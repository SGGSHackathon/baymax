"""
Safety & triage helper functions.
Extracted from main_v6.py §7.
"""

import re
from typing import Optional

from app.config import C
from app.db.helpers import get_drug_classes_for, get_drugs_in_class, get_inventory_fuzzy
from app.core.retrieval import retrieve


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
