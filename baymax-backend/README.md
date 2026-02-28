# 🏥 Medical AI — Agentic Pharmacy Assistant V6

> **Production-grade multilingual medical chatbot** powered by LangGraph multi-agent orchestration, RAG with Pinecone, Neon PostgreSQL, Redis, BullMQ, Sarvam.ai translation, and WhatsApp integration.

---

## 📁 Project Structure

```
medical-ai/
├── app/                          ← FastAPI application package
│   ├── main.py                   ← App factory, lifespan, middleware
│   ├── config.py                 ← All configuration constants
│   ├── models.py                 ← Pydantic request/response models
│   ├── singletons.py             ← LLM, embedder, Redis, DB pool
│   ├── api/
│   │   ├── routes.py             ← All HTTP endpoints
│   │   └── middleware.py         ← Rate limiter
│   ├── core/
│   │   ├── abuse.py              ← Abuse detection engine
│   │   ├── cde.py                ← Clinical Decision Engine
│   │   ├── episodes.py           ← Health episode tracking
│   │   ├── retrieval.py          ← RAG pipeline (Pinecone + reranker)
│   │   ├── risk_tier.py          ← Patient risk scoring
│   │   ├── safety.py             ← Drug safety checks
│   │   └── vitals.py             ← Vital sign monitoring
│   ├── db/
│   │   ├── helpers.py            ← Async DB queries (asyncpg)
│   │   └── redis_helpers.py      ← Redis state management
│   ├── graph/
│   │   ├── builder.py            ← LangGraph compilation
│   │   ├── state.py              ← MedState TypedDict
│   │   ├── nodes.py              ← Graph nodes (intent_router, etc.)
│   │   ├── routing.py            ← Conditional edge resolvers
│   │   ├── agents.py             ← All agent implementations
│   │   └── dfe.py                ← Dynamic Follow-up Engine
│   └── services/
│       ├── sarvam.py             ← Sarvam.ai translation/TTS/STT
│       ├── background.py         ← Background task handlers
│       ├── channel.py            ← Channel-specific formatting
│       ├── messaging.py          ← WhatsApp/SMS messaging
│       └── web_search.py         ← DuckDuckGo web search
├── bullmq-server/                ← Node.js reminder scheduler sidecar
│   ├── index.js
│   └── package.json
├── whatsapp-server/              ← whatsapp-web.js bridge
│   ├── server.js
│   └── package.json
├── offilne-sms-bot/              ← Twilio SMS bot
│   ├── index.js
│   └── package.json
├── schema_v6.sql                 ← Full PostgreSQL schema (run once)
├── requirements.txt              ← Python dependencies
├── Dockerfile                    ← Multi-stage Docker build
├── docker-compose.yml            ← Full stack orchestration
├── Procfile                      ← PaaS deployment (Render/Railway)
├── env.example                   ← Environment variable template
└── API_ENDPOINTS.md              ← API documentation
```

---

## ⚙️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| LLM | Groq `llama-3.3-70b-versatile` | 500+ tok/s, free tier |
| Embeddings | `BAAI/bge-m3` (1024d) | Dense medical embeddings |
| Reranker | `BAAI/bge-reranker-base` | Top-K accuracy boost |
| Vector DB | Pinecone Serverless | 3 namespaces (RAG) |
| SQL DB | Neon PostgreSQL | Users, orders, reminders, vitals |
| Cache / State | Upstash Redis | Session memory, pending actions |
| Queue | BullMQ (Node.js sidecar) | Reminders, escalations, follow-ups |
| Translation | Sarvam.ai | 12+ Indian languages, TTS, STT |
| WhatsApp | `whatsapp-web.js` server | Messaging |
| SMS | Twilio | SMS bot + escalation calls |
| Backend | FastAPI + Uvicorn | REST API |
| Agent Graph | LangGraph | Multi-agent state machine |

---

## 🏗️ Architecture

```
User (WhatsApp / SMS / Web / Voice)
     │
     ▼
┌──────────────────────────────────────────────┐
│           Sarvam.ai Translation Layer        │
│  detect language → translate to English      │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│              LangGraph Agent Graph           │
│                                              │
│  load_context → should_onboard?              │
│       │              │                       │
│  onboarding    pre_safety                    │
│                  │                           │
│           clinical_decision                  │
│                  │                           │
│            intent_router                     │
│         ┌───┬───┼───┬───┬───┬───┐           │
│         │   │   │   │   │   │   │           │
│        conv drug safe order rem refill fam   │
│         │   │   │   │   │   │   │           │
│         └───┴───┼───┴───┴───┴───┘           │
│              DFE (follow-up engine)          │
│                  │                           │
│            post_process                      │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│      Smart Language Response (translate out)  │
│  English input → English reply               │
│  Native script → native reply                │
│  Romanized Indic → translated + English      │
└──────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Clone & Configure
```bash
git clone https://github.com/your-username/medical-ai.git
cd medical-ai
cp env.example .env
# Fill in all API keys in .env
```

### 2. Database Setup
```bash
psql $DATABASE_URL < schema_v6.sql
```

### 3. Option A: Docker (Recommended)
```bash
docker compose up --build
# Backend: http://localhost:8000
# BullMQ:  http://localhost:3001
# WhatsApp: http://localhost:5001
```

### 3. Option B: Local Development
```bash
# Terminal 1 — Python backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — BullMQ sidecar
cd bullmq-server && npm install && node index.js

