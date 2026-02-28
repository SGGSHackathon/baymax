"""
╔══════════════════════════════════════════════════════════════════════╗
║  MEDICAL AI V6 — Adaptive Clinical Reasoning Engine                  ║
║  FastAPI + LangGraph + Groq + Pinecone + Neon + Redis + BullMQ       ║
╠══════════════════════════════════════════════════════════════════════╣
║  NEW IN V6 (vs V5):                                                  ║
║                                                                      ║
║  🧠 DYNAMIC FOLLOW-UP ENGINE (DFE) — Core V6 Layer:                 ║
║    ✅ Structured FOLLOWUP_REQUIREMENTS per symptom×age group         ║
║    ✅ Priority-scored missing variable detection (5 clinical factors)║
║    ✅ LLM-generated questions (no hardcoded robotic text)            ║
║    ✅ Tier-adaptive: Tier 5 → 1 max question OR immediate escalation ║
║    ✅ Episode-aware: followup_count ≥ 2 → escalation screening mode  ║
║    ✅ Behavioral adaptation: ignores/short-replies reshape questions  ║
║    ✅ Red-flag FIRST screening for elderly + high-risk profiles       ║
║    ✅ All DFE Q&A logged to dfe_question_log table                   ║
║                                                                      ║
║  🌐 CONTROLLED WEB SEARCH (Safe Secondary Intelligence Layer):       ║
║    ✅ Triggers ONLY when RAG + DB = empty                            ║
║    ✅ Triggers for: new drugs, recalls, outbreaks, guidelines        ║
║    ✅ Trusted source allowlist: WHO, CDC, NIH, FDA, NHS, PubMed      ║
║    ✅ All untrusted domains rejected silently                        ║
║    ✅ Results cached in Pinecone external_verified namespace         ║
║    ✅ Always labeled: "📚 External source (WHO/NIH/FDA)" in reply    ║
║    ✅ NEVER used for dosage, CDE, renal rules, contraindications     ║
║    ✅ Drug recall detection: flags inventory + admin WhatsApp alert  ║
║                                                                      ║
║  💬 DUAL-CHANNEL (WhatsApp + Web Chatbot):                           ║
║    ✅ channel="whatsapp" → *bold*, concise, emoji-first              ║
║    ✅ channel="web" → rich markdown, longer answers                  ║
║    ✅ /chat endpoint for web frontend (JSON)                         ║
║    ✅ /stream endpoint for web (Server-Sent Events streaming)        ║
║    ✅ /whatsapp endpoint unchanged (backward-compatible)             ║
║    ✅ Session state portable across both channels per user           ║
║                                                                      ║
║  🤖 PROACTIVE CLINICAL REASONING (Claude/GPT-level behavior):        ║
║    ✅ DFE asks single most critical question (priority scored)       ║
║    ✅ child+fever → asks age+temp (not generic "how long?")          ║
║    ✅ elderly+dizziness → red-flag screen (chest pain, vision, etc.) ║
║    ✅ high-triage → skips questions, directly escalates              ║
║    ✅ Closed-ended questions for users who give short answers        ║
║    ✅ Reassurance-first for anxiety-pattern users                    ║
║                                                                      ║
║  ALL V5 FEATURES PRESERVED + ENHANCED:                               ║
║    ✅ Clinical Decision Engine — also checks web recall data         ║
║    ✅ Risk Tier System (1–5) — drives DFE question strategy          ║
║    ✅ Health Episode Tracking — DFE reads active episode context     ║
║    ✅ Vital Trend Engine — unchanged                                  ║
║    ✅ Cumulative Abuse Scoring — unchanged                            ║
║    ✅ Renal / Duplicate / Polypharmacy checks — unchanged            ║
║    ✅ Onboarding state machine — unchanged                           ║
║    ✅ Background tasks — unchanged                                   ║
║    ✅ Clinical report — includes DFE question history                ║
║                                                                      ║
║  V6 GRAPH FLOW:                                                      ║
║    load_context → pre_safety → clinical_decision_node               ║
║    → intent_router → dynamic_followup_engine                        ║
║    → [if DFE has question → post_process]                           ║
║    → [else → target agent → post_process]                           ║
╚══════════════════════════════════════════════════════════════════════╝

pip install:
  fastapi uvicorn asyncpg langchain langchain-groq langgraph
  pinecone-client sentence-transformers redis httpx python-dotenv
  duckduckgo-search
"""


import os, json, hashlib, logging, re, time
from datetime import datetime, timedelta, date
from typing import Optional, Any
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict

from pinecone import Pinecone
from sentence_transformers import SentenceTransformer, CrossEncoder
import redis.asyncio as aioredis
import asyncpg

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("medai.v5")


# ══════════════════════════════════════════════════════════════
# §1  CONFIGURATION
# ══════════════════════════════════════════════════════════════
class C:
    GROQ_API_KEY   = os.getenv("GROQ_API_KEY", "")
    PINECONE_KEY   = os.getenv("PINECONE_API_KEY", "")
    DATABASE_URL   = os.getenv("DATABASE_URL", "")
    REDIS_URL      = os.getenv("REDIS_URL", "redis://localhost:6379")
    BULLMQ_URL     = os.getenv("BULLMQ_SERVER_URL", "http://localhost:3001")
    WHATSAPP_URL   = os.getenv("WHATSAPP_SERVER_URL", "http://localhost:3002")
    ADMIN_PHONE    = os.getenv("ADMIN_PHONE", "")
    BULLMQ_SECRET  = os.getenv("BULLMQ_SECRET", "")
    ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")

    INDEX_NAME = os.getenv("PINECONE_INDEX", "medical-rag")
    NS_GENERAL = "general_knowledge"
    NS_DRUGS   = "drug_database"
    NS_SAFETY  = "safety_rules"

    LLM_MODEL    = "llama-3.3-70b-versatile"
    EMBED_MODEL  = "BAAI/bge-m3"
    RERANK_MODEL = "BAAI/bge-reranker-base"

    RETRIEVAL_TOP_K     = 8
    RERANK_TOP          = 3
    CACHE_TTL           = 3600
    ACK_TIMEOUT_SECS    = 3600
    INTENT_CONF_MIN     = 0.72
    AUTO_APPLY_CONF     = 0.85
    FOLLOWUP_HOURS      = 24
    MAX_MSG_LEN         = 1500
    RATE_LIMIT_MIN      = 20
    POLY_PHARMACY_LIMIT = 5       # active meds > this → polypharmacy flag
    ABUSE_BLOCK_SCORE   = 8       # cumulative abuse score → hard block
    ABUSE_REVIEW_SCORE  = 4       # → flag for manual review

    EMERGENCY_KW = [
        "chest pain", "heart attack", "can't breathe", "cannot breathe",
        "difficulty breathing", "stroke", "unconscious", "overdose",
        "suicidal", "want to die", "seizure", "fits", "anaphylaxis",
        "blood vomiting", "coughing blood", "not responding", "severe allergic",
    ]
    SEVERE_KW = {
        "high": [
            "103°f", "104°f", "105°f", "very high fever", "severe headache blurred",
            "chest tightness", "child not responding", "severe abdominal pain",
            "can't walk", "lost consciousness", "bleeding profusely",
        ],
        "medium": [
            "fever 101", "102°f", "persistent vomiting", "rash spreading",
            "moderate pain", "difficulty swallowing", "swollen throat",
        ],
    }
    SYMPTOM_KW = [
        "fever", "headache", "cough", "cold", "pain", "vomiting", "diarrhea",
        "rash", "itching", "breathless", "stomach", "nausea", "dizzy", "throat",
        "allergy", "swelling", "weakness", "fatigue", "runny nose", "chills", "chest",
    ]
    ADVERSE_KW = [
        "after taking", "after having", "side effect", "feel dizzy after",
        "nausea from", "rash after", "allergic to", "reaction to",
        "feel bad after", "feel sick after", "vomiting after", "this medicine causing",
    ]
    NEVER_DISPENSE = [
        "morphine", "oxycodone", "fentanyl", "buprenorphine", "methadone",
        "ketamine", "cocaine", "heroin", "methamphetamine", "ranitidine",
    ]
    CONTROLLED_WATCH = ["clonazepam", "alprazolam", "diazepam", "lorazepam", "codeine", "tramadol"]

    # ── V6: Web Search Trusted Sources ──────────────────────────
    TRUSTED_SEARCH_DOMAINS = [
        "who.int", "cdc.gov", "nih.gov", "fda.gov", "ema.europa.eu",
        "pubmed.ncbi.nlm.nih.gov", "nhs.uk", "drugs.com/fda",
        "medlineplus.gov", "clinicaltrials.gov", "rxlist.com",
        "accessdata.fda.gov",   # FDA recall database
    ]
    WEB_SEARCH_TRIGGERS = [
        "recall", "recalled", "banned", "new drug", "latest guideline",
        "recent study", "outbreak", "new research", "just approved",
        "newly approved", "not in database", "not available",
    ]
    NS_EXTERNAL = "external_verified"  # Pinecone namespace for verified web results

    # ── V6: DFE (Dynamic Follow-Up Engine) ──────────────────────
    # Clinical requirement map: symptom_context → fields needed
    FOLLOWUP_REQUIREMENTS: dict = {
        "fever_child": {
            "required": ["temperature_value", "age", "duration"],
            "red_flags": ["seizure", "not responding", "stiff neck", "rash all over"],
            "escalate_if": ["seizure", "not responding", "stiff neck"],
        },
        "fever_adult": {
            "required": ["temperature_value", "duration"],
            "red_flags": ["confusion", "chest pain", "difficulty breathing"],
            "escalate_if": ["confusion", "chest pain"],
        },
        "fever_elderly": {
            "required": ["temperature_value", "duration"],
            "red_flags": ["confusion", "chest pain", "not responding", "breathing difficulty"],
            "escalate_if": ["confusion", "not responding"],
        },
        "dizziness_elderly": {
            "required": ["duration", "chest_pain_yn", "vision_change_yn", "weakness_yn"],
            "red_flags": ["fainting", "stroke symptoms", "sudden headache", "face drooping"],
            "escalate_if": ["fainting", "face drooping", "stroke"],
        },
        "dizziness_adult": {
            "required": ["duration", "position_related_yn"],
            "red_flags": ["chest pain", "fainting", "hearing loss"],
            "escalate_if": ["fainting"],
        },
        "cough": {
            "required": ["duration", "breathing_difficulty_yn", "fever_yn"],
            "red_flags": ["blood in sputum", "coughing blood", "breathing severely"],
            "escalate_if": ["blood in sputum", "coughing blood"],
        },
        "chest_pain": {
            "required": [],                         # No questions — immediate escalation
            "red_flags": ["*"],                     # Everything is red flag
            "escalate_if": ["*"],
        },
        "abdominal_pain": {
            "required": ["location", "duration", "vomiting_yn", "fever_yn"],
            "red_flags": ["severe sudden onset", "rigid abdomen", "blood in stool"],
            "escalate_if": ["severe sudden onset", "rigid abdomen"],
        },
        "headache": {
            "required": ["duration", "severity_1_10", "fever_yn"],
            "red_flags": ["thunderclap headache", "worst ever", "stiff neck", "vision changes"],
            "escalate_if": ["thunderclap headache", "worst ever"],
        },
        "breathing_difficulty": {
            "required": [],                         # Immediate escalation
            "red_flags": ["*"],
            "escalate_if": ["*"],
        },
        "generic": {
            "required": ["duration"],
            "red_flags": [],
            "escalate_if": [],
        },
    }
    # Priority weights per missing field type
    DFE_WEIGHTS: dict = {
        "red_flag_screen":    5,  # Screening for red flags
        "triage_affecting":   4,  # Changes triage level
        "safety_affecting":   3,  # Affects medicine safety
        "dosing_affecting":   2,  # Needed for dose calculation
        "context_adding":     1,  # Nice-to-have context
    }
    # Fields and their priority classification
    DFE_FIELD_PRIORITY: dict = {
        "temperature_value":     "triage_affecting",
        "age":                   "safety_affecting",
        "duration":              "context_adding",
        "chest_pain_yn":         "red_flag_screen",
        "vision_change_yn":      "red_flag_screen",
        "weakness_yn":           "red_flag_screen",
        "breathing_difficulty_yn":"red_flag_screen",
        "fever_yn":              "triage_affecting",
        "vomiting_yn":           "context_adding",
        "severity_1_10":         "triage_affecting",
        "location":              "context_adding",
        "position_related_yn":   "context_adding",
        "weight_kg":             "dosing_affecting",
    }
    DFE_BEHAVIORAL_MAX_IGNORES = 2   # After N ignores, downgrade or skip

    MEAL_INST = {
        "paracetamol": "after_meal",   "ibuprofen": "after_meal",
        "aspirin": "after_meal",        "metformin": "after_meal",
        "omeprazole": "before_meal",    "pantoprazole": "before_meal",
        "domperidone": "before_meal",   "ciprofloxacin": "empty_stomach",
        "montelukast": "before_sleep",  "atorvastatin": "any",
        "cetirizine": "any",            "amlodipine": "any",
        "metoprolol": "after_meal",     "losartan": "any",
    }
    FREQ_TIMES = {
        "once_daily":   ["08:00"],
        "twice_daily":  ["08:00", "20:00"],
        "thrice_daily": ["08:00", "14:00", "20:00"],
        "four_times":   ["06:00", "12:00", "18:00", "22:00"],
        "before_sleep": ["21:00"],
    }
    FOOD_DRUG = {
        "atorvastatin":  ["grapefruit"],
        "simvastatin":   ["grapefruit"],
        "warfarin":      ["alcohol", "leafy greens", "cranberry"],
        "metronidazole": ["alcohol"],
        "doxycycline":   ["dairy", "calcium", "milk", "yogurt"],
        "ciprofloxacin": ["dairy", "antacids", "calcium"],
        "amlodipine":    ["grapefruit"],
        "metformin":     ["alcohol"],
        "clonazepam":    ["alcohol"],
    }
    # Symptom keyword → episode type mapping
    EPISODE_MAP = {
        "respiratory":    ["fever", "cough", "cold", "breathless", "throat", "runny nose", "chills"],
        "gi":             ["vomiting", "diarrhea", "stomach", "nausea", "abdominal"],
        "cardiac":        ["chest pain", "palpitation", "heart", "blood pressure"],
        "neurological":   ["headache", "dizzy", "seizure", "confusion", "memory"],
        "musculoskeletal":["joint pain", "back pain", "muscle", "sprain"],
    }
    # Vital danger thresholds
    VITAL_CRITICAL = {
        "spo2_pct":    90,
        "bp_systolic": 180,
        "blood_sugar": 400,
        "temp_celsius": 40.0,
        "heart_rate":  150,
    }
    VITAL_HIGH = {
        "spo2_pct":    94,
        "bp_systolic": 160,
        "blood_sugar": 300,
        "temp_celsius": 39.5,
        "heart_rate":  120,
    }
    # Abuse score weights per event
    ABUSE_WEIGHTS = {
        "controlled_drug":    3,
        "rapid_refill":       2,
        "multi_controlled":   3,
        "night_order":        1,
        "dose_increase_ask":  2,
        "prescription_refuse":2,
    }


# ══════════════════════════════════════════════════════════════
# §2  SINGLETONS
# ══════════════════════════════════════════════════════════════
_embedder = _reranker = _pinecone = _redis = _llm = _http = _pool = None

def get_embedder():
    global _embedder
    if not _embedder:
        _embedder = SentenceTransformer(C.EMBED_MODEL)
        logger.info(f"✅ Embedder: {C.EMBED_MODEL}")
    return _embedder

def get_reranker():
    global _reranker
    if not _reranker:
        _reranker = CrossEncoder(C.RERANK_MODEL)
        logger.info(f"✅ Reranker: {C.RERANK_MODEL}")
    return _reranker

def get_pinecone():
    global _pinecone
    if not _pinecone:
        _pinecone = Pinecone(api_key=C.PINECONE_KEY).Index(C.INDEX_NAME)
        logger.info(f"✅ Pinecone: {C.INDEX_NAME}")
    return _pinecone

def get_llm():
    global _llm
    if not _llm:
        _llm = ChatGroq(api_key=C.GROQ_API_KEY, model=C.LLM_MODEL, temperature=0.1, max_tokens=1200)
        logger.info(f"✅ LLM: {C.LLM_MODEL}")
    return _llm

async def get_redis():
    global _redis
    if not _redis:
        try:
            _redis = aioredis.from_url(C.REDIS_URL, decode_responses=True)
            await _redis.ping()
            logger.info("✅ Redis connected")
        except Exception as e:
            logger.warning(f"Redis unavailable: {e}")
            _redis = None
    return _redis

async def get_pool():
    global _pool
    if not _pool:
        _pool = await asyncpg.create_pool(dsn=C.DATABASE_URL, min_size=2, max_size=12, command_timeout=30)
        logger.info("✅ DB pool ready")
    return _pool

async def get_http():
    global _http
    if not _http:
        _http = httpx.AsyncClient(timeout=10.0)
    return _http


# ══════════════════════════════════════════════════════════════
# §3  PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════
class WhatsAppIncoming(BaseModel):
    phone: str
    message: str
    session_id: Optional[str] = None
    channel: str = "whatsapp"

    @field_validator("message")
    @classmethod
    def clean_msg(cls, v):
        v = v.strip()[:C.MAX_MSG_LEN]
        # Prompt-injection hardening
        v = re.sub(r"(ignore previous|disregard all|system:\s|<\|im_start\|>)", "", v, flags=re.I)
        return v

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, v):
        return re.sub(r"[^\d+]", "", v)[:20]

class ChatResponse(BaseModel):
    reply: str
    session_id: str
    agent_used: str
    emergency: bool = False
    safety_flags: list[str] = []
    triage_level: Optional[str] = None
    requires_action: Optional[str] = None
    risk_tier: int = 1
    # V6 additions
    channel: str = "whatsapp"
    dfe_triggered: bool = False
    web_search_used: bool = False

class AckRequest(BaseModel):
    log_id: str
    response: str

class VitalInput(BaseModel):
    phone: str
    bp_systolic:  Optional[int]   = None
    bp_diastolic: Optional[int]   = None
    blood_sugar:  Optional[float] = None
    spo2_pct:     Optional[float] = None
    temp_celsius: Optional[float] = None
    heart_rate:   Optional[int]   = None
    weight_kg:    Optional[float] = None


# ══════════════════════════════════════════════════════════════
# §4  DATABASE HELPERS
# ══════════════════════════════════════════════════════════════
async def db_fetchrow(sql: str, *args) -> Optional[dict]:
    pool = await get_pool()
    row  = await pool.fetchrow(sql, *args)
    return dict(row) if row else None

