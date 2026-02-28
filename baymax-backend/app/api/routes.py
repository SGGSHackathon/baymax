"""
FastAPI route handlers.
Extracted from main_v6.py §20.
"""

import json
import hashlib
import logging
import base64
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, SystemMessage

from app.config import C
from app.singletons import get_pinecone, get_pool
from app.models import WhatsAppIncoming, ChatResponse, AckRequest, VitalInput
from app.db.helpers import (
    get_user_by_phone, create_user, get_recent_messages, get_session_summary,
    db_fetch, db_fetchrow, db_execute, update_adherence, update_user,
    check_stock,
)
from app.db.redis_helpers import r_set, r_get
from app.core.retrieval import retrieve
from app.core.safety import triage_severity, extract_drugs_from_inventory, detect_adverse_reaction
from app.core.risk_tier import compute_risk_tier, get_tier_constraints
from app.core.vitals import analyze_vital_trends
from app.core.episodes import get_or_create_episode, update_episode_followup
from app.services.messaging import (
    send_whatsapp, schedule_symptom_followup,
)
from app.services.background import (
    extract_and_apply_facts, handle_adverse_reaction_bg,
    summarize_session_bg, check_missed_dose_pattern,
)
from app.services.web_search import controlled_web_search, check_drug_recall
from app.services.channel import format_for_channel
from app.services.sarvam import (
    detect_language, translate_to_english, translate_from_english,
    text_to_speech, speech_to_text, speech_to_text_translate,
)
from app.graph.state import MedState
from app.graph.builder import build_graph

logger = logging.getLogger("medai.v6")

router = APIRouter()

# Compile graph once at module-level
graph = build_graph()
logger.info("✅ Medical AI V6 LangGraph compiled")


# ── Helpers ────────────────────────────────────────────────────
def _make_initial_state(phone: str, message: str, session_id: str, channel: str,
                        original_message: str = "") -> MedState:
    return {
        "phone": phone, "message": message,
        "original_message": original_message or message,
        "session_id": session_id, "channel": channel,
        "user": {}, "is_new_user": False, "history": [],
        "session_summary": None, "intent": "", "intent_conf": 0.0,
        "drugs_found": [], "emergency": False, "triage_level": "none",
        "blocked_drug": None, "caregiver_ctx": None, "patient_id": None,
        "risk_tier": 1, "cde_result": None, "active_episode_id": None,
        "rag_context": [], "selected_inv": None, "order_record": None,
        "reply": "", "agent_used": "", "safety_flags": [], "requires_action": None,
        "active_flow": None, "conv_memory": None,
        "dfe_triggered": False, "dfe_question": None, "dfe_context": None,
        "web_search_used": False, "web_search_source": None, "behavioral_profile": None,
    }


