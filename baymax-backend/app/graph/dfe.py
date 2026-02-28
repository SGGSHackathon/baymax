"""
Dynamic Follow-Up Engine (DFE) — V6 core clinical reasoning layer.
Extracted from main_v6.py §V6-C.
"""

import re
import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import C
from app.singletons import get_llm
from app.db.helpers import db_fetchrow, db_execute
from app.db.redis_helpers import r_get, r_set
from app.graph.state import MedState

logger = logging.getLogger("medai.v6")


def _extract_clinical_context(state: MedState) -> dict:
    """Gather all clinically relevant context from state for DFE decision-making."""
    user     = state.get("user", {})
    msg      = state.get("message", "").lower()
    history  = state.get("history", [])
    age      = user.get("age")
    caregiver= state.get("caregiver_ctx")
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
            if f"_{age_group}" in key:
                primary_symptom = key
                break
            elif "_adult" in key and age_group in ("adult", "unknown"):
                primary_symptom = key

    if not primary_symptom:
        for kw, map_key in [("fever","fever_adult"), ("dizziness","dizziness_adult"),
                             ("cough","cough"), ("chest","chest_pain"),
                             ("headache","headache"), ("breathless","breathing_difficulty"),
                             ("abdominal","abdominal_pain"), ("stomach","abdominal_pain")]:
            if kw in msg:
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

    # Previously asked questions in this session
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
    """Return list of field keys that are both required and not yet known / already asked."""
    symptom  = ctx["primary_symptom"]
    req      = C.FOLLOWUP_REQUIREMENTS.get(symptom, C.FOLLOWUP_REQUIREMENTS["generic"])
    required = req.get("required", [])
    known    = ctx["already_known"]
    asked    = ctx["asked_keys"]
    return [f for f in required if f not in known and f not in asked]


def _rank_missing(missing: list[str], ctx: dict) -> list[tuple[str, int]]:
    """Priority-score each missing field. Returns sorted list of (field_name, score) DESC."""
    scored = []
    for field in missing:
        category = C.DFE_FIELD_PRIORITY.get(field, "context_adding")
        base     = C.DFE_WEIGHTS.get(category, 1)
        if ctx["age_group"] == "child" and field in ("age", "weight_kg", "temperature_value"):
            base += 2
        if ctx["age_group"] == "elderly" and field in ("chest_pain_yn", "vision_change_yn", "weakness_yn"):
            base += 2
        behavior = ctx.get("behavior", {})
        ignores  = behavior.get("ignored_questions", 0)
        if ignores >= C.DFE_BEHAVIORAL_MAX_IGNORES:
            base = max(1, base - 2)
        scored.append((field, base))
    return sorted(scored, key=lambda x: x[1], reverse=True)


def _should_escalate_instead(ctx: dict, msg: str) -> bool:
    """Return True if DFE should escalate instead of asking a question."""
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
    """LLM-generates a single, warm, contextual question (never hardcoded)."""
    age_group  = ctx["age_group"]
    symptom    = ctx["primary_symptom"]
    caregiver  = ctx.get("caregiver")
    behavior   = ctx.get("behavior") or {}
    short_user = behavior.get("short_replies", False)
    anxiety    = behavior.get("anxiety_loop", False)

    style_note = ""
    if channel == "web":
        style_note = "Format as a friendly web chat message. Can be 2 sentences."
    elif channel == "sms":
        style_note = "Format for SMS. Plain text only, no emoji, no bold markers. Keep under 160 chars if possible. Max 2 short sentences."
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
        raw = raw.strip('"\'')
        return raw
    except Exception as e:
        logger.error(f"DFE question gen: {e}")
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
    """Load behavioral signals from Redis for this session."""
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
        if len(msg) < 8:
            profile["short_replies"] = True
            profile["ignored_questions"] = profile.get("ignored_questions", 0) + 1
        else:
            profile["ignored_questions"] = 0
    anxiety_words = ["scared", "worried", "afraid", "is it serious", "am i ok",
                     "dangerous", "will i be fine", "so worried"]
    if any(w in msg.lower() for w in anxiety_words):
        profile["anxiety_loop"] = True
    profile["q_count"] = profile.get("q_count", 0) + 1
    await r_set(f"behavior:{session_id}", profile, ttl=3600)


