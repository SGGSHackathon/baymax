"""
Domain agent nodes — onboarding, conversation, drug_info, safety, order, reminder, refill.
Now with: deterministic order state machine, no-LLM quantity parsing,
         strict stage transitions, proper Redis state management.
"""

import re
import json
import logging
from datetime import date, timedelta

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import C
from app.singletons import get_llm, get_pool
from app.db.helpers import (
    get_user_by_phone, update_user, db_fetch, db_fetchrow, db_execute,
    get_inventory_fuzzy, check_stock, log_audit, log_health_event,
    get_dosage_cap, get_or_create_family, add_family_member,
    get_family_members, get_family_member_by_relation, create_user,
    check_duplicate_order,
)
from app.db.redis_helpers import r_get, r_get_json, r_set, r_del
from app.core.retrieval import retrieve
from app.core.safety import check_class_allergy, check_interactions_rag, check_food_drug, extract_drugs_from_inventory
from app.core.risk_tier import get_tier_constraints
from app.core.cde import run_cde
from app.core.abuse import update_abuse_score, check_abuse_blocked
from app.graph.state import MedState

logger = logging.getLogger("medai.v6")


# ═══════════════════════════════════════════════════════════════
# Smart Helpers — LLM for understanding, regex for extraction
# ═══════════════════════════════════════════════════════════════

def _parse_quantity(msg: str) -> int | None:
    """Extract quantity from message — pure regex, fast and reliable."""
    m = msg.strip().lower()
    if re.fullmatch(r"\d+", m):
        return int(m)
    match = re.search(r"(\d+)\s*(?:tablet|tab|strip|cap|capsule|unit|piece|bottle)?s?", m, re.I)
    if match:
        return int(match.group(1))
    return None


async def _llm_understand_response(message: str, drug: str, stage: str,
                                    history: list = None) -> dict:
    """Use LLM to naturally understand user's response during an order/reminder flow.
    Returns: {is_confirm, is_cancel, quantity, unrelated, user_want}
    """
    llm = get_llm()
    hist_txt = ""
    if history:
        hist_txt = "\n".join(
            f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:100]}"
            for h in history[-3:])

    try:
        chat_ctx = ("Chat:\n" + hist_txt + "\n\n") if hist_txt else ""
        prompt = (
            f"Context: Bot is handling an order for '{drug}', currently at stage '{stage}'.\n"
            f"{chat_ctx}"
            f'User says: "{message}"\n\n'
            "Analyze what the user wants and return:\n"
            '{\n'
            '  "is_confirm": true/false,  // User agrees, says yes, wants to proceed\n'
            '  "is_cancel": true/false,    // User declines, says no, wants to cancel\n'
            '  "quantity": null or number,  // If user mentions a quantity\n'
            '  "unrelated": true/false      // Message is NOT about the current order at all\n'
            '}\n\n'
            "Examples:\n"
            '- "haan kar do" -> {"is_confirm":true,"is_cancel":false,"quantity":null,"unrelated":false}\n'
            '- "20 tablets de do" -> {"is_confirm":true,"is_cancel":false,"quantity":20,"unrelated":false}\n'
            '- "nahi rehne do" -> {"is_confirm":false,"is_cancel":true,"quantity":null,"unrelated":false}\n'
            '- "my name is rahul" -> {"is_confirm":false,"is_cancel":false,"quantity":null,"unrelated":true}\n'
            '- "what is aspirin?" -> {"is_confirm":false,"is_cancel":false,"quantity":null,"unrelated":true}'
        )
        raw = (await llm.ainvoke([
            SystemMessage(content=(
                "You understand user responses in a pharmacy chatbot. "
                "Understand English, Hindi, Hinglish, and Marathi. "
                "Return ONLY valid JSON.")),
            HumanMessage(content=prompt)
        ])).content.strip()
        raw  = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
        return {
            "is_confirm": bool(data.get("is_confirm", False)),
            "is_cancel":  bool(data.get("is_cancel", False)),
            "quantity":   data.get("quantity"),
            "unrelated":  bool(data.get("unrelated", False)),
        }
    except Exception as e:
        logger.error(f"LLM understand response: {e}")
        # Fallback to regex
        qty = _parse_quantity(message)
        return {"is_confirm": False, "is_cancel": False, "quantity": qty, "unrelated": False}


# ═══════════════════════════════════════════════════════════════
# LLM Order Decision — ONLY for fresh orders with no pending state
# ═══════════════════════════════════════════════════════════════

async def llm_order_decision(user_message: str, drug: str, inv: dict,
                              user: dict, history: list) -> dict:
    """LLM decides if order should proceed. Returns {proceed, reason, needs, quantity}.
    ONLY called for fresh orders — never inside a pending flow."""
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
        return {"proceed": False, "reason": "llm_error", "needs": [], "quantity": None}


# ── Node 5: Onboarding Agent ──────────────────────────────────

def _is_greeting(msg: str) -> bool:
    """Detect greetings including stretched variants: 'Hhhiiii', 'helloooo', etc."""
    m = msg.lower().strip().rstrip("!.?,")
    # Exact short greetings
    if m in ("sup", "yo", "hey", "hi", "hello", "hola", "namaste", "namaskar",
             "good morning", "good evening", "good afternoon", "good night",
             "gm", "gn", "morning", "evening"):
        return True
    # Regex for stretched variants: hiii, hhhiii, hellloooo, heyyy, namasteeee
    patterns = [
        r'^h+i+$',             # hi, hii, hhhiii, etc.
        r'^h+e+l+o+$',         # hello, helllooo
        r'^h+e+y+$',           # hey, heyyyy
        r'^n+a+m+a+s+t+e+$',  # namaste, namasteeee
        r'^n+a+m+a+s+k+a+r+$', # namaskar
        r'^go+d\s+(morning|evening|afternoon|night)$',
    ]
    return any(re.match(p, m) for p in patterns)
async def onboarding_agent(state: MedState) -> MedState:
    """Handles greetings + directs unregistered users to register on the website.
    For registered users, handles greetings with BAYMAX intro."""
    user  = state["user"]
    phone = state["phone"]
    msg   = state["message"].strip()
    step  = user.get("onboarding_step", "name")
    llm   = get_llm()

    # ── If user is not onboarded → redirect to website for registration ──
    if not user.get("onboarded"):
        register_url = C.WEBSITE_BASE_URL
        if _is_greeting(msg):
            return {**state,
                "reply": ("Hello! 👋 My name is *BAYMAX*, your Medical AI Assistant!\n\n"
                          "It looks like you're new here! 🌟\n\n"
                          "To get started, please register on our website first:\n"
                          f"🔗 {register_url}\n\n"
                          "Once you've registered, come back and say *Hi* — I'll be ready to help you! 😊"),
                "agent_used": "onboarding_agent"}
        else:
            return {**state,
                "reply": ("Hey there! 👋 I'm *BAYMAX*, your Medical AI Assistant.\n\n"
                          "I'd love to help, but it seems you haven't registered yet.\n"
                          "Please register on our website first:\n"
                          f"🔗 {register_url}\n\n"
                          "Once registered, I'll be able to assist you with all your medical needs! 😊"),
                "agent_used": "onboarding_agent"}

    # ── Onboarded user greeting → BAYMAX intro ──
    if _is_greeting(msg):
        name = user.get("name", "there")
        return {**state,
                "reply": f"Hi *{name}*! 👋 I'm BAYMAX, your Medical AI Assistant!\nHow can I help you today?\n\n"
                         "💊 Medicine info  |  🛒 Order  |  ⚠️ Drug safety  |  🏥 Health questions",
                "agent_used": "onboarding_agent"}

    # ── Multi-field extraction for long messages with profile data ──
    word_count = len(msg.split())
    if word_count > 3 and step in ("name", "age", "gender", "allergies"):
        try:
            multi_raw = (await llm.ainvoke([
                SystemMessage(content=(
                    "Extract ALL personal/medical profile info from the user's message. "
                    "Return ONLY valid JSON. Use null for info NOT clearly stated.\n"
                    '{"name": null, "age": null, "gender": null, '
                    '"is_pregnant": null, "allergies": null}\n'
                    "Rules:\n"
                    "- name: string or null\n"
                    "- age: integer or null\n"
                    '- gender: "male","female","other" or null\n'
                    "- is_pregnant: true/false or null\n"
                    '- allergies: ["list"] or "none" or null (null = not mentioned)')),
                HumanMessage(content=f'Message: "{msg}"')
            ])).content.strip()
            multi_raw = re.sub(r"```json|```", "", multi_raw).strip()
            multi_data = json.loads(multi_raw)

            updates = {}
            if multi_data.get("name") and not user.get("name"):
                updates["name"] = str(multi_data["name"]).strip().title()[:80]
            if multi_data.get("age") is not None and user.get("age") is None:
                try:
                    age_val = int(multi_data["age"])
                    if 0 < age_val < 120:
                        updates["age"] = age_val
                except (ValueError, TypeError):
                    pass
            if multi_data.get("gender") and not user.get("gender"):
                g = str(multi_data["gender"]).lower()
                if g in ("male", "female", "other"):
                    updates["gender"] = g
            if multi_data.get("is_pregnant") is True and not user.get("is_pregnant"):
                updates["is_pregnant"] = True
            if multi_data.get("allergies") is not None and user.get("allergies") is None:
                if multi_data["allergies"] == "none" or multi_data["allergies"] == []:
                    updates["allergies"] = []
                elif isinstance(multi_data["allergies"], list):
                    updates["allergies"] = [a.strip().lower() for a in multi_data["allergies"] if a.strip()]

            if len(updates) >= 2:
                final_name = updates.get("name") or user.get("name")
                final_age = updates.get("age") if "age" in updates else user.get("age")
                final_gender = updates.get("gender") or user.get("gender")
                final_allergies = updates.get("allergies") if "allergies" in updates else user.get("allergies")

                if final_name and final_age is not None and final_gender and final_allergies is not None:
                    updates["onboarded"] = True
                    updates["onboarding_step"] = "done"
                    updates["consent_accepted"] = True
                    await update_user(phone, **updates)
                    a_str = ", ".join(final_allergies) if final_allergies else "none"
                    reply = (
                        f"✅ *Profile complete!* Welcome, *{final_name}*! 😊\n\n"
                        f"📋 Age: {final_age} | Gender: {final_gender.title()} | Allergies: {a_str}\n\n"
                        "_⚕️ This service provides information only — not medical advice._\n\n"
                        "How can I help?\n"
                        "💊 Medicine info  |  🛒 Order  |  ⚠️ Drug safety  |  🏥 Health questions")
                    return {**state, "reply": reply, "agent_used": "onboarding_agent",
                            "user": await get_user_by_phone(phone) or state["user"]}
                else:
                    if final_name and final_age is not None and not final_gender:
                        updates["onboarding_step"] = "gender"
                    elif final_name and final_age is None:
                        updates["onboarding_step"] = "age"
                    elif final_name and final_age is not None and final_gender and final_allergies is None:
                        updates["onboarding_step"] = "allergies"
                    await update_user(phone, **updates)
                    user = await get_user_by_phone(phone) or state["user"]
                    step = user.get("onboarding_step", "name")
                    name_display = updates.get("name") or user.get("name", "there")
                    stored_parts = []
                    if "name" in updates: stored_parts.append(f"name: *{updates['name']}*")
                    if "age" in updates: stored_parts.append(f"age: *{updates['age']}*")
                    if "gender" in updates: stored_parts.append(f"gender: *{updates['gender']}*")
                    if "allergies" in updates:
                        a = ", ".join(updates["allergies"]) if updates["allergies"] else "none"
                        stored_parts.append(f"allergies: *{a}*")
                    stored_msg = "Got it — " + ", ".join(stored_parts) + ".\n\n" if stored_parts else ""
                    next_prompts = {
                        "age": f"{stored_msg}📅 *How old are you?*",
                        "gender": f"{stored_msg}👤 *Gender?* Reply: *male*, *female*, or *other*",
                        "pregnancy": f"{stored_msg}🤰 *Are you currently pregnant?* (yes/no)",
                        "allergies": f"{stored_msg}💊 *Any medicine allergies?* Or reply *none*",
                        "current_meds": f"{stored_msg}💊 *Are you currently taking any medicines?* List them or reply *none*.",
                    }
                    reply = next_prompts.get(step, f"{stored_msg}How can I help?")
                    return {**state, "reply": reply, "agent_used": "onboarding_agent",
                            "user": user}
        except Exception as e:
            logger.debug(f"Multi-field onboarding extraction failed: {e}")

    # ── Step-by-step profile collection (when user sends direct profile data) ──
    if step == "name":
        # Use LLM to extract just the name
        try:
            raw_name = (await llm.ainvoke([
                SystemMessage(content="Extract ONLY the person's name from the message. Return just the name, nothing else. If no name found, return 'NONE'."),
                HumanMessage(content=f'Message: "{msg}"')
            ])).content.strip().strip('"').strip("'")
            if raw_name.upper() == "NONE" or len(raw_name) < 2:
                # Can't extract name — that's fine, let them use the bot anyway
                return {**state, "reply": "Please tell me your name to get started. 😊",
                        "agent_used": "onboarding_agent"}
            name = raw_name.title()[:80]
        except:
            name = re.sub(r"(?i)^(my name is|i am|i'm|mera naam|naam)\s+", "", msg).strip().title()[:80]
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
        g = msg.lower().strip().rstrip("!.")
        gender_map = {
            "male": "male", "m": "male", "man": "male", "boy": "male",
            "ladka": "male", "mard": "male", "purush": "male",
            "female": "female", "f": "female", "woman": "female", "girl": "female",
            "ladki": "female", "mahila": "female", "stree": "female",
            "other": "other", "non-binary": "other", "nb": "other",
            "prefer not to say": "other",
        }
        gender = gender_map.get(g)
        if not gender:
            name = user.get("name", "there")
            return {**state,
                    "reply": f"Hi {name}! Please reply with *male*, *female*, or *other*. 👤",
                    "agent_used": "onboarding_agent"}

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
        if "none" not in msg.lower() and msg.lower() not in ("no", "n"):
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