async def db_fetch(sql: str, *args) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(sql, *args)
    return [dict(r) for r in rows]

async def db_execute(sql: str, *args) -> str:
    pool = await get_pool()
    return await pool.execute(sql, *args)

async def get_user_by_phone(phone: str) -> Optional[dict]:
    return await db_fetchrow(
        """SELECT u.*, ARRAY_AGG(DISTINCT am.drug_name) FILTER (WHERE am.is_active) AS current_meds
           FROM users u
           LEFT JOIN active_medications am ON u.id = am.user_id AND am.is_active = TRUE
           WHERE u.phone = $1
           GROUP BY u.id""", phone)

async def create_user(phone: str) -> dict:
    return await db_fetchrow(
        """INSERT INTO users(phone, onboarded, onboarding_step)
           VALUES($1, FALSE, 'name')
           ON CONFLICT(phone) DO UPDATE SET updated_at = NOW()
           RETURNING *""", phone)

async def update_user(phone: str, **fields) -> dict:
    if not fields: return {}
    pool = await get_pool()
    sets = ", ".join(f"{k}=${i+2}" for i, k in enumerate(fields))
    row  = await pool.fetchrow(
        f"UPDATE users SET {sets}, updated_at=NOW() WHERE phone=$1 RETURNING *",
        phone, *fields.values())
    return dict(row) if row else {}

async def get_recent_messages(session_id: str, limit: int = 6) -> list[dict]:
    rows = await db_fetch(
        "SELECT role, content, created_at FROM conversation_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT $2",
        session_id, limit)
    return list(reversed(rows))

async def get_session_summary(user_id: str) -> Optional[str]:
    row = await db_fetchrow(
        "SELECT summary_text FROM conversation_summaries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", user_id)
    return row["summary_text"] if row else None

async def get_drug_classes_for(drug: str) -> list[str]:
    rows = await db_fetch("SELECT class_name FROM drug_classes WHERE drug_name=LOWER($1)", drug)
    return [r["class_name"] for r in rows]

async def get_drugs_in_class(cls: str) -> list[str]:
    rows = await db_fetch("SELECT drug_name FROM drug_classes WHERE class_name=$1", cls)
    return [r["drug_name"] for r in rows]

async def get_dosage_cap(drug: str) -> Optional[dict]:
    return await db_fetchrow("SELECT * FROM dosage_safety_caps WHERE drug_name=LOWER($1)", drug)

async def get_inventory_fuzzy(query: str, limit: int = 5) -> list[dict]:
    return await db_fetch(
        """SELECT id, drug_name, brand_name, strength, form, stock_qty, unit, price_per_unit, is_otc, drug_class
           FROM inventory
           WHERE is_active=TRUE AND stock_qty>0
             AND (drug_name ILIKE $2 OR brand_name ILIKE $2
                  OR similarity(LOWER(drug_name), LOWER($1)) > 0.25
                  OR similarity(LOWER(brand_name), LOWER($1)) > 0.25)
           ORDER BY GREATEST(similarity(LOWER(drug_name),LOWER($1)),
                             similarity(LOWER(brand_name),LOWER($1))) DESC
           LIMIT $3""",
        query, f"%{query}%", limit)

async def check_stock(drug: str) -> Optional[dict]:
    return await db_fetchrow(
        """SELECT id, drug_name, brand_name, stock_qty, unit, price_per_unit, is_otc, strength, form, drug_class
           FROM inventory
           WHERE (LOWER(drug_name)=LOWER($1) OR LOWER(brand_name)=LOWER($1))
             AND is_active=TRUE AND stock_qty>0
           ORDER BY expiry_date ASC LIMIT 1""", drug)

async def log_audit(user_id: str, action: str, entity_type: str = None,
                    entity_id: str = None, old_val: dict = None,
                    new_val: dict = None, performed_by: str = "system"):
    await db_execute(
        """INSERT INTO audit_log(user_id, action, entity_type, entity_id, old_value, new_value, performed_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)""",
        user_id, action, entity_type, entity_id,
        json.dumps(old_val) if old_val else None,
        json.dumps(new_val) if new_val else None,
        performed_by)

async def log_health_event(user_id: str, event_type: str, title: str,
                           description: str = None, drug_name: str = None,
                           metadata: dict = None, episode_id: str = None):
    await db_execute(
        """INSERT INTO health_events(user_id, event_type, title, description, drug_name, metadata, episode_id)
           VALUES($1,$2,$3,$4,$5,$6,$7)""",
        user_id, event_type, title, description, drug_name,
        json.dumps(metadata or {}), episode_id)

async def update_adherence(user_id: str, drug_name: str, taken: bool):
    week_start = date.today() - timedelta(days=date.today().weekday())
    pool = await get_pool()
    row  = await pool.fetchrow(
        """INSERT INTO adherence_scores(user_id, drug_name, week_start, total_scheduled, total_taken, total_skipped)
           VALUES($1,$2,$3,1,$4,$5)
           ON CONFLICT(user_id, drug_name, week_start) DO UPDATE SET
               total_scheduled = adherence_scores.total_scheduled + 1,
               total_taken     = adherence_scores.total_taken + $4,
               total_skipped   = adherence_scores.total_skipped + $5
           RETURNING score""",
        user_id, drug_name, week_start,
        1 if taken else 0, 0 if taken else 1)
    if row:
        score = float(row["score"])
        flag  = "low" if score < 50 else ("medium" if score < 70 else "high")
        await pool.execute(
            "UPDATE adherence_scores SET risk_flag=$4 WHERE user_id=$1 AND drug_name=$2 AND week_start=$3",
            user_id, drug_name, week_start, flag)
        await pool.execute(
            """UPDATE users SET overall_adherence=(
                   SELECT ROUND(AVG(score),2) FROM adherence_scores
                   WHERE user_id=$1 AND week_start >= CURRENT_DATE - 28)
               WHERE id=$1""", user_id)


# ══════════════════════════════════════════════════════════════
# §5  REDIS HELPERS
# ══════════════════════════════════════════════════════════════
async def r_get(key: str) -> Optional[str]:
    rd = await get_redis()
    if rd:
        try: return await rd.get(key)
        except: pass
    return None

async def r_set(key: str, val: Any, ttl: int = C.CACHE_TTL):
    rd = await get_redis()
    if rd:
        try: await rd.setex(key, ttl, json.dumps(val) if not isinstance(val, str) else val)
        except: pass

async def r_del(key: str):
    rd = await get_redis()
    if rd:
        try: await rd.delete(key)
        except: pass

async def r_incr(key: str, ttl: int = 60) -> int:
    rd = await get_redis()
    if rd:
        try:
            v = await rd.incr(key)
            if v == 1: await rd.expire(key, ttl)
            return v
        except: pass
    return 0


# ══════════════════════════════════════════════════════════════
# §6  RETRIEVAL ENGINE
# ══════════════════════════════════════════════════════════════
def _embed(text: str) -> list[float]:
    return get_embedder().encode(text, normalize_embeddings=True).tolist()

def _rerank(query: str, docs: list[str]) -> list[tuple]:
    if not docs: return []
    scores = get_reranker().predict([(query, d) for d in docs])
    return sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)[:C.RERANK_TOP]

async def retrieve(query: str, namespace: str, top_k: int = None, filters: dict = None) -> list[dict]:
    top_k = top_k or C.RETRIEVAL_TOP_K
    ck    = f"rag:{namespace}:{hashlib.md5(query.encode()).hexdigest()}"
    rd    = await get_redis()
    if rd:
        try:
            cached = await rd.get(ck)
            if cached: return json.loads(cached)
        except: pass
    try:
        kw = dict(vector=_embed(query), top_k=top_k, namespace=namespace, include_metadata=True)
        if filters: kw["filter"] = filters
        matches = get_pinecone().query(**kw).get("matches", [])
    except Exception as e:
        logger.error(f"Pinecone: {e}"); return []
    if not matches: return []
    texts    = [m["metadata"].get("text", "") for m in matches]
    reranked = _rerank(query, texts)
    output   = []
    for text, score in reranked:
        orig = next((m for m in matches if m["metadata"].get("text", "") == text), None)
        if orig:
            output.append({"text": text, "score": round(float(score), 4),
                           "source": orig["metadata"].get("source", ""),
                           "severity": orig["metadata"].get("severity", "")})
    if rd:
        try: await rd.setex(ck, 1800, json.dumps(output))
        except: pass
    return output


# ══════════════════════════════════════════════════════════════
# §7  SAFETY & TRIAGE HELPERS
# ══════════════════════════════════════════════════════════════
def triage_severity(msg: str) -> str:
    m = msg.lower()
    if any(k in m for k in C.EMERGENCY_KW): return "emergency"
    if any(k in m for k in C.SEVERE_KW.get("high", [])): return "high"
    if any(k in m for k in C.SEVERE_KW.get("medium", [])): return "medium"
    if any(k in m for k in C.SYMPTOM_KW): return "low"
    return "none"

def is_blocked_drug(msg: str) -> Optional[str]:
    m = msg.lower()
    return next((d for d in C.NEVER_DISPENSE if d in m), None)

def detect_caregiver_ctx(msg: str) -> Optional[str]:
    m = msg.lower()
    if any(k in m for k in ["my child", "my son", "my daughter", "my baby", "my kid", "my toddler", "my infant"]): return "child"
    if any(k in m for k in ["my mother", "my father", "my mom", "my dad", "my parent", "my elderly"]): return "parent"
    if any(k in m for k in ["my wife", "my husband", "my spouse", "my partner"]): return "spouse"
    return None

def detect_adverse_reaction(msg: str) -> bool:
    return any(k in msg.lower() for k in C.ADVERSE_KW)

def check_food_drug(drug: str, message: str) -> Optional[str]:
    for food in C.FOOD_DRUG.get(drug.lower(), []):
        if food in message.lower():
            return f"⚠️ *Food Interaction:* Avoid *{food}* while taking {drug.title()} — affects absorption/effectiveness."
    return None

async def extract_drugs_from_inventory(message: str) -> list[str]:
    """V4+: Fuzzy inventory search instead of static hardcoded list."""
    words = re.findall(r"[a-zA-Z]+", message)
    found = set()
    for w in words:
        if len(w) < 4: continue
        res = await get_inventory_fuzzy(w, limit=1)
        if res and res[0].get("drug_name"):
            found.add(res[0]["drug_name"].lower())
    return list(found)

async def check_class_allergy(drug: str, allergies: list[str]) -> list[dict]:
    warnings = []
    for cls in await get_drug_classes_for(drug.lower()):
        class_drugs = await get_drugs_in_class(cls)
        for allergy in (allergies or []):
            if allergy.lower() in class_drugs or allergy.lower() == cls:
                warnings.append({"severity": "CRITICAL",
                    "text": (f"You are allergic to *{allergy}* ({cls} class). "
                             f"*{drug.title()}* is in the same class. ⛔ Cross-allergy risk.")})
    return warnings

async def check_interactions_rag(drug: str, current_meds: list[str]) -> list[dict]:
    if not current_meds: return []
    results = await retrieve(f"drug interaction {drug} with {' '.join(current_meds)}", C.NS_SAFETY, top_k=6)
    return [{"severity": r["severity"], "text": r["text"][:300]}
            for r in results if r.get("severity") in ("CRITICAL", "HIGH", "MODERATE")]


# ══════════════════════════════════════════════════════════════
# §8  V5 RISK TIER ENGINE
# ══════════════════════════════════════════════════════════════
def compute_risk_tier(user: dict) -> int:
    """
    Returns 1–5.
    Tier 1 = Healthy adult
    Tier 2 = Mild chronic condition
    Tier 3 = Multi-morbidity or polypharmacy
    Tier 4 = Elderly (>70) / child (<12) / pregnant
    Tier 5 = Critical combination of high-risk factors
    """
    score  = 0
    age    = user.get("age") or 30
    conds  = user.get("chronic_conditions") or []
    meds   = user.get("current_meds") or []
    adh    = user.get("overall_adherence")

    # Age risk
    if   age > 70: score += 3
    elif age > 60: score += 1
    if   age < 5:  score += 4
    elif age < 12: score += 2

    if user.get("is_pregnant"):                         score += 3
    score += min(len(conds), 4)                         # max +4 from conditions
    if len(meds) >= C.POLY_PHARMACY_LIMIT:              score += 2
    if adh is not None and float(adh) < 50:             score += 1

    if   score >= 9: return 5
    elif score >= 6: return 4
    elif score >= 4: return 3
    elif score >= 2: return 2
    return 1

def get_tier_constraints(tier: int) -> dict:
    """Behaviour constraints per risk tier."""
    BASE = {"escalate_doctor": False, "short_response": False,
            "conservative": False, "extra_warning": ""}
    if tier == 5:
        return {**BASE, "escalate_doctor": True, "short_response": True, "conservative": True,
                "esc_timeout_secs": 900,
                "extra_warning": "🚨 *High-risk profile — please consult your doctor before taking any new medicine.*"}
    if tier == 4:
        return {**BASE, "short_response": True, "conservative": True,
                "esc_timeout_secs": 1800,
                "extra_warning": "⚠️ *Extra caution required. Always verify medicines with your doctor.*"}
    if tier == 3:
        return {**BASE, "conservative": True, "esc_timeout_secs": 2700}
    return {**BASE, "esc_timeout_secs": C.ACK_TIMEOUT_SECS}


