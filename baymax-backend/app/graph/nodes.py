"""
Structural LangGraph nodes — load_context, pre_safety, clinical_decision, intent_router, post_process.
Now with: pending-action bypass, Redis working memory, deterministic flow routing.
"""

import re
import json
import logging
from datetime import date

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import C
from app.singletons import get_llm, get_pool
from app.db.helpers import (
    get_user_by_phone, create_user, get_recent_messages, get_session_summary,
)
from app.db.redis_helpers import r_get, r_get_json, r_set, r_del
from app.core.safety import (
    triage_severity, is_blocked_drug, detect_caregiver_ctx,
    extract_drugs_from_inventory,
)
from app.core.risk_tier import compute_risk_tier, get_tier_constraints
from app.core.cde import run_cde
from app.core.retrieval import retrieve, _embed
from app.graph.state import MedState

logger = logging.getLogger("medai.v6")


# ── Node 1: Load Context ──────────────────────────────────────
async def load_context(state: MedState) -> MedState:
    phone   = state["phone"]
    user    = await get_user_by_phone(phone)

    # If user doesn't exist in DB (not registered), return early — no DB writes
    if not user or not user.get("onboarded"):
        return {**state,
                "user": user or {}, "is_new_user": True, "history": [],
                "session_summary": None, "risk_tier": 1,
                "cde_result": None, "active_episode_id": None,
                "active_flow": None, "conv_memory": None}

    is_new  = False
    history = await get_recent_messages(state["session_id"], limit=6)
    tier    = compute_risk_tier(user)

    pool = await get_pool()
    try:
        await pool.execute(
            """INSERT INTO conversations(session_id, user_id, channel) VALUES($1,$2,$3)
               ON CONFLICT(session_id) DO UPDATE SET
                   last_active=NOW(),
                   message_count=conversations.message_count+1""",
            state["session_id"], str(user["id"]), state["channel"])
    except Exception as e:
        logger.warning(f"Conversations insert error: {e}")

    await pool.execute("UPDATE users SET risk_tier=$2 WHERE id=$1", str(user["id"]), tier)

    # ── Load session summary (Postgres + Pinecone semantic memory) ──
    summary = None
    if not is_new:
        # 1. Latest summary from DB
        summary = await get_session_summary(str(user["id"]))

        # 2. Semantic memory from Pinecone: search user's past context
        #    Only fetch if user has enough history (avoid phantom memories for new-ish users)
        msg_count_row = await pool.fetchrow(
            "SELECT message_count FROM conversations WHERE session_id=$1", state["session_id"])
        has_history = msg_count_row and msg_count_row["message_count"] and msg_count_row["message_count"] > 4
        if has_history:
            try:
                mem_results = await retrieve(state["message"], C.NS_USER_MEMORY, top_k=3)
                # Filter to this user's memories only — strict phone/user_id match
                user_memories = [r for r in mem_results
                                if r.get("phone") == phone or r.get("user_id") == str(user["id"])]
                if user_memories:
                    mem_texts = [m["text"][:200] for m in user_memories[:2]]
                    mem_context = " | ".join(mem_texts)
                    summary = f"{summary}\n[Memory: {mem_context}]" if summary else f"[Memory: {mem_context}]"
            except Exception as e:
                logger.debug(f"Pinecone memory fetch: {e}")

    # ── Load active transactional flow from Redis ──
    active_flow = None
    pending_action = await r_get_json(f"pending_action:{phone}")
    if pending_action and isinstance(pending_action, dict):
        active_flow = {**pending_action, "flow": "order"}
        logger.info(f"Active flow loaded: stage={pending_action.get('stage', pending_action.get('type'))} phone={phone}")
    else:
        pending_order = await r_get_json(f"pending_order:{phone}")
        if pending_order and isinstance(pending_order, dict):
            active_flow = {**pending_order, "flow": "reminder"}
            logger.info(f"Active reminder flow loaded phone={phone}")
        else:
            reminder_step = await r_get_json(f"reminder_step:{phone}")
            if reminder_step and isinstance(reminder_step, dict):
                active_flow = {**reminder_step, "flow": "reminder"}
            else:
                family_step = await r_get_json(f"family_step:{phone}")
                if family_step and isinstance(family_step, dict):
                    active_flow = {**family_step, "flow": "family"}

    # ── Load Redis working memory ──
    conv_memory = await r_get_json(f"conv_state:{phone}")

    logger.info(f"Context loaded: phone={phone} session={state['session_id']} "
                f"history={len(history)} active_flow={'yes' if active_flow else 'no'}")

    return {**state,
            "user": user, "is_new_user": is_new, "history": history,
            "session_summary": summary, "risk_tier": tier,
            "cde_result": None, "active_episode_id": None,
            "active_flow": active_flow, "conv_memory": conv_memory}