# ── Node 5b: Family Agent ─────────────────────────────────────
async def family_agent(state: MedState) -> MedState:
    """Handles family management: add members, list family, order for family."""
    if state.get("reply"): return state

    user    = state["user"]
    phone   = state["phone"]
    message = state["message"].strip()
    uid     = str(user["id"])
    llm     = get_llm()

    # Check for active family flow
    family_step = await r_get_json(f"family_step:{phone}")

    if family_step and isinstance(family_step, dict):
        step = family_step.get("step")

        if step == "awaiting_phone":
            # User should have provided a phone number
            phone_match = re.search(r'\+?\d{10,13}', message.replace(' ', ''))
            if not phone_match:
                return {**state,
                        "reply": "Please share their phone number (e.g. +919876543210).",
                        "agent_used": "family_agent",
                        "requires_action": "family_phone"}

            member_phone = phone_match.group()
            if not member_phone.startswith("+"):
                member_phone = "+91" + member_phone[-10:]  # Default to India

            relation = family_step.get("relation", "family member")
            member_name = family_step.get("name", relation.title())

            # Check if account already exists for this phone
            member_user = await get_user_by_phone(member_phone)
            existing_account = member_user is not None

            if not member_user:
                # Create new user
                member_user = await create_user(member_phone)
                await update_user(member_phone, name=member_name, onboarding_step="done")
                member_user = await get_user_by_phone(member_phone)
            else:
                # Existing account found — use their name if available
                if member_user.get("name"):
                    member_name = member_user["name"]

            # Create/get family and add member
            family = await get_or_create_family(uid, f"{user.get('name', 'My')} Family")
            await add_family_member(
                str(family["id"]), str(member_user["id"]),
                role="dependent", admin_user_id=uid,
                relation=relation)

            await r_del(f"family_step:{phone}")

            await log_audit(uid, "family_member_added", "family_members",
                           str(member_user["id"]),
                           new_val={"relation": relation, "phone": member_phone})

            # Build response
            lines = [f"✅ *{member_name.title()}* added to your family!\n"]
            if existing_account:
                lines.append(f"🔗 Existing account found for {member_phone}")
                if member_user.get("name"):
                    lines.append(f"👤 Name: *{member_user['name'].title()}*")
            else:
                lines.append(f"📱 Phone: {member_phone}")
            lines.append(f"👥 Relation: {relation.title()}")
            lines.append(f"\nYou can now say *'order paracetamol for {relation}'* "
                         f"to order medicines for them.")
            lines.append(f"\n✏️ _You can edit family details from the website._")

            return {**state,
                    "reply": "\n".join(lines),
                    "agent_used": "family_agent"}

        if step == "awaiting_name":
            # User gave the name — use ORIGINAL message (pre-translation) to avoid mangling
            orig_msg = state.get("original_message") or message
            name = orig_msg.strip().title()[:80]
            family_step["name"] = name
            family_step["step"] = "awaiting_phone"
            await r_set(f"family_step:{phone}", family_step, ttl=300)
            return {**state,
                    "reply": f"Got it! What's *{name}'s* phone number?",
                    "agent_used": "family_agent",
                    "requires_action": "family_phone"}

    # ── Fresh family intent — use LLM to understand what they want ──
    try:
        raw = (await llm.ainvoke([
            SystemMessage(content=(
                "Classify this family-related message. Return ONLY valid JSON:\n"
                '{"action": "add_member"|"list_members"|"order_for",'
                ' "relation": "sister"|"brother"|"mother"|...,'
                ' "name": null or string,'
                ' "drug": null or string}')),
            HumanMessage(content=f'Message: "{message}"')
        ])).content.strip()

        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
    except:
        data = {"action": "list_members"}

    action = data.get("action", "list_members")

    if action == "add_member":
        relation = data.get("relation", "family member")
        # Use LLM-extracted name only as hint; prefer original_message for names
        name = data.get("name")

        if name:
            # Use name from original (pre-translation) message to avoid mangling
            orig_msg = state.get("original_message") or message
            # If the original message contains the name-like text, use it as-is
            if orig_msg.strip().lower() != message.strip().lower():
                # Message was translated — the LLM name might be wrong
                # Extract name from original message by removing relation keywords
                clean = orig_msg.strip()
                for kw in ("add my", "add ", "my ", "family member", "in my family",
                           "to my family", relation):
                    clean = re.sub(re.escape(kw), "", clean, flags=re.IGNORECASE).strip()
                if clean and len(clean) > 1:
                    name = clean.title()

            await r_set(f"family_step:{phone}",
                        {"step": "awaiting_phone", "relation": relation, "name": name},
                        ttl=300)
            return {**state,
                    "reply": (f"Adding your *{relation}* — *{name.title()}*.\n\n"
                              f"📱 What's their phone number?\n\n"
                              f"💡 _If they already have an account, we'll link them automatically._"),
                    "agent_used": "family_agent",
                    "requires_action": "family_phone"}
        else:
            await r_set(f"family_step:{phone}",
                        {"step": "awaiting_name", "relation": relation},
                        ttl=300)
            return {**state,
                    "reply": f"Sure! What's your *{relation}'s* name?",
                    "agent_used": "family_agent",
                    "requires_action": "family_name"}

    elif action == "order_for":
        # Delegate to order_agent with patient_id context
        relation = data.get("relation", "")
        drug = data.get("drug")
        member = await get_family_member_by_relation(uid, relation)
        if not member:
            return {**state,
                    "reply": (f"I couldn't find *{relation}* in your family.\n\n"
                              f"Say *'add my {relation}'* to add them first."),
                    "agent_used": "family_agent"}

        member_name = member.get("name", relation).title()

        # If no specific drug mentioned, ask which medicine
        if not drug:
            # Store family context so next message routes correctly
            await r_set(f"pending_action:{phone}",
                        {"flow": "order", "patient_id": str(member["id"]),
                         "relation": relation, "member_name": member_name},
                        ttl=300)
            return {**state,
                    "reply": f"Which medicine would you like to order for *{member_name}*?",
                    "agent_used": "family_agent",
                    "active_flow": {"flow": "order", "stage": "awaiting_drug",
                                    "drug": "", "patient_id": str(member["id"])}}

        # Drug specified — pass to order flow with patient context
        # Set patient context and pass to order flow
        return {**state,
                "patient_id": str(member["id"]),
                "intent": "order",
                "message": f"order {drug}",
                "reply": None,  # Let order_agent handle
                "agent_used": None}

    else:  # list_members
        members = await get_family_members(uid)
        if not members:
            return {**state,
                    "reply": ("You haven't added any family members yet.\n\n"
                              "Say *'add my sister'* or *'add my mother'* to get started!"),
                    "agent_used": "family_agent"}

        lst = "\n".join(
            f"• *{m.get('name', 'Unknown').title()}* — "
            f"{(m.get('relation') or m['role']).title()} | 📱 {m.get('phone', '?')}"
            for m in members)
        return {**state,
                "reply": (f"👨‍👩‍👧‍👦 *Your Family:*\n\n{lst}\n\n"
                          "Say *'order [medicine] for [name]'* to order for them.\n\n"
                          "✏️ _You can edit family details from the website._"),
                "agent_used": "family_agent"}