# ══════════════════════════════════════════════════════════════
# §9  V5 CLINICAL DECISION ENGINE (CDE)
# ══════════════════════════════════════════════════════════════
async def run_cde(user: dict, drug: str) -> dict:
    """
    Core V5 safety layer. Runs BEFORE every drug-related response.
    Every evaluation is logged to clinical_decision_log.

    Returns:
      block           bool  — hard block (contraindication / allergy)
      warnings        list  — all warnings [{severity, text}]
      requires_doctor bool  — doctor consult needed
      dose_adjustment dict  — renal/hepatic adjustment if applicable
      escalate        bool  — auto-escalate (tier 5 or critical finding)
      risk_tier       int   — computed tier
      dup_therapy     str   — duplicate therapy message or None
    """
    t0 = time.monotonic()
    uid       = str(user.get("id", ""))
    allergies = user.get("allergies") or []
    conds     = user.get("chronic_conditions") or []
    cur_meds  = user.get("current_meds") or []
    age       = user.get("age") or 30
    pregnant  = user.get("is_pregnant", False)
    egfr      = user.get("egfr")
    tier      = compute_risk_tier(user)

    block           = False
    warnings        = []
    requires_doctor = False
    dose_adjustment = None
    escalate        = False
    dup_therapy     = None

    drug_l = drug.lower()

    # ── 1. Cross-class allergy ────────────────────────────────
    allergy_warns = await check_class_allergy(drug, allergies)
    if allergy_warns:
        block = True
        warnings.extend(allergy_warns)

    # ── 2. DB contraindication check ─────────────────────────
    for cond in conds:
        rows = await db_fetch(
            """SELECT severity, rationale
               FROM drug_contraindications
               WHERE drug_name=LOWER($1) AND condition=LOWER($2)""",
            drug, cond)
        for row in rows:
            sev = row["severity"]
            warnings.append({"severity": sev.upper(),
                "text": f"🚨 *Contraindication ({sev.upper()}):* {row['rationale']}"})
            if sev == "critical":
                block = True
            if sev in ("critical", "high"):
                requires_doctor = True

    # ── 3. Pregnancy block ────────────────────────────────────
    if pregnant:
        preg_rows = await db_fetch(
            "SELECT severity, rationale FROM drug_contraindications WHERE drug_name=LOWER($1) AND condition='pregnancy'",
            drug)
        if preg_rows:
            for row in preg_rows:
                sev = row["severity"]
                warnings.append({"severity": "CRITICAL",
                    "text": f"🤰 *Pregnancy Alert ({sev.upper()}):* {row['rationale']}"})
                if sev in ("critical", "high"):
                    block = True
                requires_doctor = True
        else:
            # Generic caution for all Rx drugs during pregnancy
            warnings.append({"severity": "MODERATE",
                "text": "🤰 You are pregnant. Please verify this medicine is safe with your doctor before use."})
            requires_doctor = True

    # ── 4. Age-specific blocks ────────────────────────────────
    if age < 16 and drug_l == "aspirin":
        block = True
        warnings.insert(0, {"severity": "CRITICAL",
            "text": "⛔ *Aspirin is contraindicated under age 16* — Reye's syndrome risk. Use paracetamol."})
    if age < 18 and drug_l in ("ciprofloxacin", "levofloxacin", "ofloxacin"):
        warnings.append({"severity": "HIGH",
            "text": f"⚠️ {drug.title()} should generally be avoided in children — cartilage development risk."})
        requires_doctor = True
    if age < 3:
        warnings.append({"severity": "HIGH",
            "text": "⚠️ Patient under 3 years — all medicines must be weight-based and approved by a paediatrician."})
        requires_doctor = True

    # ── 5. Duplicate therapy detection ───────────────────────
    new_classes = await get_drug_classes_for(drug)
    for med in (cur_meds or []):
        med_classes = await get_drug_classes_for(med)
        overlap = set(new_classes) & set(med_classes)
        for cls in overlap:
            dup_row = await db_fetchrow(
                "SELECT warning, severity FROM duplicate_therapy_rules WHERE drug_class=$1", cls)
            if dup_row:
                dup_therapy = dup_row["warning"]
                sev = dup_row["severity"]
                warnings.append({"severity": sev.upper(),
                    "text": (f"⚠️ *Duplicate Therapy ({cls} class):* "
                             f"You already take *{med.title()}*. {dup_row['warning']}")})
                if sev == "critical":
                    block = True
                requires_doctor = True

    # ── 6. Polypharmacy flag ──────────────────────────────────
    if len(cur_meds or []) >= C.POLY_PHARMACY_LIMIT:
        warnings.append({"severity": "MODERATE",
            "text": (f"💊 *Polypharmacy:* You are already on {len(cur_meds)} medicines. "
                     "Adding more requires doctor guidance.")})
        requires_doctor = True

    # ── 7. Renal dose adjustment (eGFR) ──────────────────────
    if egfr is not None:
        renal = await db_fetch(
            """SELECT action, note FROM renal_dose_rules
               WHERE drug_name=LOWER($1) AND $2::INTEGER BETWEEN egfr_min AND egfr_max
               LIMIT 1""",
            drug, int(egfr))
        if renal:
            action = renal[0]["action"]
            note   = renal[0]["note"]
            dose_adjustment = {"action": action, "note": note, "egfr": egfr}
            if action == "avoid":
                block = True
                warnings.append({"severity": "CRITICAL",
                    "text": f"⛔ *Renal Contraindication (eGFR={egfr}):* {note}"})
            elif action in ("reduce_50", "reduce_75"):
                warnings.append({"severity": "HIGH",
                    "text": f"⚠️ *Dose Reduction Required (eGFR={egfr}):* {note}"})
                requires_doctor = True

    # ── 8. Tier-5 auto-escalation ─────────────────────────────
    if tier == 5:
        escalate        = True
        requires_doctor = True

    # ── 9. Log every evaluation ──────────────────────────────
    eval_ms = int((time.monotonic() - t0) * 1000)
    try:
        await db_execute(
            """INSERT INTO clinical_decision_log
               (user_id, drug_name, risk_tier, block, warnings, requires_doctor,
                escalate, dose_adjustment, evaluation_ms)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
            uid, drug, tier, block, json.dumps(warnings),
            requires_doctor, escalate,
            json.dumps(dose_adjustment), eval_ms)
    except Exception as e:
        logger.error(f"CDE log error: {e}")

    logger.info(f"CDE drug={drug} tier={tier} block={block} warnings={len(warnings)} {eval_ms}ms")

    return {
        "block":           block,
        "warnings":        warnings,
        "requires_doctor": requires_doctor,
        "dose_adjustment": dose_adjustment,
        "escalate":        escalate,
        "risk_tier":       tier,
        "dup_therapy":     dup_therapy,
    }


# ══════════════════════════════════════════════════════════════
# §10  V5 HEALTH EPISODE TRACKING
# ══════════════════════════════════════════════════════════════
def classify_episode_type(symptoms: list[str]) -> Optional[str]:
    """Map detected symptom keywords to a clinical episode type."""
    best, best_count = None, 0
    for ep_type, kws in C.EPISODE_MAP.items():
        count = sum(1 for s in symptoms if any(k in s for k in kws))
        if count > best_count:
            best, best_count = ep_type, count
    return best if best_count > 0 else None

async def get_or_create_episode(user_id: str, symptoms: list[str]) -> Optional[str]:
    """Find active matching episode or create new one. Returns episode_id."""
    ep_type = classify_episode_type(symptoms)
    if not ep_type: return None
    pool = await get_pool()
    existing = await pool.fetchrow(
        "SELECT id FROM health_episodes WHERE user_id=$1 AND episode_type=$2 AND status='active' LIMIT 1",
        user_id, ep_type)
    if existing:
        await pool.execute(
            "UPDATE health_episodes SET symptoms=array_cat(symptoms,$2), followup_count=followup_count+1 WHERE id=$1",
            str(existing["id"]), symptoms)
        return str(existing["id"])
    row = await pool.fetchrow(
        "INSERT INTO health_episodes(user_id, episode_type, symptoms) VALUES($1,$2,$3) RETURNING id",
        user_id, ep_type, symptoms)
    return str(row["id"]) if row else None

async def update_episode_followup(user_id: str, response: str):
    """Process followup response. 3× 'worse' → emergency escalation."""
    pool = await get_pool()
    resp = response.lower().strip()
    if resp == "worse":
        rows = await pool.fetch(
            "SELECT id, followup_count FROM health_episodes WHERE user_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",
            user_id)
        if rows:
            ep = dict(rows[0])
            await pool.execute(
                "UPDATE health_episodes SET followup_count=followup_count+1, worsened=TRUE WHERE id=$1",
                str(ep["id"]))
            # 3+ worsening responses → escalate
            if ep["followup_count"] >= 2:
                user = await db_fetchrow("SELECT phone, name FROM users WHERE id=$1", user_id)
                if user:
                    await send_whatsapp(user["phone"],
                        "🚨 *Health Alert*\n\n"
                        "Your symptoms have been worsening across multiple check-ins.\n\n"
                        "*Please visit a doctor or emergency room immediately.*\n"
                        "📞 *India Emergency:* 112  |  Ambulance: 108")
                    await log_health_event(user_id, "episode_deterioration",
                        "Symptoms worsening — emergency escalation triggered",
                        metadata={"followup_count": ep["followup_count"] + 1})
    elif resp == "better":
        await pool.execute(
            "UPDATE health_episodes SET status='resolved', resolved_at=NOW() WHERE user_id=$1 AND status='active'",
            user_id)
        await log_health_event(user_id, "episode_resolved", "Symptoms resolved via followup")


# ══════════════════════════════════════════════════════════════
# §11  V5 VITAL TREND ENGINE
# ══════════════════════════════════════════════════════════════
async def analyze_vital_trends(user_id: str) -> list[dict]:
    """
    Detect rising/falling trends across last 5 readings.
    Alerts returned as list of {vital, trend, last, message}.
    """
    pool   = await get_pool()
    alerts = []
    check  = ["bp_systolic", "blood_sugar", "spo2_pct", "heart_rate", "temp_celsius"]

    for vital in check:
        rows = await pool.fetch(
            f"SELECT {vital} FROM vitals WHERE user_id=$1 AND {vital} IS NOT NULL ORDER BY recorded_at DESC LIMIT 5",
            user_id)
        values = [float(r[vital]) for r in rows if r[vital] is not None]
        if len(values) < 3: continue

        recent = values[:3]
        if   all(recent[i] > recent[i+1] for i in range(len(recent)-1)): trend = "rising"
        elif all(recent[i] < recent[i+1] for i in range(len(recent)-1)): trend = "falling"
        else: trend = "stable"

        avg = round(sum(values) / len(values), 2)
        chg = round((values[0] - avg) / avg * 100, 1) if avg else 0

        # Upsert vital_trends table
        try:
            await pool.execute(
                """INSERT INTO vital_trends(user_id, vital_type, trend, readings_count, last_value, avg_value, change_pct)
                   VALUES($1,$2,$3,$4,$5,$6,$7)
                   ON CONFLICT(user_id, vital_type) DO UPDATE SET
                     trend=EXCLUDED.trend, readings_count=EXCLUDED.readings_count,
                     last_value=EXCLUDED.last_value, avg_value=EXCLUDED.avg_value,
                     change_pct=EXCLUDED.change_pct, computed_at=NOW(), alert_sent=FALSE""",
                user_id, vital, trend, len(values), values[0], avg, chg)
        except Exception as e:
            logger.error(f"vital_trends upsert: {e}")

        # Generate alerts for actionable trends
        if trend == "rising" and vital in ("bp_systolic", "blood_sugar"):
            alerts.append({
                "vital": vital, "trend": "rising", "last": values[0],
                "message": (f"📈 *Trend Alert — {vital.replace('_',' ').title()}*\n\n"
                            f"Your readings have been *rising* over the last {len(recent)} measurements "
                            f"(latest: {values[0]}, avg: {avg}).\n\n"
                            "Please consult your doctor for evaluation.")
            })
        elif trend == "falling" and vital == "spo2_pct":
            alerts.append({
                "vital": vital, "trend": "falling", "last": values[0],
                "message": (f"📉 *Oxygen Level Trending Down*\n\n"
                            f"Latest SpO₂: *{values[0]}%* (avg: {avg}%).\n\n"
                            "Please seek medical attention if this continues.")
            })

    return alerts


# ══════════════════════════════════════════════════════════════
# §12  V5 CUMULATIVE ABUSE SCORING
# ══════════════════════════════════════════════════════════════
async def update_abuse_score(user_id: str, drug: str,
                              extra_flags: list[str], message: str = "") -> dict:
    """
    Persistent cumulative abuse detection.
    Increments abuse_scores table.
    Returns {score, block, review, flags}.
    """
    added = 0
    flags = list(extra_flags)

    # Controlled drug
    if drug.lower() in C.CONTROLLED_WATCH:
        added += C.ABUSE_WEIGHTS["controlled_drug"]
        flags.append("CONTROLLED_DRUG")

    # Rapid refill (< 3 days)
    recent = await db_fetch(
        "SELECT ordered_at FROM orders WHERE patient_id=$1 AND drug_name=$2 ORDER BY ordered_at DESC LIMIT 2",
        user_id, drug)
    if len(recent) >= 2:
        delta = (recent[0]["ordered_at"] - recent[1]["ordered_at"]).total_seconds() / 86400
        if delta < 3:
            added += C.ABUSE_WEIGHTS["rapid_refill"]
            flags.append("RAPID_REFILL")

    # Night ordering 23:00–05:00
    hour = datetime.now().hour
    if hour >= 23 or hour < 5:
        added += C.ABUSE_WEIGHTS["night_order"]
        flags.append("NIGHT_ORDER")

    # Dose-increase language
    if any(w in message.lower() for w in ["stronger", "higher dose", "more mg", "double dose", "increase dose"]):
        added += C.ABUSE_WEIGHTS["dose_increase_ask"]
        flags.append("DOSE_INCREASE_ASK")

    # Multiple controlled classes in last 30 days
    recent_ctrl = await db_fetch(
        """SELECT DISTINCT drug_name FROM orders
           WHERE patient_id=$1 AND ordered_at > NOW()-INTERVAL '30 days'
             AND drug_name = ANY($2::TEXT[])""",
        user_id, C.CONTROLLED_WATCH)
    if len(recent_ctrl) >= 2:
        added += C.ABUSE_WEIGHTS["multi_controlled"]
        flags.append("MULTI_CONTROLLED")

    if added == 0:
        return {"score": 0, "block": False, "review": False, "flags": []}

    pool = await get_pool()
    row  = await pool.fetchrow(
        """INSERT INTO abuse_scores(user_id, score, flags)
           VALUES($1, $2, $3)
           ON CONFLICT(user_id) DO UPDATE SET
               score        = abuse_scores.score + $2,
               flags        = array_cat(abuse_scores.flags, $3),
               last_updated = NOW()
           RETURNING score, blocked""",
        user_id, added, flags)

    total  = int(row["score"]) if row else added
    block  = total >= C.ABUSE_BLOCK_SCORE
    review = total >= C.ABUSE_REVIEW_SCORE

    if block:
        await pool.execute(
            "UPDATE abuse_scores SET blocked=TRUE, review_required=TRUE WHERE user_id=$1", user_id)
        await log_audit(user_id, "abuse_hard_block", "abuse_scores", user_id,
                        new_val={"score": total, "flags": flags})
    elif review:
        await pool.execute(
            "UPDATE abuse_scores SET review_required=TRUE WHERE user_id=$1", user_id)

    if (block or review) and C.ADMIN_PHONE:
        label = "HARD BLOCK" if block else "REVIEW REQUIRED"
        await send_whatsapp(C.ADMIN_PHONE,
            f"🚨 *Abuse Alert — {label}*\n\n"
            f"User: {user_id[:12]}\nDrug: {drug}\nScore: {total}\n"
            f"Flags: {', '.join(flags)}")

    return {"score": total, "block": block, "review": review, "flags": flags}

async def check_abuse_blocked(user_id: str) -> bool:
    """Quick check — is user currently hard-blocked?"""
    row = await db_fetchrow("SELECT blocked FROM abuse_scores WHERE user_id=$1", user_id)
    return bool(row and row["blocked"]) if row else False


# ══════════════════════════════════════════════════════════════
# §13  BULLMQ + WHATSAPP BRIDGE
# ══════════════════════════════════════════════════════════════
async def send_whatsapp(phone: str, message: str) -> bool:
    http = await get_http()
    try:
        await http.post(f"{C.WHATSAPP_URL}/send", json={"phone": phone, "message": message})
        return True
    except Exception as e:
        logger.error(f"WA send: {e}"); return False

async def schedule_reminder_jobs(reminder_id: str, patient_id: str, drug_name: str,
                                  dose: str, meal_instruction: str, remind_times: list,
                                  start_date: date, end_date: date, phone: str,
                                  escalation_timeout: int = None) -> list:
    http = await get_http()
    try:
        r = await http.post(f"{C.BULLMQ_URL}/schedule-reminder", json={
            "reminderId": reminder_id, "patientId": patient_id, "drugName": drug_name,
            "dose": dose, "mealInstruction": meal_instruction, "remindTimes": remind_times,
            "startDate": str(start_date), "endDate": str(end_date) if end_date else None,
            "phone": phone, "ackTimeoutSecs": escalation_timeout or C.ACK_TIMEOUT_SECS})
        return r.json().get("jobIds", [])
    except Exception as e:
        logger.error(f"BullMQ: {e}"); return []

async def enqueue_call(phone: str, drug_name: str, log_id: str) -> str:
    http = await get_http()
    try:
        r = await http.post(f"{C.BULLMQ_URL}/enqueue-call",
                            json={"phone": phone, "drugName": drug_name, "logId": log_id})
        return r.json().get("jobId", "")
    except: return ""

async def dequeue_call(job_id: str):
    http = await get_http()
    try: await http.post(f"{C.BULLMQ_URL}/remove-call", json={"jobId": job_id})
    except: pass

async def schedule_symptom_followup(user_id: str, phone: str, symptom: str) -> str:
    followup_at = datetime.utcnow() + timedelta(hours=C.FOLLOWUP_HOURS)
    pool = await get_pool()
    row  = await pool.fetchrow(
        "INSERT INTO symptom_followups(user_id, symptom, followup_at) VALUES($1,$2,$3) RETURNING id",
        user_id, symptom, followup_at)
    if not row: return ""
    fid = str(row["id"])
    http = await get_http()
    try:
        r = await http.post(f"{C.BULLMQ_URL}/schedule-followup",
            json={"followupId": fid, "phone": phone, "symptom": symptom,
                  "delayMs": C.FOLLOWUP_HOURS * 3_600_000})
        await pool.execute("UPDATE symptom_followups SET bullmq_job_id=$2 WHERE id=$1",
                           fid, r.json().get("jobId", ""))
    except: pass
    return fid


# ══════════════════════════════════════════════════════════════
# §14  BACKGROUND TASKS
# ══════════════════════════════════════════════════════════════
async def extract_and_apply_facts(user_id: str, phone: str, message: str, session_id: str):
    """Auto-extract allergies, conditions, pregnancy status and apply to user profile."""
    llm = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content="Extract medical facts. Return ONLY valid JSON, no explanation."),
            HumanMessage(content=(
                'Schema: {"allergies":[],"conditions":[],"is_pregnant":null,"weight_kg":null,"confidence":0.0}\n'
                f"Message: {message[:800]}"))
        ])).content.strip()
        raw   = re.sub(r"```json|```", "", raw).strip()
        facts = json.loads(raw)
    except: return

    conf = float(facts.get("confidence", 0.0))
    if conf < 0.5: return

    user = await get_user_by_phone(phone)
    if not user: return
    uid  = str(user["id"])
    pool = await get_pool()

    async def store_fact(ftype: str, val: str):
        await pool.execute(
            """INSERT INTO extracted_medical_facts
               (user_id, fact_type, value, confidence, auto_applied, source_msg, session_id)
               VALUES($1,$2,$3,$4,$5,$6,$7)""",
            uid, ftype, val, conf, conf >= C.AUTO_APPLY_CONF, message[:500], session_id)

    for allergy in facts.get("allergies", []):
        allergy = allergy.lower().strip()
        if allergy and allergy not in (user.get("allergies") or []):
            await store_fact("allergy", allergy)
            if conf >= C.AUTO_APPLY_CONF:
                existing = list(user.get("allergies") or []) + [allergy]
                await update_user(phone, allergies=existing)
                await log_health_event(uid, "allergy_added", f"Auto-added allergy: {allergy}",
                                       metadata={"confidence": conf, "source": "auto_extracted"})
                await log_audit(uid, "allergy_auto_added", "users", uid,
                                old_val={"allergies": user.get("allergies")},
                                new_val={"added": allergy, "confidence": conf})

    for cond in facts.get("conditions", []):
        cond = cond.lower().strip()
        if cond and conf >= C.AUTO_APPLY_CONF:
            await store_fact("condition", cond)
            existing = list(user.get("chronic_conditions") or [])
            if cond not in existing:
                await update_user(phone, chronic_conditions=existing + [cond])
                await log_health_event(uid, "new_condition", f"Condition auto-noted: {cond}")

    if facts.get("is_pregnant") is True and not user.get("is_pregnant"):
        await store_fact("pregnancy", "true")
        if conf >= C.AUTO_APPLY_CONF:
            await update_user(phone, is_pregnant=True)
            await log_health_event(uid, "pregnancy_noted", "Pregnancy status auto-detected")

async def handle_adverse_reaction_bg(user_id: str, phone: str, message: str, drugs: list):
    if not drugs: return
    llm = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content="Extract drug reaction info. Return only JSON or null."),
            HumanMessage(content=(
                f"Message: '{message}'\nDrugs: {drugs}\n"
                'Return: {"drug":"...","reaction":"...","severity":"mild|moderate|severe"}'))
        ])).content.strip()
        raw = re.sub(r"```json|```", "", raw).strip()
        res = json.loads(raw)
        if not res or "drug" not in res: return
    except: return

    drug     = res.get("drug", "unknown")
    reaction = res.get("reaction", "unknown")
    severity = res.get("severity", "mild")
    pool     = await get_pool()
    await pool.execute(
        "INSERT INTO adverse_reactions(user_id, drug_name, reaction, severity, auto_detected) VALUES($1,$2,$3,$4,TRUE)",
        user_id, drug, reaction, severity)
    await log_health_event(user_id, "adverse_reaction", f"Reaction to {drug}: {reaction}",
                           f"Severity: {severity}", drug_name=drug)
    if severity == "severe":
        await send_whatsapp(phone,
            f"🚨 *Severe Reaction Detected*\n\n"
            f"⛔ *Stop {drug.title()} immediately.*\n"
            f"Reaction: {reaction}\n\n"
            "📞 Contact your doctor now.\n"
            "_Reaction logged to your medical profile._")

async def summarize_session_bg(session_id: str, user_id: str):
    messages = await db_fetch(
        "SELECT role, content FROM conversation_messages WHERE session_id=$1 ORDER BY created_at ASC",
        session_id)
    if len(messages) < 4: return
    conv = "\n".join(f"{'User' if m['role']=='user' else 'Bot'}: {m['content'][:200]}"
                     for m in messages[-20:])
    llm  = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content="Summarize medical conversations. Return only valid JSON."),
            HumanMessage(content=(
                'Schema: {"summary":"...","key_points":[],"allergies_detected":[],'
                '"conditions_detected":[],"drugs_mentioned":[],"symptoms_detected":[]}\n\n'
                f"Conversation:\n{conv}"))
        ])).content.strip()
        raw  = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
    except: return
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO conversation_summaries
           (user_id, session_id, summary_text, key_points, allergies_detected,
            conditions_detected, drugs_mentioned, symptoms_detected)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)""",
        user_id, session_id,
        data.get("summary", ""), data.get("key_points", []),
        data.get("allergies_detected", []), data.get("conditions_detected", []),
        data.get("drugs_mentioned", []), data.get("symptoms_detected", []))