# ── Conversation Summary Generator ────────────────────────────
async def _generate_and_store_summary(user_id: str, phone: str, session_id: str):
    """Generate a conversation summary every ~5 messages.
    Stores in conversation_summaries table + embeds into Pinecone."""
    pool = await get_pool()

    # Check message count
    row = await pool.fetchrow(
        "SELECT message_count FROM conversations WHERE session_id=$1", session_id)
    if not row or row["message_count"] % 5 != 0:
        return  # Only summarize every 5 messages

    # Fetch last 20 messages for summarization
    msgs = await pool.fetch(
        """SELECT role, content, agent_used, drugs_mentioned
           FROM conversation_messages WHERE session_id=$1
           ORDER BY created_at DESC LIMIT 20""", session_id)
    if len(msgs) < 6:
        return

    chat_text = "\n".join(
        f"{'User' if m['role']=='user' else 'Bot'}: {m['content'][:150]}"
        for m in reversed(msgs))

    llm = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content=(
                "Summarize this medical chat concisely. Extract:\n"
                "1. Key health concerns discussed\n"
                "2. Medicines mentioned or ordered\n"
                "3. Allergies or conditions revealed\n"
                "4. Symptoms reported\n"
                "5. Important user preferences\n"
                "Return ONLY valid JSON:\n"
                '{"summary": "...", "allergies": [], "conditions": [], '
                '"drugs": [], "symptoms": [], "key_points": []}')),
            HumanMessage(content=f"Chat:\n{chat_text}")
        ])).content.strip()

        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)

        summary_text = data.get("summary", "")
        if not summary_text:
            return

        # Store in Postgres
        await pool.execute(
            """INSERT INTO conversation_summaries
               (user_id, session_id, summary_text, key_points,
                allergies_detected, conditions_detected, drugs_mentioned, symptoms_detected)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)""",
            user_id, session_id, summary_text,
            data.get("key_points", []),
            data.get("allergies", []),
            data.get("conditions", []),
            data.get("drugs", []),
            data.get("symptoms", []))

        # Embed into Pinecone for semantic search
        try:
            from app.singletons import get_pinecone
            emb = _embed(summary_text)
            get_pinecone().upsert(
                vectors=[{
                    "id": f"mem_{phone}_{session_id[-8:]}",
                    "values": emb,
                    "metadata": {
                        "text": summary_text[:500],
                        "phone": phone,
                        "user_id": user_id,
                        "session_id": session_id,
                        "drugs": data.get("drugs", []),
                        "allergies": data.get("allergies", []),
                        "type": "conversation_summary",
                    },
                }],
                namespace=C.NS_USER_MEMORY)
            logger.info(f"Conversation summary stored + embedded for {phone}")
        except Exception as e:
            logger.error(f"Pinecone memory embed: {e}")

    except Exception as e:
        logger.error(f"Summary generation: {e}")


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
    """Runs CDE for every message that mentions a drug."""
    # Only skip CDE for non-drug transactional flows (reminder times, family setup)
    active_flow = state.get("active_flow")
    if active_flow:
        flow_type = active_flow.get("flow", "")
        if flow_type in ("reminder", "family"):
            logger.info(f"CDE skipped — {flow_type} flow (no drug evaluation needed)")
            return state
        # For order flows: still run CDE if drugs are found

    drugs = state.get("drugs_found", [])
    if not drugs:
        return state

    user = state["user"]
    all_warnings = []
    all_flags = []
    cde = None

    for drug in drugs:
        cde = await run_cde(user, drug)

        if cde["block"]:
            criticals = [w for w in cde["warnings"] if w["severity"] == "CRITICAL"]
            base_msg  = criticals[0]["text"] if criticals else "⛔ This medicine cannot be dispensed due to a safety concern."
            dr_note   = "\n\n🩺 *Please consult your doctor immediately.*" if cde["requires_doctor"] else ""
            tier_warn = get_tier_constraints(cde["risk_tier"]).get("extra_warning", "")
            full_reply = f"{base_msg}{dr_note}"
            if tier_warn:
                full_reply += f"\n\n{tier_warn}"

            # Show ALL warnings, not just the first one
            extra_warns = [w for w in cde["warnings"] if w != criticals[0]] if criticals else cde["warnings"]
            if extra_warns:
                full_reply += "\n\n*Additional concerns:*\n" + "\n".join(
                    f"• {w['text'][:150]}" for w in extra_warns[:3])

            return {**state, "cde_result": cde, "reply": full_reply.strip(),
                    "agent_used": "clinical_decision_engine",
                    "safety_flags": ["CDE_BLOCKED"],
                    "risk_tier": cde["risk_tier"]}

        all_warnings.extend(cde.get("warnings", []))

    # Also run RAG-based drug interaction check for current meds
    cur_meds = user.get("current_meds") or []
    if drugs and cur_meds:
        try:
            from app.core.safety import check_interactions_rag
            rag_interactions = await check_interactions_rag(drugs[0], cur_meds)
            if rag_interactions:
                all_warnings.extend(rag_interactions)
                logger.info(f"RAG interactions found: {len(rag_interactions)}")
        except Exception as e:
            logger.debug(f"RAG interaction check: {e}")

    if cde:
        cde["warnings"] = all_warnings

    return {**state, "cde_result": cde, "risk_tier": cde["risk_tier"] if cde else state.get("risk_tier", 1)}


