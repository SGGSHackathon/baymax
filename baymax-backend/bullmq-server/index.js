/**
 * BullMQ Reminder Scheduler — Event-Driven, WhatsApp Only
 * No Twilio, no SMS, no call escalation.
 * Architecture: Python → schedule-reminder → BullMQ delayed jobs → WhatsApp
 */

require('dotenv').config({ path: '../.env' });
const express = require("express");
const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { Pool } = require("pg");

// ── Config ────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_REMINDER_URL || process.env.REDIS_URL || "redis://localhost:6379";
const PYTHON_URL = process.env.PYTHON_URL || "http://localhost:8000";
const WHATSAPP_URL = process.env.WHATSAPP_SERVER_URL || "http://localhost:5001";
const PORT = process.env.PORT || 3001;

// Postgres
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Redis
const connection = new IORedis(REDIS_URL, {
  tls: REDIS_URL.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: null,
});

connection.on("connect", () => console.log("✅ Redis connected"));
connection.on("error", (err) => console.error("❌ Redis error:", err.message));

// Single queue — no escalation queue needed
const reminderQueue = new Queue("reminder_queue", { connection });

// Express
const app = express();
app.use(express.json());

// ====================== SCHEDULE REMINDER ======================
app.post("/schedule-reminder", async (req, res) => {
  try {
    const { reminderId } = req.body;
    if (!reminderId) return res.status(400).json({ error: "Missing reminderId" });

    const { rows } = await pgPool.query(`
      SELECT r.*, u.phone 
      FROM reminders r
      JOIN users u ON r.patient_id = u.id
      WHERE r.id = $1
    `, [reminderId]);

    if (!rows.length) return res.status(404).json({ error: "Reminder not found" });

    const rem = rows[0];
    const remindTimes = rem.remind_times || [];
    const start = new Date(rem.start_date || new Date());
    const end = rem.end_date ? new Date(rem.end_date) : null;
    const now = Date.now();
    const jobIds = [];

    let currentDate = new Date(start);
    let dayCount = 0;
    const MAX_DAYS = 400;

    while (dayCount < MAX_DAYS) {
      if (end && currentDate > end) break;

      for (const timeStr of remindTimes) {
        const [hour, minute] = timeStr.split(":").map(Number);
        const fireAt = new Date(currentDate);
        fireAt.setHours(hour, minute, 0, 0);

        const delayMs = fireAt.getTime() - now;
        if (delayMs <= 0) continue;

        const dateStr = currentDate.toISOString().split("T")[0];
        const jobId = `rem:${reminderId}:${timeStr}:${dateStr}`;

        const jobData = {
          reminderId,
          patientId: rem.patient_id,
          drugName: rem.drug_name,
          dose: rem.dose || "1 tablet",
          mealInstruction: rem.meal_instruction || "after_meal",
          phone: rem.phone,
          timeStr,
          dateStr,
          logId: uuidv4(),
        };

        try {
          await reminderQueue.add("send-reminder", jobData, {
            jobId,
            delay: delayMs,
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: "exponential", delay: 30000 },
          });
          jobIds.push(jobId);
        } catch (err) {
          if (!err.message?.includes("already exists"))
            console.error(`Failed ${jobId}:`, err.message);
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
      dayCount++;
    }

    await pgPool.query("UPDATE reminders SET bullmq_job_ids = $1 WHERE id = $2", [jobIds, reminderId]);
    console.log(`📅 Scheduled ${jobIds.length} jobs for ${rem.drug_name}`);
    res.json({ scheduled: true, jobIds });
  } catch (err) {
    console.error("Schedule error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ====================== REMOVE REMINDER ======================
app.post("/remove-reminder", async (req, res) => {
  try {
    const { reminderId } = req.body;
    if (!reminderId) return res.status(400).json({ error: "Missing reminderId" });

    const { rows } = await pgPool.query("SELECT bullmq_job_ids FROM reminders WHERE id = $1", [reminderId]);
    if (!rows.length) return res.status(404).json({ error: "Reminder not found" });

    const jobIds = rows[0].bullmq_job_ids || [];
    let removed = 0;
    for (const jobId of jobIds) {
      try {
        const job = await reminderQueue.getJob(jobId);
        if (job) { await job.remove(); removed++; }
      } catch (e) { /* job may already be processed */ }
    }
    await pgPool.query("UPDATE reminders SET bullmq_job_ids = $1 WHERE id = $2", [[], reminderId]);
    res.json({ removed: true, count: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================== WORKER — Batch Same-Time, WhatsApp Only ======================
//
// If 2+ medicines share the same phone+time+date, the FIRST job to arrive
// acquires a lock, waits 5 s for the others, then sends ONE combined message.
// All log-ids are pushed to a Redis LIST `pending_acks:{phone}` with a
// shared batchId so the WhatsApp server can ACK them all at once.
//
const reminderWorker = new Worker("reminder_queue", async (job) => {
  const { reminderId, phone, drugName, dose, mealInstruction, logId, timeStr, dateStr } = job.data;
  const batchKey  = `rbatch:${phone}:${timeStr}:${dateStr}`;
  const batchId   = `${timeStr}:${dateStr}`;                       // groups same-time drugs

  // ── Push this drug into the time-batch list ──
  await connection.rpush(batchKey, JSON.stringify(
    { reminderId, drugName, dose, mealInstruction, logId, batchId }
  ));
  await connection.expire(batchKey, 60);

  // ── Try to become the sender for this batch (NX = only first one wins) ──
  const senderKey = `rbatch_lock:${phone}:${timeStr}:${dateStr}`;
  const isSender  = await connection.set(senderKey, job.id, "EX", 60, "NX");

  if (!isSender) {
    // Another worker instance will send the combined message & log everything.
    return;
  }

  // ── I'm the sender — wait for other same-time jobs to join the batch ──
  await new Promise(resolve => setTimeout(resolve, 5000));

  // ── Read the entire batch ──
  const rawItems = await connection.lrange(batchKey, 0, -1);
  const drugs    = rawItems.map(r => JSON.parse(r));
  if (!drugs.length) return;

  // ── Build message (single or combined) ──
  let msg;
  if (drugs.length === 1) {
    const d  = drugs[0];
    const mt = (d.mealInstruction || "after_meal").replace(/_/g, " ");
    msg = [
      `Hey! 👋 It's time to take your medicine.`, ``,
      `💊 *${d.drugName}*  |  Dose: *${d.dose}*`,
      `🍽️ Take it ${mt}`, ``,
      `Stay healthy! 😊`,
      `✅ Reply *taken* or ❌ *skipped*`,
    ].join("\n");
  } else {
    const list = drugs.map((d, i) => {
      const mt = (d.mealInstruction || "after_meal").replace(/_/g, " ");
      return `  ${i + 1}. 💊 *${d.drugName}* — ${d.dose} (${mt})`;
    }).join("\n");
    msg = [
      `Hey! 👋 It's time to take your medicines.`, ``,
      list, ``,
      `Stay healthy! 😊`,
      `✅ Reply *taken* for all, or ❌ *skipped*`,
    ].join("\n");
  }

  // ── Send ONE WhatsApp message for the whole batch ──
  await axios.post(`${WHATSAPP_URL}/send`, {
    number: phone, message: msg,
  }, { timeout: 15000 });

  // ── Log each drug + push to pending_acks LIST ──
  for (const d of drugs) {
    await axios.post(`${PYTHON_URL}/reminder/log-sent`, null, {
      params: {
        reminder_id: d.reminderId, log_id: d.logId, phone,
        drug_name: d.drugName, dose: d.dose, meal_instruction: d.mealInstruction,
      },
    }).catch(e => console.error("Log error:", e.message));

    await connection.rpush(`pending_acks:${phone}`, JSON.stringify({
      logId: d.logId, drugName: d.drugName, reminderId: d.reminderId, batchId,
    }));
  }
  await connection.expire(`pending_acks:${phone}`, 14400);  // 4 h TTL

  // ── Cleanup batch keys ──
  await connection.del(batchKey, senderKey);
  console.log(`💊 Reminder sent (${drugs.length} drug${drugs.length > 1 ? 's' : ''}): ${drugs.map(d => d.drugName).join(", ")} → ${phone}`);
}, { connection, concurrency: 5 });

reminderWorker.on("failed", (job, err) => {
  console.error(`❌ Reminder job failed [${job?.id}]:`, err.message);
});

// ====================== TEST ROUTE ======================
app.post("/test-reminder", async (req, res) => {
  try {
    const { phone, drugName = "Paracetamol", dose = "1 tablet", meal = "after meal" } = req.body;
    if (!phone) return res.status(400).json({ error: "Missing phone" });

    const logId   = `manual-${Date.now()}`;
    const batchId = `test:${Date.now()}`;
    const msg = `Hey! 👋 It's time to take your medicine.\n\n💊 *${drugName}* | ${dose}\n🍽️ Take it ${meal}\n\nStay healthy! 😊\nReply *taken* or *skipped*`;

    await axios.post(`${WHATSAPP_URL}/send`, { number: phone, message: msg });

    // Push to the same pending_acks LIST used by the real worker
    await connection.rpush(`pending_acks:${phone}`, JSON.stringify({
      logId, drugName, reminderId: "test", batchId,
    }));
    await connection.expire(`pending_acks:${phone}`, 14400);

    res.json({ status: "success", message: "Test reminder sent via WhatsApp", logId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", queue: "reminder_queue", redis: connection.status });
});

app.listen(PORT, () => console.log(`🚀 BullMQ Server (WhatsApp-Only) running on port ${PORT}`));