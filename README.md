# BayMax AI Healthcare Platform

Production-ready, multilingual AI healthcare platform with:
- Agentic medical chat and triage
- Medicine ordering + Razorpay payment flow
- WhatsApp/SMS notification and reminder workflows
- Prescription OCR processing
- Admin operations and proactive risk analytics
- Langfuse observability tracing

## Monorepo Structure

```text
ai-final/
├─ baymax-backend/                # FastAPI + LangGraph + DB + integrations
│  ├─ app/
│  │  ├─ api/                     # Routes, auth, middleware
│  │  ├─ core/                    # Clinical/safety/retrieval engines
│  │  ├─ db/                      # DB/Redis helpers
│  │  ├─ graph/                   # Agent graph, state, nodes
│  │  ├─ observability/           # Langfuse client helpers
│  │  └─ services/                # Messaging, scheduler, web search, Sarvam
│  ├─ migrations/                 # SQL migrations
│  ├─ whatsapp-server/            # Node whatsapp-web.js bridge
│  └─ bullmq-server/              # Node worker service
└─ baymax-frontend/               # Next.js web app + admin panel
```

## Core Capabilities

### Patient Experience
- AI chat for symptom support and medicine guidance
- Voice, translation, and multilingual responses
- Order initiation from chat
- Razorpay checkout before final order confirmation
- Profile order history and payment continuation
- Reminder setup for active medicine courses

### Clinical + Safety
- CDE/risk-tier safety checks in ordering flow
- Duplicate-order and dosage guardrails
- Emergency sensitivity routing
- Recall/search augmentation where available

### Operations + Admin
- Table-based admin CRUD explorer
- Stock, refill, and expiry views
- Proactive AI/log intelligence widgets (client-side computed)

### Observability
- Request-level Langfuse traces
- Generation spans for agent/LLM segments
- Tool spans for retrieval/DB flow points
- Error event capture from middleware and route path

## Prerequisites

- Node.js 18+
- Python 3.11 or 3.12 (recommended)
- PostgreSQL (Neon supported)
- Redis (Upstash supported)

> Important: Python 3.14 causes dependency issues in this stack (notably `pydantic-core` build path). Use Python 3.11/3.12.

## Environment Setup

### Backend env
1. Copy template:
   - `baymax-backend/env.example` → `baymax-backend/.env`
2. Fill required keys for:
   - DB/Redis
   - Groq
   - Sarvam
   - Razorpay
   - WhatsApp/SMS/Twilio (as needed)
   - Langfuse:
     - `LANGFUSE_PUBLIC_KEY`
     - `LANGFUSE_SECRET_KEY`
     - `LANGFUSE_HOST` (or `LANGFUSE_BASE_URL`)

### Frontend env
Create `baymax-frontend/.env.local` with at least:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Local Development (Windows-first)

## 1) Backend

```powershell
cd baymax-backend
py -3.12 -m venv .venv312
.\.venv312\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Alternative launcher:
```powershell
powershell -ExecutionPolicy Bypass -File .\start_backend.ps1
```

## 2) WhatsApp Server

```powershell
cd baymax-backend\whatsapp-server
npm install
node server.js
```

## 3) Frontend

```powershell
cd baymax-frontend
npm install
npm run dev
```

Open: `http://localhost:3000`

## 4) Optional Worker

```powershell
cd baymax-backend\bullmq-server
npm install
node index.js
```

## API Surface (high-level)

- Auth/user/profile APIs
- Streaming chat endpoint (`/stream`)
- Prescription upload/OCR endpoints
- Order + payment endpoints
  - initiate payment
  - verify payment
- Admin tables/stats/operations endpoints

For route-level details, see:
- `baymax-backend/API_ENDPOINTS.md`

## Payment + Order Status Flow

- Chat/profile can initiate payment for unpaid orders
- Payment verification updates order state to confirmed and marks payment paid
- Notification fanout (email/SMS/WhatsApp) runs post-verification path

## Langfuse Tracing

Tracing is initialized from `app/observability/langfuse_client.py` and attached via HTTP middleware.

Expected trace behavior:
- One trace per request/session
- Generation spans for agent/LLM blocks
- Tool spans for retrieval/DB operations
- Error events on middleware/streaming failures

Quick smoke check:
1. Start backend
2. Send one `/stream` request
3. Open Langfuse project and filter by session/user

## Admin Proactive Intelligence (Frontend)

On log-like admin datasets, UI computes locally (no backend calls):
- High-risk responses (24h)
- Average risk
- Hallucination rate
- Escalation count
- Prescription-without-indication rate
- Risk trend chart (date-wise avg risk)
- AI summary from recent rows
- Smart filters (High Risk, Escalations, Hallucinations, Pediatric)

All calculations are client-side using existing in-state rows.

## Troubleshooting

### `pydantic-core` / Rust build failure during install
Cause: wrong Python version (3.14).
Fix: use Python 3.11/3.12 and reinstall in a fresh venv.

### No Langfuse traces visible
- Verify env keys are set
- Confirm backend restart after env changes
- Ensure SDK version is `<3` for current tracing API
- Send a real `/stream` request and check recent traces

### Backend starts but chat fails
- Check DB and Redis connectivity
- Check Groq/Sarvam keys
- Verify `NEXT_PUBLIC_API_URL` points to backend

## Deployment Notes

- Backend can be containerized (`Dockerfile`, `docker-compose.yml` in backend)
- Keep secrets only in deployment env, never in repo
- For production: enforce CORS origin, secure JWT secret, and rotate API keys

## Security Note

Treat all credentials as sensitive. If any secrets were exposed in local logs/history, rotate them immediately.

## License

Internal project / not publicly licensed by default.