async def _run_graph_and_bg(phone: str, message: str, session_id: str,
                             channel: str, bg: BackgroundTasks) -> MedState:
    # ── Step 0: Check if user is registered (onboarded) ────────
    # Unregistered users get NO database writes — just a redirect message
    user_row_pre = await get_user_by_phone(phone)
    if not user_row_pre or not user_row_pre.get("onboarded"):
        register_url = C.WEBSITE_BASE_URL
        reply = ("Hello! 👋 I'm *BAYMAX*, your Medical AI Assistant!\n\n"
                 "It looks like you haven't registered yet. 🌟\n\n"
                 "Please register on our website first:\n"
                 f"🔗 {register_url}\n\n"
                 "Once you've registered, come back and say *Hi* — I'll be ready to help you! 😊")
        return {
            **_make_initial_state(phone, message, session_id, channel, original_message=message),
            "reply": reply,
            "reply_english": reply,
            "agent_used": "onboarding_agent",
        }

    # ── Step 1: Detect language & translate to English ─────────
    original_message = message
    user_preferred_lang = "en-IN"

    # Check user's stored preferred language and STRICTLY enforce English or Hindi
    if user_row_pre and user_row_pre.get("preferred_language"):
        db_lang = user_row_pre["preferred_language"].lower()
        if "hi" in db_lang:
            user_preferred_lang = "hi-IN"
        else:
            user_preferred_lang = "en-IN"

    # Detect and translate incoming message
    try:
        english_message, detected_lang = await translate_to_english(message)
        if detected_lang and detected_lang != "en-IN":
            message = english_message
            # We explicitly prevent overriding the user's DB language preference here
            # to strictly honor their registration choice.
    except Exception as e:
        logger.warning(f"Translation in failed: {e}, using original message")

    # ── Step 2: Run graph with English message ─────────────────
    initial = _make_initial_state(phone, message, session_id, channel,
                                  original_message=original_message)
    try:
        result = await graph.ainvoke(initial)
    except Exception as e:
        logger.error(f"Graph error: {e}", exc_info=True)
        raise HTTPException(500, "Internal error. Please try again.")

    result["reply"] = format_for_channel(result.get("reply", ""), channel)

    # Save the English reply before translation
    result["reply_english"] = result["reply"]

    # ── Step 3: Strict Language Output ───────────────────────────
    # The user mandated: "generate the response only and only in language the user has set as prefered_language."
    if user_preferred_lang and user_preferred_lang != "en-IN":
        try:
            translated_reply = await translate_from_english(
                result["reply"], user_preferred_lang
            )
            result["reply"] = translated_reply
            result["reply_english"] = result["reply_english"]  # keep for API purposes
        except Exception as e:
            logger.warning(f"Translation out failed: {e}, using English reply")

    # Schedule deferred post-processing (profile extraction, DB writes, summary+embed)
    # These run AFTER the HTTP response is sent
    deferred = result.get("_deferred")
    if deferred:
        from app.graph.nodes import run_deferred_post_tasks
        bg.add_task(run_deferred_post_tasks, deferred)

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
            if cnt and cnt % 5 == 0:
                bg.add_task(summarize_session_bg, session_id, uid)
        except: pass

        if result.get("drugs_found"):
            bg.add_task(check_missed_dose_pattern, uid, result["drugs_found"][0])

            async def recall_bg():
                for drug in result.get("drugs_found", [])[:1]:
                    await check_drug_recall(drug, phone, uid)
            bg.add_task(recall_bg)

    return result


# ── Health ─────────────────────────────────────────────────────
@router.get("/health")
async def health():
    stats = get_pinecone().describe_index_stats()
    return {"status": "healthy", "version": "6.0",
            "vectors": stats.get("total_vector_count", 0)}


# ── WhatsApp Endpoint ─────────────────────────────────────────
@router.post("/whatsapp", response_model=ChatResponse)
async def whatsapp(req: WhatsAppIncoming, bg: BackgroundTasks):
    phone      = req.phone
    session_id = req.session_id or f"wa_{hashlib.md5(phone.encode()).hexdigest()[:12]}"
    result     = await _run_graph_and_bg(phone, req.message, session_id, "whatsapp", bg)
    return ChatResponse(
        reply            = result["reply"],
        reply_english    = result.get("reply_english"),
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
        web_search_source = result.get("web_search_source"),
    )


# ── SMS Endpoint (Twilio offline-sms-bot) ─────────────────────
@router.post("/sms", response_model=ChatResponse)
async def sms_chat(req: WhatsAppIncoming, bg: BackgroundTasks):
    phone      = req.phone
    session_id = req.session_id or f"sms_{hashlib.md5(phone.encode()).hexdigest()[:12]}"
    result     = await _run_graph_and_bg(phone, req.message, session_id, "sms", bg)
    return ChatResponse(
        reply            = result["reply"],
        reply_english    = result.get("reply_english"),
        session_id       = session_id,
        agent_used       = result["agent_used"],
        emergency        = result.get("emergency", False),
        safety_flags     = result.get("safety_flags", []),
        triage_level     = result.get("triage_level"),
        requires_action  = result.get("requires_action"),
        risk_tier        = result.get("risk_tier", 1),
        channel          = "sms",
        dfe_triggered    = result.get("dfe_triggered", False),
        web_search_used  = result.get("web_search_used", False),
        web_search_source = result.get("web_search_source"),
    )


# ── Web Chat Endpoint ─────────────────────────────────────────
@router.post("/chat", response_model=ChatResponse)
async def web_chat(req: WhatsAppIncoming, bg: BackgroundTasks):
    phone      = req.phone
    session_id = req.session_id or f"web_{hashlib.md5((phone + req.message[:10]).encode()).hexdigest()[:12]}"
    result     = await _run_graph_and_bg(phone, req.message, session_id, "web", bg)
    return ChatResponse(
        reply            = result["reply"],
        reply_english    = result.get("reply_english"),
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
        web_search_source = result.get("web_search_source"),
    )