# ── Node 4: Intent Router — Unified LLM Classification ───────

async def _llm_classify(message: str, history: list, active_flow: dict | None,
                         conv_memory: dict | None) -> dict:
    """Single LLM call that handles ALL classification:
    - Is the message a response to an active flow? (confirm/cancel/quantity/time)
    - Or is it a brand new intent? (drug_info/order/safety/etc.)
    Returns: {intent, confidence, flow_response, quantity, is_confirm, is_cancel}
    """
    llm = get_llm()

    hist_txt = "\n".join(
        f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:120]}"
        for h in history[-4:])

    # Build active flow context
    flow_ctx = ""
    if active_flow:
        stage = active_flow.get("stage", active_flow.get("type", ""))
        drug  = active_flow.get("drug", "")
        ftype = active_flow.get("flow", "")
        if ftype == "order":
            flow_ctx = (
                f"\n\nACTIVE PENDING ORDER:\n"
                f"- Drug: {drug}\n"
                f"- Stage: {stage}\n"
                f"- The bot previously asked the user a question about this order.\n"
                f"- If the user is responding to this order (saying yes/no, giving quantity, "
                f"mentioning this drug), set flow_response=true.\n"
                f"- If the user is asking something completely different or unrelated, "
                f"set flow_response=false and classify the new intent.")
        elif ftype == "reminder":
            flow_ctx = (
                f"\n\nACTIVE PENDING REMINDER:\n"
                f"- Drug: {drug}\n"
                f"- The bot previously asked about reminder times or duration.\n"
                f"- If the user is responding with times/duration/yes/no, set flow_response=true.\n"
                f"- If the user is asking something completely different, set flow_response=false.")
        elif ftype == "family":
            flow_ctx = (
                f"\n\nACTIVE FAMILY FLOW:\n"
                f"- Step: {stage}\n"
                f"- The bot asked for a family member's name or phone number.\n"
                f"- If the user is responding with a name or phone number, set flow_response=true.\n"
                f"- If the user is asking something completely different, set flow_response=false.")

    # Working memory context
    mem_ctx = ""
    if conv_memory:
        if conv_memory.get("last_intent"):
            mem_ctx = f"\nPrevious intent: {conv_memory['last_intent']}"
        if conv_memory.get("last_drug"):
            mem_ctx += f" | Previous drug: {conv_memory['last_drug']}"

    prompt = (
        "You are an intelligent pharmacy chatbot classifier. "
        "Understand English, Hindi, Hinglish, and Marathi.\n\n"
        "Analyze the user's message and return ONLY valid JSON.\n\n"
        f"Recent chat:\n{hist_txt}{mem_ctx}{flow_ctx}\n\n"
        f"User message: \"{message}\"\n\n"
        "Return JSON with these fields:\n"
        '{\n'
        '  "flow_response": true/false,  // Is user responding to the active pending flow? (false if no active flow)\n'
        '  "is_confirm": true/false,     // Is user saying yes/agreeing/confirming?\n'
        '  "is_cancel": true/false,      // Is user saying no/canceling/declining?\n'
        '  "quantity": null or number,    // If user mentions a quantity (e.g. "10", "20 tablets")\n'
        '  "intent": "drug_info|order|safety|reminder|refill|family|order_history|general",  // Primary intent if NOT a flow response\n'
        '  "confidence": 0.0-1.0\n'
        '}\n\n'
        "Rules:\n"
        "- If there is NO active pending flow, flow_response MUST be false\n"
        "- 'haan', 'ha', 'theek hai', 'kar do' = is_confirm=true\n"
        "- 'nahi', 'nako', 'mat karo', 'cancel' = is_cancel=true\n"
        "- If user sends just a number like '10' and there's an active order, flow_response=true, quantity=10\n"
        "- If user says something UNRELATED to the active flow (like their name, a question about a different topic), flow_response=false\n"
        "- IMPORTANT: 'what did I order', 'my past orders', 'order history', 'which medicines I ordered' = intent 'order_history' NOT 'order'\n"
        "- The 'order' intent is ONLY for when the user wants to PLACE a NEW order (e.g. 'order paracetamol', 'I want to buy medicine')\n"
        "- Questions ABOUT orders/medicines/past purchases are 'order_history' or 'general'\n"
        "- 'I am allergic to X', 'I have allergy' = intent 'general' (not order or drug_info)"
    )

    try:
        raw = (await llm.ainvoke([
            SystemMessage(content="You classify pharmacy chatbot intents. Return ONLY valid JSON, nothing else."),
            HumanMessage(content=prompt)
        ])).content.strip()
        raw  = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
        return {
            "flow_response": bool(data.get("flow_response", False)),
            "is_confirm":    bool(data.get("is_confirm", False)),
            "is_cancel":     bool(data.get("is_cancel", False)),
            "quantity":      data.get("quantity"),
            "intent":        str(data.get("intent", "general")),
            "confidence":    float(data.get("confidence", 0.9)),
        }
    except Exception as e:
        logger.error(f"LLM classify error: {e}")
        # Fallback: simple heuristic for pure digits
        msg = message.strip().lower()
        qty_m = re.fullmatch(r"\d+", msg)
        if qty_m and active_flow:
            return {"flow_response": True, "is_confirm": False, "is_cancel": False,
                    "quantity": int(qty_m.group()), "intent": "order", "confidence": 0.9}
        return {"flow_response": False, "is_confirm": False, "is_cancel": False,
                "quantity": None, "intent": "general", "confidence": 0.5}