async def conversation_agent(state: MedState) -> MedState:
    if state.get("reply"): return state

    user    = state["user"]
    phone   = state["phone"]
    query   = state["message"]
    history = state.get("history", [])
    summary = state.get("session_summary") or ""
    tier    = state.get("risk_tier", 1)
    cde     = state.get("cde_result") or {}
    age     = user.get("age")
    uid     = str(user.get("id", ""))

    # ── Order History Handler ──
    if state.get("intent") == "order_history":
        try:
            orders = await db_fetch(
                """SELECT drug_name, quantity, unit_price, status, ordered_at
                   FROM orders WHERE user_id=$1 OR patient_id=$1
                   ORDER BY ordered_at DESC LIMIT 10""", uid)
            if orders:
                lines = []
                for i, o in enumerate(orders, 1):
                    dt = o["ordered_at"]
                    date_str = dt.strftime("%d %b %Y") if hasattr(dt, 'strftime') else str(dt)[:10]
                    total = round(float(o["unit_price"]) * o["quantity"], 2)
                    lines.append(
                        f"{i}. 💊 *{o['drug_name'].title()}* × {o['quantity']} — ₹{total} "
                        f"({o['status']}) — {date_str}")
                reply = f"📋 *Your Past Orders:*\n\n" + "\n".join(lines)

                # Also show active medications
                active_meds = user.get("current_meds") or []
                if active_meds and active_meds != [None]:
                    meds_list = ", ".join(m.title() for m in active_meds if m)
                    reply += f"\n\n💊 *Currently taking:* {meds_list}"
            else:
                reply = "You haven't placed any orders yet! Say *'order [medicine name]'* to get started."
        except Exception as e:
            logger.error(f"Order history query: {e}")
            reply = "Sorry, I couldn't retrieve your order history right now. Please try again."

        return {**state, "reply": reply, "agent_used": "conversation_agent"}

    # ── Active Medications Handler (includes reminders) ──
    query_l = query.lower()
    active_med_signals = [
        "my med", "active med", "current med", "what am i taking",
        "my medication", "which med", "what medicine am i",
        "active reminder", "my reminder", "my prescription",
        "current prescription", "what medicine",
    ]
    if any(s in query_l for s in active_med_signals):
        sections = []

        # 1. From active_medications table
        try:
            active_meds = await db_fetch(
                "SELECT drug_name, dosage, frequency, meal_instruction FROM active_medications WHERE user_id=$1 AND is_active=TRUE",
                uid)
            if active_meds:
                lines = []
                for m in active_meds:
                    meal = (m.get("meal_instruction") or "after meal").replace("_", " ")
                    lines.append(
                        f"• 💊 *{m['drug_name'].title()}* — {m.get('dosage', '')} "
                        f"({m.get('frequency', '')}) | 🍽️ {meal}")
                sections.append("📋 *Prescribed Medications:*\n" + "\n".join(lines))
        except Exception as e:
            logger.error(f"Active meds query: {e}")

        # 2. From user profile current_meds
        profile_meds = user.get("current_meds") or []
        if profile_meds and profile_meds != [None]:
            existing_names = {m['drug_name'].lower() for m in (active_meds if 'active_meds' in dir() else [])}
            extra = [m.title() for m in profile_meds if m and m.lower() not in existing_names]
            if extra:
                sections.append("💊 *Self-reported:* " + ", ".join(extra))

        # 3. From reminders table (active reminders = active medications)
        try:
            reminders = await db_fetch(
                "SELECT drug_name, dose, remind_times, meal_instruction, end_date FROM reminders WHERE patient_id=$1 AND is_active=TRUE",
                uid)
            if reminders:
                lines = []
                for r in reminders:
                    times_str = ", ".join(r.get("remind_times") or [])
                    meal = (r.get("meal_instruction") or "after meal").replace("_", " ")
                    end = r["end_date"].strftime("%d %b") if r.get("end_date") else "ongoing"
                    lines.append(
                        f"• ⏰ *{r['drug_name'].title()}* — {r.get('dose', '1 tablet')} "
                        f"at {times_str} | 🍽️ {meal} | until {end}")
                sections.append("⏰ *Active Reminders:*\n" + "\n".join(lines))
        except Exception as e:
            logger.error(f"Reminders query: {e}")

        if sections:
            reply = "\n\n".join(sections)
            reply += "\n\n_Say *set reminder for [medicine]* to add more._"
        else:
            reply = ("You don't have any active medications or reminders recorded.\n\n"
                     "💊 Say *set reminder for [medicine]* to start tracking.\n"
                     "📋 When you order medicines, they'll appear here too.")

        return {**state, "reply": reply, "agent_used": "conversation_agent"}

    # ── Allergy / Profile Management Handler ──
    allergy_signals = ["allerg", "my allerg", "what allerg", "which allerg",
                       "add to allerg", "add allerg", "remove allerg", "list allerg",
                       "show allerg"]
    if any(s in query_l for s in allergy_signals):
        current_allergies = user.get("allergies") or []
        llm = get_llm()
        try:
            raw = (await llm.ainvoke([
                SystemMessage(content=(
                    "Analyze the user's message about allergies. Return ONLY valid JSON:\n"
                    '{"action": "list"|"add"|"remove", "items": ["drug1","drug2"] or []}\n'
                    "- 'list' if user wants to see their allergies\n"
                    "- 'add' if user wants to add new allergies\n"
                    "- 'remove' if user wants to remove allergies\n"
                    "If multiple actions, prefer 'add' over 'list'.\n"
                    "Extract drug/substance names to add/remove.")),
                HumanMessage(content=f'Current allergies: {current_allergies}\nMessage: "{query}"')
            ])).content.strip()
            raw = re.sub(r"```json|```", "", raw).strip()
            data = json.loads(raw)

            action = data.get("action", "list")
            items = [i.strip().lower() for i in data.get("items", []) if i.strip()]

            if action == "add" and items:
                new_items = [i for i in items if i not in current_allergies]
                if new_items:
                    combined = current_allergies + new_items
                    await update_user(phone, allergies=combined)
                    reply = (f"✅ Added allergies: *{', '.join(i.title() for i in new_items)}*\n\n"
                             f"📋 *Your allergies:* {', '.join(i.title() for i in combined)}\n\n"
                             "⚠️ I'll flag any medicines that may conflict with these allergies.")
                else:
                    already = ', '.join(i.title() for i in items)
                    reply = (f"*{already}* {'is' if len(items)==1 else 'are'} already in your allergy list.\n\n"
                             f"📋 *Your allergies:* {', '.join(i.title() for i in current_allergies)}")

            elif action == "remove" and items:
                removed = [i for i in items if i in current_allergies]
                remaining = [a for a in current_allergies if a not in items]
                await update_user(phone, allergies=remaining)
                if removed:
                    reply = (f"✅ Removed: *{', '.join(i.title() for i in removed)}*\n\n"
                             f"📋 *Your allergies:* {', '.join(i.title() for i in remaining) or 'none'}")
                else:
                    reply = f"Those items are not in your allergy list.\n\n📋 *Your allergies:* {', '.join(i.title() for i in current_allergies) or 'none'}"

            else:  # list
                if current_allergies:
                    reply = f"📋 *Your allergies:*\n\n" + "\n".join(
                        f"• {a.title()}" for a in current_allergies)
                    reply += "\n\n_Say 'add [medicine] to allergy' or 'remove [medicine] from allergy' to update._"
                else:
                    reply = ("You don't have any allergies recorded. 🎉\n\n"
                             "_Say 'add [medicine] to allergy' to add one._")

        except Exception as e:
            logger.error(f"Allergy management: {e}")
            if current_allergies:
                reply = f"📋 *Your allergies:* {', '.join(a.title() for a in current_allergies)}"
            else:
                reply = "You don't have any allergies recorded."

        return {**state, "reply": reply, "agent_used": "conversation_agent"}

    triage_note = ("⚠️ *Your symptoms seem significant. Please see a doctor soon.*\n\n"
                   if state.get("triage_level") == "high" else "")
    tier_warn   = get_tier_constraints(tier).get("extra_warning", "")

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

    # Follow-up questions: only ask ONE, and only if truly needed.
    # Track pending question in Redis so we can check if user already answered.
    has_symptom = any(kw in query.lower() for kw in C.SYMPTOM_KW)
    follow_up   = ""
    pending_q = await r_get_json(f"pending_question:{phone}")
    if has_symptom and not pending_q:
        if not age:
            follow_up = "\n\n*Could you also tell me your age?* This helps me give safer advice."
            await r_set(f"pending_question:{phone}", {"field": "age", "topic": query[:80]}, ttl=600)
        elif not re.search(r"\d+\s*(day|hour|week|month)", query.lower()):
            follow_up = "\n\n*How long have you had these symptoms?*"
            await r_set(f"pending_question:{phone}", {"field": "duration", "topic": query[:80]}, ttl=600)
    elif pending_q:
        # User is replying to a pending follow-up — check if they answered it
        pq_field = pending_q.get("field", "")
        pq_topic = pending_q.get("topic", "")
        answered = False

        if pq_field == "age" and re.search(r"\d+", query):
            # They gave a number — likely answering the age question
            answered = True
            age_match = re.search(r"\d+", query)
            if age_match:
                try:
                    captured_age = int(age_match.group())
                    if 0 < captured_age < 120:
                        await update_user(phone, age=captured_age)
                        age = captured_age
                        logger.info(f"Captured age={captured_age} from follow-up answer, phone={phone}")
                except (ValueError, TypeError):
                    pass
        elif pq_field == "duration" and re.search(r"\d+\s*(day|hour|week|month|din|ghanta|hafte|mahina)", query.lower()):
            answered = True
            # Duration info will be used in the conversation context naturally
        elif pq_field in ("name", "gender", "allergies"):
            # Profile field from proactive follow-up — _auto_extract_profile handles this
            answered = True

        # Clear the pending question regardless (don't nag)
        await r_del(f"pending_question:{phone}")

        # If they answered with JUST the answer (short reply), enrich query with original topic
        if answered and len(query.split()) <= 4 and pq_topic:
            query = f"{pq_topic} — {query}"
            logger.info(f"Enriched follow-up answer with topic: '{query[:60]}'")

    cde_notes = ""
    if cde.get("warnings"):
        moderate = [w for w in cde["warnings"] if w["severity"] not in ("CRITICAL", "HIGH")]
        if moderate:
            cde_notes = f"\n\n{moderate[0]['text'][:200]}"




    # Inject working memory for richer context
    mem      = state.get("conv_memory") or {}
    mem_note = ""
    if mem.get("last_drug"):
        mem_note += f"\n[Previous drug topic: {mem['last_drug']}]"
    if mem.get("last_topic"):
        mem_note += f"\n[Previous topic: {mem['last_topic']}]"
    if mem.get("last_intent"):
        mem_note += f" [Previous intent: {mem['last_intent']}]"

    # Include recent messages from Redis conv_memory for better follow-up context
    recent_msgs = mem.get("recent_messages", [])
    recent_ctx = ""
    if recent_msgs:
        recent_ctx = "\n".join(
            f"{'User' if m['role']=='user' else 'Bot'}: {m['content'][:200]}"
            for m in recent_msgs[-6:])  # Last 3 exchanges

    # Detect user's language for response
    user_lang = user.get("preferred_language", "en-IN")
    lang_name = {
        "en": "English", "en-IN": "English",
        "hi": "Hindi", "hi-IN": "Hindi",
        "mr": "Marathi", "mr-IN": "Marathi",
        "bn": "Bengali", "bn-IN": "Bengali",
        "ta": "Tamil", "ta-IN": "Tamil",
        "te": "Telugu", "te-IN": "Telugu",
        "gu": "Gujarati", "gu-IN": "Gujarati",
        "kn": "Kannada", "kn-IN": "Kannada",
        "ml": "Malayalam", "ml-IN": "Malayalam",
        "pa": "Punjabi", "pa-IN": "Punjabi",
    }.get(user_lang, "English")

    # Use web-fallback retrieval for richer answers — but SKIP for non-medical queries
    from app.services.web_search import retrieve_with_web_fallback
    from app.core.retrieval import needs_rag
    drug_in_db = bool(state.get("drugs_found"))
    if needs_rag(query):
        rag, web_meta = await retrieve_with_web_fallback(
            query, C.NS_GENERAL, state.get("drugs_found", []),
            drug_in_db, state.get("channel", "whatsapp"))
        ctx = "\n\n---\n".join([r["text"] for r in rag[:3]]) if rag else "No RAG context."
    else:
        logger.info(f"Skipping RAG for non-medical query: '{query[:40]}'")
        rag, web_meta = [], None
        ctx = "No knowledge base lookup needed for this query."

    # Build full history from DB history + recent Redis messages
    if recent_ctx:
        hist_txt = recent_ctx + "\n" + "\n".join(
            f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:150]}"
            for h in history[-2:])  # Only last 2 from DB to avoid duplication
    else:
        hist_txt = "\n".join(
            f"{'User' if h['role']=='user' else 'Bot'}: {h['content'][:150]}"
            for h in history[-4:])
    short    = get_tier_constraints(tier)["short_response"]

    # Build patient context ONLY from data that actually exists (avoid hallucination)
    patient_parts = []
    if age: patient_parts.append(f"Age={age}")
    if user.get('is_pregnant'): patient_parts.append("Pregnant=Yes")
    actual_allergies = user.get('allergies') or []
    if actual_allergies and actual_allergies != [None]:
        patient_parts.append(f"Allergies={actual_allergies}")
    actual_meds = user.get('current_meds') or []
    if actual_meds and actual_meds != [None]:
        patient_parts.append(f"Current Meds={actual_meds}")
    if tier and tier > 1: patient_parts.append(f"Risk Tier={tier}")
    patient_ctx = " | ".join(patient_parts) if patient_parts else "No profile info available yet"

    # Only include summary if it exists and is meaningful
    summary_ctx = ""
    if summary and len(summary.strip()) > 10:
        summary_ctx = f"\nPrevious context: {summary[:250]}\n"

    prompt = (
        "You are BAYMAX, a warm, knowledgeable Medical AI Assistant.\n"
        "Your name is BAYMAX. When asked who you are or what your name is, always introduce yourself as BAYMAX.\n"
        "Rules:\n"
        "- Never diagnose. Suggest doctor for persistent symptoms.\n"
        "- Do NOT ask multiple questions. Ask at most ONE short follow-up question if critically needed, otherwise just answer.\n"
        "- NEVER add symptoms the user did NOT mention. Only discuss what they told you.\n"
        "- Do NOT hallucinate or invent symptoms, conditions, medications, or side effects not in the knowledge base.\n"
        "- Do NOT reference any medications unless the user mentioned them or they are in the conversation history.\n"
        "- Stick strictly to the user's stated complaint or question.\n"
        "- If the user sends a greeting like 'hi' or 'how are you' or asks who you are, respond warmly, introduce yourself as BAYMAX, and ask how you can help. Do NOT mention any medical conditions or medications. Do NOT cite any sources.\n"
        "- IMPORTANT: If the user asks a follow-up like 'how to cure' or 'what to do', "
        "refer to the CONVERSATION HISTORY to understand what topic they are asking about.\n"
        f"- Respond in {lang_name} (same language the user is using).\n"
        f"{'IMPORTANT: Be concise — high-risk patient profile.' if short else ''}\n\n"
        f"Patient: {patient_ctx}{ep_ctx}{mem_note}\n"
        f"{summary_ctx}\n"
        f"Knowledge:\n{ctx}\n\nConversation History:\n{hist_txt}\n\nUser's current message: {query}\n\nAnswer:"
    )
    try:
        llm   = get_llm()
        reply = (await llm.ainvoke([
            SystemMessage(content=(
                f"You are BAYMAX, a safe, helpful Medical AI Assistant. Your name is BAYMAX. Respond in {lang_name}. "
                "When the user asks who you are, introduce yourself as BAYMAX. "
                "Never add information the user did not ask about. "
                "Never mention medications, conditions, or symptoms that are not in the conversation history or the user's current message. "
                "If no conversation history exists, treat this as a fresh conversation — do NOT assume any prior context. "
                "Pay close attention to conversation history for follow-up questions. "
                "Ask at most ONE follow-up question, and only if critically needed.")),
            HumanMessage(content=prompt)
        ])).content
    except Exception as e:
        logger.error(f"conversation_agent: {e}")
        reply = "I couldn't process that. Could you rephrase?"

    # Attach source if web search was used OR RAG sources are available
    # Skip source citation for greetings and non-medical queries
    source_text = ""
    web_source = None
    greeting_words = {"hi", "hello", "hey", "greetings", "namaste", "namaskar",
                      "good morning", "good evening", "good afternoon", "good night",
                      "who are you", "what is your name", "what's your name",
                      "how are you", "sup", "yo"}
    is_greeting_or_identity = any(g in query.lower() for g in greeting_words)
    if not is_greeting_or_identity:
        if web_meta:
            domain = web_meta.get("domain", "")
            source_text = f"\n\n📚 *Source: {domain}*"
            web_source = domain
        elif rag:
            # Attach RAG sources (knowledge base) — extract unique domains/sources
            rag_sources = set()
            for r in rag[:3]:
                src = r.get("source", "")
                if src and src not in ("", "external"):
                    rag_sources.add(src)
            if rag_sources:
                sources_str = ", ".join(sorted(rag_sources)[:3])
                source_text = f"\n\n📚 *Source: {sources_str}*"

    full = triage_note + reply + source_text + cde_notes + follow_up
    if tier_warn:
        full += f"\n\n{tier_warn}"

    # Log web search to DB if used
    if web_meta and uid:
        try:
            await db_execute(
                """INSERT INTO web_search_log (user_id, query, trigger_type, domain_used,
                   result_found, cached, recall_alert)
                   VALUES ($1, $2, $3, $4, TRUE, $5, FALSE)""",
                uid, query[:500], 'fallback', web_meta.get('domain', ''),
                web_meta.get('cached', False))
        except Exception as e:
            logger.debug(f"Web search log: {e}")

    return {**state, "reply": full, "agent_used": "conversation_agent",
            "rag_context": rag, "web_search_used": bool(web_meta),
            "web_search_source": web_source}