# ── Voice Input (STT → Graph → TTS) ──────────────────────────
@router.post("/voice")
async def voice_chat(
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    phone: str = Form(...),
    session_id: str = Form(None),
    channel: str = Form("whatsapp"),
):
    """
    Accept audio file → STT → run graph → translate reply → TTS.
    Returns JSON with text reply + base64 audio.
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file")

    # 1. Speech-to-text (auto-detect language, translate to English)
    transcript, lang_code = await speech_to_text_translate(audio_bytes, file.filename or "audio.wav")
    if not transcript:
        # Fallback: try basic transcription
        transcript, lang_code = await speech_to_text(audio_bytes, file.filename or "audio.wav")
    if not transcript:
        raise HTTPException(422, "Could not transcribe audio")

    # Determine user's strict registered language (English or Hindi)
    user_row = await get_user_by_phone(phone)
    user_lang = "en-IN"
    if user_row and user_row.get("preferred_language"):
        db_lang = user_row["preferred_language"].lower()
        if "hi" in db_lang:
            user_lang = "hi-IN"

    # 2. Run graph with English transcript
    sid = session_id or f"voice_{hashlib.md5(phone.encode()).hexdigest()[:12]}"
    result = await _run_graph_and_bg(phone, transcript, sid, channel, bg)

    # 3. Translate reply to user's registered language & generate TTS
    reply_text = result["reply"]
    reply_translated = reply_text
    
    if user_lang == "hi-IN":
        try:
            reply_translated = await translate_from_english(reply_text, user_lang)
        except Exception:
            reply_translated = reply_text

    audio_b64 = await text_to_speech(reply_translated, user_lang)

    return {
        "transcript": transcript,
        "detected_language": user_lang,
        "reply": reply_translated,
        "reply_english": reply_text,
        "audio_base64": audio_b64,
        "session_id": sid,
        "agent_used": result.get("agent_used", ""),
        "emergency": result.get("emergency", False),
    }


# ── Text-to-Speech Only ──────────────────────────────────────
@router.post("/tts")
async def tts_endpoint(
    text: str = Form(...),
    language: str = Form("hi-IN"),
    speaker: str = Form("anushka"),
):
    """Convert text to speech. Returns base64 audio."""
    audio_b64 = await text_to_speech(text, language, speaker)
    if not audio_b64:
        raise HTTPException(500, "TTS generation failed")
    return {"audio_base64": audio_b64, "language": language}


# ── Speech-to-Text Only ──────────────────────────────────────
@router.post("/stt")
async def stt_endpoint(file: UploadFile = File(...)):
    """Transcribe audio. Returns transcript + detected language."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file")
    transcript, lang = await speech_to_text(audio_bytes, file.filename or "audio.wav")
    if not transcript:
        raise HTTPException(422, "Could not transcribe audio")
    return {"transcript": transcript, "language_code": lang}


# ── Language Detection Only ───────────────────────────────────
@router.post("/detect-language")
async def detect_lang_endpoint(text: str = Form(...)):
    """Detect language of input text."""
    lang = await detect_language(text)
    return {"language_code": lang or "unknown"}


# ── Translate Only ────────────────────────────────────────────
@router.post("/translate")
async def translate_endpoint(
    text: str = Form(...),
    source_lang: str = Form("auto"),
    target_lang: str = Form("en-IN"),
):
    """Translate text between supported languages."""
    if source_lang == "auto" and target_lang == "en-IN":
        translated, detected = await translate_to_english(text)
        return {"translated_text": translated, "source_language": detected, "target_language": "en-IN"}
    elif source_lang == "en-IN":
        translated = await translate_from_english(text, target_lang)
        return {"translated_text": translated, "source_language": "en-IN", "target_language": target_lang}
    else:
        # Generic: translate to English first, then to target
        english, detected = await translate_to_english(text, source_lang)
        final = await translate_from_english(english, target_lang) if target_lang != "en-IN" else english
        return {"translated_text": final, "source_language": detected, "target_language": target_lang}


# ── Streaming Endpoint ────────────────────────────────────────
@router.post("/stream")
async def stream_chat(req: WhatsAppIncoming, bg: BackgroundTasks):
    phone      = req.phone
    session_id = req.session_id or f"web_{hashlib.md5(phone.encode()).hexdigest()[:12]}"

    async def event_generator():
        try:
            user     = await get_user_by_phone(phone) or await create_user(phone)
            history  = await get_recent_messages(session_id, limit=6)
            summary  = await get_session_summary(str(user.get("id", "")))
            tier     = compute_risk_tier(user)
            drugs    = await extract_drugs_from_inventory(req.message)
            triage   = triage_severity(req.message)

            yield f"data: {json.dumps({'type':'meta','tier':tier,'triage':triage})}\n\n"

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

            yield f"data: {json.dumps({'type':'token','text':'','done':True,'session_id':session_id})}\n\n"

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


