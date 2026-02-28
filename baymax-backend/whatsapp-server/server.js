require('dotenv').config();
const axios = require('axios');
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');
const morgan = require('morgan');
const cors = require('cors');
const IORedis = require('ioredis');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5001;
const PYTHON_URL = process.env.PYTHON_URL || "http://localhost:8000";
const REDIS_URL = process.env.REDIS_REMINDER_URL || process.env.REDIS_URL || "redis://localhost:6379";
const APP_LOCK_FILE = path.join(__dirname, '.wa_server.lock');
const SESSION_DIR = path.join(__dirname, '.wwebjs_cache', 'session');

function isProcessRunning(pid) {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function acquireAppLock() {
  try {
    if (fs.existsSync(APP_LOCK_FILE)) {
      const existing = JSON.parse(fs.readFileSync(APP_LOCK_FILE, 'utf8'));
      if (existing?.pid && isProcessRunning(existing.pid)) {
        console.error(`⚠️ WhatsApp server already running (PID ${existing.pid}). Exiting.`);
        process.exit(0);
      }
      try { fs.unlinkSync(APP_LOCK_FILE); } catch {}
    }
    fs.writeFileSync(APP_LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (e) {
    console.error('❌ Failed to acquire app lock:', e.message);
    process.exit(1);
  }
}

function releaseAppLock() {
  try {
    if (fs.existsSync(APP_LOCK_FILE)) fs.unlinkSync(APP_LOCK_FILE);
  } catch {}
}

function clearChromiumSingletonLocks() {
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const name of lockFiles) {
    const lockPath = path.join(SESSION_DIR, name);
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch {}
  }
}

// ── Redis for persistent ACK tracking (survives restarts) ──
const redis = new IORedis(REDIS_URL, {
  tls: REDIS_URL.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: 3,
});
redis.on("connect", () => console.log("✅ Redis connected (WhatsApp ACK store)"));
redis.on("error", (err) => console.error("❌ Redis error:", err.message));

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

acquireAppLock();

// ====================== PERSISTENT WHATSAPP CLIENT ======================
const client = new Client({
  authStrategy: new LocalAuth({ 
    dataPath: './.wwebjs_cache'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920x1080'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('📲 QR Code received - Scan with WhatsApp!');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('🔐 WhatsApp authenticated successfully!');
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready! (using .wwebjs_cache)');
});

client.on('disconnected', (reason) => {
  console.log('❌ Client disconnected:', reason);
});

// ====================== MESSAGE HANDLER ======================
//
// ACK logic is FIFO + batch-aware:
// ─ pending_acks:{phone} is a Redis LIST of {logId, drugName, reminderId, batchId}
// ─ Drugs that share a batchId were sent in ONE combined reminder message.
// ─ One "taken" reply ACKs every drug in the oldest batch.
// ─ If drugs from a different batch are still pending, the user is prompted.
//
client.on('message', async (message) => {
  console.log(`\n💬 MESSAGE RECEIVED from ${message.from}: "${message.body}"`);
  const bodyLower = message.body.toLowerCase().trim();

  // ── Resolve real phone number (handles both @c.us and @lid formats) ──
  let phoneKey;
  if (message.from.endsWith('@lid')) {
    // LID format: internal WhatsApp ID, need to get real number from contact
    try {
      const contact = await message.getContact();
      phoneKey = contact.number || contact.id?.user || '';
      console.log(`📱 LID resolved: ${message.from} → contact.number=${contact.number}, using=${phoneKey}`);
    } catch (e) {
      console.error('Failed to resolve LID contact:', e.message);
      phoneKey = '';
    }
  } else {
    phoneKey = message.from.replace('@c.us', '');
  }

  if (!phoneKey) {
    console.error('❌ Could not resolve phone number from', message.from);
    return;
  }

  // Normalize phone to local 10-digit form (must match users.phone in backend DB)
  const digits = phoneKey.replace(/\D/g, '');
  const normalizedPhone = digits.length > 10 && digits.startsWith('91')
    ? digits.slice(2)
    : digits.slice(-10);

  if (bodyLower === 'ping') return message.reply('pong');

  // ── 1. Detect ACK keywords ──
  let ackResponse = null;
  if (['taken', 'yes', 'done', 'le liya', 'liya', 'kha liya', 'li'].some(w => bodyLower.includes(w))) {
    ackResponse = 'taken';
  } else if (['skipped', 'skip', 'nahi liya', 'nahi li', 'bhul gaya', 'missed'].some(w => bodyLower.includes(w))) {
    ackResponse = 'skipped';
  }

  // ── 2. Process ACK against pending_acks LIST ──
  if (ackResponse) {
    try {
      const allRaw = await redis.lrange(`pending_acks:${normalizedPhone}`, 0, -1);

      if (allRaw.length > 0) {
        const allPending    = allRaw.map(r => JSON.parse(r));
        const oldestBatchId = allPending[0].batchId;           // FIFO — oldest first

        // Separate current batch (same batchId) from the rest
        const currentBatch = allPending.filter(p => p.batchId === oldestBatchId);
        const remaining    = allPending.filter(p => p.batchId !== oldestBatchId);

        // ACK every drug in the current batch via Python /ack
        const drugNames = [];
        let lastAckResult = null;
        for (const entry of currentBatch) {
          try {
            const ackResp = await axios.post(`${PYTHON_URL}/ack`, {
              log_id: entry.logId,
              response: ackResponse,
            });
            lastAckResult = ackResp.data;
          } catch (e) {
            console.error('ACK call failed:', e.message);
          }
          drugNames.push(entry.drugName);
        }

        // Replace the list with only the remaining items
        await redis.del(`pending_acks:${normalizedPhone}`);
        if (remaining.length > 0) {
          for (const r of remaining) {
            await redis.rpush(`pending_acks:${normalizedPhone}`, JSON.stringify(r));
          }
          await redis.expire(`pending_acks:${normalizedPhone}`, 14400);
        }

        // Build reply
        const emoji    = ackResponse === 'taken' ? '✅' : '❌';
        const drugList = drugNames.map(n => `*${n}*`).join(', ');
        let reply = `${emoji} *${ackResponse.toUpperCase()}* logged for ${drugList}`;

        // Show remaining doses from backend response
        if (lastAckResult && lastAckResult.qty_remaining != null) {
          reply += `\n📊 *${lastAckResult.doses_taken || 0}* doses taken`;
          if (lastAckResult.qty_remaining <= 3 && lastAckResult.qty_remaining > 0) {
            reply += `  |  ⚠️ Only *${lastAckResult.qty_remaining}* dose${lastAckResult.qty_remaining !== 1 ? 's' : ''} left!`;
          } else if (lastAckResult.qty_remaining > 0) {
            reply += `  |  💊 *${lastAckResult.qty_remaining}* remaining`;
          }
        }

        // Notify about next pending batch (different time)
        if (remaining.length > 0) {
          const nextBatchId = remaining[0].batchId;
          const nextBatch   = remaining.filter(r => r.batchId === nextBatchId);
          const nextDrugs   = nextBatch.map(r => `*${r.drugName}*`).join(', ');
          reply += `\n\n⏳ *Still pending:* ${nextDrugs}\nReply *taken* or *skipped* when done.`;
        }

        await message.reply(reply);
        return;
      }
      // No pending acks → fall through to /chat
    } catch (err) {
      console.error('ACK error:', err.message);
      await message.reply('❌ Could not log your response. Please try again.');
      return;
    }
  }

  try {
    const payload = { phone: normalizedPhone, message: message.body, channel: 'whatsapp' };
    console.log(`📤 Sending to backend: ${PYTHON_URL}/whatsapp`, JSON.stringify(payload));
    const response = await axios.post(`${PYTHON_URL}/whatsapp`, payload, { timeout: 120000 });
    console.log(`📥 Backend response:`, JSON.stringify(response.data).slice(0, 200));

    if (response.data?.reply) {
      await message.reply(response.data.reply);
    } else {
      await message.reply('No reply from AI. Please try again.');
    }
  } catch (err) {
    console.error('Agent API error:', err.response?.status, err.response?.data || err.message);
    await message.reply('Sorry, AI is temporarily unavailable. Try again later.');
  }
});

let isShuttingDown = false;

async function initWhatsAppClient() {
  try {
    await client.initialize();
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('The browser is already running for')) {
      console.warn('⚠️ Detected stale Chromium session lock. Cleaning and retrying once...');
      clearChromiumSingletonLocks();
      await new Promise(resolve => setTimeout(resolve, 1000));
      await client.initialize();
      return;
    }
    throw err;
  }
}

// ====================== SEND ENDPOINT (called by BullMQ worker) ======================
// Pure message delivery — ACK state is managed by BullMQ worker via Redis directly.
app.post('/send', async (req, res) => {
  try {
    const { number, message: msg } = req.body;
    if (!number || !msg) {
      return res.status(400).json({ error: 'Missing number or message' });
    }
    // Normalize: strip non-digits, prepend 91 if 10-digit Indian number
    let normalized = number.replace(/\D/g, '');
    if (normalized.length === 10) normalized = '91' + normalized;
    const formattedNumber = number.includes('@c.us') ? number : `${normalized}@c.us`;
    console.log(`📤 Sending to ${formattedNumber} (raw: ${number})`);
    await client.sendMessage(formattedNumber, msg);
    res.json({ status: 'sent' });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Health endpoints
app.get('/ping', (req, res) => res.send('pong'));
app.get('/', (req, res) => res.json({ 
  status: 'running',
  service: 'WhatsApp Web Service',
  ack_store: 'Redis',
}));

const server = app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Web Server running on http://localhost:${PORT}`);
  console.log('Session saved in ./.wwebjs_cache — QR only on first run');
  console.log('ACK tracking: Redis-backed (persistent)');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Another WhatsApp server instance is likely running.`);
    releaseAppLock();
    process.exit(0);
  }
  console.error('❌ Server startup error:', err);
  releaseAppLock();
  process.exit(1);
});

async function shutdownAndExit(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try { await client.destroy(); } catch {}
  try { await redis.quit(); } catch {}
  try { server.close(); } catch {}
  releaseAppLock();
  process.exit(code);
}

process.on('SIGINT', () => shutdownAndExit(0));
process.on('SIGTERM', () => shutdownAndExit(0));
process.on('uncaughtException', async (err) => {
  console.error('❌ Uncaught exception:', err);
  await shutdownAndExit(1);
});
process.on('unhandledRejection', async (err) => {
  console.error('❌ Unhandled rejection:', err);
  await shutdownAndExit(1);
});

initWhatsAppClient().catch(async (err) => {
  console.error('❌ WhatsApp client initialization failed:', err?.message || err);
  await shutdownAndExit(1);
});