# ── Node 7: Drug Info Agent ───────────────────────────────────
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

    # ── If no specific drug found, this is likely a condition/symptom/personal query ──
    # Delegate to conversation_agent which handles active meds, web search, general knowledge
    if not drugs:
        query_l = query.lower()
        # Personal medication queries — user asking about THEIR meds, not a specific drug
        personal_signals = [
            "my med", "active med", "current med", "what am i taking",
            "my medication", "which med", "my reminder", "my prescription",
            "what medicine",
        ]
        if any(s in query_l for s in personal_signals):
            logger.info(f"drug_info_agent: personal medication query → delegating to conversation_agent")
            return await conversation_agent({**state, "intent": "general"})
        # Check if the query is about a condition, symptom, or treatment (not a specific drug)
        condition_signals = [
            "cure", "treat", "treatment", "remedy", "how to", "what is",
            "suffering", "diagnos", "condition", "disease", "disorder",
            "syndrome", "symptom", "cause", "prevent", "manage",
            "exercise", "therapy", "procedure", "maneuver",
        ]
        is_condition_query = any(s in query_l for s in condition_signals)
        if is_condition_query:
            logger.info(f"drug_info_agent: no drugs found + condition query detected → delegating to conversation_agent")
            return await conversation_agent({**state, "intent": "general"})

    asks_dosage = any(w in query.lower() for w in ["dose", "dosage", "how much", "how many mg"])
    follow_up   = ""
    if asks_dosage and not age:
        follow_up = "\n\n*Is this for an adult or a child?*"
    elif asks_dosage and is_child and not weight:
        follow_up = f"\n\n*What is the child's weight in kg?* This helps calculate the correct dose."

    # Check drug info cache first (same drug + query type = same answer)
    cache_key = None
    cached_reply = None
    if drugs:
        query_type = 'dosage' if asks_dosage else 'info'
        cache_key = f"cache:druginfo:{drugs[0].lower()}:{query_type}"
        try:
            from app.db.redis_helpers import r_get_json
            cached = await r_get_json(cache_key)
            if cached:
                logger.info(f"Drug info cache hit: {drugs[0]}")
                cached_reply = cached.get("reply", "")
        except Exception:
            pass

    rag = await retrieve(query, C.NS_DRUGS, top_k=8)

    # ── Check if RAG results are actually relevant to the query ──
    # If RAG returned results but they don't mention the drug we're looking for,
    # the results are irrelevant (Pinecone returned nearest-neighbor noise).
    if drugs and rag:
        drug_l = drugs[0].lower()
        relevant_rag = [r for r in rag if drug_l in r.get("text", "").lower()]
        if not relevant_rag:
            logger.info(f"drug_info_agent: RAG results don't mention '{drugs[0]}' — filtering out irrelevant context")
            rag = []  # Clear irrelevant results

    # ── Web search fallback when RAG has no relevant context ──
    web_meta = None
    if not rag or not any(drugs[0].lower() in r.get("text", "").lower() for r in rag) if drugs else not rag:
        try:
            from app.services.web_search import retrieve_with_web_fallback
            drug_in_db = bool(drugs and await check_stock(drugs[0]))
            search_query = f"{drugs[0]} medicine uses dosage side effects" if drugs else query
            rag_web, web_meta = await retrieve_with_web_fallback(
                search_query, C.NS_GENERAL, drugs, drug_in_db, state.get("channel", "whatsapp"))
            if rag_web:
                rag = rag_web
                logger.info(f"drug_info_agent: web fallback provided context, web_meta={'yes' if web_meta else 'no'}")
        except Exception as e:
            logger.error(f"drug_info_agent web fallback: {e}")

    ctx = "\n\n---\n".join([r["text"] for r in rag[:3]]) if rag else ""

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

    all_warnings   = list(cde.get("warnings", []))
    if drugs and not all_warnings:
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

    # ── If still no context at all, delegate to conversation_agent as last resort ──
    if not ctx and not cached_reply:
        logger.info(f"drug_info_agent: no context found even after web fallback → delegating to conversation_agent")
        return await conversation_agent({**state, "intent": "general"})

    # Use cached reply or generate fresh
    if cached_reply:
        reply = cached_reply
    else:
        # Build patient context only from available data
        di_patient_parts = []
        if age: di_patient_parts.append(f"Age={age}")
        if user.get('is_pregnant'): di_patient_parts.append("Pregnant=Yes")
        if weight: di_patient_parts.append(f"Weight={weight}kg")
        if tier and tier > 1: di_patient_parts.append(f"Risk Tier={tier}")
        di_patient_ctx = " | ".join(di_patient_parts) if di_patient_parts else "No patient profile yet"

        drug_name_for_prompt = drugs[0].title() if drugs else "the requested drug"
        try:
            llm   = get_llm()
            reply = (await llm.ainvoke([
                SystemMessage(content=(
                    "You are a clinical pharmacy information system. Be accurate and concise. "
                    "ONLY provide information about the specific drug the user asked about. "
                    "Do NOT mention or reference any other medications unless the user asked about interactions. "
                    "Base your answer strictly on the provided drug context. "
                    "If the context does not contain relevant info, say so — do NOT invent information.")),
                HumanMessage(content=(
                    f"Drug being asked about: {drug_name_for_prompt}\n\n"
                    f"Drug context from knowledge base:\n{ctx if ctx else 'No information found in knowledge base.'}\n\n"
                    f"Patient: {di_patient_ctx}\n\n"
                    f"User question: {query}\n\n"
                    "Provide information about this specific drug only. "
                    "Use this format:\n"
                    f"💊 *{drug_name_for_prompt}*\n🎯 *Used for:* (from context)\n📏 *Dosage:* (from context)\n"
                    "⏰ *Frequency:* (from context)\n🍽️ *Take:* (from context)\n⚠️ *Key warnings:* (from context)"))
            ])).content
        except:
            reply = ctx[:500] if ctx else f"Sorry, I couldn't find detailed information about {drug_name_for_prompt} right now."

        # Cache the base LLM reply (1hr TTL) — stock/safety are added fresh each time
        if cache_key and reply:
            try:
                from app.db.redis_helpers import r_set as _r_set_cache
                await _r_set_cache(cache_key, {"reply": reply}, ttl=3600)
            except Exception:
                pass

    # Attach web search source if used
    if web_meta:
        domain = web_meta.get("domain", "")
        reply += f"\n\n📚 *Source: {domain}*"

    reply += stock_info + safety_section + follow_up
    if tier_warn:
        reply += f"\n\n{tier_warn}"

    # Set pending action with EXPLICIT stage for deterministic follow-up
    if inv and not critical:
        await r_set(f"pending_action:{state['phone']}",
                    {"stage": "awaiting_confirm", "drug": drugs[0], "inventory": inv},
                    ttl=3000)
        reply += f"\n\n🛒 *Would you like to order {drugs[0].title()}?* Reply *yes* to proceed."
        return {**state, "reply": reply, "agent_used": "drug_info_agent",
                "rag_context": rag, "selected_inv": inv, "requires_action": "order_confirm",
                "web_search_used": bool(web_meta), "web_search_source": web_meta.get("domain") if web_meta else None,
                "safety_flags": [f"{w['severity']}_WARNING" for w in all_warnings]}

    return {**state, "reply": reply, "agent_used": "drug_info_agent",
            "rag_context": rag,
            "web_search_used": bool(web_meta), "web_search_source": web_meta.get("domain") if web_meta else None,
            "safety_flags": [f"{w['severity']}_WARNING" for w in all_warnings]}


# ── Node 8: Safety Agent ──────────────────────────────────────
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

    # Build patient context only from available data
    sa_patient_parts = []
    if user.get('age'): sa_patient_parts.append(f"Age={user.get('age')}")
    if user.get('is_pregnant'): sa_patient_parts.append("Pregnant=Yes")
    if user.get('allergies'): sa_patient_parts.append(f"Allergies={user.get('allergies')}")
    if user.get('current_meds'): sa_patient_parts.append(f"Current Meds={user.get('current_meds')}")
    if tier > 1: sa_patient_parts.append(f"Risk Tier={tier}")
    sa_patient_ctx = ", ".join(sa_patient_parts) if sa_patient_parts else "No profile info"

    channel = state.get("channel", "whatsapp")
    if channel == "sms":
        format_note = "Be direct. Plain text only, no emoji, no bold markers. Keep concise. "
    else:
        format_note = "Be direct. Use WhatsApp *bold* for warnings. "

    try:
        llm   = get_llm()
        reply = (await llm.ainvoke([
            SystemMessage(content="You are a clinical pharmacist. Be precise and safety-first."),
            HumanMessage(content=(
                f"Safety context:\n{ctx}{dup_note}\n\n"
                f"Patient: {sa_patient_ctx}\n\nQ: {query}\n\n"
                f"{format_note}"
                "End: 'Always verify with your doctor.'"))
        ])).content
    except:
        reply = "Safety check unavailable. Consult your pharmacist."

    if tier_warn:
        reply += f"\n\n{tier_warn}"

    return {**state, "reply": reply, "agent_used": "safety_agent",
            "safety_flags": [f"{w['severity']}_WARNING" for w in all_warnings]}