async def intent_router(state: MedState) -> MedState:
    if state.get("reply"):
        return state

    active_flow = state.get("active_flow")
    conv_memory = state.get("conv_memory")
    history     = state.get("history", [])
    message     = state["message"]

    # ── Quick fast-path: pure digit during active order ──
    msg_stripped = message.strip()
    if active_flow and active_flow.get("flow") == "order" and re.fullmatch(r"\d+", msg_stripped):
        logger.info(f"Fast-path: quantity '{msg_stripped}' → order (skipped LLM)")
        return {**state, "intent": "order", "intent_conf": 1.0}

    # ── Keyword fast-paths: skip LLM for obvious intents (~400ms saved) ──
    msg_lower = message.lower().strip()
    if not active_flow:
        # Order intents — only if a specific drug name seems present (not vague)
        vague_order_words = {"medicine", "tablet", "something", "best", "which", "what", "suggest", "recommend", "kuch"}
        order_msg_words = set(msg_lower.split())
        if (any(msg_lower.startswith(p) for p in (
            "order ", "reorder ", "buy ", "get me ", "i want ", "i need ",
            "send me ", "deliver ", "purchase ",
            "chahiye", "lena ", "manga ", "bhejo "))
            and not vague_order_words.intersection(order_msg_words)):
            logger.info("Fast-path: keyword → order (skipped LLM)")
            return {**state, "intent": "order", "intent_conf": 0.95}
        # Reminder intents
        if any(kw in msg_lower for kw in (
            "remind me", "set reminder", "reminder for",
            "yaad dila", "remind ")):
            logger.info("Fast-path: keyword → reminder (skipped LLM)")
            return {**state, "intent": "reminder", "intent_conf": 0.95}
        # Active medications / profile — route to general (conversation_agent handles it)
        if any(kw in msg_lower for kw in (
            "my med", "active med", "my current med", "what am i taking",
            "my medication", "which med", "what medicine", "active reminder",
            "my reminder", "my prescription", "current prescription")):
            logger.info("Fast-path: keyword → general/active_meds (skipped LLM)")
            return {**state, "intent": "general", "intent_conf": 0.95}
        # Drug info intents
        if any(kw in msg_lower for kw in (
            "side effect", "what is ", "tell me about ",
            "uses of ", "dosage of ", "dose of ",
            "price of ", "composition of ")):
            logger.info("Fast-path: keyword → drug_info (skipped LLM)")
            return {**state, "intent": "drug_info", "intent_conf": 0.90}
        # Order history
        if any(kw in msg_lower for kw in (
            "my order", "past order", "order history",
            "what did i order", "previous order")):
            logger.info("Fast-path: keyword → order_history (skipped LLM)")
            return {**state, "intent": "order_history", "intent_conf": 0.95}
        # Family intents
        family_relations = ("sister", "brother", "mother", "father", "wife",
                            "husband", "son", "daughter", "bhai", "behen",
                            "maa", "papa", "bahin", "didi", "bhabhi")
        if any(kw in msg_lower for kw in (
            "my family", "add my ", "family member", "add member",
            "order for my ")):
            logger.info("Fast-path: keyword → family (skipped LLM)")
            return {**state, "intent": "family", "intent_conf": 0.95}
        if any(rel in msg_lower for rel in family_relations) and any(
            kw in msg_lower for kw in ("add", "order for", "in my family",
                                        "to my family", "show family",
                                        "list family", "medicine for")):
            logger.info("Fast-path: keyword+relation → family (skipped LLM)")
            return {**state, "intent": "family", "intent_conf": 0.95}

    # ── Unified LLM classification (only if no fast-path matched) ──
    result = await _llm_classify(message, history, active_flow, conv_memory)
    logger.info(f"LLM classify: flow_resp={result['flow_response']} "
                f"confirm={result['is_confirm']} cancel={result['is_cancel']} "
                f"qty={result['quantity']} intent={result['intent']} "
                f"conf={result['confidence']:.2f} phone={state['phone']}")

    # If user is responding to active flow → route to that flow's agent
    if result["flow_response"] and active_flow:
        flow_type = active_flow.get("flow", "")
        if flow_type == "order":
            return {**state, "intent": "order", "intent_conf": 1.0}
        elif flow_type == "reminder":
            return {**state, "intent": "reminder", "intent_conf": 1.0}
        elif flow_type == "family":
            return {**state, "intent": "family", "intent_conf": 1.0}

    # Standard intent routing
    intent     = result["intent"]
    confidence = result["confidence"]

    if intent not in {"drug_info", "order", "safety", "reminder", "refill", "family", "general", "order_history"}:
        intent = "general"

    if confidence < C.INTENT_CONF_MIN:
        return {**state, "intent": "clarify", "intent_conf": confidence,
                "reply": ("I'm not sure what you'd like to do:\n\n"
                          "1️⃣ Ask about a medicine\n2️⃣ Place an order\n"
                          "3️⃣ Check drug safety\n4️⃣ Set a reminder\n\n"
                          "Reply with 1, 2, 3, or 4."),
                "agent_used": "intent_router"}

    logger.info(f"Intent={intent} ({confidence:.2f}) phone={state['phone']}")
    return {**state, "intent": intent, "intent_conf": confidence}


