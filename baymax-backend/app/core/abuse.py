"""
Cumulative abuse scoring engine.
Extracted from main_v6.py §12.
"""

import json
import logging
from datetime import datetime

from app.config import C
from app.db.helpers import db_fetch, db_fetchrow, db_execute, log_audit
from app.services.messaging import send_whatsapp
from app.singletons import get_pool

logger = logging.getLogger("medai.v6")


async def update_abuse_score(user_id: str, drug: str,
                              extra_flags: list[str], message: str = "") -> dict:
    """
    Persistent cumulative abuse detection.
    Increments abuse_scores table.
    Returns {score, block, review, flags}.
    """
    added = 0
    flags = list(extra_flags)

    # Controlled drug
    if drug.lower() in C.CONTROLLED_WATCH:
        added += C.ABUSE_WEIGHTS["controlled_drug"]
        flags.append("CONTROLLED_DRUG")

    # Rapid refill (< 3 days)
    recent = await db_fetch(
        "SELECT ordered_at FROM orders WHERE patient_id=$1 AND drug_name=$2 ORDER BY ordered_at DESC LIMIT 2",
        user_id, drug)
    if len(recent) >= 2:
        delta = (recent[0]["ordered_at"] - recent[1]["ordered_at"]).total_seconds() / 86400
        if delta < 3:
            added += C.ABUSE_WEIGHTS["rapid_refill"]
            flags.append("RAPID_REFILL")

    # Night ordering 23:00–05:00
    hour = datetime.now().hour
    if hour >= 23 or hour < 5:
        added += C.ABUSE_WEIGHTS["night_order"]
        flags.append("NIGHT_ORDER")

    # Dose-increase language
    if any(w in message.lower() for w in ["stronger", "higher dose", "more mg", "double dose", "increase dose"]):
        added += C.ABUSE_WEIGHTS["dose_increase_ask"]
        flags.append("DOSE_INCREASE_ASK")

    # Multiple controlled classes in last 30 days
    recent_ctrl = await db_fetch(
        """SELECT DISTINCT drug_name FROM orders
           WHERE patient_id=$1 AND ordered_at > NOW()-INTERVAL '30 days'
             AND drug_name = ANY($2::TEXT[])""",
        user_id, C.CONTROLLED_WATCH)
    if len(recent_ctrl) >= 2:
        added += C.ABUSE_WEIGHTS["multi_controlled"]
        flags.append("MULTI_CONTROLLED")

    if added == 0:
        return {"score": 0, "block": False, "review": False, "flags": []}

    pool = await get_pool()
    row  = await pool.fetchrow(
        """INSERT INTO abuse_scores(user_id, score, flags)
           VALUES($1, $2, $3)
           ON CONFLICT(user_id) DO UPDATE SET
               score        = abuse_scores.score + $2,
               flags        = array_cat(abuse_scores.flags, $3),
               last_updated = NOW()
           RETURNING score, blocked""",
        user_id, added, flags)

    total  = int(row["score"]) if row else added
    block  = total >= C.ABUSE_BLOCK_SCORE
    review = total >= C.ABUSE_REVIEW_SCORE

    if block:
        await pool.execute(
            "UPDATE abuse_scores SET blocked=TRUE, review_required=TRUE WHERE user_id=$1", user_id)
        await log_audit(user_id, "abuse_hard_block", "abuse_scores", user_id,
                        new_val={"score": total, "flags": flags})
    elif review:
        await pool.execute(
            "UPDATE abuse_scores SET review_required=TRUE WHERE user_id=$1", user_id)

    if (block or review) and C.ADMIN_PHONE:
        label = "HARD BLOCK" if block else "REVIEW REQUIRED"
        await send_whatsapp(C.ADMIN_PHONE,
            f"🚨 *Abuse Alert — {label}*\n\n"
            f"User: {user_id[:12]}\nDrug: {drug}\nScore: {total}\n"
            f"Flags: {', '.join(flags)}")

    return {"score": total, "block": block, "review": review, "flags": flags}


async def check_abuse_blocked(user_id: str) -> bool:
    """Quick check — is user currently hard-blocked?"""
    row = await db_fetchrow("SELECT blocked FROM abuse_scores WHERE user_id=$1", user_id)
    return bool(row and row["blocked"]) if row else False
