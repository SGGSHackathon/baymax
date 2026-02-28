/**
 * SMS Agent — Twilio webhook that bridges SMS ↔ Medical AI backend.
 *
 * Fixes vs. original:
 *  - channel = "sms" (not "whatsapp") → backend strips emoji/bold/markdown
 *  - Phone normalised to digits-only (no +, no spaces)
 *  - Hard SMS limit of 1500 chars (Twilio max 1600, leave margin)
 *  - Proper error handling + logging
 */

require("dotenv").config();
const express = require("express");
const axios   = require("axios");
const twilio  = require("twilio");

const app  = express();
const PORT = process.env.PORT || 3000;

// Twilio sends application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const MEDICAL_AI_BASE = process.env.PYTHON_URL || "http://localhost:8000";

// ── Helpers ──────────────────────────────────────────────────
function normalisePhone(raw) {
  // Twilio sends "+919876543210" — strip everything except digits
  return raw.replace(/[^\d]/g, "");
}

function trimForSMS(text, max = 1500) {
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + "...";
}

// ── Call backend /sms endpoint ───────────────────────────────
async function callMedicalAI(phone, message) {
  try {
    const res = await axios.post(`${MEDICAL_AI_BASE}/sms`, {
      phone,
      message,
      channel: "sms",
    }, { timeout: 30000 });
    return res.data;
  } catch (err) {
    console.error("Medical AI error:", err.response?.data || err.message);
    return null;
  }
}

// ── Twilio SMS webhook ───────────────────────────────────────
app.post("/sms", async (req, res) => {
  const from    = req.body.From;
  const message = (req.body.Body || "").trim();

  if (!from || !message) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Please send a message to get started.");
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const phone = normalisePhone(from);
  console.log(`SMS from ${phone}: ${message}`);

  const aiResponse = await callMedicalAI(phone, message);
  const twiml      = new twilio.twiml.MessagingResponse();

  if (!aiResponse || !aiResponse.reply) {
    twiml.message("Sorry, the system is temporarily unavailable. Please try again in a moment.");
  } else {
    let reply = aiResponse.reply;

    // Emergency prefix
    if (aiResponse.emergency) {
      reply = "EMERGENCY ALERT\n\n" + reply + "\n\nPlease call emergency services immediately.";
    }

    twiml.message(trimForSMS(reply));
  }

  res.type("text/xml").send(twiml.toString());
});

// ── Health ───────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "sms-agent", backend: MEDICAL_AI_BASE });
});

app.get("/", (_req, res) => {
  res.json({ status: "running", service: "Offline SMS Bot" });
});

app.listen(PORT, () => {
  console.log(`SMS Agent running on port ${PORT}`);
  console.log(`Backend: ${MEDICAL_AI_BASE}`);
});