# ── Profile Auto-Extraction (runs on EVERY message) ───────────

async def _extract_allergies_only(message: str, user: dict, phone: str):
    """Extract allergy info from message even during active order/reminder flows.
    This is safety-critical — allergies must always be captured."""
    # Quick keyword check — only run LLM if allergy-related words present
    allergy_kw = ["allerg", "allergic", "cannot take", "cant take", "reaction to",
                  "sensitive to", "intolerant", "intolerance"]
    msg_l = message.lower()
    if not any(k in msg_l for k in allergy_kw):
        return

    llm = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content=(
                "Extract ONLY allergy information from this message. "
                "Return ONLY valid JSON: {\"allergies\": [\"drug1\", \"drug2\"] or \"none\"}\n"
                "Only extract if the user clearly states an allergy. Do NOT guess.")),
            HumanMessage(content=f'Message: "{message}"')
        ])).content.strip()
        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)

        if data.get("allergies") and data["allergies"] != "none":
            new_allergies = [a.strip().lower() for a in data["allergies"]] if isinstance(data["allergies"], list) else []
            if new_allergies:
                existing = user.get("allergies") or []
                combined = list(set(existing + new_allergies))
                from app.db.helpers import update_user
                await update_user(phone, allergies=combined)
                logger.info(f"Allergies captured during flow: {new_allergies} for {phone}")
    except Exception as e:
        logger.debug(f"Allergy extraction: {e}")


