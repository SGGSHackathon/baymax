# Medical AI V6 — API Endpoints Reference

> Base URL: `http://localhost:8000`

---

## 🟢 Health Check

### `GET /health`

No input required.

**Response:**
```json
{
  "status": "healthy",
  "version": "6.0",
  "vectors": 12345
}
```

---

## 💬 Chat Endpoints

### `POST /whatsapp`

Primary chatbot endpoint for WhatsApp integration.

**Request Body (JSON):**
```json
{
  "phone": "+919876543210",
  "message": "I have a headache and fever since 2 days",
  "session_id": "optional_session_id",
  "channel": "whatsapp"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | ✅ | User's phone number |
| `message` | string | ✅ | User's message (max 1500 chars) |
| `session_id` | string | ❌ | Session ID (auto-generated if empty) |
| `channel` | string | ❌ | Defaults to `"whatsapp"` |

**Response:**
```json
{
  "reply": "Based on your symptoms...",
  "session_id": "wa_abc123",
  "agent_used": "conversation_agent",
  "emergency": false,
  "safety_flags": [],
  "triage_level": "low",
  "requires_action": null,
  "risk_tier": 1,
  "channel": "whatsapp",
  "dfe_triggered": false,
  "web_search_used": false
}
```

---

### `POST /chat`

Web chatbot endpoint — same input as `/whatsapp`, but returns richer Markdown output.

**Request Body (JSON):**
```json
{
  "phone": "+919876543210",
  "message": "What is paracetamol used for?",
  "session_id": "web_session_123",
  "channel": "web"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | ✅ | User's phone number |
| `message` | string | ✅ | User's message |
| `session_id` | string | ❌ | Auto-generated if empty |
| `channel` | string | ❌ | Defaults to `"whatsapp"` (set `"web"` for Markdown) |

**Response:** Same schema as `/whatsapp`.

---

### `POST /stream`

Server-Sent Events (SSE) streaming endpoint for real-time web chat.

**Request Body (JSON):**
```json
{
  "phone": "+919876543210",
  "message": "Tell me about ibuprofen side effects"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | ✅ | User's phone number |
| `message` | string | ✅ | User's message |
| `session_id` | string | ❌ | Auto-generated if empty |

**Response:** `text/event-stream` with chunked events:

```
data: {"type":"meta","tier":1,"triage":"none"}

data: {"type":"token","text":"Ibuprofen is","done":false}

data: {"type":"token","text":" a non-steroidal","done":false}

data: {"type":"token","text":"","done":true,"session_id":"web_abc123"}
```

---

## 🌐 Multilingual & Voice Endpoints (Sarvam.ai)

> All chat endpoints (`/whatsapp`, `/chat`, `/sms`) now **auto-detect** the user's language, translate to English for the LLM, and translate the reply back to the user's preferred language. No special parameters needed.

### `POST /voice`

Full voice pipeline: Audio → STT → Graph → Translation → TTS.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | ✅ | Audio file (WAV, MP3, OGG, etc.) |
| `phone` | string | ✅ | User's phone number |
| `session_id` | string | ❌ | Session ID (auto-generated) |
| `channel` | string | ❌ | Defaults to `"whatsapp"` |

**Response:**
```json
{
  "transcript": "मुझे बुखार है",
  "detected_language": "hi-IN",
  "reply": "आपको बुखार कितने दिनों से है?",
  "reply_english": "How many days have you had a fever?",
  "audio_base64": "UklGRi4AAABXQVZFZm10...",
  "session_id": "voice_abc123",
  "agent_used": "conversation_agent",
  "emergency": false
}
```

---

### `POST /tts`

Convert text to speech audio.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | ✅ | Text to convert to speech |
| `language` | string | ❌ | BCP-47 code (default `"hi-IN"`) |
| `speaker` | string | ❌ | Voice name (default `"anushka"`) |

**Response:**
```json
{
  "audio_base64": "UklGRi4AAABXQVZFZm10...",
  "language": "hi-IN"
}
```

---

### `POST /stt`

Transcribe audio to text.

**Request:** `multipart/form-data` with `file` field.

**Response:**
```json
{
  "transcript": "मुझे बुखार है",
  "language_code": "hi-IN"
}
```

---

### `POST /detect-language`

Detect language of text input.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | ✅ | Text to identify |

**Response:**
```json
{
  "language_code": "hi-IN"
}
```

---

### `POST /translate`

Translate text between supported languages.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | ✅ | Text to translate |
| `source_lang` | string | ❌ | Source language (default `"auto"`) |
| `target_lang` | string | ❌ | Target language (default `"en-IN"`) |

**Supported Languages:**
`en-IN`, `hi-IN`, `bn-IN`, `gu-IN`, `kn-IN`, `ml-IN`, `mr-IN`, `od-IN`, `pa-IN`, `ta-IN`, `te-IN`, `as-IN`, `ur-IN`, `ne-IN`, `kok-IN`, `ks-IN`, `sd-IN`, `sa-IN`

**Response:**
```json
{
  "translated_text": "I have a fever",
  "source_language": "hi-IN",
  "target_language": "en-IN"
}
```

---

## 💊 Drug Recall Check

### `GET /recall-check/{drug_name}`

Checks FDA recall status for a specific drug.

**URL Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `drug_name` | string | ✅ | Name of the drug (in URL path) |

**Query Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | ❌ | User's phone (for logging) |

**Example:** `GET /recall-check/ranitidine?phone=+919876543210`

**Response:**
```json
{
  "drug": "ranitidine",
  "recall_detected": true,
  "source": "fda.gov",
  "evidence": "FDA recalled ranitidine due to...",
  "label": "📚 External source (FDA)"
}
```

---

## ⏰ Reminder & Acknowledgement

### `POST /ack`

Acknowledge a medication reminder (taken/skipped).

**Request Body (JSON):**
```json
{
  "log_id": "reminder-log-uuid",
  "response": "taken"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `log_id` | string | ✅ | Reminder log UUID |
| `response` | string | ✅ | `"taken"`, `"yes"`, `"done"`, `"skipped"`, `"no"` |

**Response:**
```json
{
  "status": "taken",
  "log_id": "reminder-log-uuid"
}
```

---

## 🔔 BullMQ Callbacks (Internal)

These endpoints are called by the BullMQ job server, not by users directly.

### `POST /reminder/send`

**Query Parameters:**

| Field | Type | Required |
|-------|------|----------|
| `reminder_id` | string | ✅ |
| `log_id` | string | ✅ |
| `phone` | string | ✅ |
| `drug_name` | string | ✅ |
| `dose` | string | ✅ |
| `meal_instruction` | string | ✅ |

---

### `POST /reminder/escalate`

**Query Parameters:**

| Field | Type | Required |
|-------|------|----------|
| `log_id` | string | ✅ |
| `phone` | string | ✅ |
| `drug_name` | string | ✅ |

---

### `POST /followup/send`

**Query Parameters:**

| Field | Type | Required |
|-------|------|----------|
| `followup_id` | string | ✅ |
| `phone` | string | ✅ |
| `symptom` | string | ✅ |

---

### `POST /followup/response`

**Query Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | ✅ | User's phone |
| `response` | string | ✅ | `"better"`, `"same"`, or `"worse"` |

---

## 🩺 Vitals

### `POST /vitals`

Record patient vital signs. Triggers threshold alerts and trend analysis.

**Request Body (JSON):**
```json
{
  "phone": "+919876543210",
  "bp_systolic": 140,
  "bp_diastolic": 90,
  "blood_sugar": 180.5,
  "spo2_pct": 96.0,
  "temp_celsius": 38.2,
  "heart_rate": 88,
  "weight_kg": 72.5
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | ✅ | User's phone |
| `bp_systolic` | int | ❌ | Systolic BP (mmHg) |
| `bp_diastolic` | int | ❌ | Diastolic BP (mmHg) |
| `blood_sugar` | float | ❌ | Blood sugar (mg/dL) |
| `spo2_pct` | float | ❌ | Oxygen saturation (%) |
| `temp_celsius` | float | ❌ | Body temperature (°C) |
| `heart_rate` | int | ❌ | Heart rate (bpm) |
| `weight_kg` | float | ❌ | Weight (kg) |

**Response:**
```json
{
  "status": "recorded",
  "alerts": ["🚨 BP very high: 180/100 mmHg"]
}
```

---

## 📋 Cron / Scheduled Tasks

### `POST /refill/check`

Checks all users for low medication stock and sends refill alerts. No input needed.

**Response:**
```json
{ "checked": 5, "sent": 2 }
```

---

### `POST /inventory/low-stock-alert`

Sends admin alert for low-stock inventory items. No input needed.

**Response:**
```json
{ "low_items": 3 }
```

---

## 👤 User Endpoints

### `GET /user/{phone}`

Get full user profile.

**Example:** `GET /user/+919876543210`

**Response:**
```json
{
  "id": "uuid",
  "phone": "+919876543210",
  "name": "Rahul",
  "age": 28,
  "gender": "male",
  "allergies": ["penicillin"],
  "chronic_conditions": [],
  "is_pregnant": false,
  "risk_tier": 1,
  "current_meds": ["metformin"],
  "overall_adherence": 85.5
}
```

---

### `GET /user/{phone}/timeline`

Get recent health events.

**Query Parameters:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `limit` | int | ❌ | 30 |

**Example:** `GET /user/+919876543210/timeline?limit=10`

---

### `GET /user/{phone}/adherence`

Get medication adherence scores.

**Example:** `GET /user/+919876543210/adherence`

**Response:**
```json
{
  "overall": 85.5,
  "records": [
    {
      "drug_name": "metformin",
      "score": 90.0,
      "risk_flag": "high",
      "week_start": "2026-02-17",
      "total_taken": 12,
      "total_skipped": 2
    }
  ]
}
```

---

### `GET /user/{phone}/episodes`

Get health episode history (symptom clusters).

**Example:** `GET /user/+919876543210/episodes`

---

### `GET /user/{phone}/risk`

Get risk profile and abuse status.

**Example:** `GET /user/+919876543210/risk`

**Response:**
```json
{
  "risk_tier": 2,
  "tier_constraints": { "escalate_doctor": false, "short_response": false, "conservative": false },
  "abuse_score": 0,
  "abuse_flags": [],
  "abuse_blocked": false
}
```

---

### `GET /user/{phone}/clinical-report`

Generate a doctor-ready clinical summary report.

**Example:** `GET /user/+919876543210/clinical-report`

**Response:**
```json
{
  "generated_at": "2026-02-23T16:30:00",
  "patient": {
    "name": "Rahul",
    "age": 28,
    "gender": "male",
    "allergies": ["penicillin"],
    "chronic_conditions": [],
    "risk_tier": 1,
    "overall_adherence": 85.5
  },
  "active_medications": [...],
  "adverse_reactions": [...],
  "health_episodes": [...],
  "recent_vitals": [...],
  "recent_health_events": [...],
  "disclaimer": "This report was auto-generated..."
}
```

---

### `GET /user/{phone}/dfe-history`

Get Dynamic Follow-Up Engine question log.

**Query Parameters:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `limit` | int | ❌ | 20 |

**Example:** `GET /user/+919876543210/dfe-history?limit=5`

---

## 📦 Inventory

### `GET /inventory/search`

Fuzzy search inventory by drug name.

**Query Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | ✅ | Search query (min 2 chars) |
| `limit` | int | ❌ | Max results (default 5) |

**Example:** `GET /inventory/search?q=paracetamol&limit=3`

---

### `GET /inventory/low-stock`

List all low-stock inventory items. No input needed.

---

### `GET /inventory/expiring`

List inventory items expiring soon. No input needed.

---

## 🔐 Admin Endpoints

### `GET /admin/abuse-risk`

List users flagged for abuse review. No input needed.

**Response:**
```json
[
  {
    "phone": "+919876543210",
    "name": "User",
    "score": 5,
    "flags": ["CONTROLLED_DRUG", "RAPID_REFILL"],
    "review_required": true,
    "blocked": false
  }
]
```

---

### `GET /admin/vital-trend-alerts`

List users with concerning vital trends. No input needed.

---

### `GET /admin/cde-log`

View Clinical Decision Engine audit log.

**Query Parameters:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `limit` | int | ❌ | 50 |

**Example:** `GET /admin/cde-log?limit=20`
