"""
Clinical Decision Engine (CDE) — core V5 safety layer.
Extracted from main_v6.py §9.
"""

import json
import time
import logging

from app.config import C
from app.db.helpers import (
    db_fetch, db_fetchrow, db_execute,
    get_drug_classes_for, get_drugs_in_class,
)
from app.core.safety import check_class_allergy
from app.core.risk_tier import compute_risk_tier, get_tier_constraints
from app.singletons import get_pool

logger = logging.getLogger("medai.v6")


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