# ── Drug Recall Check ─────────────────────────────────────────
@router.get("/recall-check/{drug_name}")
async def recall_check(drug_name: str, phone: str = Query(default="")):
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


# ── DFE History ───────────────────────────────────────────────
@router.get("/user/{phone}/dfe-history")
async def dfe_history(phone: str, limit: int = 20):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    try:
        rows = await db_fetch(
            "SELECT * FROM dfe_question_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
            str(user["id"]), limit)
    except:
        rows = []
    return {"dfe_questions": rows}


# ── ACK ───────────────────────────────────────────────────────
@router.post("/ack")
async def ack_reminder(req: AckRequest):
    """Handle taken/skipped ACK from WhatsApp via the whatsapp-web.js server."""
    taken  = req.response.lower() in ("yes", "y", "taken", "ok", "done", "haan", "ha",
                                       "le liya", "liya", "kha liya", "li")
    status = "taken" if taken else "skipped"
    pool   = await get_pool()

    # Fetch the log
    log = await pool.fetchrow("SELECT * FROM reminder_logs WHERE id=$1", req.log_id)
    if not log:
        raise HTTPException(404, "Log not found")

    # Calculate late ACK (>1 hour after scheduled time)
    from datetime import datetime as dt_cls, timezone
    late_ack = False
    if log.get("scheduled_at"):
        elapsed = (dt_cls.now(timezone.utc) - log["scheduled_at"]).total_seconds()
        late_ack = elapsed > 3600

    # Update the log
    row = await pool.fetchrow(
        """UPDATE reminder_logs
           SET ack_status=$2, ack_received_at=NOW(), late_ack=$3
           WHERE id=$1
           RETURNING *""",
        req.log_id, status, late_ack)

    # Mark ACK in Redis (for any async checks)
    await r_set(f"ack:{req.log_id}", "done", ttl=7200)

    # Decrement qty_remaining if taken
    if taken and row:
        updated_rem = await pool.fetchrow(
            """UPDATE reminders SET qty_remaining=GREATEST(qty_remaining-1,0), updated_at=NOW()
               WHERE id=$1 RETURNING qty_remaining, drug_name, patient_id""",
            row["reminder_id"])

        # Check if quantity is running low (<=1) → send reorder message via WhatsApp
        if updated_rem and updated_rem["qty_remaining"] is not None and updated_rem["qty_remaining"] <= 1:
            drug_name = updated_rem["drug_name"]
            patient_id = str(updated_rem["patient_id"])
            # Get user phone
            user_row = await pool.fetchrow("SELECT phone FROM users WHERE id=$1", patient_id)
            if user_row:
                user_phone = user_row["phone"]
                reorder_msg = (
                    f"⚠️ *Low Stock Alert!*\n\n"
                    f"Your *{drug_name.title()}* is about to run out "
                    f"(only *{updated_rem['qty_remaining']}* dose{'s' if updated_rem['qty_remaining'] != 1 else ''} remaining).\n\n"
                    f"Would you like to reorder? Reply with the quantity, e.g.:\n"
                    f"*reorder {drug_name} 10*\n\n"
                    f"Or reply *no* to dismiss.")
                try:
                    await send_whatsapp(user_phone, reorder_msg)
                    # Set a pending reorder flag so the system knows this is a reorder
                    await r_set(f"pending_reorder:{user_phone}",
                                {"drug": drug_name, "reminder_id": str(row["reminder_id"]),
                                 "patient_id": patient_id}, ttl=3600)
                    # Also set pending_action so order_agent handles the reply quantity
                    inv = await check_stock(drug_name)
                    if inv:
                        await r_set(f"pending_action:{user_phone}",
                                    {"stage": "awaiting_quantity", "drug": drug_name,
                                     "inventory": inv}, ttl=3600)
                    logger.info(f"Reorder prompt sent for {drug_name} to {user_phone}")
                except Exception as e:
                    logger.error(f"Failed to send reorder message: {e}")

    # Update adherence score
    if row:
        await update_adherence(str(row["patient_id"]), row["drug_name"], taken)

    return {
        "status": status,
        "log_id": req.log_id,
        "late_ack": late_ack,
    }