async def check_missed_dose_pattern(user_id: str, drug_name: str):
    rows  = await db_fetch(
        "SELECT ack_status FROM reminder_logs WHERE patient_id=$1 AND drug_name=$2 ORDER BY scheduled_at DESC LIMIT 5",
        user_id, drug_name)
    skips = sum(1 for r in rows[:3] if r["ack_status"] == "skipped")
    if skips >= 3:
        await log_health_event(user_id, "missed_dose_cluster",
                               f"Repeated missed doses: {drug_name}",
                               f"{skips} consecutive skips", drug_name=drug_name)


# ══════════════════════════════════════════════════════════════
# §15  LLM ORDER DECISION (V4, preserved)
# ══════════════════════════════════════════════════════════════
async def llm_order_decision(user_message: str, drug: str, inv: dict,
                              user: dict, history: list) -> dict:
    """LLM decides if order should proceed. Returns {proceed, reason, needs, quantity}."""
    llm  = get_llm()
    hist = "\n".join(
        f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:80]}"
        for h in history[-4:])
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content="You are a pharmacy order processor. Return ONLY valid JSON."),
            HumanMessage(content=(
                "Decide if this pharmacy order should proceed.\n"
                "Rules:\n"
                "- PROCEED if user clearly wants to order\n"
                "- DECLINE if user is asking a question or said no/cancel\n"
                "- Add 'quantity' to needs if quantity not mentioned\n"
                "- Add 'prescription' to needs if this is a Rx drug\n\n"
                f"Drug: {drug} | OTC: {inv.get('is_otc', True)} | "
                f"Price: ₹{inv.get('price_per_unit')}/{inv.get('unit')}\n"
                f"Chat:\n{hist}\n\nMessage: '{user_message}'\n\n"
                'Return: {"proceed":true/false,"reason":"...","needs":[],"quantity":null_or_number}'))
        ])).content.strip()
        raw  = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
        return {
            "proceed":  bool(data.get("proceed", False)),
            "reason":   str(data.get("reason", "")),
            "needs":    list(data.get("needs", [])),
            "quantity": data.get("quantity"),
        }
    except Exception as e:
        logger.error(f"LLM order decision: {e}")
        aff = any(w in user_message.lower() for w in ["yes", "y", "ok", "order", "haan", "ha"])
        return {"proceed": aff, "reason": "fallback", "needs": [], "quantity": None}


# ══════════════════════════════════════════════════════════════
# §16  LANGGRAPH STATE
# ══════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════
# §V6-A  CONTROLLED WEB SEARCH LAYER
# ══════════════════════════════════════════════════════════════

def _domain_trusted(url: str) -> bool:
    """Return True only if URL is from an Anthropic-approved medical domain."""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        return any(host == d or host.endswith("." + d) for d in C.TRUSTED_SEARCH_DOMAINS)
    except:
        return False

def _should_web_search(query: str, rag_results: list, drug_found: bool) -> bool:
    """
    Only trigger web search when:
    1. RAG + DB returned nothing useful, OR
    2. Query explicitly mentions recall/new drug/outbreak keywords.
    NEVER for dosage, CDE, or contraindication logic.
    """
    q = query.lower()
    # Explicit triggers
    if any(kw in q for kw in C.WEB_SEARCH_TRIGGERS):
        return True
    # Fallback when RAG returned nothing AND drug not in inventory
    if not rag_results and not drug_found:
        return True
    return False

async def controlled_web_search(query: str) -> dict:
    """
    Safe web search that:
    - Uses DuckDuckGo (no API key needed)
    - Filters to trusted domains only
    - Returns structured result with source label
    - Caches to Pinecone external_verified namespace
    Returns {"text": str, "source": str, "domain": str} or None.
    """
    # Check Pinecone cache first
    cache_key = hashlib.md5(query.encode()).hexdigest()
    cached    = await retrieve(query, C.NS_EXTERNAL, top_k=1)
    if cached and cached[0].get("score", 0) > 0.82:
        logger.info(f"Web search: cache hit for '{query[:50]}'")
        return {
            "text":   cached[0]["text"],
            "source": cached[0].get("source", "external"),
            "domain": cached[0].get("source", ""),
            "cached": True,
        }

    # DuckDuckGo search (no API key)
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            raw = list(ddgs.text(query + " site:who.int OR site:nih.gov OR site:fda.gov OR site:nhs.uk",
                                  max_results=6, safesearch="strict"))
    except ImportError:
        # Graceful fallback if duckduckgo_search not installed
        logger.warning("duckduckgo_search not installed; web search unavailable")
        return None
    except Exception as e:
        logger.error(f"DuckDuckGo error: {e}")
        return None

    # Filter to trusted domains only
    trusted_results = []
    for r in raw:
        url  = r.get("href", "") or r.get("url", "")
        body = r.get("body", "") or r.get("description", "")
        if _domain_trusted(url) and body and len(body) > 50:
            trusted_results.append({
                "url":  url,
                "text": body[:800],
                "domain": url.split("/")[2] if "/" in url else url,
            })

    if not trusted_results:
        logger.info(f"Web search: no trusted results for '{query[:50]}'")
        return None

    best = trusted_results[0]

    # Store to Pinecone for future cache hits
    try:
        emb = _embed(best["text"])
        get_pinecone().upsert(
            vectors=[{
                "id":       f"web_{cache_key}",
                "values":   emb,
                "metadata": {
                    "text":     best["text"],
                    "source":   best["domain"],
                    "query":    query[:200],
                    "verified": True,
                },
            }],
            namespace=C.NS_EXTERNAL
        )
    except Exception as e:
        logger.error(f"Pinecone web cache store: {e}")

    logger.info(f"Web search: found trusted result from {best['domain']}")
    return {"text": best["text"], "source": best["domain"], "domain": best["domain"], "cached": False}

async def check_drug_recall(drug_name: str, phone: str, user_id: str) -> Optional[str]:
    """
    V6: Check if drug is recalled via FDA recall DB search.
    If recalled: flag inventory + send admin alert.
    Returns recall notice or None.
    """
    result = await controlled_web_search(f"{drug_name} FDA recall 2024 2025")
    if not result:
        return None

    text   = result["text"].lower()
    domain = result.get("domain", "")
    # Only act on FDA source with recall signal
    if "recall" in text and ("fda" in domain or "accessdata" in domain):
        # Flag inventory
        try:
            await db_execute(
                "UPDATE inventory SET is_active=FALSE, notes=CONCAT(notes, ' | FDA RECALL FLAGGED') WHERE LOWER(drug_name)=LOWER($1)",
                drug_name)
        except Exception as e:
            logger.error(f"Recall inventory flag: {e}")

        # Admin alert
        if C.ADMIN_PHONE:
            await send_whatsapp(C.ADMIN_PHONE,
                f"🚨 *FDA RECALL ALERT*\n\n"
                f"Drug: *{drug_name.title()}*\n"
                f"Source: {domain}\n"
                f"User: {user_id[:12]}\n\n"
                f"Inventory flagged as inactive. Verify immediately.\n"
                f"Evidence: {result['text'][:200]}")

        await log_audit(user_id, "recall_detected", "inventory", drug_name,
                        new_val={"source": domain, "query": drug_name})

        return (f"⚠️ *Recall Alert for {drug_name.title()}*\n\n"
                f"Our clinical search detected a possible FDA recall notice.\n"
                f"📚 *Source: {domain}*\n\n"
                f"Do NOT dispense this medicine until the alert is verified.\n"
                f"Please contact your doctor or pharmacist.")
    return None


# ══════════════════════════════════════════════════════════════
# §V6-B  CHANNEL FORMATTER
# ══════════════════════════════════════════════════════════════

def format_for_channel(text: str, channel: str) -> str:
    """
    Adapts reply text for the target channel.
    WhatsApp: *bold*, plain, concise, emoji-first
    Web:      Markdown ## headers, **bold**, richer layout
    """
    if channel == "web":
        # Convert WhatsApp bold (*text*) → Markdown bold (**text**)
        text = re.sub(r"\*([^*\n]+)\*", r"**\1**", text)
        # Add horizontal rule before disclaimers
        text = text.replace("_⚕️ For informational", "\n---\n_⚕️ For informational")
        return text
    # WhatsApp is already formatted correctly as-is (V5 format)
    return text

def channel_disclaimer(channel: str) -> str:
    if channel == "web":
        return "\n\n---\n> ⚕️ *For informational purposes only. Not a substitute for professional medical advice.*"
    return "\n\n_⚕️ For informational purposes only. Not a substitute for professional medical advice._"


# ══════════════════════════════════════════════════════════════
# §V6-C  DYNAMIC FOLLOW-UP ENGINE (DFE)
# ══════════════════════════════════════════════════════════════

def _extract_clinical_context(state: MedState) -> dict:
    """
    Gather all clinically relevant context from state for DFE decision-making.
    """
    user     = state.get("user", {})
    msg      = state.get("message", "").lower()
    history  = state.get("history", [])
    age      = user.get("age")
    caregiver= state.get("caregiver_ctx")       # "child" | "parent" | "spouse" | None
    tier     = state.get("risk_tier", 1)
    triage   = state.get("triage_level", "none")
    ep_id    = state.get("active_episode_id")

    # Detect patient age group
    if caregiver == "child":
        age_group = "child"
    elif age and age < 12:
        age_group = "child"
    elif age and age >= 65:
        age_group = "elderly"
    elif age and age >= 18:
        age_group = "adult"
    else:
        age_group = "unknown"

    # Detect primary symptom from message
    primary_symptom = None
    for key in C.FOLLOWUP_REQUIREMENTS:
        base = key.split("_")[0]
        if base in msg:
            # Check age group match
            if f"_{age_group}" in key:
                primary_symptom = key
                break
            elif "_adult" in key and age_group in ("adult", "unknown"):
                primary_symptom = key

    if not primary_symptom:
        # Generic symptom matching
        for kw, map_key in [("fever","fever_adult"), ("dizziness","dizziness_adult"),
                             ("cough","cough"), ("chest","chest_pain"),
                             ("headache","headache"), ("breathless","breathing_difficulty"),
                             ("abdominal","abdominal_pain"), ("stomach","abdominal_pain")]:
            if kw in msg:
                # Override with age-specific version if it exists
                age_specific = f"{kw}_{age_group}"
                primary_symptom = age_specific if age_specific in C.FOLLOWUP_REQUIREMENTS else map_key
                break

    primary_symptom = primary_symptom or "generic"

    # Detect which fields are already answered from message + history
    all_text = msg + " ".join(h.get("content", "")[:200] for h in history[-4:])
    already_known = set()
    if age:                                                      already_known.add("age")
    if re.search(r"\d+[\.,]?\d*\s*[°º]?\s*[cfCF]", all_text):  already_known.add("temperature_value")
    if re.search(r"\d+\s*(day|hour|week|month|din|ghante)", all_text, re.I):
                                                                  already_known.add("duration")
    if re.search(r"(no|not|nahi|nahin)\s*(chest|pain)", all_text, re.I):
        already_known.add("chest_pain_yn")
    if re.search(r"kg|weight|wt\b", all_text, re.I):            already_known.add("weight_kg")
    if re.search(r"\d+\s*kg|\d+\s*kilo", all_text, re.I):       already_known.add("weight_kg")
    if re.search(r"(vomit|puke|nausea)", all_text, re.I):        already_known.add("vomiting_yn")

    # Previously asked questions in this session (avoid asking same twice)
    asked_keys = set()
    for h in history[-10:]:
        if h.get("role") == "assistant":
            ct = h.get("content", "").lower()
            if "temperature" in ct:    asked_keys.add("temperature_value")
            if "how long" in ct:       asked_keys.add("duration")
            if "chest pain" in ct:     asked_keys.add("chest_pain_yn")
            if "vision" in ct:         asked_keys.add("vision_change_yn")
            if "weakness" in ct:       asked_keys.add("weakness_yn")
            if "how old" in ct or "age" in ct: asked_keys.add("age")
            if "weight" in ct:         asked_keys.add("weight_kg")

    return {
        "age":              age,
        "age_group":        age_group,
        "primary_symptom":  primary_symptom,
        "already_known":    already_known,
        "asked_keys":       asked_keys,
        "tier":             tier,
        "triage":           triage,
        "caregiver":        caregiver,
        "active_episode":   ep_id,
        "message":          state.get("message", ""),
        "user":             user,
    }

def _detect_missing_variables(ctx: dict) -> list[str]:
    """
    Return list of field keys that are both required (by FOLLOWUP_REQUIREMENTS)
    and not yet known / already asked.
    """
    symptom  = ctx["primary_symptom"]
    req      = C.FOLLOWUP_REQUIREMENTS.get(symptom, C.FOLLOWUP_REQUIREMENTS["generic"])
    required = req.get("required", [])
    known    = ctx["already_known"]
    asked    = ctx["asked_keys"]
    # Only missing fields that haven't been answered OR asked yet
    return [f for f in required if f not in known and f not in asked]

def _rank_missing(missing: list[str], ctx: dict) -> list[tuple[str, int]]:
    """
    Priority-score each missing field.
    Returns sorted list of (field_name, score) DESC.
    """
    scored = []
    for field in missing:
        category = C.DFE_FIELD_PRIORITY.get(field, "context_adding")
        base     = C.DFE_WEIGHTS.get(category, 1)
        # Bonus for child patients (dosing critical)
        if ctx["age_group"] == "child" and field in ("age", "weight_kg", "temperature_value"):
            base += 2
        # Bonus for elderly (red flag critical)
        if ctx["age_group"] == "elderly" and field in ("chest_pain_yn", "vision_change_yn", "weakness_yn"):
            base += 2
        # Penalty if user has been ignoring (behavioral)
        behavior = ctx.get("behavior", {})
        ignores  = behavior.get("ignored_questions", 0)
        if ignores >= C.DFE_BEHAVIORAL_MAX_IGNORES:
            base = max(1, base - 2)
        scored.append((field, base))
    return sorted(scored, key=lambda x: x[1], reverse=True)

def _should_escalate_instead(ctx: dict, msg: str) -> bool:
    """
    Return True if DFE should escalate instead of asking a question.
    - Tier 5 + any red flag keyword in message
    - Chest pain / breathing difficulty at any tier
    - Episode worsening ≥ 3 times
    """
    m   = msg.lower()
    req = C.FOLLOWUP_REQUIREMENTS.get(ctx["primary_symptom"], {})
    escalate_kws = req.get("escalate_if", [])
    if "*" in escalate_kws:
        return True
    if any(kw in m for kw in escalate_kws):
        return True
    if ctx["tier"] == 5 and ctx["triage"] in ("high", "medium"):
        return True
    return False

async def _generate_dfe_question(top_field: str, ctx: dict, channel: str) -> str:
    """
    LLM-generates a single, warm, contextual question (never hardcoded).
    Channel-adaptive: WhatsApp concise vs Web richer.
    """
    age_group  = ctx["age_group"]
    symptom    = ctx["primary_symptom"]
    caregiver  = ctx.get("caregiver")
    behavior   = ctx.get("behavior") or {}
    short_user = behavior.get("short_replies", False)
    anxiety    = behavior.get("anxiety_loop", False)

    style_note = ""
    if channel == "web":
        style_note = "Format as a friendly web chat message. Can be 2 sentences."
    else:
        style_note = "Format for WhatsApp. Be concise, use *bold* for key word. Max 2 lines."

    if anxiety:
        style_note += " Start with a brief reassurance before asking."
    if short_user:
        style_note += " Ask a yes/no (closed-ended) question if possible."

    caregiver_note = f" (asking on behalf of their {caregiver})" if caregiver else ""

    field_desc = {
        "temperature_value":     "their current body temperature (°C or °F)",
        "age":                   "the patient's age",
        "duration":              "how long they've had this symptom",
        "chest_pain_yn":         "whether they have any chest pain or tightness",
        "vision_change_yn":      "any vision changes or blurred vision",
        "weakness_yn":           "any sudden weakness on one side of the body",
        "breathing_difficulty_yn":"any difficulty breathing",
        "fever_yn":              "whether they have a fever",
        "vomiting_yn":           "any vomiting or nausea",
        "severity_1_10":         "the pain severity on a scale of 1–10",
        "location":              "where exactly the pain is located",
        "position_related_yn":   "whether dizziness gets worse with position changes",
        "weight_kg":             "the patient's weight in kg",
    }.get(top_field, f"about {top_field.replace('_', ' ')}")

    llm = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content=(
                "You are a warm, empathetic medical chatbot. "
                "Generate ONE focused follow-up question. Never diagnose. "
                "Do not use clinical jargon. Be gentle and conversational.")),
            HumanMessage(content=(
                f"Patient context: {age_group}{caregiver_note}, symptom='{symptom}'\n"
                f"Need to ask: {field_desc}\n"
                f"{style_note}\n\n"
                f"Generate ONE concise, warm question:"))
        ])).content.strip()
        # Remove surrounding quotes if LLM adds them
        raw = raw.strip('"\'')
        return raw
    except Exception as e:
        logger.error(f"DFE question gen: {e}")
        # Safe fallback
        fallbacks = {
            "temperature_value": "What is the current temperature? (°C or °F)",
            "age":               "How old is the patient?",
            "duration":          "How long have these symptoms been going on?",
            "chest_pain_yn":     "Are you experiencing any chest pain or tightness? (Yes/No)",
            "vision_change_yn":  "Any changes in your vision? (Yes/No)",
            "weight_kg":         "What is the patient's weight in kg?",
        }
        return fallbacks.get(top_field, "Could you give me a bit more detail?")

async def _load_behavioral_profile(user_id: str, session_id: str) -> dict:
    """
    Load behavioral signals from Redis for this session.
    """
    key = f"behavior:{session_id}"
    raw = await r_get(key)
    if raw:
        try: return json.loads(raw)
        except: pass
    return {"ignored_questions": 0, "short_replies": False, "anxiety_loop": False, "q_count": 0}

async def _update_behavioral_profile(session_id: str, profile: dict,
                                      message: str, dfe_was_active: bool):
    """Update behavioral signals based on user's response to DFE."""
    msg = message.strip()
    if dfe_was_active:
        # Very short response to a DFE question → short_replies flag
        if len(msg) < 8:
            profile["short_replies"] = True
            profile["ignored_questions"] = profile.get("ignored_questions", 0) + 1
        else:
            profile["ignored_questions"] = 0
    # Detect anxiety patterns
    anxiety_words = ["scared", "worried", "afraid", "is it serious", "am i ok",
                     "dangerous", "will i be fine", "so worried"]
    if any(w in msg.lower() for w in anxiety_words):
        profile["anxiety_loop"] = True
    profile["q_count"] = profile.get("q_count", 0) + 1
    await r_set(f"behavior:{session_id}", profile, ttl=3600)

