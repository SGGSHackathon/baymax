"""
WhatsApp messaging service.
WhatsApp-only — no Twilio, no SMS, no call escalation.
Reminders are handled by the cron scheduler (app.services.scheduler).
"""

import logging
from datetime import datetime, timedelta

from app.config import C
from app.singletons import get_http, get_pool

logger = logging.getLogger("medai.v6")


async def send_whatsapp(phone: str, message: str) -> bool:
    """Send a WhatsApp message via the whatsapp-web.js server."""
    http = await get_http()
    try:
        await http.post(f"{C.WHATSAPP_URL}/send", json={"number": phone, "message": message})
        return True
    except Exception as e:
        logger.error(f"WA send: {e}")
        return False


async def schedule_symptom_followup(user_id: str, phone: str, symptom: str) -> str:
    """Schedule a follow-up for a reported symptom (stores in DB, checked by scheduler)."""
    followup_at = datetime.utcnow() + timedelta(hours=C.FOLLOWUP_HOURS)
    pool = await get_pool()
    row  = await pool.fetchrow(
        "INSERT INTO symptom_followups(user_id, symptom, followup_at) VALUES($1,$2,$3) RETURNING id",
        user_id, symptom, followup_at)
    if not row:
        return ""
    return str(row["id"])
