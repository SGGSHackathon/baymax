"""
Configuration constants for Medical AI V6.
Extracted from main_v6.py §1.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class C:
    GROQ_API_KEY   = os.getenv("GROQ_API_KEY", "")
    PINECONE_KEY   = os.getenv("PINECONE_API_KEY", "")
    DATABASE_URL   = os.getenv("DATABASE_URL", "")
    REDIS_URL      = os.getenv("REDIS_URL", "redis://localhost:6379")
    WHATSAPP_URL   = os.getenv("WHATSAPP_SERVER_URL", "http://localhost:5001")
    ADMIN_PHONE    = os.getenv("ADMIN_PHONE", "")
    ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")
    WEBSITE_BASE_URL = os.getenv("WEBSITE_BASE_URL", "http://localhost:3000")

    # ── JWT Auth ──────────────────────────────────────────────
    JWT_SECRET       = os.getenv("JWT_SECRET", "change-me-in-production")
    JWT_ALGORITHM    = "HS256"
    JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

    # ── Sarvam.ai Multilingual ──────────────────────────────────
    SARVAM_API_KEY  = os.getenv("SARVAM_API_KEY", "")
    SARVAM_BASE_URL = "https://api.sarvam.ai"

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
    AUTO_APPLY_CONF     = 0.70
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
    NS_USER_MEMORY = "user_memory"      # Pinecone namespace for per-user conversation summaries

    # ── V6: DFE (Dynamic Follow-Up Engine) ──────────────────────
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
