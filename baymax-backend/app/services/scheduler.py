"""
Cron-based Reminder Scheduler — replaces BullMQ Node.js sidecar.

Runs every 60 s inside the FastAPI process.  For each active reminder whose
`remind_times` includes the current HH:MM, it:
  1. Batches same-phone + same-time drugs into one WhatsApp message.
  2. Inserts a `reminder_logs` row for each drug.
  3. Pushes entries onto the `pending_acks:{phone}` Redis LIST so the
     WhatsApp-server ACK flow works exactly as before.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, date, timedelta, timezone

from app.singletons import get_pool, get_redis
from app.services.messaging import send_whatsapp

logger = logging.getLogger("medai.v6")

# IST offset (UTC+5:30) — adjust if your users span multiple timezones
IST = timezone(timedelta(hours=5, minutes=30))

# Guard: ensure only one tick executes at a time
_tick_lock = asyncio.Lock()


async def _tick():
    """Called every 60 s.  Finds due reminders and sends WhatsApp messages."""
    if _tick_lock.locked():
        return                        # previous tick still running — skip
    async with _tick_lock:
        try:
            await _process_due_reminders()
        except Exception as e:
            logger.error(f"Scheduler tick error: {e}", exc_info=True)


async def _process_due_reminders():
    pool = await get_pool()
    redis = await get_redis()
    now = datetime.now(IST)
    current_time = now.strftime("%H:%M")       # e.g. "09:00"
    today = now.date()

    # Find active reminders that include this HH:MM in their remind_times
    # and whose date range covers today
    rows = await pool.fetch(
        """SELECT r.id, r.patient_id, r.drug_name, r.dose,
                  r.meal_instruction, r.remind_times, r.qty_remaining,
                  u.phone
           FROM reminders r
           JOIN users u ON r.patient_id = u.id
           WHERE r.is_active = TRUE
             AND $1 = ANY(r.remind_times)
             AND (r.start_date IS NULL OR r.start_date <= $2)
             AND (r.end_date   IS NULL OR r.end_date   >= $2)
             AND (r.qty_remaining IS NULL OR r.qty_remaining > 0)""",
        current_time, today)

    if not rows:
        return

    # Deduplicate: skip if we already sent for this reminder+time+date
    idempotency_prefix = f"{current_time}:{today.isoformat()}"

    # Group by phone for batching
    phone_batches: dict[str, list] = {}
    for row in rows:
        phone = row["phone"]
        if not phone:
            continue

        idem_key = f"rem:{row['id']}:{idempotency_prefix}"

        # Fast Redis check — skip if already processed
        if await redis.get(f"sent:{idem_key}"):
            continue

        phone_batches.setdefault(phone, []).append({
            "reminder_id": str(row["id"]),
            "patient_id":  str(row["patient_id"]),
            "drug_name":   row["drug_name"],
            "dose":        row["dose"] or "1 tablet",
            "meal_instruction": row["meal_instruction"] or "after_meal",
            "phone":       phone,
            "log_id":      str(uuid.uuid4()),
            "idem_key":    idem_key,
        })

    # Process each phone batch
    for phone, drugs in phone_batches.items():
        try:
            await _send_reminder_batch(pool, redis, phone, drugs, current_time, today)
        except Exception as e:
            logger.error(f"Reminder batch send error for {phone}: {e}")


async def _send_reminder_batch(pool, redis, phone: str, drugs: list,
                               time_str: str, today: date):
    """Send one WhatsApp message for all same-time drugs, log each, push to pending_acks."""

    batch_id = f"{time_str}:{today.isoformat()}"

    # ── Build message ──
    if len(drugs) == 1:
        d = drugs[0]
        mt = d["meal_instruction"].replace("_", " ")
        msg = (
            f"Hey! 👋 It's time to take your medicine.\n\n"
            f"💊 *{d['drug_name']}*  |  Dose: *{d['dose']}*\n"
            f"🍽️ Take it {mt}\n\n"
            f"Stay healthy! 😊\n"
            f"✅ Reply *taken* or ❌ *skipped*"
        )
    else:
        lines = []
        for i, d in enumerate(drugs, 1):
            mt = d["meal_instruction"].replace("_", " ")
            lines.append(f"  {i}. 💊 *{d['drug_name']}* — {d['dose']} ({mt})")
        drug_list = "\n".join(lines)
        msg = (
            f"Hey! 👋 It's time to take your medicines.\n\n"
            f"{drug_list}\n\n"
            f"Stay healthy! 😊\n"
            f"✅ Reply *taken* for all, or ❌ *skipped*"
        )

    # ── Send WhatsApp ──
    ok = await send_whatsapp(phone, msg)
    if not ok:
        logger.error(f"Failed to send reminder to {phone}")
        return

    # ── Log each drug + push to pending_acks ──
    for d in drugs:
        # Insert reminder_logs row
        try:
            await pool.execute(
                """INSERT INTO reminder_logs
                   (id, reminder_id, user_id, patient_id, drug_name, dose,
                    scheduled_at, sent_at, idempotency_key)
                   VALUES($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7)
                   ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING""",
                d["log_id"], d["reminder_id"],
                d["patient_id"], d["patient_id"],
                d["drug_name"], d["dose"], d["idem_key"])
        except Exception as e:
            logger.error(f"Reminder log insert: {e}")

        # Push to pending_acks LIST (same format as old BullMQ worker)
        await redis.rpush(f"pending_acks:{phone}", json.dumps({
            "logId":      d["log_id"],
            "drugName":   d["drug_name"],
            "reminderId": d["reminder_id"],
            "batchId":    batch_id,
        }))

        # Mark as sent so we don't resend on the same minute
        await redis.set(f"sent:{d['idem_key']}", "1", ex=120)

    await redis.expire(f"pending_acks:{phone}", 14400)   # 4 h TTL

    logger.info(
        f"💊 Reminder sent ({len(drugs)} drug{'s' if len(drugs) > 1 else ''}): "
        f"{', '.join(d['drug_name'] for d in drugs)} → {phone}"
    )


# ── Scheduler loop — started from app lifespan ──────────────

_scheduler_task: asyncio.Task | None = None


async def start_scheduler():
    """Start the 60-second reminder cron loop."""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    logger.info("⏰ Reminder scheduler started (60s interval)")


async def stop_scheduler():
    """Cancel the scheduler loop gracefully."""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
    _scheduler_task = None
    logger.info("⏰ Reminder scheduler stopped")


async def _scheduler_loop():
    """Infinite loop: wait until the next minute boundary, then tick."""
    while True:
        try:
            # Align to the next :00 second boundary
            now = datetime.now(IST)
            seconds_to_next_min = 60 - now.second
            await asyncio.sleep(seconds_to_next_min)
            await _tick()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Scheduler loop error: {e}", exc_info=True)
            await asyncio.sleep(30)      # back off on unexpected errors