async def _auto_extract_profile(message: str, user: dict, phone: str):
    """Silently extract profile info (name, age, gender, allergies) from any message
    and update the user record. Runs regardless of which agent handled the message."""
    # Skip if user is fully onboarded with complete profile
    has_name = bool(user.get("name"))
    has_age  = user.get("age") is not None
    has_gender = bool(user.get("gender"))
    has_allergies = user.get("allergies") is not None

    if has_name and has_age and has_gender and has_allergies:
        return  # Profile complete, nothing to extract

    # Build a focused extraction prompt
    missing = []
    if not has_name: missing.append("name")
    if not has_age: missing.append("age (number)")
    if not has_gender: missing.append("gender (male/female/other)")
    if not has_allergies: missing.append("allergies (list or 'none')")

    llm = get_llm()
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content=(
                "Extract personal information from the user's message. "
                "Return ONLY valid JSON. If info is not present, use null.")),
            HumanMessage(content=(
                f'Missing fields: {", ".join(missing)}\n'
                f'User message: "{message}"\n\n'
                'Return: {"name": null or string, "age": null or number, '
                '"gender": null or "male"/"female"/"other", '
                '"allergies": null or ["list"] or "none"}\n\n'
                "Only extract if CLEARLY stated. Do NOT guess."))
        ])).content.strip()
        raw  = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)

        from app.db.helpers import update_user
        updates = {}
        if data.get("name") and not has_name:
            updates["name"] = str(data["name"]).strip().title()[:80]
            logger.info(f"Auto-captured name: {updates['name']} for {phone}")
        if data.get("age") and not has_age:
            age = int(data["age"])
            if 0 < age < 120:
                updates["age"] = age
                logger.info(f"Auto-captured age: {age} for {phone}")
        if data.get("gender") and not has_gender:
            g = str(data["gender"]).lower()
            if g in ("male", "female", "other"):
                updates["gender"] = g
                logger.info(f"Auto-captured gender: {g} for {phone}")
        if data.get("allergies") is not None and not has_allergies:
            if data["allergies"] == "none" or data["allergies"] == []:
                updates["allergies"] = []
            elif isinstance(data["allergies"], list):
                updates["allergies"] = [a.strip().lower() for a in data["allergies"]]
            logger.info(f"Auto-captured allergies for {phone}")

        if updates:
            # Advance onboarding step based on what we captured
            step = user.get("onboarding_step", "name")
            if "name" in updates and step == "name":
                updates["onboarding_step"] = "age" if not has_age else ("gender" if not has_gender else "allergies")
            if "age" in updates and step in ("name", "age"):
                updates["onboarding_step"] = "gender" if not has_gender else "allergies"
            if "gender" in updates and step in ("name", "age", "gender"):
                updates["onboarding_step"] = "allergies"
            if "allergies" in updates:
                # Check if profile is now complete
                new_name = updates.get("name") or user.get("name")
                new_age = updates.get("age") or user.get("age")
                new_gender = updates.get("gender") or user.get("gender")
                if new_name and new_age and new_gender:
                    updates["onboarded"] = True
                    updates["onboarding_step"] = "done"
                    updates["consent_accepted"] = True

            await update_user(phone, **updates)

    except Exception as e:
        logger.error(f"Profile auto-extract: {e}")