async def dynamic_followup_engine(state: MedState) -> MedState:
    """
    V6 Core Node: Runs AFTER intent_router, BEFORE target agent.

    Decides:
    1. Should we ask a clinical follow-up question now?
    2. If yes: what is the single most important question?
    3. Or should we escalate instead (red flag detected)?

    Injects:
    - dfe_triggered=True + reply (if question asked)
    - dfe_context (for downstream agents to use)
    - Logs to dfe_question_log

    DFE does NOT run if:
    - reply already set (blocked, emergency, CDE blocked, etc.)
    - intent == "order" or "reminder" (operational, not symptom)
    - no symptoms detected in message
    """
    # ── Guard rails ───────────────────────────────────────────
    if state.get("reply"):
        return {**state, "dfe_triggered": False}
    if state.get("intent") in ("order", "reminder", "refill"):
        return {**state, "dfe_triggered": False}
    if state.get("emergency"):
        return {**state, "dfe_triggered": False}

    msg      = state.get("message", "").lower()
    channel  = state.get("channel", "whatsapp")
    # Only activate for messages with symptom content
    has_symptom = any(kw in msg for kw in C.SYMPTOM_KW)
    if not has_symptom:
        return {**state, "dfe_triggered": False}

    # ── Extract clinical context ──────────────────────────────
    ctx = _extract_clinical_context(state)

    # Load behavioral profile
    behavior = await _load_behavioral_profile(
        str(state.get("user", {}).get("id", "")), state["session_id"])
    ctx["behavior"] = behavior

    # ── V6 Episode-aware mode ─────────────────────────────────
    # If active episode + ≥2 followups → switch to escalation screening mode
    ep_id = state.get("active_episode_id")
    if ep_id:
        ep = await db_fetchrow(
            "SELECT followup_count, worsened FROM health_episodes WHERE id=$1", ep_id)
        if ep and ep["followup_count"] >= 2:
            q = (await _generate_dfe_question("chest_pain_yn", ctx, channel)
                 if ctx["age_group"] == "elderly"
                 else "Are your symptoms *getting worse*, staying the same, or *improving*?")
            return {**state, "dfe_triggered": True, "dfe_question": q,
                    "reply": q, "agent_used": "dynamic_followup_engine",
                    "requires_action": "episode_followup"}

    # ── Should we escalate instead of asking? ─────────────────
    if _should_escalate_instead(ctx, state.get("message", "")):
        escalation_msg = (
            "🚨 *This sounds like it may need immediate attention.*\n\n"
            "Please call emergency services now:\n"
            "🏥 India: *112*  |  Ambulance: *108*\n\n"
            "Do not wait — please seek help immediately." if channel == "whatsapp"
            else
            "## 🚨 Immediate Attention Required\n\n"
            "Based on your symptoms, please **call emergency services immediately**:\n\n"
            "- 🏥 **India Emergency:** 112\n"
            "- 🚑 **Ambulance:** 108\n\n"
            "> Do not wait. Please seek help now.")
        return {**state, "reply": escalation_msg,
                "agent_used": "dynamic_followup_engine",
                "emergency": True,
                "dfe_triggered": True,
                "safety_flags": state.get("safety_flags", []) + ["DFE_ESCALATED"]}

    # ── Detect and rank missing variables ─────────────────────
    missing = _detect_missing_variables(ctx)
    if not missing:
        # Nothing to ask — pass to target agent
        return {**state, "dfe_triggered": False, "dfe_context": ctx}

    ranked = _rank_missing(missing, ctx)
    if not ranked:
        return {**state, "dfe_triggered": False, "dfe_context": ctx}

    # ── Tier constraint: Tier 5 → max 1 high-priority Q only ──
    tier = ctx["tier"]
    top_field, top_score = ranked[0]
    if tier == 5 and top_score < 3:
        # Low importance question not worth asking for high-risk patient → skip
        return {**state, "dfe_triggered": False, "dfe_context": ctx}

    # ── Generate the question via LLM ─────────────────────────
    question = await _generate_dfe_question(top_field, ctx, channel)

    # ── Log DFE event ─────────────────────────────────────────
    uid = str(state.get("user", {}).get("id", ""))
    try:
        await db_execute(
            """INSERT INTO dfe_question_log
               (user_id, session_id, symptom_context, missing_field, question_generated,
                tier, age_group, caregiver_ctx, channel)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
            uid, state["session_id"],
            ctx["primary_symptom"], top_field, question,
            tier, ctx["age_group"], ctx.get("caregiver"), channel)
    except Exception as e:
        logger.error(f"DFE log: {e}")

    # ── Update behavioral profile ─────────────────────────────
    was_dfe = bool(await r_get(f"dfe_active:{state['session_id']}"))
    await _update_behavioral_profile(state["session_id"], behavior,
                                      state.get("message", ""), was_dfe)
    await r_set(f"dfe_active:{state['session_id']}", "1", ttl=300)

    return {**state,
            "dfe_triggered":    True,
            "dfe_question":     question,
            "dfe_context":      ctx,
            "reply":            question,
            "agent_used":       "dynamic_followup_engine",
            "requires_action":  f"dfe_{top_field}",
            "behavioral_profile": behavior}


# ══════════════════════════════════════════════════════════════
# §V6-D  WEB SEARCH–ENHANCED RAG HELPER
# ══════════════════════════════════════════════════════════════

async def retrieve_with_web_fallback(query: str, namespace: str, drugs: list,
                                      drug_in_db: bool, channel: str) -> tuple[list, dict]:
    """
    V6 enhanced retrieval:
    1. Standard Pinecone RAG
    2. If empty + web search conditions met → controlled web search
    Returns (results, web_meta) where web_meta may be None.
    """
    results = await retrieve(query, namespace)
    web_meta = None

    if _should_web_search(query, results, drug_in_db):
        logger.info(f"Web search triggered for: '{query[:60]}'")
        ws = await controlled_web_search(query)
        if ws:
            web_meta = ws
            # Inject as synthetic RAG result (marked external)
            results = [{
                "text":   f"[External — {ws['domain']}]\n{ws['text']}",
                "score":  0.70,
                "source": ws["domain"],
            }] + results

    return results, web_meta


# ══════════════════════════════════════════════════════════════
# ── Placeholder marker — V6 sections inserted above ──────────
# ══════════════════════════════════════════════════════════════


    # Request
    phone:            str
    message:          str
    session_id:       str
    channel:          str
    # User context
    user:             dict
    is_new_user:      bool
    history:          list[dict]
    session_summary:  Optional[str]
    # Routing
    intent:           str
    intent_conf:      float
    drugs_found:      list[str]
    emergency:        bool
    triage_level:     str
    blocked_drug:     Optional[str]
    caregiver_ctx:    Optional[str]
    patient_id:       Optional[str]
    # V5
    risk_tier:        int
    cde_result:       Optional[dict]
    active_episode_id:Optional[str]
    # RAG / output
    rag_context:      list[dict]
    selected_inv:     Optional[dict]
    order_record:     Optional[dict]
    reply:            str
    agent_used:       str
    safety_flags:     list[str]
    requires_action:  Optional[str]
    # V6 additions
    dfe_triggered:    bool
    dfe_question:     Optional[str]          # The question DFE generated
    dfe_context:      Optional[dict]         # Clinical context used by DFE
    web_search_used:  bool
    web_search_source:Optional[str]          # Domain that was used
    behavioral_profile: Optional[dict]       # short_replies, ignores, anxiety


# ══════════════════════════════════════════════════════════════
# §17  LANGGRAPH NODES
# ══════════════════════════════════════════════════════════════

# ── Node 1: Load Context ──────────────────────────────────────
async def load_context(state: MedState) -> MedState:
    phone   = state["phone"]
    user    = await get_user_by_phone(phone) or await create_user(phone)
    is_new  = not user.get("onboarded", False)
    history = await get_recent_messages(state["session_id"], limit=6)
    summary = await get_session_summary(str(user.get("id", ""))) if not is_new else None
    tier    = compute_risk_tier(user)

    pool = await get_pool()
    await pool.execute(
        """INSERT INTO conversations(session_id, user_id, channel) VALUES($1,$2,$3)
           ON CONFLICT(session_id) DO UPDATE SET
               last_active=NOW(),
               message_count=conversations.message_count+1""",
        state["session_id"], str(user["id"]), state["channel"])

    # Persist updated tier
    await pool.execute("UPDATE users SET risk_tier=$2 WHERE id=$1", str(user["id"]), tier)

    return {**state,
            "user": user, "is_new_user": is_new, "history": history,
            "session_summary": summary, "risk_tier": tier,
            "cde_result": None, "active_episode_id": None}


# ── Node 2: Pre-Safety (zero-LLM rule checks) ─────────────────
async def pre_safety(state: MedState) -> MedState:
    msg     = state["message"]
    blocked = is_blocked_drug(msg)
    if blocked:
        return {**state, "blocked_drug": blocked, "agent_used": "safety_agent",
                "triage_level": "blocked",
                "reply": (f"⛔ *{blocked.title()}* cannot be dispensed here.\n"
                          "Please visit a licensed pharmacy with a valid prescription."),
                "safety_flags": ["CONTROLLED_BLOCKED"]}

    triage = triage_severity(msg)
    if triage == "emergency":
        return {**state, "emergency": True, "triage_level": "emergency",
                "agent_used": "safety_agent",
                "reply": ("🚨 *EMERGENCY DETECTED*\n\n"
                          "Call emergency services *immediately:*\n"
                          "🏥 *India:* 112  |  Ambulance: 108\n\n"
                          "This AI cannot handle medical emergencies."),
                "safety_flags": ["EMERGENCY_DETECTED"]}

    caregiver = detect_caregiver_ctx(msg)
    drugs     = await extract_drugs_from_inventory(msg)
    symptoms  = [k for k in C.SYMPTOM_KW if k in msg.lower()]

    return {**state, "drugs_found": drugs, "emergency": False, "safety_flags": [],
            "triage_level": triage, "caregiver_ctx": caregiver}


# ── Node 3: Clinical Decision Engine Node ─────────────────────
async def clinical_decision_node(state: MedState) -> MedState:
    """
    V5 Core: Runs CDE for every message that mentions a drug.
    If CDE blocks → reply immediately (no agent needed).
    Otherwise injects cde_result for all downstream agents.
    """
    drugs = state.get("drugs_found", [])
    if not drugs:
        return state  # no drug → skip CDE, proceed to intent router

    user = state["user"]
    cde  = await run_cde(user, drugs[0])

    if cde["block"]:
        criticals = [w for w in cde["warnings"] if w["severity"] == "CRITICAL"]
        base_msg  = criticals[0]["text"] if criticals else "⛔ This medicine cannot be dispensed due to a safety concern."
        dr_note   = "\n\n🩺 *Please consult your doctor immediately.*" if cde["requires_doctor"] else ""
        tier_warn = get_tier_constraints(cde["risk_tier"]).get("extra_warning", "")
        full_reply = f"{base_msg}{dr_note}"
        if tier_warn:
            full_reply += f"\n\n{tier_warn}"

        return {**state, "cde_result": cde, "reply": full_reply.strip(),
                "agent_used": "clinical_decision_engine",
                "safety_flags": ["CDE_BLOCKED"],
                "risk_tier": cde["risk_tier"]}

    # Non-blocking — inject for downstream agents
    return {**state, "cde_result": cde, "risk_tier": cde["risk_tier"]}


# ── Node 4: Intent Router ─────────────────────────────────────
async def intent_router(state: MedState) -> MedState:
    if state.get("reply"):
        return state
    llm      = get_llm()
    hist_txt = "\n".join(
        f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:100]}"
        for h in state.get("history", [])[-3:])
    pending  = await r_get(f"pending_action:{state['phone']}")
    pend_ctx = f"\nPending action: {pending[:80]}" if pending else ""

    try:
        raw = (await llm.ainvoke([
            SystemMessage(content="You classify pharmacy chatbot intents. Return only valid JSON."),
            HumanMessage(content=(
                "Intents: drug_info | order | safety | reminder | refill | general\n"
                f"Chat:\n{hist_txt}{pend_ctx}\n\n"
                f"Message: {state['message']}\n\n"
                'Return: {"intent":"...","confidence":0.0}'))
        ])).content.strip()
        raw        = re.sub(r"```json|```", "", raw).strip()
        data       = json.loads(raw)
        intent     = data.get("intent", "general")
        confidence = float(data.get("confidence", 0.9))
        if intent not in {"drug_info","order","safety","reminder","refill","general"}:
            intent = "general"
    except:
        intent = "general"; confidence = 0.9

    # Bias toward order if there is an unresolved pending action
    if pending and confidence < C.INTENT_CONF_MIN:
        intent = "order"; confidence = 0.8

    if confidence < C.INTENT_CONF_MIN:
        return {**state, "intent": "clarify", "intent_conf": confidence,
                "reply": ("I'm not sure what you'd like to do:\n\n"
                          "1️⃣ Ask about a medicine\n2️⃣ Place an order\n"
                          "3️⃣ Check drug safety\n4️⃣ Set a reminder\n\n"
                          "Reply with 1, 2, 3, or 4."),
                "agent_used": "intent_router"}

    logger.info(f"Intent={intent} ({confidence:.2f}) phone={state['phone']}")
    return {**state, "intent": intent, "intent_conf": confidence}


# ── Node 5: Onboarding Agent ──────────────────────────────────
async def onboarding_agent(state: MedState) -> MedState:
    user  = state["user"]
    phone = state["phone"]
    msg   = state["message"].strip()
    step  = user.get("onboarding_step", "name")
    llm   = get_llm()

    if step == "name":
        name = msg.strip().title()[:80]
        if len(name) < 2:
            return {**state, "reply": "Please tell me your name to get started. 😊",
                    "agent_used": "onboarding_agent"}
        await update_user(phone, name=name, onboarding_step="age")
        reply = f"Nice to meet you, *{name}*! 😊\n\n📅 *How old are you?*"

    elif step == "age":
        m = re.search(r"\d+", msg)
        if not m:
            return {**state, "reply": "Please enter your age as a number, e.g. *32*",
                    "agent_used": "onboarding_agent"}
        age = int(m.group())
        if not 0 < age < 120:
            return {**state, "reply": "Please enter a valid age.", "agent_used": "onboarding_agent"}
        await update_user(phone, age=age, onboarding_step="gender")
        reply = f"Got it — *{age} years old.*\n\n👤 *Gender?* Reply: *male*, *female*, or *other*"

    elif step == "gender":
        g      = msg.lower()
        gender = "male" if "male" in g else ("female" if "female" in g else "other")
        next_s = "pregnancy" if gender == "female" else "allergies"
        await update_user(phone, gender=gender, onboarding_step=next_s)
        reply  = ("Noted.\n\n🤰 *Are you currently pregnant?* (yes/no)"
                  if gender == "female"
                  else "Noted.\n\n💊 *Any medicine allergies?* Or reply *none*")

    elif step == "pregnancy":
        preg = "yes" in msg.lower() or "haan" in msg.lower()
        await update_user(phone, is_pregnant=preg, onboarding_step="allergies")
        reply = ("✅ Noted — pregnant. I'll flag any unsafe medicines for you.\n\n"
                 if preg else "Noted.\n\n")
        reply += "💊 *Any medicine allergies?* (e.g. penicillin, aspirin) or reply *none*"

    elif step == "allergies":
        allergies = []
        if "none" not in msg.lower() and msg.lower() not in ("no", "n"):
            raw = (await llm.ainvoke([
                SystemMessage(content="Extract medicine allergy names. Return comma-separated or 'none'."),
                HumanMessage(content=f"From: '{msg}'")
            ])).content.strip()
            allergies = ([] if raw.lower() == "none"
                         else [a.strip().lower() for a in raw.split(",") if a.strip()])
        await update_user(phone, allergies=allergies, onboarding_step="current_meds")
        a_str = ", ".join(allergies) if allergies else "none"
        reply = (f"Saved allergies: *{a_str}*\n\n"
                 "💊 *Are you currently taking any medicines?*\nList them or reply *none*.")

    elif step == "current_meds":
        meds = []
        if "none" not in msg.lower():
            raw = (await llm.ainvoke([
                SystemMessage(content="Extract medicine names. Return comma-separated or 'none'."),
                HumanMessage(content=f"From: '{msg}'")
            ])).content.strip()
            meds = ([] if raw.lower() == "none"
                    else [m.strip().lower() for m in raw.split(",") if m.strip()])
        pool = await get_pool()
        for med in meds:
            try:
                await pool.execute(
                    """INSERT INTO active_medications
                       (user_id,drug_name,frequency,meal_instruction,dose_per_intake,dosage)
                       VALUES($1,$2,'as_prescribed','any','as directed','as prescribed')
                       ON CONFLICT DO NOTHING""",
                    str(user["id"]), med)
            except: pass

        await update_user(phone, onboarded=True, onboarding_step="done", consent_accepted=True)
        # Record consent
        try:
            await db_execute(
                "INSERT INTO user_consents(user_id, consent_type) VALUES($1,'medical_disclaimer') ON CONFLICT DO NOTHING",
                str(user["id"]))
        except: pass

        m_str = ", ".join(meds) if meds else "none"
        reply = (f"✅ *Profile complete!*\n\nCurrent medicines: *{m_str}*\n\n"
                 "_⚕️ This service provides information only — not medical advice._\n\n"
                 "How can I help?\n"
                 "💊 Medicine info  |  🛒 Order  |  ⚠️ Drug safety  |  🏥 Health questions")
    else:
        reply = "Welcome back! How can I help?"

    return {**state, "reply": reply, "agent_used": "onboarding_agent",
            "user": await get_user_by_phone(phone) or state["user"]}


# ── Node 6: Conversation Agent (V5: episode-aware, tier-adaptive) ─
async def conversation_agent(state: MedState) -> MedState:
    if state.get("reply"): return state

    user    = state["user"]
    query   = state["message"]
    history = state.get("history", [])
    summary = state.get("session_summary") or ""
    tier    = state.get("risk_tier", 1)
    cde     = state.get("cde_result") or {}
    age     = user.get("age")

    triage_note = ("⚠️ *Your symptoms seem significant. Please see a doctor soon.*\n\n"
                   if state.get("triage_level") == "high" else "")
    tier_warn   = get_tier_constraints(tier).get("extra_warning", "")

    # V5: Active episode context
    ep_ctx = ""
    if state.get("active_episode_id"):
        ep = await db_fetchrow(
            "SELECT episode_type, symptoms, followup_count, worsened FROM health_episodes WHERE id=$1",
            state["active_episode_id"])
        if ep:
            ep_ctx = (f"\n[Active Episode: {ep['episode_type']} | "
                      f"Symptoms: {ep['symptoms']} | "
                      f"Followups: {ep['followup_count']} | "
                      f"Worsening: {ep['worsened']}]")

    # Proactive missing-info prompts
    has_symptom = any(kw in query.lower() for kw in C.SYMPTOM_KW)
    follow_up   = ""
    if has_symptom and not age:
        follow_up = "\n\n*Could you also tell me your age?* This helps me give safer advice."
    elif has_symptom and not re.search(r"\d+\s*(day|hour|week|month)", query.lower()):
        follow_up = "\n\n*How long have you had these symptoms?*"

    # CDE non-critical warnings to surface
    cde_notes = ""
    if cde.get("warnings"):
        moderate = [w for w in cde["warnings"] if w["severity"] not in ("CRITICAL", "HIGH")]
        if moderate:
            cde_notes = f"\n\n{moderate[0]['text'][:200]}"

    rag      = await retrieve(query, C.NS_GENERAL, top_k=8)
    ctx      = "\n\n---\n".join([r["text"] for r in rag[:3]]) if rag else "No context found."
    hist_txt = "\n".join(
        f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:150]}"
        for h in history[-4:])
    short    = get_tier_constraints(tier)["short_response"]

    prompt = (
        "You are a warm, knowledgeable medical information assistant.\n"
        "Rules: Never diagnose. Ask at most ONE follow-up. Suggest doctor for persistent symptoms.\n"
        f"{'IMPORTANT: Be concise — high-risk patient profile.' if short else ''}\n\n"
        f"Patient: Age={age or '?'} | Pregnant={user.get('is_pregnant',False)} | "
        f"Allergies={user.get('allergies',[])} | Meds={user.get('current_meds',[])} | "
        f"Risk Tier={tier}{ep_ctx}\n"
        f"{'Memory: ' + summary[:250] if summary else ''}\n\n"
        f"Knowledge:\n{ctx}\n\nChat:\n{hist_txt}\n\nQuestion: {query}\n\nAnswer:"
    )
    try:
        llm   = get_llm()
        reply = (await llm.ainvoke([
            SystemMessage(content="You are a safe, helpful medical information assistant."),
            HumanMessage(content=prompt)
        ])).content
    except Exception as e:
        logger.error(f"conversation_agent: {e}")
        reply = "I couldn't process that. Could you rephrase?"

    full = triage_note + reply + cde_notes + follow_up
    if tier_warn:
        full += f"\n\n{tier_warn}"

    return {**state, "reply": full, "agent_used": "conversation_agent", "rag_context": rag}


# ── Node 7: Drug Info Agent (CDE-injected, tier-adaptive) ─────
async def drug_info_agent(state: MedState) -> MedState:
    if state.get("reply"): return state

    user  = state["user"]
    query = state["message"]
    drugs = state.get("drugs_found", [])
    tier  = state.get("risk_tier", 1)
    cde   = state.get("cde_result") or {}
    age   = user.get("age")
    weight= user.get("weight_kg")
    is_child = age and age < 18

    # Proactive questions for dosage queries
    asks_dosage = any(w in query.lower() for w in ["dose", "dosage", "how much", "how many mg"])
    follow_up   = ""
    if asks_dosage and not age:
        follow_up = "\n\n*Is this for an adult or a child?*"
    elif asks_dosage and is_child and not weight:
        follow_up = f"\n\n*What is the child's weight in kg?* This helps calculate the correct dose."

    rag = await retrieve(query, C.NS_DRUGS, top_k=8)
    ctx = "\n\n---\n".join([r["text"] for r in rag[:3]]) if rag else ""

    # Stock check (FEFO order)
    stock_info = ""
    inv        = None
    if drugs:
        inv = await check_stock(drugs[0])
        if inv:
            stock_info = (f"\n\n📦 *In Stock:* {inv['stock_qty']} {inv['unit']}s  |  "
                          f"💰 ₹{inv['price_per_unit']}/{inv['unit']}\n"
                          f"{'✅ No prescription needed' if inv['is_otc'] else '📋 Prescription required'}")
        else:
            stock_info = f"\n\n⚠️ *{drugs[0].title()} is not currently in stock.*"

    # Build safety section from CDE result (already computed by CDE node)
    all_warnings   = list(cde.get("warnings", []))
    if drugs and not all_warnings:   # fallback if CDE didn't run for this drug
        all_warnings += await check_interactions_rag(drugs[0], user.get("current_meds") or [])
        all_warnings += await check_class_allergy(drugs[0], user.get("allergies") or [])
        food_w = check_food_drug(drugs[0], query)
        if food_w: all_warnings.append({"severity": "MODERATE", "text": food_w})

    safety_section = ""
    critical = [w for w in all_warnings if w["severity"] == "CRITICAL"]
    if critical:
        safety_section = f"\n\n🚨 *CRITICAL:*\n{critical[0]['text'][:300]}"
    elif all_warnings:
        safety_section = f"\n\n⚠️ {all_warnings[0]['text'][:200]}"

    if cde.get("dose_adjustment"):
        da = cde["dose_adjustment"]
        safety_section += f"\n\n💊 *Dose Adjustment (eGFR={da.get('egfr')}):* {da.get('note')}"
    if cde.get("dup_therapy"):
        safety_section += f"\n\n⚠️ *Duplicate Therapy:* {cde['dup_therapy'][:150]}"

    tier_warn = get_tier_constraints(tier).get("extra_warning", "")

    try:
        llm   = get_llm()
        reply = (await llm.ainvoke([
            SystemMessage(content="You are a clinical pharmacy information system. Be accurate and concise."),
            HumanMessage(content=(
                f"Drug context:\n{ctx}\n\n"
                f"Patient: Age={age or '?'} | Pregnant={user.get('is_pregnant',False)} | "
                f"Weight={weight or '?'}kg | Risk Tier={tier}\n\n"
                f"Q: {query}\n\n"
                "Format:\n"
                "💊 *Drug Name*\n🎯 *Used for:*\n📏 *Dosage:*\n"
                "⏰ *Frequency:*\n🍽️ *Take:*\n⚠️ *Key warnings:*"))
        ])).content
    except:
        reply = ctx[:500] if ctx else "Drug info unavailable."

    reply += stock_info + safety_section + follow_up
    if tier_warn:
        reply += f"\n\n{tier_warn}"

    if inv and not critical:
        await r_set(f"pending_action:{state['phone']}",
                    {"type": "order_confirm", "drug": drugs[0], "inventory": inv}, ttl=300)
        reply += f"\n\n🛒 *Would you like to order {drugs[0].title()}?* Reply *yes* to proceed."
        return {**state, "reply": reply, "agent_used": "drug_info_agent",
                "rag_context": rag, "selected_inv": inv, "requires_action": "order_confirm",
                "safety_flags": [f"{w['severity']}_WARNING" for w in all_warnings]}

    return {**state, "reply": reply, "agent_used": "drug_info_agent",
            "rag_context": rag,
            "safety_flags": [f"{w['severity']}_WARNING" for w in all_warnings]}


# ── Node 8: Safety Agent (CDE-injected) ───────────────────────
async def safety_agent(state: MedState) -> MedState:
    if state.get("reply"): return state

    user     = state["user"]
    query    = state["message"]
    drugs    = state.get("drugs_found", [])
    cde      = state.get("cde_result") or {}
    tier     = state.get("risk_tier", 1)

    rag = await retrieve(query, C.NS_SAFETY, top_k=8)
    ctx = "\n\n---\n".join([r["text"] for r in rag[:3]]) if rag else ""

    all_warnings = list(cde.get("warnings", []))
    if not all_warnings:
        for drug in drugs:
            all_warnings += await check_interactions_rag(drug, user.get("current_meds") or [])
            all_warnings += await check_class_allergy(drug, user.get("allergies") or [])

    critical = [w for w in all_warnings if w["severity"] == "CRITICAL"]
    if critical:
        return {**state,
                "reply": (f"🚨 *CRITICAL SAFETY ALERT*\n\n{critical[0]['text'][:400]}\n\n"
                          "⛔ *Do NOT take this combination.* Consult your doctor immediately."),
                "agent_used": "safety_agent",
                "safety_flags": ["CRITICAL_INTERACTION"]}

    dup_note = ""
    if cde.get("dup_therapy"):
        dup_note = f"\n\n⚠️ *Duplicate Therapy Detected:* {cde['dup_therapy'][:200]}"

    tier_warn = get_tier_constraints(tier).get("extra_warning", "")

    try:
        llm   = get_llm()
        reply = (await llm.ainvoke([
            SystemMessage(content="You are a clinical pharmacist. Be precise and safety-first."),
            HumanMessage(content=(
                f"Safety context:\n{ctx}{dup_note}\n\n"
                f"Patient: Age={user.get('age')} | Pregnant={user.get('is_pregnant',False)} | "
                f"Allergies={user.get('allergies',[])} | Meds={user.get('current_meds',[])} | "
                f"Risk Tier={tier}\n\nQ: {query}\n\n"
                "Be direct. Use WhatsApp *bold* for warnings. "
                "End: 'Always verify with your doctor.'"))
        ])).content
    except:
        reply = "Safety check unavailable. Consult your pharmacist."

    if tier_warn:
        reply += f"\n\n{tier_warn}"

    return {**state, "reply": reply, "agent_used": "safety_agent",
            "safety_flags": [f"{w['severity']}_WARNING" for w in all_warnings]}


# ── Node 9: Order Agent (V5: CDE-gated + cumulative abuse) ────
async def order_agent(state: MedState) -> MedState:
    if state.get("reply"): return state

    user    = state["user"]
    phone   = state["phone"]
    message = state["message"]
    drugs   = state.get("drugs_found", [])
    history = state.get("history", [])
    cde     = state.get("cde_result") or {}
    tier    = state.get("risk_tier", 1)

    # ── Pre-flight: hard abuse block ─────────────────────────
    if await check_abuse_blocked(str(user["id"])):
        return {**state,
                "reply": "⚠️ We are unable to process this order. Please visit our pharmacy in person.",
                "agent_used": "order_agent",
                "safety_flags": ["ABUSE_HARD_BLOCKED"]}

    # ── Handle existing pending action (LLM decision) ─────────
    prev_raw = await r_get(f"pending_action:{phone}")
    if prev_raw:
        prev = json.loads(prev_raw)
        if prev.get("type") in ("order_confirm", "order_quantity"):
            drug = prev["drug"]
            inv  = prev["inventory"]
            decision = await llm_order_decision(message, drug, inv, user, history)

            if decision["proceed"]:
                qty = decision.get("quantity")
                if not qty:
                    qty_m = re.search(r"\d+", message)
                    qty   = int(qty_m.group()) if qty_m else None
                if not qty:
                    await r_set(f"pending_action:{phone}",
                                {**prev, "type": "order_quantity"}, ttl=300)
                    return {**state,
                            "reply": (f"How many *{inv.get('unit','tablet')}s* of "
                                      f"*{inv.get('brand_name',drug).title()}* "
                                      f"would you like? (Available: {inv['stock_qty']})"),
                            "agent_used": "order_agent",
                            "requires_action": "order_quantity"}
                return await _execute_order_safe(state, drug, inv, user, int(qty), cde)

            elif decision["needs"]:
                questions = {
                    "quantity":     f"How many {inv.get('unit','tablet')}s would you like?",
                    "prescription": "Please upload a photo of your prescription to proceed.",
                    "address":      "What is your delivery address?",
                }
                return {**state,
                        "reply": questions.get(decision["needs"][0],
                                               f"Could you provide: {decision['needs'][0]}?"),
                        "agent_used": "order_agent",
                        "requires_action": decision["needs"][0]}
            else:
                await r_del(f"pending_action:{phone}")
                return {**state,
                        "reply": "No problem! Let me know if you need anything else.",
                        "agent_used": "order_agent"}

    # ── Fresh order — identify drug ───────────────────────────
    drug_name = drugs[0] if drugs else None
    if not drug_name:
        llm = get_llm()
        try:
            ext = (await llm.ainvoke([
                SystemMessage(content="Extract only the medicine name. Return the name or 'unknown'."),
                HumanMessage(content=f"Medicine from: '{message}'")
            ])).content.strip().lower()
            drug_name = ext if ext not in ("unknown", "none") else None
        except: pass

    if not drug_name:
        return {**state,
                "reply": "Which medicine would you like to order?",
                "agent_used": "order_agent"}

    # ── V5: Update abuse score ────────────────────────────────
    abuse = await update_abuse_score(str(user["id"]), drug_name, [], message)
    if abuse["block"]:
        return {**state,
                "reply": "⚠️ Unable to process this order. Please visit our pharmacy in person.",
                "agent_used": "order_agent",
                "safety_flags": ["ABUSE_HARD_BLOCKED"]}

    # ── V5: CDE gate (re-run if not already done for this drug) ─
    if not cde or cde.get("risk_tier") is None:
        cde = await run_cde(user, drug_name)

    if cde["block"]:
        critical = [w for w in cde["warnings"] if w["severity"] == "CRITICAL"]
        msg = critical[0]["text"] if critical else "Safety concern detected for this medicine."
        return {**state,
                "reply": f"⛔ *Order Blocked — Safety Alert*\n\n{msg}\n\nPlease consult your doctor.",
                "agent_used": "order_agent",
                "safety_flags": ["ORDER_BLOCKED_CDE"]}

    if cde["requires_doctor"]:
        warns = cde.get("warnings", [])
        note  = warns[0]["text"][:200] if warns else ""
        return {**state,
                "reply": (f"⚠️ *Doctor Consultation Required*\n\n{note}\n\n"
                          "This medicine requires a doctor's approval for your profile. "
                          "Would you like help finding a teleconsultation?"),
                "agent_used": "order_agent",
                "safety_flags": ["REQUIRES_DOCTOR_CONSULT"]}

    # ── Stock check ───────────────────────────────────────────
    inv = await check_stock(drug_name)
    if not inv:
        res = await get_inventory_fuzzy(drug_name, limit=3)
        inv = res[0] if res else None

    if not inv:
        return {**state,
                "reply": (f"😔 *{drug_name.title()}* is out of stock.\n\n"
                          "Reply *yes* to be notified when it becomes available."),
                "agent_used": "order_agent"}

    if not inv["is_otc"]:
        return {**state,
                "reply": (f"📋 *{inv.get('brand_name',drug_name).title()}* requires a prescription.\n\n"
                          "Please upload a prescription photo to proceed."),
                "agent_used": "order_agent",
                "safety_flags": ["PRESCRIPTION_REQUIRED"]}

    # Non-blocking CDE warnings
    warn_note = ""
    if cde.get("warnings"):
        moderate = [w for w in cde["warnings"] if w["severity"] not in ("CRITICAL", "HIGH")]
        if moderate:
            warn_note = f"\n\n💡 *Note:* {moderate[0]['text'][:150]}"
    if cde.get("dup_therapy"):
        warn_note += f"\n\n⚠️ *Duplicate Therapy:* {cde['dup_therapy'][:120]}"

    await r_set(f"pending_action:{phone}",
                {"type": "order_confirm", "drug": drug_name, "inventory": inv}, ttl=300)

    return {**state,
            "reply": (f"✅ *{inv.get('brand_name',drug_name).title()}* — In Stock\n\n"
                      f"📦 {inv['stock_qty']} {inv['unit']}s  |  "
                      f"💰 ₹{inv['price_per_unit']}/{inv['unit']}{warn_note}\n\n"
                      f"How many {inv['unit']}s would you like? _(e.g. *10*)_"),
            "agent_used": "order_agent",
            "requires_action": "order_quantity",
            "selected_inv": inv}


async def _execute_order_safe(state: MedState, drug_name: str, inv: dict,
                               user: dict, qty: int, cde: dict = None) -> MedState:
    """V5: Transaction-safe order with SELECT FOR UPDATE. CDE tier logged."""
    phone      = state["phone"]
    patient_id = state.get("patient_id") or str(user["id"])
    pool       = await get_pool()

    async with pool.acquire() as conn:
        async with conn.transaction():
            locked = await conn.fetchrow(
                "SELECT id, stock_qty, price_per_unit FROM inventory WHERE id=$1 FOR UPDATE",
                str(inv["id"]))
            if not locked or locked["stock_qty"] < qty:
                avail = locked["stock_qty"] if locked else 0
                await r_del(f"pending_action:{phone}")
                return {**state,
                        "reply": f"Sorry, only *{avail}* {inv.get('unit','tablet')}s are available.",
                        "agent_used": "order_agent"}

            order = await conn.fetchrow(
                """INSERT INTO orders
                   (user_id, patient_id, inventory_id, drug_name, quantity, unit_price,
                    placed_by_role, dup_therapy_checked, cde_risk_tier)
                   VALUES($1,$2,$3,$4,$5,$6,'self',TRUE,$7) RETURNING *""",
                str(user["id"]), patient_id, str(inv["id"]), drug_name, qty,
                float(locked["price_per_unit"]),
                cde.get("risk_tier", 1) if cde else 1)

            await conn.execute(
                "UPDATE inventory SET stock_qty=stock_qty-$2, times_ordered=times_ordered+1, updated_at=NOW() WHERE id=$1",
                str(inv["id"]), qty)

    # Determine frequency via RAG (not hardcoded)
    freq_rag = await retrieve(f"{drug_name} dosage frequency times per day", C.NS_DRUGS, top_k=3)
    freq_key = "twice_daily"
    if freq_rag:
        t = freq_rag[0]["text"].lower()
        if   "thrice" in t or "three time" in t: freq_key = "thrice_daily"
        elif "four" in t or "4 time" in t:       freq_key = "four_times"
        elif "once" in t or "one time" in t:     freq_key = "once_daily"

    meal_inst  = C.MEAL_INST.get(drug_name.lower(), "after_meal")
    times      = C.FREQ_TIMES.get(freq_key, ["08:00", "20:00"])
    days       = max(7, qty // max(len(times), 1))
    dosage_txt = freq_rag[0]["text"][:120] if freq_rag else "As prescribed"

    await pool.execute(
        """INSERT INTO active_medications
           (user_id, drug_name, dosage, dose_per_intake, frequency,
            frequency_times, meal_instruction, end_date, source)
           VALUES($1,$2,$3,'1',$4,$5,$6,$7,'ordered') ON CONFLICT DO NOTHING""",
        patient_id, drug_name, dosage_txt, freq_key, times, meal_inst,
        date.today() + timedelta(days=days))

    await log_audit(str(user["id"]), "order_placed", "orders", str(order["id"]),
                    new_val={"drug": drug_name, "qty": qty, "patient": patient_id},
                    performed_by=phone)
    await log_health_event(patient_id, "order", f"Ordered {drug_name.title()} ×{qty}",
                           drug_name=drug_name, metadata={"order_id": str(order["id"])})
    await r_del(f"pending_action:{phone}")
    await r_set(f"pending_order:{phone}",
                {"order_id": str(order["id"]), "drug": drug_name, "qty": qty,
                 "meal_inst": meal_inst, "times": times, "patient_id": patient_id,
                 "freq_key": freq_key}, ttl=600)

    total = round(float(locked["price_per_unit"]) * qty, 2)
    return {**state,
            "reply": (f"🎉 *Order Placed!*\n\n"
                      f"💊 *{inv.get('brand_name',drug_name).title()}*\n"
                      f"📦 {qty} {inv.get('unit','tablet')}s  |  💰 ₹{total}\n"
                      f"🍽️ Take: *{meal_inst.replace('_',' ')}*\n\n"
                      f"⏰ *Set dose reminders?*\n"
                      f"Suggested times: {', '.join(times)}\n"
                      f"Reply *yes* to use these, or send your preferred times _(e.g. '9am 9pm')_."),
            "agent_used": "order_agent",
            "order_record": dict(order),
            "requires_action": "reminder_setup"}


# ── Node 10: Reminder Agent (V5: tier-adaptive escalation) ────
async def reminder_agent(state: MedState) -> MedState:
    if state.get("reply"): return state

    phone   = state["phone"]
    user    = state["user"]
    message = state["message"]
    tier    = state.get("risk_tier", 1)

    pending_raw = await r_get(f"pending_order:{phone}")
    if pending_raw:
        pending = json.loads(pending_raw)
        drug    = pending["drug"]

        sub_raw = await r_get(f"reminder_step:{phone}")
        sub     = json.loads(sub_raw) if sub_raw else None

        # Sub-step: user just confirmed duration
        if sub and sub.get("step") == "duration":
            ctimes = sub["times"]
            days_m = re.search(r"(\d+)\s*(?:day|week|month)", message.lower())
            if days_m:
                rv   = int(days_m.group(1))
                unit = re.search(r"week|month", message.lower())
                days = rv * (7 if unit and "week" in unit.group()
                             else 30 if unit and "month" in unit.group()
                             else 1)
            elif "auto" in message.lower():
                days = max(7, pending.get("qty", 10) // max(len(ctimes), 1))
            else:
                days = max(7, pending.get("qty", 10) // max(len(ctimes), 1))
            end_dt = date.today() + timedelta(days=days)
            return await _create_reminder(state, pending, ctimes, end_dt, days, tier)

        # User declined
        if message.lower().strip() in ("no", "n", "skip", "nahi", "cancel"):
            await r_del(f"pending_order:{phone}")
            return {**state,
                    "reply": f"No reminders set for {drug.title()}. Say 'set reminder for {drug}' anytime.",
                    "agent_used": "reminder_agent"}

        # Parse custom times from message
        time_tokens  = re.findall(r"\d{1,2}(?::\d{2})?\s*(?:am|pm)?", message, re.I)
        parsed_times = []
        for t in time_tokens[:4]:
            try:
                tc = t.strip().lower()
                if "am" in tc or "pm" in tc:
                    fmt    = "%I%p" if ":" not in tc else "%I:%M%p"
                    parsed = datetime.strptime(tc.replace(" ", ""), fmt)
                    parsed_times.append(parsed.strftime("%H:%M"))
                else:
                    parsed_times.append(f"{tc.zfill(2)}:00" if ":" not in tc else tc.zfill(5))
            except: pass

        # Yes / OK → use defaults
        if message.lower().strip() in ("yes","y","ok","okay","haan","sure","ha") and not parsed_times:
            parsed_times = pending["times"]

        # Still no times → proactively ask
        if not parsed_times:
            return {**state,
                    "reply": (f"⏰ *What time(s) should I remind you to take *{drug.title()}*?*\n\n"
                              f"Suggested: {', '.join(pending['times'])}\n\n"
                              "Reply *yes* to use these, or send your own times _(e.g. '9am 9pm')_"),
                    "agent_used": "reminder_agent",
                    "requires_action": "reminder_time"}

        # Times confirmed → ask for duration
        await r_set(f"reminder_step:{phone}", {"step": "duration", "times": parsed_times}, ttl=300)
        return {**state,
                "reply": (f"✅ *Times set:* {', '.join(parsed_times)}\n\n"
                          f"📅 *How long should I remind you?*\n"
                          f"_(e.g. '7 days', '2 weeks', or reply *auto* to calculate from quantity)_"),
                "agent_used": "reminder_agent",
                "requires_action": "reminder_duration"}

    # No pending order — show existing reminders
    rows = await db_fetch(
        "SELECT drug_name, remind_times, qty_remaining FROM reminders WHERE patient_id=$1 AND is_active=TRUE LIMIT 5",
        str(user["id"]))
    if not rows:
        return {**state,
                "reply": "No active reminders. Order a medicine first, or tell me which medicine you need reminders for.",
                "agent_used": "reminder_agent"}

    lst = "\n".join(
        f"• *{r['drug_name'].title()}* — {', '.join(r['remind_times'])} ({r.get('qty_remaining','?')} left)"
        for r in rows)
    return {**state,
            "reply": f"📋 *Your active reminders:*\n\n{lst}\n\nReply *cancel [medicine]* to stop one.",
            "agent_used": "reminder_agent"}


async def _create_reminder(state: MedState, pending: dict,
                            times: list, end_dt: date, days: int, tier: int) -> MedState:
    phone      = state["phone"]
    user       = state["user"]
    pool       = await get_pool()
    esc_timeout= get_tier_constraints(tier)["esc_timeout_secs"]

    row = await pool.fetchrow(
        """INSERT INTO reminders
           (user_id, patient_id, order_id, drug_name, dose, meal_instruction,
            remind_times, end_date, total_qty, qty_remaining)
           VALUES($1,$2,$3,$4,'1 tablet',$5,$6,$7,$8,$8) RETURNING *""",
        str(user["id"]),
        pending.get("patient_id", str(user["id"])),
        pending["order_id"],
        pending["drug"],
        pending["meal_inst"],
        times, end_dt,
        pending.get("qty", 10))

    job_ids = await schedule_reminder_jobs(
        str(row["id"]),
        pending.get("patient_id", str(user["id"])),
        pending["drug"], "1 tablet", pending["meal_inst"],
        times, date.today(), end_dt, phone,
        escalation_timeout=esc_timeout)

    if job_ids:
        await pool.execute("UPDATE reminders SET bullmq_job_ids=$2 WHERE id=$1", str(row["id"]), job_ids)

    await r_del(f"pending_order:{phone}")
    await r_del(f"reminder_step:{phone}")

    esc_note = ("⚡ *Escalation: 30 min if no reply*" if esc_timeout <= 1800
                else "📞 *Escalation: 1 hour if no reply*")

    return {**state,
            "reply": (f"⏰ *Reminders Scheduled!*\n\n"
                      f"💊 *{pending['drug'].title()}*\n"
                      f"🕐 {', '.join(times)}\n"
                      f"🍽️ {pending['meal_inst'].replace('_',' ')}\n"
                      f"📅 Until {end_dt.strftime('%d %b %Y')} ({days} days)\n\n"
                      f"When you get a reminder, reply:\n"
                      f"✅ *taken*  |  ❌ *skipped*\n\n"
                      f"{esc_note}"),
            "agent_used": "reminder_agent"}


# ── Node 11: Refill Agent ─────────────────────────────────────
async def refill_agent(state: MedState) -> MedState:
    if state.get("reply"): return state
    user  = state["user"]
    phone = state["phone"]
    rows  = await db_fetch(
        """SELECT drug_name, qty_remaining, refill_alert_at FROM reminders
           WHERE patient_id=$1 AND is_active=TRUE
             AND qty_remaining IS NOT NULL AND qty_remaining <= refill_alert_at""",
        str(user["id"]))
    if not rows:
        return {**state, "reply": "All your medicines have sufficient stock. 👍",
                "agent_used": "refill_agent"}
    drug = rows[0]["drug_name"]
    qty  = rows[0]["qty_remaining"]
    inv  = await check_stock(drug)
    if inv:
        await r_set(f"pending_action:{phone}",
                    {"type": "order_confirm", "drug": drug, "inventory": inv}, ttl=300)
        return {**state,
                "reply": (f"🔄 *Refill Needed!*\n\n*{drug.title()}* — only *{qty}* left.\n\n"
                          f"✅ In stock at ₹{inv['price_per_unit']}/{inv['unit']}\n\n"
                          "Order a refill? Reply *yes* or *no*."),
                "agent_used": "refill_agent",
                "requires_action": "order_confirm"}
    return {**state,
            "reply": (f"⚠️ *{drug.title()}* is running low ({qty} left) but *out of stock*. "
                      "I'll notify you when available."),
            "agent_used": "refill_agent"}


# ── Node 12: Post Process ─────────────────────────────────────
async def post_process(state: MedState) -> MedState:
    if not state.get("reply"):
        return {**state, "reply": "How can I help you?"}
    reply = state["reply"]

    # Add medical disclaimer for info agents
    if (state.get("agent_used") in {"conversation_agent", "drug_info_agent", "safety_agent"}
            and "not a substitute" not in reply.lower()):
        reply += "\n\n_⚕️ For informational purposes only. Not a substitute for professional medical advice._"

    # Persist messages
    user    = state.get("user", {})
    uid     = str(user.get("id", ""))
    session = state["session_id"]
    pool    = await get_pool()
    if uid:
        for role, content, agent, flags in [
            ("user",      state["message"], None,                    []),
            ("assistant", reply,            state.get("agent_used",""), state.get("safety_flags",[])),
        ]:
            try:
                await pool.execute(
                    """INSERT INTO conversation_messages
                       (session_id, user_id, role, content, agent_used,
                        drugs_mentioned, safety_flags, intent, intent_confidence)
                       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                    session, uid, role, content[:3000], agent,
                    state.get("drugs_found", []), flags,
                    state.get("intent", ""), state.get("intent_conf", 0.0))
            except Exception as e:
                logger.error(f"post_process DB: {e}")

    return {**state, "reply": reply}


