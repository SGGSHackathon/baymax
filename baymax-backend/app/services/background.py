"""
Background tasks — fact extraction, adverse reactions, summarization, missed dose detection.
Extracted from main_v6.py §14.
"""

import re
import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import C
from app.singletons import get_llm, get_pool
from app.db.helpers import (
    db_fetch, db_execute,
    get_user_by_phone, update_user,
    log_audit, log_health_event,
)
from app.services.messaging import send_whatsapp

logger = logging.getLogger("medai.v6")


async def extract_and_apply_facts(user_id: str, phone: str, message: str, session_id: str):
    """Auto-extract allergies, conditions, pregnancy status and apply to user profile."""
    llm = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content=(
                "Extract medical facts from the user's message. Return ONLY valid JSON.\n"
                "- allergies: list of drug/substance allergies mentioned (empty if none)\n"
                "- conditions: list of medical conditions/diseases mentioned "
                "(e.g. BPPV, diabetes, hypertension, asthma, migraine, PCOD, thyroid, arthritis)\n"
                "- is_pregnant: true/false/null\n"
                "- weight_kg: number or null\n"
                "- confidence: 0.0-1.0 (how confident you are that the user is stating these as THEIR OWN facts)\n"
                "  Use 0.8+ if user says 'I have X' or 'I am allergic to Y'\n"
                "  Use 0.5-0.7 if user is asking about X (not necessarily their condition)\n"
                "  Use <0.5 if no personal medical facts are stated")),
            HumanMessage(content=(
                '{"allergies":[],"conditions":[],"is_pregnant":null,"weight_kg":null,"confidence":0.0}\n'
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
                '{"summary":"...","key_points":[],"allergies_detected":[],'
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