async def dynamic_followup_engine(state: MedState) -> MedState:
    """
    V6 Core Node: Runs AFTER intent_router, BEFORE target agent.
    Decides whether to ask a clinical follow-up question or escalate.
    """
    # ── Guard rails
    if state.get("reply"):
        return {**state, "dfe_triggered": False}
    if state.get("intent") in ("order", "reminder", "refill", "family", "order_history", "drug_info"):
        return {**state, "dfe_triggered": False}
    if state.get("emergency"):
        return {**state, "dfe_triggered": False}

    msg      = state.get("message", "").lower()
    channel  = state.get("channel", "whatsapp")

    # ── Skip DFE for profile queries (not symptom reports) ──
    # "what allergy I have" / "add paracetamol to allergy" / "my allergies" = profile management
    profile_signals = [
        "my allerg", "what allerg", "which allerg", "add to allerg",
        "add allerg", "remove allerg", "list allerg", "show allerg",
        "my profile", "my medicine", "my meds", "what medicine i",
        "update my", "change my", "edit my", "my details",
        "what all", "show my", "tell me my",
    ]
    if any(p in msg for p in profile_signals):
        return {**state, "dfe_triggered": False}

    has_symptom = any(kw in msg for kw in C.SYMPTOM_KW)
    if not has_symptom:
        return {**state, "dfe_triggered": False}

    # ── Extract clinical context
    ctx = _extract_clinical_context(state)

    behavior = await _load_behavioral_profile(
        str(state.get("user", {}).get("id", "")), state["session_id"])
    ctx["behavior"] = behavior

    # ── Episode-aware mode
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

    # ── Should we escalate instead of asking?
    if _should_escalate_instead(ctx, state.get("message", "")):
        if channel == "sms":
            escalation_msg = (
                "URGENT: This sounds like it may need immediate attention.\n\n"
                "Please call emergency services now:\n"
                "India: 112 | Ambulance: 108\n\n"
                "Do not wait - please seek help immediately.")
        elif channel == "web":
            escalation_msg = (
                "## 🚨 Immediate Attention Required\n\n"
                "Based on your symptoms, please **call emergency services immediately**:\n\n"
                "- 🏥 **India Emergency:** 112\n"
                "- 🚑 **Ambulance:** 108\n\n"
                "> Do not wait. Please seek help now.")
        else:
            escalation_msg = (
                "🚨 *This sounds like it may need immediate attention.*\n\n"
                "Please call emergency services now:\n"
                "🏥 India: *112*  |  Ambulance: *108*\n\n"
                "Do not wait — please seek help immediately.")
        return {**state, "reply": escalation_msg,
                "agent_used": "dynamic_followup_engine",
                "emergency": True,
                "dfe_triggered": True,
                "safety_flags": state.get("safety_flags", []) + ["DFE_ESCALATED"]}

    # ── Detect and rank missing variables
    missing = _detect_missing_variables(ctx)
    if not missing:
        return {**state, "dfe_triggered": False, "dfe_context": ctx}

    ranked = _rank_missing(missing, ctx)
    if not ranked:
        return {**state, "dfe_triggered": False, "dfe_context": ctx}

    # ── Tier constraint: Tier 5 → max 1 high-priority Q only
    tier = ctx["tier"]
    top_field, top_score = ranked[0]
    if tier == 5 and top_score < 3:
        return {**state, "dfe_triggered": False, "dfe_context": ctx}

    # ── Generate the question via LLM
    question = await _generate_dfe_question(top_field, ctx, channel)

    # ── Log DFE event
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

    # ── Update behavioral profile
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