# ═══════════════════════════════════════════════════════════════
# Node 9: Order Agent — DETERMINISTIC STATE MACHINE
# ═══════════════════════════════════════════════════════════════

async def order_agent(state: MedState) -> MedState:
    if state.get("reply"): return state

    user    = state["user"]
    phone   = state["phone"]
    message = state["message"]
    drugs   = state.get("drugs_found", [])
    history = state.get("history", [])
    cde     = state.get("cde_result") or {}
    tier    = state.get("risk_tier", 1)

    if await check_abuse_blocked(str(user["id"])):
        return {**state,
                "reply": "⚠️ We are unable to process this order. Please visit our pharmacy in person.",
                "agent_used": "order_agent",
                "safety_flags": ["ABUSE_HARD_BLOCKED"]}

    # ══════════════════════════════════════════════════════════
    # SMART PATH: Active pending flow — LLM understands response
    # Transaction execution remains deterministic
    # ══════════════════════════════════════════════════════════
    pending = await r_get_json(f"pending_action:{phone}")
    if pending and isinstance(pending, dict):
        drug  = pending.get("drug", "")
        inv   = pending.get("inventory", {})
        stage = pending.get("stage", pending.get("type", "awaiting_confirm"))

        logger.info(f"Order flow: stage={stage} drug={drug} msg='{message[:40]}' phone={phone}")

        # ── Deterministic fast-paths (skip LLM for obvious responses) ──
        msg_stripped = message.strip()
        msg_lower = msg_stripped.lower().rstrip("!.")

        # Pure number during quantity stage → skip LLM entirely
        if stage in ("awaiting_quantity", "order_quantity") and re.fullmatch(r"\d+", msg_stripped):
            qty = int(msg_stripped)
            stock = inv.get("stock_qty", 0)
            if qty > stock:
                return {**state,
                        "reply": (f"Sorry, only *{stock}* {inv.get('unit', 'tablet')}s "
                                  f"are available. Please enter a smaller quantity."),
                        "agent_used": "order_agent",
                        "requires_action": "order_quantity"}
            logger.info(f"Fast-path: quantity {qty} for {drug} (skipped LLM)")
            return await _execute_order_safe(state, drug, inv, user, qty, cde)

        # Clear yes/no during confirm stage → skip LLM
        yes_words = {"yes", "y", "haan", "ha", "ok", "okay", "sure", "proceed", "confirm", "kar do", "karo"}
        no_words = {"no", "n", "nahi", "nah", "cancel", "nope", "rehne do", "mat karo"}
        if stage in ("awaiting_confirm", "order_confirm"):
            if msg_lower in yes_words:
                logger.info(f"Fast-path: confirm yes for {drug} (skipped LLM)")
                await r_set(f"pending_action:{phone}",
                            {**pending, "stage": "awaiting_quantity"}, ttl=3000)
                unit = inv.get("unit", "tablet")
                return {**state,
                        "reply": (f"How many *{unit}s* of "
                                  f"*{inv.get('brand_name', drug).title()}* "
                                  f"would you like?\n\n"
                                  f"📦 Available: {inv.get('stock_qty', '?')} {unit}s  |  "
                                  f"💰 ₹{inv.get('price_per_unit', '?')}/{unit}"),
                        "agent_used": "order_agent",
                        "requires_action": "order_quantity"}
            if msg_lower in no_words:
                logger.info(f"Fast-path: cancel order for {drug} (skipped LLM)")
                await r_del(f"pending_action:{phone}")
                return {**state,
                        "reply": "No problem! Let me know if you need anything else. 😊",
                        "agent_used": "order_agent"}

        # Use LLM to understand the user's response (fallback for ambiguous messages)
        understood = await _llm_understand_response(message, drug, stage, history)
        logger.info(f"LLM understood: {understood}")

        # If message is unrelated to this order, let it fall through
        if understood["unrelated"]:
            logger.info(f"Message unrelated to pending order — clearing bypass")
            # Don't clear pending action — it stays for when user comes back
            # Fall through to fresh order logic (which will see no drugs and ask)
            pass
        else:
            # ── Stage: awaiting_confirm ──
            if stage in ("awaiting_confirm", "order_confirm"):
                if understood["is_confirm"] or understood["quantity"]:
                    qty = understood["quantity"]
                    if qty:
                        # User confirmed AND gave quantity in one message
                        return await _execute_order_safe(state, drug, inv, user, int(qty), cde)
                    # Move to quantity stage
                    await r_set(f"pending_action:{phone}",
                                {**pending, "stage": "awaiting_quantity"}, ttl=3000)
                    unit = inv.get("unit", "tablet")
                    return {**state,
                            "reply": (f"How many *{unit}s* of "
                                      f"*{inv.get('brand_name', drug).title()}* "
                                      f"would you like?\n\n"
                                      f"📦 Available: {inv.get('stock_qty', '?')} {unit}s  |  "
                                      f"💰 ₹{inv.get('price_per_unit', '?')}/{unit}"),
                            "agent_used": "order_agent",
                            "requires_action": "order_quantity"}

                elif understood["is_cancel"]:
                    await r_del(f"pending_action:{phone}")
                    return {**state,
                            "reply": "No problem! Let me know if you need anything else. 😊",
                            "agent_used": "order_agent"}

                else:
                    # LLM couldn't determine — re-ask naturally
                    return {**state,
                            "reply": (f"Would you like to order *{inv.get('brand_name', drug).title()}*?\n\n"
                                      "Reply *yes* to proceed or *no* to cancel."),
                            "agent_used": "order_agent",
                            "requires_action": "order_confirm"}

            # ── Stage: awaiting_quantity ──
            elif stage in ("awaiting_quantity", "order_quantity"):
                if understood["is_cancel"]:
                    await r_del(f"pending_action:{phone}")
                    return {**state,
                            "reply": "Order cancelled. Let me know if you need anything else.",
                            "agent_used": "order_agent"}

                qty = understood["quantity"] or _parse_quantity(message)  # LLM + regex fallback
                if qty:
                    qty = int(qty)
                    stock = inv.get("stock_qty", 0)
                    if qty > stock:
                        return {**state,
                                "reply": (f"Sorry, only *{stock}* {inv.get('unit', 'tablet')}s "
                                          f"are available. Please enter a smaller quantity."),
                                "agent_used": "order_agent",
                                "requires_action": "order_quantity"}
                    if qty < 1:
                        return {**state,
                                "reply": "Please enter a valid quantity (1 or more).",
                                "agent_used": "order_agent",
                                "requires_action": "order_quantity"}

                    # ── Dosage safety cap check on quantity stage ──
                    dosage_cap = await get_dosage_cap(drug)
                    if dosage_cap:
                        max_daily = dosage_cap.get("adult_max_daily_mg", 0)
                        strength_str = inv.get("strength", "500mg")
                        strength_m = re.search(r"(\d+)", str(strength_str))
                        per_unit_mg = int(strength_m.group(1)) if strength_m else 500
                        if max_daily and per_unit_mg:
                            max_per_day = max_daily / per_unit_mg
                            max_30d = int(max_per_day * 30)
                            if qty > max_30d:
                                return {**state,
                                        "reply": (f"⚠️ *Dosage Warning:* {qty} {inv.get('unit','tablet')}s "
                                                  f"exceeds the *30-day safe supply* "
                                                  f"(max ~{max_30d} {inv.get('unit','tablet')}s).\n\n"
                                                  f"📝 Max daily: {max_daily}mg | Per {inv.get('unit','tablet')}: {per_unit_mg}mg\n\n"
                                                  f"Please enter a smaller quantity (≤{max_30d})."),
                                        "agent_used": "order_agent",
                                        "safety_flags": ["DOSAGE_EXCESSIVE"],
                                        "requires_action": "order_quantity"}

                    # ✅ EXECUTE ORDER
                    return await _execute_order_safe(state, drug, inv, user, qty, cde)

                # Could not extract quantity
                return {**state,
                        "reply": (f"Please tell me how many *{inv.get('unit', 'tablet')}s* "
                                  f"of *{inv.get('brand_name', drug).title()}* you'd like.\n\n"
                                  f"_(e.g. *10* or *10 tablets*)_"),
                        "agent_used": "order_agent",
                        "requires_action": "order_quantity"}

            # ── Stage: awaiting_dup_confirm (duplicate order) ──
            elif stage == "awaiting_dup_confirm":
                if understood["is_confirm"]:
                    dup_data = await r_get_json(f"dup_override:{phone}")
                    if dup_data:
                        await r_del(f"dup_override:{phone}")
                        await r_del(f"pending_action:{phone}")
                        override_qty = dup_data.get("qty", 10)
                        override_inv = dup_data.get("inv", inv)
                        return await _execute_order_safe(state, drug, override_inv, user, override_qty, cde)
                    # Fallback — just execute
                    return await _execute_order_safe(state, drug, inv, user, 10, cde)
                elif understood["is_cancel"]:
                    await r_del(f"pending_action:{phone}")
                    await r_del(f"dup_override:{phone}")
                    return {**state,
                            "reply": "Order cancelled. Let me know if you need anything else.",
                            "agent_used": "order_agent"}

    # ══════════════════════════════════════════════════════════
    # FRESH ORDER: No pending state — standard flow
    # ══════════════════════════════════════════════════════════
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
        # Check if user mentioned a symptom — suggest relevant OTC medicines
        symptom_medicine_map = {
            "fever":     ("analgesic",       "fever"),
            "headache":  ("analgesic",       "headaches"),
            "pain":      ("analgesic",       "pain"),
            "body ache": ("analgesic",       "body ache"),
            "cold":      ("antihistamine",   "cold"),
            "allergy":   ("antihistamine",   "allergies"),
            "cough":     ("bronchodilator",  "cough"),
            "acidity":   ("ppi",             "acidity"),
            "gas":       ("ppi",             "gas/acidity"),
            "stomach":   ("ppi",             "stomach issues"),
            "vomit":     ("antiemetic",      "nausea/vomiting"),
            "nausea":    ("antiemetic",      "nausea"),
            "diarr":     ("rehydration",     "diarrhea"),
        }
        msg_l = message.lower()
        matched_symptom = None
        for symptom_kw, (category, label) in symptom_medicine_map.items():
            if symptom_kw in msg_l:
                matched_symptom = (category, label)
                break

        if matched_symptom:
            cat, label = matched_symptom
            try:
                suggestions = await db_fetch(
                    """SELECT drug_name, brand_name, strength, price_per_unit, is_otc
                       FROM inventory
                       WHERE category = $1 AND is_active = TRUE AND stock_qty > 0
                       ORDER BY times_ordered DESC, price_per_unit ASC LIMIT 3""", cat)
                if suggestions:
                    lines = []
                    for i, s in enumerate(suggestions, 1):
                        otc = "✅ No Rx" if s["is_otc"] else "📋 Rx needed"
                        lines.append(
                            f"{i}. 💊 *{s['brand_name']}* ({s['drug_name'].title()} {s['strength']}) "
                            f"— ₹{s['price_per_unit']} | {otc}")
                    reply = (
                        f"Here are some medicines for *{label}*:\n\n"
                        + "\n".join(lines)
                        + "\n\nReply with the medicine name to order (e.g. *order Crocin*).\n"
                        "_⚕️ Consult a doctor if symptoms persist._")
                    return {**state, "reply": reply, "agent_used": "order_agent"}
            except Exception as e:
                logger.error(f"Symptom suggestion: {e}")

        return {**state,
                "reply": "Which medicine would you like to order? You can say the name or describe your symptom (e.g. *order paracetamol* or *medicine for headache*)",
                "agent_used": "order_agent"}

    abuse = await update_abuse_score(str(user["id"]), drug_name, [], message)
    if abuse["block"]:
        return {**state,
                "reply": "⚠️ Unable to process this order. Please visit our pharmacy in person.",
                "agent_used": "order_agent",
                "safety_flags": ["ABUSE_HARD_BLOCKED"]}

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

    warn_note = ""
    if cde.get("warnings"):
        moderate = [w for w in cde["warnings"] if w["severity"] not in ("CRITICAL", "HIGH")]
        if moderate:
            warn_note = f"\n\n💡 *Note:* {moderate[0]['text'][:150]}"
    if cde.get("dup_therapy"):
        warn_note += f"\n\n⚠️ *Duplicate Therapy:* {cde['dup_therapy'][:120]}"

    # ── Try to extract quantity from the initial message ──
    qty_from_msg = _parse_quantity(message)
    profile_ok = bool(user.get("name")) and user.get("age") is not None

    if qty_from_msg and profile_ok:
        # ── Dosage safety cap check ──
        dosage_cap = await get_dosage_cap(drug_name)
        max_qty = None
        safety_warning = ""
        if dosage_cap:
            max_daily = dosage_cap.get("adult_max_daily_mg", 0)
            strength_str = inv.get("strength", "500mg")
            strength_m = re.search(r"(\d+)", str(strength_str))
            per_unit_mg = int(strength_m.group(1)) if strength_m else 500
            if max_daily and per_unit_mg:
                max_per_day = max_daily // per_unit_mg
                # Max reasonable order = 30 days supply
                max_qty = max_per_day * 30
                if qty_from_msg > max_qty:
                    safety_warning = (
                        f"\n\n⚠️ *Safety Notice:* {qty_from_msg} {inv['unit']}s of "
                        f"{drug_name.title()} ({strength_str}) exceeds the recommended "
                        f"30-day supply (max ~{max_qty} {inv['unit']}s based on "
                        f"{max_daily}mg/day max dose).")

        # Stock check
        stock = inv.get("stock_qty", 0)
        if qty_from_msg > stock:
            return {**state,
                    "reply": (f"😔 Only *{stock}* {inv['unit']}s of "
                              f"*{inv.get('brand_name', drug_name).title()}* are available."
                              f"\n\nWould you like to order {stock} instead?"),
                    "agent_used": "order_agent"}

        if safety_warning:
            # Excessive quantity — warn and ask to confirm
            await r_set(f"pending_action:{phone}",
                        {"stage": "awaiting_confirm", "drug": drug_name,
                         "inventory": inv, "requested_qty": qty_from_msg}, ttl=300)
            return {**state,
                    "reply": (f"⚠️ *{inv.get('brand_name', drug_name).title()}*{safety_warning}"
                              f"\n\nWould you still like to proceed with *{qty_from_msg}* {inv['unit']}s? "
                              f"Reply *yes* to confirm or a different quantity."),
                    "agent_used": "order_agent",
                    "safety_flags": ["DOSAGE_WARNING"]}

        # ✅ All checks pass — execute directly!
        logger.info(f"Direct order: {drug_name} x{qty_from_msg} for {phone} (profile OK, dosage OK)")
        return await _execute_order_safe(state, drug_name, inv, user, qty_from_msg, cde)

    # ── Quantity not in message or profile incomplete — ask ──
    profile_note = ""
    if not profile_ok:
        missing = []
        if not user.get("name"): missing.append("name")
        if user.get("age") is None: missing.append("age")
        profile_note = (f"\n\n📝 *To process orders, I need your {' and '.join(missing)}.* "
                        f"Please share {'it' if len(missing)==1 else 'them'} to continue.")

    await r_set(f"pending_action:{phone}",
                {"stage": "awaiting_quantity", "drug": drug_name, "inventory": inv},
                ttl=300)

    return {**state,
            "reply": (f"✅ *{inv.get('brand_name',drug_name).title()}* — In Stock\n\n"
                      f"📦 {inv['stock_qty']} {inv['unit']}s  |  "
                      f"💰 ₹{inv['price_per_unit']}/{inv['unit']}{warn_note}\n\n"
                      f"How many {inv['unit']}s would you like? _(e.g. *10*)_{profile_note}"),
            "agent_used": "order_agent",
            "requires_action": "order_quantity",
            "selected_inv": inv}