# ══════════════════════════════════════════════════════════════
# §18  ROUTING FUNCTIONS
# ══════════════════════════════════════════════════════════════
def should_onboard(state: MedState) -> str:
    if state.get("emergency") or state.get("blocked_drug") or state.get("reply"):
        return "post_process"
    if state.get("is_new_user") or not state.get("user", {}).get("onboarded"):
        return "onboarding_agent"
    return "pre_safety"

def after_presafety(state: MedState) -> str:
    if state.get("emergency") or state.get("blocked_drug") or state.get("reply"):
        return "post_process"
    return "clinical_decision"

def after_cde(state: MedState) -> str:
    # CDE blocked → already has reply
    if state.get("reply"):
        return "post_process"
    return "intent_router"

def route_intent(state: MedState) -> str:
    if state.get("reply"):
        return "post_process"
    return {
        "drug_info": "drug_info_agent",
        "order":     "order_agent",
        "safety":    "safety_agent",
        "reminder":  "reminder_agent",
        "refill":    "refill_agent",
        "clarify":   "post_process",
    }.get(state.get("intent", ""), "conversation_agent")


# ══════════════════════════════════════════════════════════════
# §19  BUILD GRAPH
# ══════════════════════════════════════════════════════════════
def after_dfe(state: MedState) -> str:
    """
    After DFE runs:
    - If DFE asked a question (reply set) → post_process
    - If DFE found nothing to ask → continue to target agent
    """
    if state.get("dfe_triggered") and state.get("reply"):
        return "post_process"
    # Route to the right agent based on original intent
    intent = state.get("intent", "general")
    return {
        "drug_info":  "drug_info_agent",
        "safety":     "safety_agent",
    }.get(intent, "conversation_agent")