async def _build_proactive_followup(user: dict, phone: str, state: dict) -> str:
    """Build a contextual proactive follow-up in the user's preferred language.
    Only asks ONE question. Checks pending_question to avoid double-asking."""
    # If there's already a pending question for this user, don't add another
    existing_q = await r_get_json(f"pending_question:{phone}")
    if existing_q:
        return ""  # Already asked a question, wait for answer

    lang = user.get("preferred_language", "en-IN")
    name = user.get("name", "")
    parts = []

    # 1. Missing profile fields
    missing_fields = []
    if not name:
        missing_fields.append("name")
    if user.get("age") is None:
        missing_fields.append("age")
    if not user.get("gender"):
        missing_fields.append("gender")
    if user.get("allergies") is None:
        missing_fields.append("allergies")

    # 2. Check health episodes + adherence (only if basic profile done)
    health_context = ""
    if user.get("id") and not missing_fields:
        try:
            pool = await get_pool()
            episodes = await pool.fetch(
                """SELECT episode_type, symptoms, started_at
                   FROM health_episodes WHERE user_id=$1 AND status='active'
                   ORDER BY started_at DESC LIMIT 1""",
                str(user["id"]))
            if episodes:
                ep = dict(episodes[0])
                days_ago = (date.today() - ep["started_at"].date()).days if ep.get("started_at") else 0
                if days_ago <= 7:
                    health_context = f"active health episode: {ep.get('symptoms', ep.get('episode_type', ''))} ({days_ago} days ago)"
        except:
            pass

        if not health_context:
            try:
                pool = await get_pool()
                low = await pool.fetchrow(
                    """SELECT drug_name, score FROM adherence_scores
                       WHERE user_id=$1 AND score < 50
                       ORDER BY week_start DESC LIMIT 1""",
                    str(user["id"]))
                if low:
                    health_context = f"low adherence for {low['drug_name']} (score: {low['score']}%)"
            except:
                pass

    if not missing_fields and not health_context:
        return ""  # Nothing to ask

    # Use LLM to generate a natural, one-line follow-up in the user's language
    llm = get_llm()
    lang_name = {
        "en": "English", "en-IN": "English",
        "hi": "Hindi", "hi-IN": "Hindi",
        "mr": "Marathi", "mr-IN": "Marathi",
        "bn": "Bengali", "bn-IN": "Bengali",
        "ta": "Tamil", "ta-IN": "Tamil",
        "te": "Telugu", "te-IN": "Telugu",
        "kn": "Kannada", "kn-IN": "Kannada",
        "ml": "Malayalam", "ml-IN": "Malayalam",
        "gu": "Gujarati", "gu-IN": "Gujarati",
        "pa": "Punjabi", "pa-IN": "Punjabi",
        "od": "Odia", "od-IN": "Odia",
        "ur": "Urdu", "ur-IN": "Urdu",
    }.get(lang, "English")
    try:
        context_parts = []
        if missing_fields:
            context_parts.append(f"Missing profile info: {', '.join(missing_fields)}")
        if health_context:
            context_parts.append(f"Health context: {health_context}")
        if name:
            context_parts.append(f"User's name: {name}")

        raw = (await llm.ainvoke([
            SystemMessage(content=(
                f"Generate a SHORT, caring one-line follow-up question in {lang_name}. "
                "Use a relevant emoji. Do NOT repeat what was already said in the conversation. "
                "Ask about only ONE thing. Be warm and natural.")),
            HumanMessage(content="\n".join(context_parts))
        ])).content.strip()

        # Track the pending question so we don't double-ask
        topic = missing_fields[0] if missing_fields else (health_context or "general")
        await r_set(f"pending_question:{phone}", {"field": topic, "source": "proactive"}, ttl=600)

        return "\n\n---\n" + raw
    except:
        # Fallback to English
        if missing_fields:
            field = missing_fields[0]
            fallbacks = {
                "name": "😊 *What's your name?*",
                "age": "📅 *How old are you?*",
                "gender": "👤 *What's your gender?* (male/female/other)",
                "allergies": "💊 *Any medicine allergies?* Or reply *none*.",
            }
            # Track the pending question
            await r_set(f"pending_question:{phone}", {"field": field, "source": "proactive"}, ttl=600)
            return "\n\n---\n" + fallbacks.get(field, "")
        return ""


async def _detect_language(message: str) -> str:
    """Detect the language of a message. Returns 'en', 'hi', 'mr', etc."""
    # Quick heuristic for common scripts
    for ch in message:
        if '\u0900' <= ch <= '\u097F':  # Devanagari (Hindi/Marathi)
            # Distinguish Hindi vs Marathi using common words
            mr_words = {"आहे", "तुम्ही", "मला", "करा", "नाही", "होय", "काय", "कसे", "माझे"}
            if any(w in message for w in mr_words):
                return "mr"
            return "hi"
        if '\u0980' <= ch <= '\u09FF':  # Bengali
            return "bn"
    # Default to English
    return "en"


