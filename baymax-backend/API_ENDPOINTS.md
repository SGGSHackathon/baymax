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

---

## 🛠️ Admin CRUD — Full Table Management

All admin CRUD endpoints follow a uniform pattern. Every database table is exposed under `/admin/crud/{slug}` with full **Create, Read, Update, Delete** support.

---

### `GET /admin/tables`

List all available table slugs with metadata.

**Response:**
```json
[
  {
    "slug": "users",
    "table": "users",
    "pk": "id",
    "search_cols": ["phone", "name", "email"]
  },
  {
    "slug": "inventory",
    "table": "inventory",
    "pk": "id",
    "search_cols": ["drug_name", "brand_name", "composition", "category"]
  }
]
```

---

### `GET /admin/tables/{slug}/schema`

Get column definitions (type, nullable, default) for a specific table.

**Example:** `GET /admin/tables/users/schema`

**Response:**
```json
{
  "slug": "users",
  "table": "users",
  "columns": [
    { "column_name": "id", "data_type": "uuid", "is_nullable": "NO", "column_default": "uuid_generate_v4()" },
    { "column_name": "phone", "data_type": "text", "is_nullable": "NO", "column_default": null },
    { "column_name": "name", "data_type": "text", "is_nullable": "YES", "column_default": null }
  ]
}
```

---

### `GET /admin/stats`

Quick row counts for every table — used by the admin dashboard.

**Response:**
```json
{
  "users": 152,
  "inventory": 20,
  "orders": 87,
  "conversations": 340,
  "prescription-uploads": 23
}
```

---

### Available Table Slugs

| Slug | Table | PK | Description |
|------|-------|----|-------------|
| `users` | users | id | User accounts & profiles |
| `families` | families | id | Family groups |
| `family-members` | family_members | id | Family member associations |
| `drug-classes` | drug_classes | id | Drug → class mappings |
| `dosage-safety-caps` | dosage_safety_caps | id | Max dosage limits |
| `drug-contraindications` | drug_contraindications | id | Contraindication rules |
| `duplicate-therapy-rules` | duplicate_therapy_rules | id | Dup therapy warnings |
| `renal-dose-rules` | renal_dose_rules | id | Renal dose adjustments |
| `inventory` | inventory | id | Drug inventory (FEFO) |
| `orders` | orders | id | Drug orders |
| `active-medications` | active_medications | id | User's current meds |
| `reminders` | reminders | id | Medication reminders |
| `reminder-logs` | reminder_logs | id | Reminder ack logs |
| `medicine-courses` | medicine_courses | id | Active medicine courses |
| `vitals` | vitals | id | Vital sign records |
| `vital-trends` | vital_trends | id | Vital trend analysis |
| `adherence-scores` | adherence_scores | id | Medication adherence |
| `adverse-reactions` | adverse_reactions | id | Drug adverse reactions |
| `health-events` | health_events | id | Health timeline events |
| `health-episodes` | health_episodes | id | Episode clusters |
| `medical-history` | medical_history | id | Medical conditions |
| `symptom-followups` | symptom_followups | id | 24hr follow-ups |
| `conversations` | conversations | id | Chat sessions |
| `conversation-messages` | conversation_messages | id | Chat messages |
| `conversation-summaries` | conversation_summaries | id | Session summaries |
| `extracted-medical-facts` | extracted_medical_facts | id | Auto-extracted facts |
| `clinical-decision-log` | clinical_decision_log | id | CDE audit log |
| `dfe-question-log` | dfe_question_log | id | DFE question log |
| `web-search-log` | web_search_log | id | Web search log |
| `dfe-field-registry` | dfe_field_registry | field_name | DFE field priority registry |
| `user-behavioral-profiles` | user_behavioral_profiles | user_id | Behavioral profiles |
| `audit-log` | audit_log | id | Immutable audit trail |
| `abuse-scores` | abuse_scores | user_id | Abuse risk scores |
| `user-consents` | user_consents | id | User consent records |
| `prescription-uploads` | prescription_uploads | id | Prescription uploads |
| `prescription-extracted-drugs` | prescription_extracted_drugs | id | Extracted drugs from Rx |
| `prescription-observations` | prescription_observations | id | Rx clinical observations |