async def _execute_order_safe(state: MedState, drug_name: str, inv: dict,
                               user: dict, qty: int, cde: dict = None) -> MedState:
    """Transaction-safe order with full safety pre-checks."""
    phone      = state["phone"]
    patient_id = state.get("patient_id") or str(user["id"])
    pool       = await get_pool()
    uid        = str(user["id"])

    # ── SAFETY PRE-CHECK 1: Re-run CDE if not available ──
    if not cde or not cde.get("warnings") is not None:
        cde = await run_cde(user, drug_name)
        if cde["block"]:
            critical = [w for w in cde["warnings"] if w["severity"] == "CRITICAL"]
            msg = critical[0]["text"] if critical else "Safety concern detected."
            await r_del(f"pending_action:{phone}")
            return {**state,
                    "reply": f"⛔ *Order Blocked*\n\n{msg}\n\nPlease consult your doctor.",
                    "agent_used": "order_agent",
                    "safety_flags": ["CDE_BLOCKED_AT_EXECUTION"]}

    # ── SAFETY PRE-CHECK 2: Duplicate order detection ──
    dup = await check_duplicate_order(uid, drug_name, patient_id)
    if dup:
        dup_qty = dup.get("quantity", 0)
        dup_status = dup.get("status", "pending")
        dup_time = dup.get("ordered_at", "")
        time_str = dup_time.strftime("%h:%M %p") if hasattr(dup_time, 'strftime') else str(dup_time)[:16]

        # Check if there's a pending_confirm for duplicate override
        dup_override = await r_get_json(f"dup_override:{phone}")
        if not dup_override:
            await r_set(f"dup_override:{phone}",
                        {"drug": drug_name, "qty": qty, "inv": inv, "patient_id": patient_id},
                        ttl=300)
            await r_set(f"pending_action:{phone}",
                        {"stage": "awaiting_dup_confirm", "drug": drug_name, "inventory": inv},
                        ttl=300)
            return {**state,
                    "reply": (f"⚠️ *Duplicate Order Detected!*\n\n"
                              f"You already ordered *{drug_name.title()}* × {dup_qty} "
                              f"({dup_status}) at {time_str}.\n\n"
                              f"Are you sure you want to order *{qty}* more? "
                              f"Reply *yes* to confirm or *no* to cancel."),
                    "agent_used": "order_agent",
                    "safety_flags": ["DUPLICATE_ORDER_WARNING"],
                    "requires_action": "dup_confirm"}

    # ── SAFETY PRE-CHECK 3: Dosage cap final check ──
    dosage_cap = await get_dosage_cap(drug_name)
    if dosage_cap:
        max_daily = dosage_cap.get("adult_max_daily_mg", 0)
        strength_str = inv.get("strength", "500mg")
        strength_m = re.search(r"(\d+)", str(strength_str))
        per_unit_mg = int(strength_m.group(1)) if strength_m else 500
        if max_daily and per_unit_mg:
            max_per_day = max_daily / per_unit_mg
            max_30d = int(max_per_day * 30)
            if qty > max_30d:
                await r_del(f"pending_action:{phone}")
                return {**state,
                        "reply": (f"⛔ *Order Blocked — Quantity Exceeds Safe Limit*\n\n"
                                  f"{qty} {inv.get('unit','tablet')}s exceeds the 30-day max "
                                  f"({max_30d} {inv.get('unit','tablet')}s).\n"
                                  f"Max daily dose: {max_daily}mg\n\n"
                                  f"Please order ≤{max_30d} {inv.get('unit','tablet')}s."),
                        "agent_used": "order_agent",
                        "safety_flags": ["DOSAGE_BLOCKED"]}

    # ── Build CDE warning text for the confirmation reply ──
    cde_warn_text = ""
    if cde and cde.get("warnings"):
        non_critical = [w for w in cde["warnings"] if w["severity"] not in ("CRITICAL",)]
        if non_critical:
            cde_warn_text = "\n\n⚠️ *Safety Notes:*\n" + "\n".join(
                f"• {w['text'][:150]}" for w in non_critical[:3])

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

    # ✅ ALWAYS clear pending action after successful order
    await r_del(f"pending_action:{phone}")
    logger.info(f"Order executed: drug={drug_name} qty={qty} phone={phone}")

    # Check if this is a reorder (user already has an active reminder for this drug)
    pending_reorder = await r_get_json(f"pending_reorder:{phone}")
    is_reorder = False
    if pending_reorder and pending_reorder.get("drug", "").lower() == drug_name.lower():
        is_reorder = True
        # Update the existing reminder's qty_remaining with new quantity
        existing_reminder_id = pending_reorder.get("reminder_id")
        if existing_reminder_id:
            await pool.execute(
                "UPDATE reminders SET qty_remaining=qty_remaining+$2, total_qty=total_qty+$2, updated_at=NOW() WHERE id=$1",
                existing_reminder_id, qty)
            logger.info(f"Reorder: updated reminder {existing_reminder_id} qty +{qty}")
        await r_del(f"pending_reorder:{phone}")

    total = round(float(locked["price_per_unit"]) * qty, 2)

    if is_reorder:
        # Reorder — no reminder prompt, just confirmation
        return {**state,
                "reply": (f"🎉 *Reorder Placed!*\n\n"
                          f"💊 *{inv.get('brand_name',drug_name).title()}*\n"
                          f"📦 {qty} {inv.get('unit','tablet')}s  |  💰 ₹{total}\n\n"
                          f"Your existing daily intake reminder has been updated with the new stock. "
                          f"No need to set a new reminder! ✅"
                          f"{cde_warn_text}"),
                "agent_used": "order_agent",
                "order_record": dict(order)}

    await r_set(f"pending_order:{phone}",
                {"order_id": str(order["id"]), "drug": drug_name, "qty": qty,
                 "meal_inst": meal_inst, "times": times, "patient_id": patient_id,
                 "freq_key": freq_key}, ttl=1800)

    return {**state,
            "reply": (f"🎉 *Order Placed!*\n\n"
                      f"💊 *{inv.get('brand_name',drug_name).title()}*\n"
                      f"📦 {qty} {inv.get('unit','tablet')}s  |  💰 ₹{total}\n"
                      f"🍽️ Take: *{meal_inst.replace('_',' ')}*"
                      f"{cde_warn_text}\n\n"
                      f"⏰ *Set dose reminders?*\n"
                      f"Suggested times: {', '.join(times)}\n"
                      f"Reply *yes* to use these, or send your preferred times _(e.g. '9am 9pm')_."),
            "agent_used": "order_agent",
            "order_record": dict(order),
            "requires_action": "reminder_setup"}


