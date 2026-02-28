"""
Health episode tracking — symptom clustering and worsening detection.
Extracted from main_v6.py §10.
"""

from typing import Optional

from app.config import C
from app.db.helpers import db_fetchrow, log_health_event
from app.services.messaging import send_whatsapp
from app.singletons import get_pool


def classify_episode_type(symptoms: list[str]) -> Optional[str]:
    """Map detected symptom keywords to a clinical episode type."""
    best, best_count = None, 0
    for ep_type, kws in C.EPISODE_MAP.items():
        count = sum(1 for s in symptoms if any(k in s for k in kws))
        if count > best_count:
            best, best_count = ep_type, count
    return best if best_count > 0 else None


async def get_or_create_episode(user_id: str, symptoms: list[str]) -> Optional[str]:
    """Find active matching episode or create new one. Returns episode_id."""
    ep_type = classify_episode_type(symptoms)
    if not ep_type: return None
    pool = await get_pool()
    existing = await pool.fetchrow(
        "SELECT id FROM health_episodes WHERE user_id=$1 AND episode_type=$2 AND status='active' LIMIT 1",
        user_id, ep_type)
    if existing:
        await pool.execute(
            "UPDATE health_episodes SET symptoms=array_cat(symptoms,$2), followup_count=followup_count+1 WHERE id=$1",
            str(existing["id"]), symptoms)
        return str(existing["id"])
    row = await pool.fetchrow(
        "INSERT INTO health_episodes(user_id, episode_type, symptoms) VALUES($1,$2,$3) RETURNING id",
        user_id, ep_type, symptoms)
    return str(row["id"]) if row else None


async def update_episode_followup(user_id: str, response: str):
    """Process followup response. 3× 'worse' → emergency escalation."""
    pool = await get_pool()
    resp = response.lower().strip()
    if resp == "worse":
        rows = await pool.fetch(
            "SELECT id, followup_count FROM health_episodes WHERE user_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",
            user_id)
        if rows:
            ep = dict(rows[0])
            await pool.execute(
                "UPDATE health_episodes SET followup_count=followup_count+1, worsened=TRUE WHERE id=$1",
                str(ep["id"]))
            # 3+ worsening responses → escalate
            if ep["followup_count"] >= 2:
                user = await db_fetchrow("SELECT phone, name FROM users WHERE id=$1", user_id)
                if user:
                    await send_whatsapp(user["phone"],
                        "🚨 *Health Alert*\n\n"
                        "Your symptoms have been worsening across multiple check-ins.\n\n"
                        "*Please visit a doctor or emergency room immediately.*\n"
                        "📞 *India Emergency:* 112  |  Ambulance: 108")
                    await log_health_event(user_id, "episode_deterioration",
                        "Symptoms worsening — emergency escalation triggered",
                        metadata={"followup_count": ep["followup_count"] + 1})
    elif resp == "better":
        await pool.execute(
            "UPDATE health_episodes SET status='resolved', resolved_at=NOW() WHERE user_id=$1 AND status='active'",
            user_id)
        await log_health_event(user_id, "episode_resolved", "Symptoms resolved via followup")