# ── Reminder Logger Endpoints ─────────────────────────────────
@router.post("/reminder/log-sent")
async def reminder_log_sent(reminder_id: str, log_id: str, phone: str,
                            drug_name: str, dose: str, meal_instruction: str,
                            idempotency_key: str = None):
    pool = await get_pool()

    # Idempotency check: if this key already exists, skip
    if idempotency_key:
        existing = await pool.fetchrow(
            "SELECT id FROM reminder_logs WHERE idempotency_key=$1", idempotency_key)
        if existing:
            logger.info(f"Idempotent skip: {idempotency_key}")
            return {"status": "already_logged", "log_id": str(existing["id"])}

    # Get reminder to find user_id and patient_id
    reminder = await pool.fetchrow("SELECT user_id, patient_id FROM reminders WHERE id=$1", reminder_id)
    if not reminder:
        return {"status": "reminder_not_found"}

    # Insert reminder_logs row with idempotency
    try:
        await pool.execute(
            """INSERT INTO reminder_logs
               (id, reminder_id, user_id, patient_id, drug_name, dose,
                scheduled_at, sent_at, idempotency_key)
               VALUES($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7)
               ON CONFLICT (idempotency_key) DO NOTHING""",
            log_id, reminder_id,
            str(reminder["user_id"]), str(reminder["patient_id"]),
            drug_name, dose, idempotency_key)
    except Exception as e:
        logger.error(f"Reminder log insert: {e}")

    # Note: WhatsApp sending is now handled directly by the Node.js sidecar!
    # This endpoint is strictly for database logging and single-source-of-truth.
    return {"status": "logged", "log_id": log_id}

@router.post("/followup/send")
async def followup_send(followup_id: str, phone: str, symptom: str):
    msg = (f"👋 *Follow-up Check*\n\n"
           f"Yesterday you mentioned *{symptom}*.\n\n"
           f"How are you feeling now?\n"
           f"✅ *Better*  |  ⚠️ *Same*  |  ❌ *Worse*")
    await send_whatsapp(phone, msg)
    await db_execute("UPDATE symptom_followups SET followup_sent=TRUE WHERE id=$1", followup_id)
    return {"status": "sent"}

@router.post("/followup/response")
async def followup_response(phone: str, response: str):
    user = await get_user_by_phone(phone)
    if not user:
        raise HTTPException(404, "User not found")
    await update_episode_followup(str(user["id"]), response)
    return {"status": "recorded", "response": response}


# ── Cron Endpoints ────────────────────────────────────────────
@router.post("/refill/check")
async def check_refills():
    rows = await db_fetch("SELECT * FROM refill_due_view")
    sent = 0
    for row in rows:
        ok = await send_whatsapp(row["phone"],
            f"🔄 *Refill Alert!*\n\n*{row['drug_name'].title()}* — only *{row['qty_remaining']}* left.\n"
            f"Reply *refill {row['drug_name']}* to reorder.")
        if ok: sent += 1
    return {"checked": len(rows), "sent": sent}

@router.post("/inventory/low-stock-alert")
async def low_stock_alert():
    rows = await db_fetch("SELECT * FROM low_stock_view")
    if rows and C.ADMIN_PHONE:
        items = "\n".join(
            f"• {r['drug_name'].title()} — {r['stock_qty']} left (min: {r['reorder_level']})"
            for r in rows)
        await send_whatsapp(C.ADMIN_PHONE, f"📦 *Low Stock Alert*\n\n{items}")
    return {"low_items": len(rows)}


# ── Vitals ─────────────────────────────────────────────────────
@router.post("/vitals")
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
        from app.db.helpers import log_health_event
        await log_health_event(uid, "vital_alert", "Abnormal vitals detected",
                               "\n".join(alerts))

    async def run_vital_trend_bg(user_id: str, phone: str):
        trends = await analyze_vital_trends(user_id)
        for t in trends:
            await send_whatsapp(phone, t["message"])
            p = await get_pool()
            await p.execute(
                "UPDATE vital_trends SET alert_sent=TRUE WHERE user_id=$1 AND vital_type=$2",
                user_id, t["vital"])

    bg.add_task(run_vital_trend_bg, uid, v.phone)
    return {"status": "recorded", "alerts": alerts}