---

### `GET /admin/crud/{slug}` — List Rows (Paginated)

**Query Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `page` | int | ❌ | 1 | Page number (1-based) |
| `per_page` | int | ❌ | 25 | Rows per page (max 100) |
| `q` | string | ❌ | — | Full-text search across searchable columns |
| `sort` | string | ❌ | — | Column name to sort by |
| `order` | string | ❌ | `desc` | `asc` or `desc` |
| `filter_{col}` | string | ❌ | — | Exact-match filter on any column |

**Example:** `GET /admin/crud/inventory?q=paracetamol&page=1&per_page=10`

**Example with filter:** `GET /admin/crud/orders?filter_status=pending&sort=ordered_at&order=desc`

**Response:**
```json
{
  "table": "inventory",
  "total": 3,
  "page": 1,
  "per_page": 10,
  "total_pages": 1,
  "data": [
    {
      "id": "uuid-1",
      "drug_name": "paracetamol",
      "brand_name": "Crocin",
      "stock_qty": 200,
      "price_per_unit": 2.50
    }
  ]
}
```

---

### `GET /admin/crud/{slug}/{pk}` — Get Single Row

**Example:** `GET /admin/crud/users/550e8400-e29b-41d4-a716-446655440000`

**Response:** Full row JSON object.

---

### `POST /admin/crud/{slug}` — Create Row

**Request Body (JSON):** Column–value pairs. Auto-generated columns (id, timestamps) are excluded automatically.

**Example:**
```http
POST /admin/crud/inventory
Content-Type: application/json

{
  "drug_name": "metformin",
  "brand_name": "Glycomet SR",
  "composition": "Metformin 500mg SR",
  "category": "antidiabetic",
  "form": "tablet",
  "strength": "500mg",
  "stock_qty": 100,
  "price_per_unit": 4.00,
  "is_otc": false,
  "expiry_date": "2027-06-01"
}
```

**Response:** The newly created row with all columns (including generated id, timestamps).

---

### `PUT /admin/crud/{slug}/{pk}` — Update Row

**Request Body (JSON):** Only the columns to update.

**Example:**
```http
PUT /admin/crud/inventory/550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "stock_qty": 150,
  "price_per_unit": 4.50
}
```

**Response:** The updated row with all columns.

---

### `DELETE /admin/crud/{slug}/{pk}` — Delete Row

**Example:** `DELETE /admin/crud/users/550e8400-e29b-41d4-a716-446655440000`

**Response:**
```json
{
  "deleted": true,
  "row": { "id": "550e...", "phone": "9876543210", "name": "Rahul" }
}
```

---

### `POST /admin/crud/{slug}/bulk-delete` — Bulk Delete

