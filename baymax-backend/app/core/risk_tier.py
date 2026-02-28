"""
Risk Tier Engine — patient risk scoring and behaviour constraints.
Extracted from main_v6.py §8.
"""

from app.config import C


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
