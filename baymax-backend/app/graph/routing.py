"""
LangGraph routing functions — conditional edge resolvers.
Now with: non-blocking onboarding — users can ask ANY query even before completing profile.
Profile data is collected passively via proactive follow-ups after answering the user's query.
"""

import re
from app.config import C
from app.graph.state import MedState


def _is_greeting(msg: str) -> bool:
    """Detect greetings including stretched variants."""
    m = msg.lower().strip().rstrip("!.?,")
    if m in ("sup", "yo", "hey", "hi", "hello", "hola", "namaste", "namaskar",
             "good morning", "good evening", "good afternoon", "good night",
             "gm", "gn", "morning", "evening"):
        return True
    patterns = [
        r'^h+i+$', r'^h+e+l+o+$', r'^h+e+y+$',
        r'^n+a+m+a+s+t+e+$', r'^n+a+m+a+s+k+a+r+$',
        r'^go+d\s+(morning|evening|afternoon|night)$',
    ]
    return any(re.match(p, m) for p in patterns)


def _is_profile_data(msg: str) -> bool:
    """Detect if message is ONLY profile data (name, age, gender, allergy info)
    that should go to onboarding_agent for proper handling."""
    m = msg.strip().lower()

    # Pure number (likely age response)
    if re.fullmatch(r"\d{1,3}", m):
        return True

    # Pure gender response
    if m in ("male", "female", "other", "m", "f", "man", "woman", "boy", "girl",
             "ladka", "ladki", "mard", "mahila", "purush", "stree"):
        return True

    # "yes" / "no" alone — only if pending onboarding question
    if m in ("yes", "no", "y", "n", "haan", "ha", "nahi", "nako", "none"):
        return True

    # Explicit self-introduction patterns
    intro_patterns = [
        r"^(?:my name is|i am|i'm|mera naam|naam)\s+\w",
        r"^(?:i have|mujhe)\s+(?:allerg|no allerg)",
        r"^(?:i am|i'm|main)\s+\d{1,3}\s*(?:year|yr|sal|saal)?",
    ]
    if any(re.match(p, m) for p in intro_patterns):
        return True

    return False


def should_onboard(state: MedState) -> str:
    # Emergency / blocked / reply already set → post_process
    if state.get("emergency") or state.get("blocked_drug") or state.get("reply"):
        return "post_process"

    # Active transactional flow ALWAYS takes priority over onboarding
    if state.get("active_flow"):
        return "pre_safety"

    # Already onboarded → normal flow (but greetings still get BAYMAX intro)
    if state.get("user", {}).get("onboarded"):
        msg = state.get("message", "").strip()
        if _is_greeting(msg):
            return "onboarding_agent"
        return "pre_safety"

    # ── New / un-onboarded user: redirect to website ──
    msg = state.get("message", "").strip()

    # 1. New user (any message) → onboarding_agent (will redirect to website)
    if state.get("is_new_user"):
        return "onboarding_agent"

    # 2. Un-onboarded user sending greeting → onboarding_agent
    if _is_greeting(msg):
        return "onboarding_agent"

    # 3. If user is actively providing profile data AND there's a pending onboarding step
    step = state.get("user", {}).get("onboarding_step", "name")
    if step != "done" and _is_profile_data(msg):
        return "onboarding_agent"

    # 4. Un-onboarded user sending non-profile data → still redirect to register
    return "onboarding_agent"


def after_presafety(state: MedState) -> str:
    if state.get("emergency") or state.get("blocked_drug") or state.get("reply"):
        return "post_process"
    return "clinical_decision"


def after_cde(state: MedState) -> str:
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
        "family":    "family_agent",
        "order_history": "conversation_agent",
        "clarify":   "post_process",
    }.get(state.get("intent", ""), "conversation_agent")


def after_dfe(state: MedState) -> str:
    """
    After DFE runs:
    - If DFE asked a question (reply set) → post_process
    - If DFE found nothing to ask → continue to target agent
    """
    if state.get("dfe_triggered") and state.get("reply"):
        return "post_process"
    intent = state.get("intent", "general")
    return {
        "drug_info":  "drug_info_agent",
        "safety":     "safety_agent",
    }.get(intent, "conversation_agent")