**Request Body:**
```json
{
  "ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

**Response:**
```json
{ "deleted": 3 }
```

---

## 📊 Proactive Refill & Stock Prediction

### `GET /admin/refill-alerts`

Patients whose medicine courses / reminders are running low **right now**.

Combines two sources:
- `reminders` with `qty_remaining <= refill_alert_at`
- `medicine_courses` with `qty_remaining <= frequency × 3`

**Response:**
```json
[
  {
    "record_id": "uuid",
    "source": "reminder",
    "user_id": "uuid",
    "phone": "9876543210",
    "patient_name": "Rahul",
    "drug_name": "metformin",
    "qty_remaining": 2,
    "refill_alert_at": 3,
    "urgency": "critical",
    "end_date": "2026-04-01",
    "is_active": true
  }
]
```

---

### `GET /admin/refill-forecast`

Predict which patients will need refills within the next **N days**.

**Query Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `days_ahead` | int | ❌ | 14 | Look-ahead window (1–90 days) |

**Example:** `GET /admin/refill-forecast?days_ahead=7`

**Response:**
```json
{
  "days_ahead": 7,
  "cutoff_date": "2026-03-08",
  "patients_needing_refill": 5,
  "data": [
    {
      "record_id": "uuid",
      "source": "course",
      "patient_name": "Priya",
      "drug_name": "amlodipine",
      "qty_remaining": 6,
      "daily_doses": 1,
      "remaining_days": 6,
      "predicted_runout": "2026-03-07"
    }
  ]
}
```

---

### `GET /admin/stock-prediction`

Forecast future inventory stock levels for all active drugs.

**Methodology:**
1. **Historical demand** — avg daily units ordered (past 90 days)
2. **Active consumption** — sum of daily doses from all active reminders & courses
3. **Blended daily rate** = MAX(historic, active) (conservative)
4. Predict: `stock_in_N_days = current − (rate × N)`

**Query Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `days_ahead` | int | ❌ | 30 | Forecast horizon (1–180 days) |
| `include_all` | bool | ❌ | false | Include drugs with sufficient stock |

**Example:** `GET /admin/stock-prediction?days_ahead=30`

**Response:**
```json
{
  "days_ahead": 30,
  "reorder_now": 2,
  "reorder_soon": 5,
  "total_items": 7,
  "data": [
    {
      "drug_name": "metformin",
      "brand_name": "Glycomet",
      "current_stock": 200,
      "reorder_level": 20,
      "hist_daily_demand": 3.2,
      "active_daily_demand": 4.0,
      "blended_daily_rate": 4.0,
      "predicted_stock": 80,
      "days_until_stockout": 50.0,
      "reorder_flag": "reorder_soon"
    }
  ]
}
```

---

### `GET /admin/stock-prediction/{drug_name}`

Detailed stock forecast for a **single drug** with daily breakdown.

**Query Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `days_ahead` | int | ❌ | 30 | Forecast horizon (1–180 days) |

**Example:** `GET /admin/stock-prediction/paracetamol?days_ahead=14`

**Response:**
```json
{
  "drug_name": "paracetamol",
  "inventory_batches": [
    { "brand_name": "Crocin", "stock_qty": 200, "expiry_date": "2026-12-01" },
    { "brand_name": "Dolo 650", "stock_qty": 150, "expiry_date": "2026-10-01" }
  ],
  "total_current_stock": 350,
  "demand": {
    "historic_daily_avg": 5.5,
    "active_daily_consumption": 8.0,
    "blended_daily_rate": 8.0
  },
  "forecast": {
    "days_ahead": 14,
    "days_until_stockout": 43.8,
    "predicted_reorder_date": "2026-04-01",
    "predicted_stock_at_end": 238.0,
    "daily": [
      { "day": 1, "date": "2026-03-02", "predicted_stock": 342.0 },
      { "day": 2, "date": "2026-03-03", "predicted_stock": 334.0 }
    ]
  },
  "active_patients": [
    { "id": "uuid", "phone": "9876543210", "name": "Rahul" }
  ],
  "active_patient_count": 3,
  "recent_orders": [
    { "order_number": "ORD-A1B2C3D4", "quantity": 10, "status": "delivered", "ordered_at": "2026-02-28T10:00:00" }
  ]
}
```

---

### `GET /admin/expiry-risk`

Inventory items expiring within N days, with estimated waste.

For each expiring batch, estimates whether current demand will consume stock before expiry — or if it will go to waste.

**Query Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `days_ahead` | int | ❌ | 60 | Look-ahead window (1–365 days) |

**Example:** `GET /admin/expiry-risk?days_ahead=30`

**Response:**
```json
{
  "days_ahead": 30,
  "cutoff_date": "2026-03-31",
  "expiring_items": 2,
  "total_estimated_waste_value": 450.00,
  "data": [
    {
      "drug_name": "azithromycin",
      "brand_name": "Azithral",
      "stock_qty": 50,
      "expiry_date": "2026-03-15",
      "days_left": 14,
      "daily_demand": 1.2,
      "units_consumed_before_expiry": 17,
      "estimated_waste_units": 33,
      "estimated_waste_value": 594.00,
      "risk_level": "warning"
    }
  ]
}
```