def build_graph():
    g = StateGraph(MedState)

    # Register nodes
    nodes = {
        "load_context":              load_context,
        "pre_safety":                pre_safety,
        "clinical_decision":         clinical_decision_node,
        "onboarding_agent":          onboarding_agent,
        "intent_router":             intent_router,
        "dynamic_followup_engine":   dynamic_followup_engine,   # V6 NEW
        "conversation_agent":        conversation_agent,
        "drug_info_agent":           drug_info_agent,
        "safety_agent":              safety_agent,
        "order_agent":               order_agent,
        "reminder_agent":            reminder_agent,
        "refill_agent":              refill_agent,
        "post_process":              post_process,
    }
    for name, fn in nodes.items():
        g.add_node(name, fn)

    # Entry
    g.add_edge(START, "load_context")

    # load_context → onboarding or pre_safety
    g.add_conditional_edges("load_context", should_onboard, {
        "onboarding_agent": "onboarding_agent",
        "pre_safety":       "pre_safety",
        "post_process":     "post_process",
    })

    # pre_safety → CDE or post_process
    g.add_conditional_edges("pre_safety", after_presafety, {
        "clinical_decision": "clinical_decision",
        "post_process":      "post_process",
    })

    # CDE → intent_router or post_process (blocked)
    g.add_conditional_edges("clinical_decision", after_cde, {
        "intent_router": "intent_router",
        "post_process":  "post_process",
    })

    # intent_router → DFE (V6 NEW: DFE sits between router and agents)
    g.add_conditional_edges("intent_router", route_intent, {
        "conversation_agent": "dynamic_followup_engine",
        "drug_info_agent":    "dynamic_followup_engine",
        "safety_agent":       "dynamic_followup_engine",
        "order_agent":        "order_agent",         # Operational: skip DFE
        "reminder_agent":     "reminder_agent",      # Operational: skip DFE
        "refill_agent":       "refill_agent",        # Operational: skip DFE
        "post_process":       "post_process",
    })

    # DFE → post_process (if asked a question) OR target agent (if no question)
    g.add_conditional_edges("dynamic_followup_engine", after_dfe, {
        "conversation_agent": "conversation_agent",
        "drug_info_agent":    "drug_info_agent",
        "safety_agent":       "safety_agent",
        "post_process":       "post_process",
    })

    # All agents → post_process → END
    for agent in ["onboarding_agent", "conversation_agent", "drug_info_agent",
                  "safety_agent", "order_agent", "reminder_agent", "refill_agent"]:
        g.add_edge(agent, "post_process")
    g.add_edge("post_process", END)

    return g.compile()


graph = build_graph()
logger.info("✅ Medical AI V5 LangGraph compiled")


# ══════════════════════════════════════════════════════════════
# §20  FASTAPI APPLICATION
# ══════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    get_embedder(); get_reranker(); get_pinecone(); get_llm()
    await get_redis(); await get_pool()
    logger.info("✅ Medical AI V5 ready")
    yield
    global _pool, _http
    if _pool: await _pool.close()
    if _http: await _http.aclose()