# ── Node 12: Post Process ─────────────────────────────────────
async def post_process(state: MedState) -> MedState:
    if not state.get("reply"):
        return {**state, "reply": "How can I help you?"}
    reply = state["reply"]

    if (state.get("agent_used") in {"conversation_agent", "drug_info_agent", "safety_agent"}
            and "not a substitute" not in reply.lower()):
        # Skip disclaimer for greetings and identity questions
        msg_l = state.get("message", "").lower()
        greeting_words = {"hi", "hello", "hey", "who are you", "what is your name",
                          "what's your name", "how are you", "namaste", "good morning",
                          "good evening", "good afternoon", "sup", "yo"}
        is_greeting_msg = any(g in msg_l for g in greeting_words)
        if not is_greeting_msg:
            reply += "\n\n_⚕️ For informational purposes only. Not a substitute for professional medical advice._"
    user    = state.get("user", {})
    uid     = str(user.get("id", ""))
    session = state["session_id"]
    phone   = state["phone"]

    # ── Detect language (fast, no LLM) ──
    detected_lang = await _detect_language(state["message"])

    # ── Build proactive follow-up (affects reply, must be in-graph) ──
    from app.db.helpers import get_user_by_phone
    fresh_user = await get_user_by_phone(phone)
    if fresh_user:
        user = fresh_user

    # ── Proactive follow-up: Only ask if NO question was already asked in the reply ──
    needs_action = bool(state.get("requires_action"))
    # Check if the reply already contains a question (ends with ? or has a question pattern)
    reply_already_asks = bool(re.search(r'\?\s*$|\?\s*[\*_]', reply.strip()) or
                              re.search(r'\?\s*\n', reply))
    if (state.get("agent_used") not in ("onboarding_agent", "order_agent", "reminder_agent",
                                         "dynamic_followup_engine")
            and not needs_action
            and not reply_already_asks):
        proactive = await _build_proactive_followup(user, phone, state)
        if proactive:
            proactive_text = proactive.split("\n")[-1][:40].lower()
            if proactive_text not in reply.lower():
                reply += proactive

    # ── Update Redis conv_state (fast, <5ms) ──
    prev_conv = await r_get_json(f"conv_state:{phone}") or {}
    recent_msgs = prev_conv.get("recent_messages", [])
    recent_msgs.append({"role": "user", "content": state["message"][:200]})
    recent_msgs.append({"role": "assistant", "content": reply[:200]})
    recent_msgs = recent_msgs[-10:]

    conv_state = {
        "last_intent":    state.get("intent", ""),
        "last_drug":      state.get("drugs_found", [None])[0] if state.get("drugs_found") else None,
        "last_topic":     state.get("message", "")[:80],
        "last_agent":     state.get("agent_used", ""),
        "active_episode": state.get("active_episode_id"),
        "session_id":     session,
        "language":       user.get("preferred_language", detected_lang),
        "recent_messages": recent_msgs,
        "web_search_source": state.get("web_search_source"),
    }
    await r_set(f"conv_state:{phone}", conv_state, ttl=1800)

    # ── Collect DEFERRED tasks (run AFTER response is sent) ──
    # These are stored on the state for the API route to schedule via BackgroundTasks
    deferred = {
        "uid": uid, "phone": phone, "session": session,
        "message": state["message"], "reply": reply,
        "detected_lang": detected_lang, "stored_lang": user.get("preferred_language", "en-IN"),
        "has_active_flow": bool(state.get("active_flow")),
        "agent_used": state.get("agent_used", ""),
        "drugs_found": state.get("drugs_found", []),
        "safety_flags": state.get("safety_flags", []),
        "intent": state.get("intent", ""),
        "intent_conf": state.get("intent_conf", 0.0),
        "user": user,
    }

    return {**state, "reply": reply, "user": user, "_deferred": deferred}


async def run_deferred_post_tasks(deferred: dict):
    """Run heavy tasks AFTER HTTP response is sent. Called by API routes via BackgroundTasks."""
    uid = deferred["uid"]
    phone = deferred["phone"]
    session = deferred["session"]
    message = deferred["message"]
    reply = deferred["reply"]
    user = deferred["user"]

    if not uid:
        logger.warning(f"Deferred tasks skipped: no user_id for phone={phone}")
        return

    # 1. Language update — now handled by Sarvam translation in routes.py
    #    (routes.py detects language via Sarvam API and updates DB with BCP-47 code)
    #    Skip the heuristic-based language update here to avoid overwriting.

    # 2. Profile extraction (LLM call — was blocking 400ms)
    if not deferred["has_active_flow"] and deferred["agent_used"] not in ("order_agent", "reminder_agent"):
        await _auto_extract_profile(message, user, phone)
    else:
        await _extract_allergies_only(message, user, phone)

    # 3. Persist messages to Postgres
    pool = await get_pool()
    for role, content, agent, flags in [
        ("user",      message, None,                         []),
        ("assistant", reply,   deferred["agent_used"],       deferred["safety_flags"]),
    ]:
        try:
            await pool.execute(
                """INSERT INTO conversation_messages
                   (session_id, user_id, role, content, agent_used,
                    drugs_mentioned, safety_flags, intent, intent_confidence)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                session, uid, role, content[:3000], agent,
                deferred["drugs_found"], flags,
                deferred["intent"], deferred["intent_conf"])
        except Exception as e:
            logger.error(f"Deferred message persist failed ({role}): {e}")

    # 4. Summary generation + Pinecone embed
    try:
        await _generate_and_store_summary(uid, phone, session)
    except Exception as e:
        logger.debug(f"Deferred summary: {e}")