# ── User / Timeline / Report Endpoints ─────────────────────────
@router.get("/user/{phone}")
async def get_user_api(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    return user

@router.get("/user/{phone}/timeline")
async def health_timeline(phone: str, limit: int = 30):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    rows = await db_fetch(
        "SELECT * FROM health_events WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT $2",
        str(user["id"]), limit)
    return {"events": rows}

@router.get("/user/{phone}/adherence")
async def adherence_report(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    rows = await db_fetch(
        """SELECT drug_name, score, risk_flag, week_start, total_taken, total_skipped
           FROM adherence_scores WHERE user_id=$1 ORDER BY week_start DESC LIMIT 20""",
        str(user["id"]))
    return {"overall": user.get("overall_adherence", 100), "records": rows}

@router.get("/user/{phone}/episodes")
async def health_episodes(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "Not found")
    rows = await db_fetch(
        "SELECT * FROM health_episodes WHERE user_id=$1 ORDER BY started_at DESC LIMIT 20",
        str(user["id"]))
    return {"episodes": rows}

@router.get("/user/{phone}/risk")
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

@router.get("/user/{phone}/clinical-report")
async def clinical_report(phone: str):
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
        "SELECT drug_name, reaction, severity, reported_at as occurred_at FROM adverse_reactions WHERE user_id=$1",
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


@router.get("/user/{phone}/full-history")
async def full_profile_history(phone: str):
    user = await get_user_by_phone(phone)
    if not user: raise HTTPException(404, "User not found")
    uid = str(user["id"])

    # 1. Active Meds
    active_meds = await db_fetch(
        "SELECT * FROM active_medications WHERE user_id=$1 AND is_active=TRUE ORDER BY start_date DESC",
        uid)

    # 2. Orders (recent 20)
    orders = await db_fetch(
        "SELECT * FROM orders WHERE user_id=$1 ORDER BY ordered_at DESC LIMIT 20",
        uid)

    # 3. Health Timeline
    events = await db_fetch(
        "SELECT * FROM health_events WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 30",
        uid)

    # 4. Adherence Scores
    adherence = await db_fetch(
        "SELECT * FROM adherence_scores WHERE user_id=$1 ORDER BY week_start DESC LIMIT 20",
        uid)

    # 5. Adverse Reactions
    reactions = await db_fetch(
        "SELECT * FROM adverse_reactions WHERE user_id=$1 ORDER BY reported_at DESC",
        uid)
    
    # Calculate approximate BMI if weight and height are present
    bmi = None
    if user.get("weight_kg") and user.get("height_cm"):
        height_m = float(user["height_cm"]) / 100.0
        if height_m > 0:
            bmi = round(float(user["weight_kg"]) / (height_m * height_m), 1)

    # Enhance user dict with calculated BMI
    user_dict = dict(user)
    user_dict["bmi"] = bmi

    return {
        "user": user_dict,
        "active_medications": active_meds,
        "orders": orders,
        "health_timeline": events,
        "adherence_scores": adherence,
        "adverse_reactions": reactions,
        "generated_at": datetime.utcnow().isoformat()
    }


# ── Inventory Endpoints ───────────────────────────────────────
@router.get("/inventory/search")
async def inv_search(q: str = Query(..., min_length=2), limit: int = 5):
    from app.db.helpers import get_inventory_fuzzy
    return await get_inventory_fuzzy(q, limit)

@router.get("/inventory/low-stock")
async def low_stock():
    return await db_fetch("SELECT * FROM low_stock_view")

@router.get("/inventory/expiring")
async def expiring():
    return await db_fetch("SELECT * FROM expiring_soon_view")


# ── Admin Endpoints ───────────────────────────────────────────
@router.get("/admin/abuse-risk")
async def abuse_risk_list():
    return await db_fetch(
        """SELECT u.phone, u.name, ab.score, ab.flags, ab.review_required, ab.blocked
           FROM abuse_scores ab JOIN users u ON ab.user_id=u.id
           WHERE ab.score >= $1 OR ab.review_required=TRUE
           ORDER BY ab.score DESC""",
        C.ABUSE_REVIEW_SCORE)

@router.get("/admin/vital-trend-alerts")
async def vital_trend_alerts():
    return await db_fetch("SELECT * FROM vital_trend_alerts_view")

@router.get("/admin/cde-log")
async def cde_log(limit: int = 50):
    return await db_fetch(
        "SELECT * FROM clinical_decision_log ORDER BY created_at DESC LIMIT $1", limit)