# Terminal 3 — WhatsApp server
cd whatsapp-server && npm install && node server.js
```

### 4. Option C: PaaS Deployment (Render/Railway)
The `Procfile` and `runtime.txt` are included. Set environment variables in the platform dashboard.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/whatsapp` | WhatsApp message handler |
| `POST` | `/sms` | SMS message handler |
| `POST` | `/chat` | Web chat handler |
| `POST` | `/voice` | Voice input (STT → AI → TTS) |
| `POST` | `/tts` | Text-to-speech |
| `POST` | `/stt` | Speech-to-text |
| `POST` | `/detect-language` | Language detection |
| `POST` | `/translate` | Text translation |
| `POST` | `/ack` | Reminder acknowledgement |
| `POST` | `/reminder/send` | BullMQ → send reminder |
| `POST` | `/reminder/escalate` | BullMQ → escalate missed dose |
| `POST` | `/followup/send` | BullMQ → 24hr symptom follow-up |
| `POST` | `/refill/check` | Cron — refill alerts |
| `POST` | `/vitals` | Record vital signs |
| `GET`  | `/user/{phone}` | User profile |
| `GET`  | `/user/{phone}/timeline` | Health event timeline |
| `GET`  | `/user/{phone}/adherence` | Adherence report |
| `GET`  | `/inventory/search?q=` | Fuzzy medicine search |
| `GET`  | `/inventory/low-stock` | Admin low stock alert |
| `GET`  | `/health` | Service health check |

---

## 🌐 Multilingual Support

Powered by **Sarvam.ai** — supports 12+ Indian languages:

| Language | Code | Input | Output |
|---|---|---|---|
| English | en-IN | ✅ | ✅ |
| Hindi | hi-IN | ✅ | ✅ |
| Marathi | mr-IN | ✅ | ✅ |
| Bengali | bn-IN | ✅ | ✅ |
| Tamil | ta-IN | ✅ | ✅ |
| Telugu | te-IN | ✅ | ✅ |
| Gujarati | gu-IN | ✅ | ✅ |
| Kannada | kn-IN | ✅ | ✅ |
| Malayalam | ml-IN | ✅ | ✅ |
| Punjabi | pa-IN | ✅ | ✅ |
| Odia | od-IN | ✅ | ✅ |
| Urdu | ur-IN | ✅ | ✅ |

**Smart response behavior:**
- User types in **English** → responds in English only
- User types in **native script** (देवनागरी) → responds in that language
- User types in **Romanized Indic** ("mala tablet pahije") → responds in translated language + English

---

## ✅ Implemented Features

### Safety & Clinical
- Transaction-safe ordering with `SELECT FOR UPDATE`
- Dosage safety caps validated against DB
- Drug class cross-allergy detection (penicillin → cephalosporin)
- Never-dispense controlled substance list
- Emergency keyword bypass (no LLM — instant response)
- Clinical Decision Engine with risk-tier scoring
- Dynamic Follow-up Engine (missing clinical info detection)

### Intelligence
- RAG with Pinecone (3 namespaces) + BGE reranker
- Compressed conversation memory (LLM summaries)
- Auto medical fact extraction from free text
- Adverse reaction auto-detection
- Web search for latest drug recalls/guidelines
- Medication adherence scoring engine

### Operations
- Multi-step onboarding (non-blocking — users can ask questions immediately)
- Family member management with relation tracking
- Order for family members
- Reminder scheduling with BullMQ job queue
- Twilio escalation calls for missed doses
- Proactive refill alerts
- Vital sign monitoring with threshold alerts

### Multilingual
- Sarvam.ai translation middleware (auto-detect + translate)
- Voice input/output (STT + TTS)
- Smart language response (English/native/both)
- Name preservation (no translation mangling)

---

## 🗄️ Database Schema (21+ Tables)

| # | Table | Purpose |
|---|---|---|
| 1 | `users` | Patient profiles, allergies, conditions |
| 2 | `families` | Family group definitions |
| 3 | `family_members` | Roles + relation (sister, brother, etc.) |
| 4 | `drug_classes` | Drug → class mapping for allergy detection |
| 5 | `dosage_safety_caps` | Max daily doses per drug |
| 6 | `inventory` | Medicine stock with FEFO expiry |
| 7 | `active_medications` | Current medicines per patient |
| 8 | `orders` | Placed orders with auto-computed total |
| 9 | `reminders` | Dose reminder schedules |
| 10 | `reminder_logs` | Per-dose sent/ack/escalated log |
| 11 | `adherence_scores` | Weekly adherence % per medicine |
| 12 | `conversations` | Chat sessions |
| 13 | `conversation_messages` | Messages with intent metadata |
| 14 | `conversation_summaries` | Compressed session memory |
| 15 | `extracted_medical_facts` | Auto-extracted allergies/conditions |
| 16 | `adverse_reactions` | Drug reaction reports |
| 17 | `health_events` | Chronological health timeline |
| 18 | `symptom_followups` | 24hr follow-up tracking |
| 19 | `vitals` | BP, sugar, SpO2, temp, heart rate |
| 20 | `audit_log` | Immutable change trail |
| 21 | `medical_history` | Long-term conditions |

---

## ⚠️ Disclaimers

1. **This system is for informational purposes only.** It is not a licensed medical device.
2. All drug information should be verified by a licensed pharmacist or doctor.
3. Never rely solely on AI for dosage decisions in clinical settings.
4. For production pharmacy deployment, regulatory compliance (CDSCO, DPDP Act) is required.

---

## 📝 License

MIT

---

*Built with LangGraph · Groq · Pinecone · Neon · Redis · BullMQ · Sarvam.ai · whatsapp-web.js*
