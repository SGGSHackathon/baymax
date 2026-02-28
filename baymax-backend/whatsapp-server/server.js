require('dotenv').config();
const axios = require('axios');
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');
const morgan = require('morgan');
const cors = require('cors');
const IORedis = require('ioredis');

const app = express();
const PORT = 5001;
const PYTHON_URL = process.env.PYTHON_URL || "http://localhost:8000";
const REDIS_URL = process.env.REDIS_REMINDER_URL || process.env.REDIS_URL || "redis://localhost:6379";

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
  const bodyLower = message.body.toLowerCase().trim();
  const phoneKey  = message.from.replace('@c.us', '');

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
      const allRaw = await redis.lrange(`pending_acks:${phoneKey}`, 0, -1);

      if (allRaw.length > 0) {
        const allPending    = allRaw.map(r => JSON.parse(r));
        const oldestBatchId = allPending[0].batchId;           // FIFO — oldest first

        // Separate current batch (same batchId) from the rest
        const currentBatch = allPending.filter(p => p.batchId === oldestBatchId);
        const remaining    = allPending.filter(p => p.batchId !== oldestBatchId);

        // ACK every drug in the current batch via Python /ack
        const drugNames = [];
        for (const entry of currentBatch) {
          await axios.post(`${PYTHON_URL}/ack`, {
            log_id: entry.logId,
            response: ackResponse,
          }).catch(e => console.error('ACK call failed:', e.message));
          drugNames.push(entry.drugName);
        }

        // Replace the list with only the remaining items
        await redis.del(`pending_acks:${phoneKey}`);
        if (remaining.length > 0) {
          for (const r of remaining) {
            await redis.rpush(`pending_acks:${phoneKey}`, JSON.stringify(r));
          }
          await redis.expire(`pending_acks:${phoneKey}`, 14400);
        }

        // Build reply
        const emoji    = ackResponse === 'taken' ? '✅' : '❌';
        const drugList = drugNames.map(n => `*${n}*`).join(', ');
        let reply = `${emoji} *${ackResponse.toUpperCase()}* logged for ${drugList}`;

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

  // ── 3. AI CHAT — requires /chat prefix ──
  if (!bodyLower.startsWith('/chat')) return;

  const chatMessage = message.body.trim().substring(5).trim();
  if (!chatMessage) {
    return message.reply('Please type your message after /chat\nExample: `/chat I have headache`');
  }

  try {
    const payload = { phone: message.from, message: chatMessage, channel: 'whatsapp' };
    const response = await axios.post(`${PYTHON_URL}/whatsapp`, payload);

    if (response.data?.reply) {
      await message.reply(response.data.reply);
    } else {
      await message.reply('No reply from AI. Please try again.');
    }
  } catch (err) {
    console.error('Agent API error:', err.message);
    await message.reply('Sorry, AI is temporarily unavailable. Try again later.');
  }
});

client.initialize();

// ====================== SEND ENDPOINT (called by BullMQ worker) ======================
// Pure message delivery — ACK state is managed by BullMQ worker via Redis directly.
app.post('/send', async (req, res) => {
  try {
    const { number, message: msg } = req.body;
    if (!number || !msg) {
      return res.status(400).json({ error: 'Missing number or message' });
    }
    const formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
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

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Web Server running on http://localhost:${PORT}`);
  console.log('Session saved in ./.wwebjs_cache — QR only on first run');
  console.log('ACK tracking: Redis-backed (persistent)');
});