app = FastAPI(title="Medical AI V5", version="5.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=[C.ALLOWED_ORIGIN],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "Authorization"])


@app.middleware("http")
async def rate_limiter(request: Request, call_next):
    if request.url.path == "/whatsapp":
        phone = request.headers.get("X-Phone", "unknown")
        count = await r_incr(f"rate:{phone}", ttl=60)
        if count and count > C.RATE_LIMIT_MIN:
            return JSONResponse(status_code=429, content={"detail": "Too many requests"})
    return await call_next(request)


@app.get("/health")
async def health():
    stats = get_pinecone().describe_index_stats()
    return {"status": "healthy", "version": "5.0",
            "vectors": stats.get("total_vector_count", 0)}


def _make_initial_state(phone: str, message: str, session_id: str, channel: str) -> MedState:
    """Shared factory for building initial MedState for any channel."""
    return {
        "phone": phone, "message": message,
        "session_id": session_id, "channel": channel,
        "user": {}, "is_new_user": False, "history": [],
        "session_summary": None, "intent": "", "intent_conf": 0.0,
        "drugs_found": [], "emergency": False, "triage_level": "none",
        "blocked_drug": None, "caregiver_ctx": None, "patient_id": None,
        "risk_tier": 1, "cde_result": None, "active_episode_id": None,
        "rag_context": [], "selected_inv": None, "order_record": None,
        "reply": "", "agent_used": "", "safety_flags": [], "requires_action": None,
        # V6
        "dfe_triggered": False, "dfe_question": None, "dfe_context": None,
        "web_search_used": False, "web_search_source": None, "behavioral_profile": None,
    }

async def _run_graph_and_bg(phone: str, message: str, session_id: str,
                             channel: str, bg: BackgroundTasks) -> MedState:
    """Shared graph invocation + background task scheduling."""
    initial = _make_initial_state(phone, message, session_id, channel)
    try:
        result = await graph.ainvoke(initial)
    except Exception as e:
        logger.error(f"Graph error: {e}", exc_info=True)
        raise HTTPException(500, "Internal error. Please try again.")

    # Format reply for channel
    result["reply"] = format_for_channel(result.get("reply", ""), channel)

    user_row = await get_user_by_phone(phone)
    if user_row:
        uid = str(user_row["id"])
        bg.add_task(extract_and_apply_facts, uid, phone, message, session_id)

        if detect_adverse_reaction(message):
            bg.add_task(handle_adverse_reaction_bg, uid, phone,
                        message, result.get("drugs_found", []))

        triage = result.get("triage_level", "none")
        if triage in ("low", "medium"):
            symptom = next((k for k in C.SYMPTOM_KW if k in message.lower()), None)
            if symptom:
                bg.add_task(schedule_symptom_followup, uid, phone, symptom)

        symptoms_found = [k for k in C.SYMPTOM_KW if k in message.lower()]
        if symptoms_found:
            bg.add_task(get_or_create_episode, uid, symptoms_found)

        pool = await get_pool()
        try:
            cnt = await pool.fetchval(
                "SELECT message_count FROM conversations WHERE session_id=$1", session_id)
            if cnt and cnt % 10 == 0:
                bg.add_task(summarize_session_bg, session_id, uid)
        except: pass

        if result.get("drugs_found"):
            bg.add_task(check_missed_dose_pattern, uid, result["drugs_found"][0])

            # V6: Drug recall check in background
            async def recall_bg():
                for drug in result.get("drugs_found", [])[:1]:
                    await check_drug_recall(drug, phone, uid)
            bg.add_task(recall_bg)

    return result


# ── WhatsApp endpoint (V5 backward-compatible) ────────────────
@app.post("/whatsapp", response_model=ChatResponse)
async def whatsapp(req: WhatsAppIncoming, bg: BackgroundTasks):
    phone      = req.phone
    session_id = req.session_id or f"wa_{hashlib.md5(phone.encode()).hexdigest()[:12]}"
    result     = await _run_graph_and_bg(phone, req.message, session_id, "whatsapp", bg)
    return ChatResponse(
        reply            = result["reply"],
        session_id       = session_id,
        agent_used       = result["agent_used"],
        emergency        = result.get("emergency", False),
        safety_flags     = result.get("safety_flags", []),
        triage_level     = result.get("triage_level"),
        requires_action  = result.get("requires_action"),
        risk_tier        = result.get("risk_tier", 1),
        channel          = "whatsapp",
        dfe_triggered    = result.get("dfe_triggered", False),
        web_search_used  = result.get("web_search_used", False),
    )


# ── Web chatbot endpoint (V6 NEW) ─────────────────────────────
@app.post("/chat", response_model=ChatResponse)
async def web_chat(req: WhatsAppIncoming, bg: BackgroundTasks):
    """
    Primary endpoint for web frontend / mobile app.
    Same graph as WhatsApp but channel='web' → richer markdown output.
    Session ID from client or auto-generated.
    """
    phone      = req.phone
    session_id = req.session_id or f"web_{hashlib.md5((phone + req.message[:10]).encode()).hexdigest()[:12]}"
    result     = await _run_graph_and_bg(phone, req.message, session_id, "web", bg)
    return ChatResponse(
        reply            = result["reply"],
        session_id       = session_id,
        agent_used       = result["agent_used"],
        emergency        = result.get("emergency", False),
        safety_flags     = result.get("safety_flags", []),
        triage_level     = result.get("triage_level"),
        requires_action  = result.get("requires_action"),
        risk_tier        = result.get("risk_tier", 1),
        channel          = "web",
        dfe_triggered    = result.get("dfe_triggered", False),
        web_search_used  = result.get("web_search_used", False),
    )


# ── Streaming endpoint for web chatbot (V6 NEW) ───────────────
@app.post("/stream")
async def stream_chat(req: WhatsAppIncoming, bg: BackgroundTasks):
    """
    Server-Sent Events streaming endpoint for web frontend.
    Sends token chunks as they arrive from Groq (streaming mode).

    Frontend usage:
        const es = await fetch('/stream', {method:'POST', body:...});
        for await (const chunk of es.body) { renderChunk(chunk); }
    """
    from fastapi.responses import StreamingResponse

    phone      = req.phone
    session_id = req.session_id or f"web_{hashlib.md5(phone.encode()).hexdigest()[:12]}"

    async def event_generator():
        try:
            # Run pre-processing graph up to (not including) agents
            # then stream the final LLM call
            user     = await get_user_by_phone(phone) or await create_user(phone)
            history  = await get_recent_messages(session_id, limit=6)
            summary  = await get_session_summary(str(user.get("id", "")))
            tier     = compute_risk_tier(user)
            drugs    = await extract_drugs_from_inventory(req.message)
            triage   = triage_severity(req.message)

            # Emit metadata first
            yield f"data: {json.dumps({'type':'meta','tier':tier,'triage':triage})}\n\n"

            # Emergency short-circuit
            if triage == "emergency":
                msg = ("## 🚨 Emergency Detected\n\n"
                       "Please call **112** (India) or your local emergency number immediately.\n\n"
                       "> This AI cannot handle medical emergencies.")
                yield f"data: {json.dumps({'type':'token','text':msg,'done':True})}\n\n"
                return

            hist_txt = "\n".join(
                f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:150]}"
                for h in history[-4:])
            rag  = await retrieve(req.message, C.NS_GENERAL, top_k=5)
            ctx  = "\n\n".join(r["text"] for r in rag[:2]) if rag else ""
            prompt = (
                "You are a warm, accurate medical information assistant.\n"
                "Use **Markdown** formatting for web display.\n"
                f"Patient: Age={user.get('age','?')} | Risk Tier={tier}\n"
                f"{'Memory: ' + summary[:200] if summary else ''}\n\n"
                f"Knowledge:\n{ctx}\n\nChat:\n{hist_txt}\n\nQuestion: {req.message}\n\nAnswer:")

            # Stream from Groq
            from langchain_groq import ChatGroq
            streaming_llm = ChatGroq(api_key=C.GROQ_API_KEY, model=C.LLM_MODEL,
                                     temperature=0.1, max_tokens=1200, streaming=True)
            full_reply = ""
            async for chunk in streaming_llm.astream([
                SystemMessage(content="You are a helpful medical information assistant."),
                HumanMessage(content=prompt)
            ]):
                token = chunk.content or ""
                if token:
                    full_reply += token
                    yield f"data: {json.dumps({'type':'token','text':token,'done':False})}\n\n"

            # Final event
            yield f"data: {json.dumps({'type':'token','text':'','done':True,'session_id':session_id})}\n\n"

            # Persist in background
            uid = str(user.get("id", ""))
            if uid:
                pool = await get_pool()
                for role, content, agent in [
                    ("user", req.message, None),
                    ("assistant", full_reply, "streaming_agent"),
                ]:
                    try:
                        await pool.execute(
                            """INSERT INTO conversation_messages
                               (session_id, user_id, role, content, agent_used)
                               VALUES($1,$2,$3,$4,$5)""",
                            session_id, uid, role, content[:3000], agent)
                    except: pass

        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type':'error','message':'Stream error'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Drug recall check endpoint (V6 NEW) ───────────────────────
@app.get("/recall-check/{drug_name}")
async def recall_check(drug_name: str, phone: str = Query(default="")):
    """
    Explicit drug recall check using FDA search.
    Returns recall status from trusted sources only.
    """
    uid = ""
    if phone:
        user = await get_user_by_phone(phone)
        uid  = str(user["id"]) if user else ""
    result = await controlled_web_search(f"{drug_name} FDA drug recall warning 2024 2025")
    if not result:
        return {"drug": drug_name, "recall_detected": False,
                "message": "No recall information found in trusted sources."}
    text = result["text"].lower()
    is_recalled = "recall" in text and "fda" in result.get("domain", "").lower()
    return {
        "drug":            drug_name,
        "recall_detected": is_recalled,
        "source":          result.get("domain"),
        "evidence":        result["text"][:300],
        "label":           "📚 External source (FDA)" if is_recalled else "✅ No recall found",
    }


# ── DFE question log endpoint (V6 NEW) ───────────────────────
@app.get("/user/{phone}/dfe-history")
async def dfe_history(phone: str, limit: int = 20):
    """Returns the clinical follow-up questions asked to this user."""
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    try:
        rows = await db_fetch(
            "SELECT * FROM dfe_question_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
            str(user["id"]), limit)
    except:
        rows = []
    return {"dfe_questions": rows}


# ── Acknowledgement (V4 ACK fix preserved) ───────────────────
@app.post("/ack")
async def ack_reminder(req: AckRequest):
    taken  = req.response.lower() in ("yes","y","taken","ok","done","haan","ha")
    status = "taken" if taken else "skipped"
    pool   = await get_pool()
    row    = await pool.fetchrow(
        "UPDATE reminder_logs SET ack_status=$2, ack_received_at=NOW() WHERE id=$1 RETURNING *",
        req.log_id, status)
    if not row:
        raise HTTPException(404, "Log not found")

    # V4 fix: Set Redis ACK key so escalation check works
    await r_set(f"ack:{req.log_id}", "done", ttl=7200)

    if row.get("call_job_id"):
        await dequeue_call(row["call_job_id"])
        await pool.execute("UPDATE reminder_logs SET call_completed=TRUE WHERE id=$1", req.log_id)

    if taken:
        await pool.execute(
            "UPDATE reminders SET qty_remaining=GREATEST(qty_remaining-1,0), updated_at=NOW() WHERE id=$1",
            row["reminder_id"])
    await update_adherence(str(row["patient_id"]), row["drug_name"], taken)

    return {"status": status, "log_id": req.log_id}


# ── BullMQ callbacks ──────────────────────────────────────────
@app.post("/reminder/send")
async def reminder_send(reminder_id: str, log_id: str, phone: str,
                         drug_name: str, dose: str, meal_instruction: str):
    msg = (f"⏰ *Medication Reminder*\n\n"
           f"💊 *{drug_name.title()}*  |  Dose: *{dose}*\n"
           f"🍽️ {meal_instruction.replace('_',' ')}\n\n"
           f"✅ Reply *taken*  |  ❌ Reply *skipped*\n"
           f"_(Ref: {log_id[:8]})_")
    await send_whatsapp(phone, msg)
    await db_execute("UPDATE reminder_logs SET sent_at=NOW() WHERE id=$1", log_id)
    return {"status": "sent"}

@app.post("/reminder/escalate")
async def escalate(log_id: str, phone: str, drug_name: str):
    # V4 fix: Check Redis ACK before escalating
    ack = await r_get(f"ack:{log_id}")
    if ack:
        return {"status": "already_acknowledged"}
    job_id = await enqueue_call(phone, drug_name, log_id)
    row = await db_fetchrow(
        "UPDATE reminder_logs SET ack_status='escalated', escalated=TRUE, escalated_at=NOW(), call_job_id=$2 WHERE id=$1 RETURNING patient_id",
        log_id, job_id)
    if row:
        await log_health_event(str(row["patient_id"]), "escalated",
                               f"Missed dose escalated: {drug_name}",
                               drug_name=drug_name)
    return {"status": "escalated", "call_job_id": job_id}

@app.post("/followup/send")
async def followup_send(followup_id: str, phone: str, symptom: str):
    msg = (f"👋 *Follow-up Check*\n\n"
           f"Yesterday you mentioned *{symptom}*.\n\n"
           f"How are you feeling now?\n"
           f"✅ *Better*  |  ⚠️ *Same*  |  ❌ *Worse*")
    await send_whatsapp(phone, msg)
    await db_execute("UPDATE symptom_followups SET followup_sent=TRUE WHERE id=$1", followup_id)
    return {"status": "sent"}

@app.post("/followup/response")
async def followup_response(phone: str, response: str):
    """User replies to 24h symptom followup: better / same / worse."""
    user = await get_user_by_phone(phone)
    if not user:
        raise HTTPException(404, "User not found")
    await update_episode_followup(str(user["id"]), response)
    return {"status": "recorded", "response": response}


# ── Cron endpoints ────────────────────────────────────────────
@app.post("/refill/check")
async def check_refills():
    rows = await db_fetch("SELECT * FROM refill_due_view")
    sent = 0
    for row in rows:
        ok = await send_whatsapp(row["phone"],
            f"🔄 *Refill Alert!*\n\n*{row['drug_name'].title()}* — only *{row['qty_remaining']}* left.\n"
            f"Reply *refill {row['drug_name']}* to reorder.")
        if ok: sent += 1
    return {"checked": len(rows), "sent": sent}

@app.post("/inventory/low-stock-alert")
async def low_stock_alert():
    rows = await db_fetch("SELECT * FROM low_stock_view")
    if rows and C.ADMIN_PHONE:
        items = "\n".join(
            f"• {r['drug_name'].title()} — {r['stock_qty']} left (min: {r['reorder_level']})"
            for r in rows)
        await send_whatsapp(C.ADMIN_PHONE, f"📦 *Low Stock Alert*\n\n{items}")
    return {"low_items": len(rows)}


# ── Vitals (V5: trend analysis on every record) ───────────────
@app.post("/vitals")
async def record_vitals(v: VitalInput, bg: BackgroundTasks):
    user = await get_user_by_phone(v.phone)
    if not user:
        raise HTTPException(404, "User not found")
    uid = str(user["id"])
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO vitals
           (user_id, bp_systolic, bp_diastolic, blood_sugar, spo2_pct,
            temp_celsius, heart_rate, weight_kg)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)""",
        uid, v.bp_systolic, v.bp_diastolic, v.blood_sugar,
        v.spo2_pct, v.temp_celsius, v.heart_rate, v.weight_kg)

    # Immediate threshold alerts
    alerts = []
    if v.spo2_pct    and v.spo2_pct    < C.VITAL_CRITICAL["spo2_pct"]:
        alerts.append(f"🚨 SpO₂ critically low: {v.spo2_pct}%")
    if v.bp_systolic and v.bp_systolic > C.VITAL_CRITICAL["bp_systolic"]:
        alerts.append(f"🚨 BP very high: {v.bp_systolic}/{v.bp_diastolic} mmHg")
    if v.blood_sugar and v.blood_sugar > C.VITAL_CRITICAL["blood_sugar"]:
        alerts.append(f"🚨 Blood sugar dangerously high: {v.blood_sugar} mg/dL")
    if v.temp_celsius and v.temp_celsius > C.VITAL_CRITICAL["temp_celsius"]:
        alerts.append(f"🌡️ High fever: {v.temp_celsius}°C")
    if v.heart_rate  and v.heart_rate  > C.VITAL_CRITICAL["heart_rate"]:
        alerts.append(f"💓 Heart rate very high: {v.heart_rate} bpm")

    if alerts:
        await send_whatsapp(v.phone,
            "⚠️ *Vital Alert*\n\n" + "\n".join(alerts) + "\n\nPlease seek medical attention.")
        await log_health_event(uid, "vital_alert", "Abnormal vitals detected",
                               "\n".join(alerts))

    # V5: Trigger trend analysis in background
    bg.add_task(run_vital_trend_bg, uid, v.phone)

    return {"status": "recorded", "alerts": alerts}

async def run_vital_trend_bg(user_id: str, phone: str):
    """Background: run trend engine and send proactive alerts if needed."""
    trends = await analyze_vital_trends(user_id)
    for t in trends:
        await send_whatsapp(phone, t["message"])
        pool = await get_pool()
        await pool.execute(
            "UPDATE vital_trends SET alert_sent=TRUE WHERE user_id=$1 AND vital_type=$2",
            user_id, t["vital"])


# ── User / timeline / report endpoints ───────────────────────
@app.get("/user/{phone}")
async def get_user_api(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    return user

@app.get("/user/{phone}/timeline")
async def health_timeline(phone: str, limit: int = 30):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    rows = await db_fetch(
        "SELECT * FROM health_events WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT $2",
        str(user["id"]), limit)
    return {"events": rows}

@app.get("/user/{phone}/adherence")
async def adherence_report(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    rows = await db_fetch(
        """SELECT drug_name, score, risk_flag, week_start, total_taken, total_skipped
           FROM adherence_scores WHERE user_id=$1 ORDER BY week_start DESC LIMIT 20""",
        str(user["id"]))
    return {"overall": user.get("overall_adherence", 100), "records": rows}

@app.get("/user/{phone}/episodes")
async def health_episodes(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    rows = await db_fetch(
        "SELECT * FROM health_episodes WHERE user_id=$1 ORDER BY started_at DESC LIMIT 20",
        str(user["id"]))
    return {"episodes": rows}

@app.get("/user/{phone}/risk")
async def risk_profile(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    tier = compute_risk_tier(user)
    abuse = await db_fetchrow("SELECT score, flags, blocked FROM abuse_scores WHERE user_id=$1", str(user["id"]))
    return {
        "risk_tier":        tier,
        "tier_constraints": get_tier_constraints(tier),
        "abuse_score":      abuse.get("score", 0) if abuse else 0,
        "abuse_flags":      abuse.get("flags", []) if abuse else [],
        "abuse_blocked":    abuse.get("blocked", False) if abuse else False,
    }

@app.get("/user/{phone}/clinical-report")
async def clinical_report(phone: str):
    """
    V5: Doctor-ready structured clinical summary.
    Returns patient data in a format suitable for presenting to a clinician.
    """
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    uid  = str(user["id"])

    active_meds = await db_fetch(
        "SELECT drug_name, dosage, frequency, meal_instruction, start_date, end_date FROM active_medications WHERE user_id=$1 AND is_active=TRUE",
        uid)
    recent_events = await db_fetch(
        "SELECT event_type, title, occurred_at FROM health_events WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 10",
        uid)
    recent_vitals = await db_fetch(
        "SELECT bp_systolic, bp_diastolic, blood_sugar, spo2_pct, temp_celsius, heart_rate, recorded_at FROM vitals WHERE user_id=$1 ORDER BY recorded_at DESC LIMIT 5",
        uid)
    episodes = await db_fetch(
        "SELECT episode_type, status, started_at, resolved_at, symptoms FROM health_episodes WHERE user_id=$1 ORDER BY started_at DESC LIMIT 5",
        uid)
    reactions = await db_fetch(
        "SELECT drug_name, reaction, severity, occurred_at FROM adverse_reactions WHERE user_id=$1",
        uid)

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "patient": {
            "name":                user.get("name"),
            "age":                 user.get("age"),
            "gender":              user.get("gender"),
            "blood_group":         user.get("blood_group"),
            "weight_kg":           user.get("weight_kg"),
            "is_pregnant":         user.get("is_pregnant"),
            "chronic_conditions":  user.get("chronic_conditions", []),
            "allergies":           user.get("allergies", []),
            "risk_tier":           user.get("risk_tier", 1),
            "overall_adherence":   user.get("overall_adherence"),
        },
        "active_medications":   active_meds,
        "adverse_reactions":    reactions,
        "health_episodes":      episodes,
        "recent_vitals":        recent_vitals,
        "recent_health_events": recent_events,
        "disclaimer": "This report was auto-generated by a clinical AI assistant. It is not a substitute for professional medical documentation.",
    }


# ── Inventory endpoints ───────────────────────────────────────
@app.get("/inventory/search")
async def inv_search(q: str = Query(..., min_length=2), limit: int = 5):
    return await get_inventory_fuzzy(q, limit)

@app.get("/inventory/low-stock")
async def low_stock():
    return await db_fetch("SELECT * FROM low_stock_view")

@app.get("/inventory/expiring")
async def expiring():
    return await db_fetch("SELECT * FROM expiring_soon_view")

# ── Admin endpoints ───────────────────────────────────────────
@app.get("/admin/abuse-risk")
async def abuse_risk_list():
    """Returns users flagged for review."""
    return await db_fetch(
        """SELECT u.phone, u.name, ab.score, ab.flags, ab.review_required, ab.blocked
           FROM abuse_scores ab JOIN users u ON ab.user_id=u.id
           WHERE ab.score >= $1 OR ab.review_required=TRUE
           ORDER BY ab.score DESC""",
        C.ABUSE_REVIEW_SCORE)

@app.get("/admin/vital-trend-alerts")
async def vital_trend_alerts():
    return await db_fetch("SELECT * FROM vital_trend_alerts_view")

@app.get("/admin/cde-log")
async def cde_log(limit: int = 50):
    return await db_fetch(
        "SELECT * FROM clinical_decision_log ORDER BY created_at DESC LIMIT $1", limit)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main_v5:app", host="0.0.0.0", port=8000, reload=True)