# ── Node 10: Reminder Agent ───────────────────────────────────
async def reminder_agent(state: MedState) -> MedState:
    """
    Step-by-step reminder flow:
      Step 1 (drug)  → extract medicine name
      Step 2 (time)  → ask how many times/day + at what times
      Step 3 (days)  → ask for how many days
      Step 4 (meal)  → ask meal instruction
      Step 5         → confirm & schedule via cron scheduler → WhatsApp

    Edit support: user can say "change time to 9am" at confirmation step.
    Cancel: user says "cancel" at any step.
    List:   if no drug mentioned and no pending flow, show active reminders.
    """
    if state.get("reply"):
        return state

    phone   = state["phone"]
    user    = state["user"]
    message = state["message"]
    msg_l   = message.strip().lower()

    # ── Cancel at any step ──
    if msg_l in ("cancel", "no", "nahi", "nako", "stop", "rehne do", "mat karo", "mat"):
        await r_del(f"reminder_step:{phone}")
        return {**state,
                "reply": "❌ Reminder setup cancelled. Say *set reminder* anytime to start again.",
                "agent_used": "reminder_agent"}

    # ── Load current step from Redis ──
    step_data = await r_get_json(f"reminder_step:{phone}") or {}
    current_step = step_data.get("step", "")

    # ──────────────────────────────────────────────────────────
    # STEP: edit — user wants to change a detail at confirmation
    # ──────────────────────────────────────────────────────────
    if current_step == "confirm":
        drug     = step_data["drug"]
        times    = step_data["times"]
        days     = step_data["days"]
        meal     = step_data["meal"]

        # Accept confirmation
        if msg_l in ("yes", "y", "ok", "okay", "sure", "haan", "ha", "confirm", "done", "set", "theek hai", "kar do"):
            return await _create_reminder_v2(state, step_data)

        # ── Edit: change time ──
        new_times = _parse_times(message)
        if new_times:
            ordinal_match = re.search(r"(first|1st|second|2nd|third|3rd|fourth|4th)", msg_l)
            current_times = step_data.get("times", [])

            if ordinal_match and len(new_times) == 1 and len(current_times) > 1:
                ordinal_map = {"first": 0, "1st": 0, "second": 1, "2nd": 1,
                               "third": 2, "3rd": 2, "fourth": 3, "4th": 3}
                idx = ordinal_map.get(ordinal_match.group(1), 0)
                if idx < len(current_times):
                    current_times[idx] = new_times[0]
                    current_times.sort()
                    step_data["times"] = current_times
                else:
                    step_data["times"] = new_times
            else:
                step_data["times"] = new_times

            step_data["dosage_per_day"] = len(step_data["times"])
            await r_set(f"reminder_step:{phone}", step_data, ttl=1800)
            return {**state,
                    "reply": _build_confirmation(step_data),
                    "agent_used": "reminder_agent"}

        # ── Edit: change days ──
        days_val = _parse_days(message)
        if days_val:
            step_data["days"] = days_val
            await r_set(f"reminder_step:{phone}", step_data, ttl=1800)
            return {**state,
                    "reply": _build_confirmation(step_data),
                    "agent_used": "reminder_agent"}

        # ── Edit: change meal instruction ──
        new_meal = _parse_meal(message)
        if new_meal:
            step_data["meal"] = new_meal
            await r_set(f"reminder_step:{phone}", step_data, ttl=1800)
            return {**state,
                    "reply": _build_confirmation(step_data),
                    "agent_used": "reminder_agent"}

        # Unrecognised — re-show confirmation
        return {**state,
                "reply": ("I didn't understand that. You can:\n"
                          "• Reply *yes* to confirm\n"
                          "• Send new times (e.g. *9am 9pm*)\n"
                          "• Send new duration (e.g. *5 days*)\n"
                          "• Change meal (e.g. *before meal*)\n"
                          "• Reply *cancel* to abort\n\n"
                          + _build_confirmation(step_data)),
                "agent_used": "reminder_agent"}

    # ──────────────────────────────────────────────────────────
    # STEP: days — user is providing duration (also handles time edits)
    # ──────────────────────────────────────────────────────────
    if current_step == "time_done":
        # ── Check for time edit first ──
        edit_time_signals = any(w in msg_l for w in (
            "edit", "change", "update", "modify", "badal", "replace",
            "shift", "move", "set time", "new time",
        ))
        new_times = _parse_times(message)

        if (edit_time_signals or new_times) and new_times:
            # User wants to change time(s) — could be replacing one or all
            # Parse which time to replace: "change first time to 17:50"
            ordinal_match = re.search(r"(first|1st|second|2nd|third|3rd|fourth|4th)", msg_l)
            current_times = step_data.get("times", [])

            if ordinal_match and len(new_times) == 1 and len(current_times) > 1:
                ordinal_map = {"first": 0, "1st": 0, "second": 1, "2nd": 1,
                               "third": 2, "3rd": 2, "fourth": 3, "4th": 3}
                idx = ordinal_map.get(ordinal_match.group(1), 0)
                if idx < len(current_times):
                    current_times[idx] = new_times[0]
                    current_times.sort()
                    step_data["times"] = current_times
                else:
                    step_data["times"] = new_times
            else:
                # Replace all times with the new ones
                step_data["times"] = new_times

            step_data["dosage_per_day"] = len(step_data["times"])
            await r_set(f"reminder_step:{phone}", step_data, ttl=1800)

            return {**state,
                    "reply": (f"✅ Updated! *{step_data['dosage_per_day']}x daily* for *{step_data['drug'].title()}* "
                              f"at {', '.join(step_data['times'])}\n\n"
                              f"📅 *For how many days?*\n_(e.g. '3 days', '1 week', '2 weeks')_"),
                    "agent_used": "reminder_agent"}

        # ── Parse days (normal flow) ──
        days_val = _parse_days(message)
        if not days_val:
            return {**state,
                    "reply": "📅 *How many days should the reminder run?*\n\n_(e.g. '7 days', '2 weeks', '1 month')_",
                    "agent_used": "reminder_agent"}

        drug = step_data["drug"]
        meal = step_data.get("meal", C.MEAL_INST.get(drug.lower(), "after_meal"))

        step_data["step"] = "confirm"
        step_data["days"] = days_val
        step_data["meal"] = meal
        await r_set(f"reminder_step:{phone}", step_data, ttl=1800)

        return {**state,
                "reply": _build_confirmation(step_data),
                "agent_used": "reminder_agent"}

    # ──────────────────────────────────────────────────────────
    # STEP: time — user is providing times
    # ──────────────────────────────────────────────────────────
    if current_step == "awaiting_time":
        drug = step_data["drug"]
        suggested = step_data.get("suggested_times", ["08:00", "20:00"])

        # Accept suggestion
        if msg_l in ("yes", "y", "ok", "okay", "sure", "haan", "ha"):
            parsed_times = suggested
        else:
            parsed_times = _parse_times(message)

        if not parsed_times:
            return {**state,
                    "reply": (f"⏰ *What time(s) should I remind you for *{drug.title()}*?*\n\n"
                              f"Suggested: {', '.join(suggested)}\n\n"
                              "Reply *yes* to use these, or send your times _(e.g. '9am', '8am 2pm 10pm')_"),
                    "agent_used": "reminder_agent"}

        dosage_per_day = len(parsed_times)
        step_data["step"] = "time_done"
        step_data["times"] = parsed_times
        step_data["dosage_per_day"] = dosage_per_day
        await r_set(f"reminder_step:{phone}", step_data, ttl=1800)

        return {**state,
                "reply": (f"✅ *{dosage_per_day}x daily* at {', '.join(parsed_times)}\n\n"
                          f"📅 *For how many days?*\n_(e.g. '3 days', '1 week', '2 weeks')_"),
                "agent_used": "reminder_agent"}

    # ──────────────────────────────────────────────────────────
    # STEP: initial — extract drug name and start flow
    # ──────────────────────────────────────────────────────────

    # Check if coming from order_agent (pending_order has drug info)
    pending_order = await r_get_json(f"pending_order:{phone}")
    if pending_order and isinstance(pending_order, dict) and pending_order.get("drug"):
        drug_name = pending_order["drug"]
        suggested_times = pending_order.get("times", C.FREQ_TIMES.get("twice_daily", ["08:00", "20:00"]))
        meal = pending_order.get("meal_inst", C.MEAL_INST.get(drug_name.lower(), "after_meal"))
        qty = pending_order.get("qty", 30)

        # Accept yes → use suggested times and auto-calculate days
        if msg_l in ("yes", "y", "ok", "okay", "sure", "haan", "ha"):
            days = max(3, qty // max(len(suggested_times), 1))
            step_data = {
                "step": "confirm",
                "drug": drug_name,
                "times": suggested_times,
                "days": days,
                "meal": meal,
                "dosage_per_day": len(suggested_times),
                "order_id": pending_order.get("order_id"),
                "patient_id": pending_order.get("patient_id", str(user["id"])),
                "qty": qty,
            }
            await r_set(f"reminder_step:{phone}", step_data, ttl=1800)
            await r_del(f"pending_order:{phone}")
            return {**state,
                    "reply": _build_confirmation(step_data),
                    "agent_used": "reminder_agent"}

        step_data = {
            "step": "awaiting_time",
            "drug": drug_name,
            "suggested_times": suggested_times,
            "order_id": pending_order.get("order_id"),
            "patient_id": pending_order.get("patient_id", str(user["id"])),
            "qty": qty,
            "meal": meal,
        }
        await r_set(f"reminder_step:{phone}", step_data, ttl=1800)
        await r_del(f"pending_order:{phone}")

        return {**state,
                "reply": (f"⏰ *Setting reminder for *{drug_name.title()}**\n\n"
                          f"*What time(s) should I remind you?*\n"
                          f"Suggested: {', '.join(suggested_times)}\n\n"
                          "Reply *yes* to use these, or send your times _(e.g. '9am', '8am 2pm 9pm')_"),
                "agent_used": "reminder_agent"}

    # ── Detect edit/change intent with NO active flow (expired state) ──
    edit_signals = any(w in msg_l for w in (
        "edit", "change", "update", "modify", "badal", "replace",
        "shift", "move", "new time",
    ))
    if edit_signals and not current_step:
        return {**state,
                "reply": ("⚠️ Your reminder setup session has expired.\n\n"
                          "Please start again — say *set reminder for [medicine]*\n"
                          "You can include everything in one message, e.g.:\n"
                          "_set reminder for Crocin at 5:30pm and 7pm for 5 days_"),
                "agent_used": "reminder_agent"}

    # ── Extract drug from message ──
    # Use LLM first so the user's exact name is preserved (e.g. "Crocin" not "Paracetamol")
    drug_to_remind = None
    llm = get_llm()
    try:
        extracted = (await llm.ainvoke([
            SystemMessage(content="Extract the medicine/supplement name from this text. Return ONLY the exact name the user mentioned. If none found, return 'None'."),
            HumanMessage(content=f"Text: '{message}'")
        ])).content.strip().strip('"').strip("'")
        if extracted and extracted.lower() not in ("none", "null", "n/a", ""):
            drug_to_remind = extracted.title()
    except Exception as e:
        logger.error(f"Drug extraction for reminder: {e}")

    # Fallback to inventory match (returns generic names)
    if not drug_to_remind and state.get("drugs_found"):
        drug_to_remind = state["drugs_found"][0].title()

    if drug_to_remind:
        # ── Verify the medicine exists in user's order history ──
        uid = str(user["id"])
        pool = await get_pool()
        order_row = await pool.fetchrow(
            """SELECT id, drug_name, quantity, status, ordered_at
               FROM orders
               WHERE (user_id=$1 OR patient_id=$1)
                 AND LOWER(drug_name) = LOWER($2)
               ORDER BY ordered_at DESC LIMIT 1""",
            uid, drug_to_remind)

        if not order_row:
            # No order found — check with fuzzy match (partial name)
            order_row = await pool.fetchrow(
                """SELECT id, drug_name, quantity, status, ordered_at
                   FROM orders
                   WHERE (user_id=$1 OR patient_id=$1)
                     AND LOWER(drug_name) LIKE '%' || LOWER($2) || '%'
                   ORDER BY ordered_at DESC LIMIT 1""",
                uid, drug_to_remind)

        if not order_row:
            # Show user their ordered medicines they CAN set reminders for
            past_orders = await pool.fetch(
                """SELECT DISTINCT drug_name FROM orders
                   WHERE (user_id=$1 OR patient_id=$1)
                   ORDER BY drug_name LIMIT 10""", uid)
            if past_orders:
                med_list = "\n".join(f"  • 💊 *{o['drug_name'].title()}*" for o in past_orders)
                return {**state,
                        "reply": (f"❌ Sorry, I can't set a reminder for *{drug_to_remind}* because "
                                  f"you haven't ordered it yet.\n\n"
                                  f"You can only set reminders for medicines you've ordered.\n\n"
                                  f"📋 *Your ordered medicines:*\n{med_list}\n\n"
                                  f"Say *set reminder for [medicine name]* from the list above,\n"
                                  f"or *order {drug_to_remind}* to order it first."),
                        "agent_used": "reminder_agent"}
            else:
                return {**state,
                        "reply": (f"❌ You haven't placed any orders yet.\n\n"
                                  f"You can only set reminders for medicines you've ordered.\n\n"
                                  f"Say *order {drug_to_remind}* to place an order first, "
                                  f"then I'll help you set up a reminder! 😊"),
                        "agent_used": "reminder_agent"}

        # Order found — use it for the reminder
        matched_order_id = str(order_row["id"])
        matched_drug_name = order_row["drug_name"].title()
        matched_qty = order_row["quantity"]

        # ── Check if times / days / meal are ALREADY in this message ──
        inline_times = _parse_times(message)
        inline_days  = _parse_days(message)
        inline_meal  = _parse_meal(message)

        default_meal = C.MEAL_INST.get(drug_to_remind.lower(), "after_meal")

        # ── If times were provided inline, skip the time step ──
        if inline_times:
            step_data = {
                "drug": matched_drug_name,
                "times": inline_times,
                "dosage_per_day": len(inline_times),
                "order_id": matched_order_id,
                "patient_id": str(user["id"]),
                "qty": matched_qty,
                "meal": inline_meal or default_meal,
            }

            if inline_days:
                # Times AND days provided — go straight to confirmation
                step_data["step"] = "confirm"
                step_data["days"] = inline_days
                await r_set(f"reminder_step:{phone}", step_data, ttl=1800)
                return {**state,
                        "reply": _build_confirmation(step_data),
                        "agent_used": "reminder_agent"}
            else:
                # Times provided but no days — ask for days
                step_data["step"] = "time_done"
                await r_set(f"reminder_step:{phone}", step_data, ttl=1800)
                return {**state,
                        "reply": (f"✅ *{step_data['dosage_per_day']}x daily* for *{matched_drug_name}* "
                                  f"at {', '.join(inline_times)}\n\n"
                                  f"📅 *For how many days?*\n_(e.g. '3 days', '1 week', '2 weeks')_"),
                        "agent_used": "reminder_agent"}

        # ── No times in message — ask for times (existing flow) ──
        suggested_times = C.FREQ_TIMES.get("twice_daily", ["08:00", "20:00"])
        try:
            freq_rag = await retrieve(f"{drug_to_remind} dosage frequency times per day", C.NS_DRUGS, top_k=3)
            if freq_rag:
                t = freq_rag[0]["text"].lower()
                if "thrice" in t or "three time" in t:
                    suggested_times = C.FREQ_TIMES.get("thrice_daily", suggested_times)
                elif "four" in t or "4 time" in t:
                    suggested_times = C.FREQ_TIMES.get("four_times", suggested_times)
                elif "once" in t or "one time" in t:
                    suggested_times = C.FREQ_TIMES.get("once_daily", suggested_times)
        except Exception:
            pass

        step_data = {
            "step": "awaiting_time",
            "drug": matched_drug_name,
            "suggested_times": suggested_times,
            "order_id": matched_order_id,
            "patient_id": str(user["id"]),
            "qty": matched_qty,
            "meal": default_meal,
        }
        await r_set(f"reminder_step:{phone}", step_data, ttl=1800)

        return {**state,
                "reply": (f"⏰ *Setting reminder for *{matched_drug_name}** (from your order)\n\n"
                          f"*What time(s) should I remind you?*\n"
                          f"Suggested: {', '.join(suggested_times)}\n\n"
                          "Reply *yes* to use these, or send your times _(e.g. '9am', '8am 2pm 9pm')_"),
                "agent_used": "reminder_agent"}

    # ── No drug found — show active reminders or ordered medicines ──
    uid = str(user["id"])
    pool = await get_pool()

    # First check if user has any orders at all
    past_orders = await pool.fetch(
        """SELECT DISTINCT drug_name FROM orders
           WHERE (user_id=$1 OR patient_id=$1)
           ORDER BY drug_name LIMIT 10""", uid)

    rows = await db_fetch(
        "SELECT drug_name, remind_times, qty_remaining, end_date, meal_instruction FROM reminders WHERE patient_id=$1 AND is_active=TRUE LIMIT 5",
        uid)
    if not rows:
        if past_orders:
            med_list = "\n".join(f"  • 💊 *{o['drug_name'].title()}*" for o in past_orders)
            return {**state,
                    "reply": ("No active reminders.\n\n"
                              "You can set reminders for medicines you've ordered:\n"
                              f"{med_list}\n\n"
                              "Say *set reminder for [medicine name]* from the list above."),
                    "agent_used": "reminder_agent"}
        else:
            return {**state,
                    "reply": ("No active reminders and no past orders.\n\n"
                              "You can only set reminders for medicines you've ordered.\n"
                              "Say *order [medicine name]* to place an order first! 💊"),
                    "agent_used": "reminder_agent"}

    lst = "\n".join(
        f"• 💊 *{r['drug_name'].title()}* — {', '.join(r['remind_times'])} | "
        f"🍽️ {(r.get('meal_instruction') or 'after meal').replace('_', ' ')} | "
        f"📅 Until {r['end_date'].strftime('%d %b') if r.get('end_date') else '?'}"
        for r in rows)
    return {**state,
            "reply": (f"📋 *Your active reminders:*\n\n{lst}\n\n"
                      "To add: *set reminder for [medicine]*\n"
                      "To cancel: *cancel reminder for [medicine]*"),
            "agent_used": "reminder_agent"}


# ── Reminder helpers ──────────────────────────────────────────

def _parse_times(message: str) -> list[str]:
    """Parse time strings from user message. Returns sorted list of HH:MM strings."""
    from datetime import datetime as dt_cls
    msg_l = message.lower()
    parsed = []

    # Special words
    if "noon" in msg_l:
        parsed.append("12:00")
    if "midnight" in msg_l:
        parsed.append("00:00")

    # "7 pm", "9:30am", "08:00"
    time_tokens = re.findall(r"\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)", msg_l)
    for t in time_tokens[:4]:
        try:
            tc = t.strip().replace(" ", "")
            if "am" in tc or "pm" in tc:
                fmt = "%I:%M%p" if ":" in tc else "%I%p"
                p = dt_cls.strptime(tc, fmt)
                ts = p.strftime("%H:%M")
                if ts not in parsed:
                    parsed.append(ts)
            elif ":" in tc:
                parts = tc.split(":")
                h, m = int(parts[0]), int(parts[1])
                if 0 <= h <= 23 and 0 <= m <= 59:
                    ts = f"{h:02d}:{m:02d}"
                    if ts not in parsed:
                        parsed.append(ts)
        except:
            pass

    # "8 morning", "7 evening", "10 night"
    context = re.findall(r"(\d{1,2})\s*(?:in the\s+)?(morning|evening|night|subah|sham|raat)", msg_l)
    for num, period in context:
        h = int(num)
        if period in ("morning", "subah") and 1 <= h <= 12:
            ts = f"{h:02d}:00"
        elif period in ("evening", "sham") and 1 <= h <= 12:
            ts = f"{h + 12 if h < 12 else h:02d}:00"
        elif period in ("night", "raat") and 1 <= h <= 12:
            ts = f"{h + 12 if h < 12 else h:02d}:00"
        else:
            continue
        if ts not in parsed:
            parsed.append(ts)

    # "morning" / "evening" / "night" without number → defaults
    if not parsed:
        if any(w in msg_l for w in ("morning", "subah")):
            parsed.append("08:00")
        if any(w in msg_l for w in ("afternoon", "dopahar")):
            parsed.append("14:00")
        if any(w in msg_l for w in ("evening", "sham", "shaam")):
            parsed.append("18:00")
        if any(w in msg_l for w in ("night", "raat")):
            parsed.append("22:00")

    parsed.sort()
    return parsed


def _parse_days(message: str) -> int | None:
    """Parse duration from message. Returns number of days or None."""
    msg_l = message.lower()
    m = re.search(r"(\d+)\s*(?:day|din)", msg_l)
    if m:
        return max(1, int(m.group(1)))
    m = re.search(r"(\d+)\s*week", msg_l)
    if m:
        return max(1, int(m.group(1))) * 7
    m = re.search(r"(\d+)\s*month", msg_l)
    if m:
        return max(1, int(m.group(1))) * 30
    return None


def _parse_meal(message: str) -> str | None:
    """Parse meal instruction from message. Returns normalized string or None."""
    msg_l = message.lower()
    if any(w in msg_l for w in ("before meal", "before food", "khana khane se pehle", "empty stomach")):
        return "before_meal"
    if any(w in msg_l for w in ("after meal", "after food", "khana khane ke baad", "khane ke baad")):
        return "after_meal"
    if any(w in msg_l for w in ("any time", "anytime", "kab bhi", "with or without")):
        return "any"
    if any(w in msg_l for w in ("before sleep", "bedtime", "sone se pehle", "raat ko")):
        return "before_sleep"
    return None


def _build_confirmation(data: dict) -> str:
    """Build the reminder confirmation message."""
    drug  = data["drug"]
    times = data["times"]
    days  = data["days"]
    meal  = data.get("meal", "after_meal")
    dosage_per_day = len(times)
    total_doses = dosage_per_day * days
    end_dt = date.today() + timedelta(days=days)

    return (
        f"📋 *Reminder Summary — please confirm:*\n\n"
        f"💊 *{drug.title()}*\n"
        f"🕐 {', '.join(times)} ({dosage_per_day}x daily)\n"
        f"🍽️ {meal.replace('_', ' ')}\n"
        f"📅 {days} days — until {end_dt.strftime('%d %b %Y')}\n"
        f"💊 Total doses: {total_doses}\n\n"
        f"Reply *yes* to confirm\n"
        f"Or edit: send new times / days / meal instruction\n"
        f"Reply *cancel* to abort"
    )


async def _create_reminder_v2(state: MedState, data: dict) -> MedState:
    """Create the reminder in DB. Cron scheduler will handle delivery."""
    phone = state["phone"]
    user  = state["user"]
    pool  = await get_pool()

    drug  = data["drug"]
    times = data["times"]
    days  = data["days"]
    meal  = data.get("meal", "after_meal")
    dosage_per_day = len(times)
    total_doses = dosage_per_day * days
    end_dt = date.today() + timedelta(days=days)
    patient_id = data.get("patient_id", str(user["id"]))

    # Insert reminder into DB
    row = await pool.fetchrow(
        """INSERT INTO reminders
           (user_id, patient_id, order_id, drug_name, dose, meal_instruction,
            remind_times, end_date, total_qty, qty_remaining)
           VALUES($1,$2,$3,$4,'1 tablet',$5,$6,$7,$8,$8) RETURNING *""",
        str(user["id"]),
        patient_id,
        data.get("order_id"),
        drug,
        meal,
        times, end_dt,
        total_doses)

    # Also add to active_medications table
    try:
        freq_key = f"{dosage_per_day}x_daily"
        await pool.execute(
            """INSERT INTO active_medications
               (user_id, drug_name, dosage, dose_per_intake, frequency,
                frequency_times, meal_instruction, end_date, source)
               VALUES($1,$2,$3,'1 tablet',$4,$5,$6,$7,'ordered')
               ON CONFLICT DO NOTHING""",
            patient_id, drug, f"{dosage_per_day}x daily",
            freq_key, times, meal, end_dt)
        logger.info(f"Added {drug} to active_medications for patient {patient_id}")
    except Exception as e:
        logger.error(f"Failed to add to active_medications: {e}")

    # Reminder is now auto-picked by the cron scheduler (app.services.scheduler)
    # No BullMQ scheduling needed — the scheduler queries the reminders table every 60s
    logger.info(f"Reminder {row['id']} created for {drug} at {times} — scheduler will handle delivery")

    # Clear all step data
    await r_del(f"reminder_step:{phone}")
    await r_del(f"pending_order:{phone}")

    return {**state,
            "reply": (f"✅ *Reminder Created Successfully!*\n\n"
                      f"💊 *{drug.title()}* (from your order)\n"
                      f"🕐 {', '.join(times)}\n"
                      f"🍽️ {meal.replace('_', ' ')}\n"
                      f"📅 Until {end_dt.strftime('%d %b %Y')} ({days} days)\n\n"
                      f"I'll send you a WhatsApp message when it's time to take your medicine! 💬\n\n"
                      f"When you get a reminder, reply:\n"
                      f"✅ *taken*  |  ❌ *skipped*\n\n"
                      f"Want to edit? Just tell me!"),
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
                    {"stage": "awaiting_confirm", "drug": drug, "inventory": inv}, ttl=300)
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
