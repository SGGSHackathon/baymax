"""db/postgres.py — Neon PostgreSQL async connection pool"""
import os
import logging
from typing import Optional
import asyncpg
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("medai.db")

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.getenv("DATABASE_URL"),
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        logger.info("✅ Neon DB pool created")
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── User Queries ──────────────────────────────────────────────

async def get_user_by_phone(phone: str) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """SELECT u.*,
                  ARRAY_AGG(DISTINCT am.drug_name) FILTER (WHERE am.is_active) AS current_meds
           FROM users u
           LEFT JOIN active_medications am ON u.id = am.user_id AND am.is_active = TRUE
           WHERE u.phone = $1
           GROUP BY u.id""",
        phone
    )
    return dict(row) if row else None


async def create_user(phone: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """INSERT INTO users (phone, onboarded, onboarding_step)
           VALUES ($1, FALSE, 'name')
           ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()
           RETURNING *""",
        phone
    )
    return dict(row)


async def update_user(phone: str, **fields) -> dict:
    if not fields:
        return {}
    pool  = await get_pool()
    sets  = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    vals  = list(fields.values())
    row   = await pool.fetchrow(
        f"UPDATE users SET {sets}, updated_at = NOW() WHERE phone = $1 RETURNING *",
        phone, *vals
    )
    return dict(row) if row else {}


async def get_user_active_meds(user_id: str) -> list[str]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT drug_name FROM active_medications WHERE user_id = $1 AND is_active = TRUE",
        user_id
    )
    return [r["drug_name"] for r in rows]


async def add_active_medication(user_id: str, drug_name: str, dosage: str,
                                 frequency: str, frequency_times: list[str],
                                 meal_instruction: str, end_date=None,
                                 dose_per_intake: str = None) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """INSERT INTO active_medications
               (user_id, drug_name, dosage, dose_per_intake, frequency,
                frequency_times, meal_instruction, end_date, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ordered')
           RETURNING *""",
        user_id, drug_name, dosage, dose_per_intake,
        frequency, frequency_times, meal_instruction, end_date
    )
    return dict(row)


async def get_medical_history(user_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM medical_history WHERE user_id = $1 ORDER BY created_at DESC",
        user_id
    )
    return [dict(r) for r in rows]


# ── Family Queries ────────────────────────────────────────────

async def get_family_members(user_id: str) -> list[dict]:
    """Get all family members the given user can order for."""
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT u.id, u.phone, u.name, u.age, fm.role
           FROM family_members fm
           JOIN families f ON fm.family_id = f.id
           JOIN family_members fm2 ON fm2.family_id = f.id AND fm2.user_id = $1
           JOIN users u ON fm.user_id = u.id
           WHERE fm.user_id != $1""",
        user_id
    )
    return [dict(r) for r in rows]


async def get_orderable_patients(user_id: str) -> list[dict]:
    """Users this person can place an order on behalf of."""
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT u.id, u.phone, u.name, u.age, u.allergies,
                  fm.role, fm.can_order_for
           FROM family_members fm
           JOIN families fam ON fm.family_id = fam.id
           JOIN users u ON fm.user_id = u.id
           WHERE fm.family_id IN (
               SELECT family_id FROM family_members WHERE user_id = $1
           )
           AND (fm.role IN ('dependent') OR $1 = ANY(
               SELECT unnest(fm2.can_order_for) FROM family_members fm2
               WHERE fm2.user_id = $1
           ))""",
        user_id
    )
    # Always include self
    self_row = await get_pool().then if False else await (await get_pool()).fetchrow(
        "SELECT id, phone, name, age, allergies FROM users WHERE id = $1", user_id
    )
    result = [dict(r) for r in rows]
    if self_row:
        result.insert(0, {**dict(self_row), "role": "self"})
    return result


# ── Inventory Queries ─────────────────────────────────────────

async def search_inventory(query: str, limit: int = 5) -> list[dict]:
    """Fuzzy search inventory by drug name or brand name."""
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT id, drug_name, brand_name, strength, form, stock_qty,
                  unit, price_per_unit, is_otc, category,
                  similarity(LOWER(drug_name), LOWER($1)) AS sim1,
                  similarity(LOWER(brand_name), LOWER($1)) AS sim2
           FROM inventory
           WHERE is_active = TRUE
             AND stock_qty > 0
             AND (
                 drug_name ILIKE $2
                 OR brand_name ILIKE $2
                 OR similarity(LOWER(drug_name),  LOWER($1)) > 0.3
                 OR similarity(LOWER(brand_name), LOWER($1)) > 0.3
             )
           ORDER BY GREATEST(
               similarity(LOWER(drug_name),  LOWER($1)),
               similarity(LOWER(brand_name), LOWER($1))
           ) DESC
           LIMIT $3""",
        query, f"%{query}%", limit
    )
    return [dict(r) for r in rows]


async def get_inventory_by_id(inventory_id: str) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM inventory WHERE id = $1 AND is_active = TRUE", inventory_id
    )
    return dict(row) if row else None


async def check_stock(drug_name: str) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """SELECT id, drug_name, brand_name, stock_qty, unit,
                  price_per_unit, is_otc, strength, form
           FROM inventory
           WHERE (LOWER(drug_name) = LOWER($1) OR LOWER(brand_name) = LOWER($1))
             AND is_active = TRUE
             AND stock_qty > 0
           ORDER BY stock_qty DESC LIMIT 1""",
        drug_name
    )
    return dict(row) if row else None


async def decrement_stock(inventory_id: str, qty: int) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        """UPDATE inventory
           SET stock_qty = stock_qty - $2, updated_at = NOW()
           WHERE id = $1 AND stock_qty >= $2""",
        inventory_id, qty
    )
    return result == "UPDATE 1"


async def get_low_stock() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM low_stock_view ORDER BY stock_qty ASC")
    return [dict(r) for r in rows]


# ── Order Queries ─────────────────────────────────────────────

async def create_order(user_id: str, patient_id: str, inventory_id: str,
                        drug_name: str, quantity: int, unit_price: float,
                        placed_by_role: str = "self", requires_rx: bool = False) -> dict:
    pool = await get_pool()
    total = round(unit_price * quantity, 2)
    row = await pool.fetchrow(
        """INSERT INTO orders
               (user_id, patient_id, inventory_id, drug_name, quantity,
                unit_price, total_price, placed_by_role, requires_rx, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed')
           RETURNING *""",
        user_id, patient_id, inventory_id, drug_name,
        quantity, unit_price, total, placed_by_role, requires_rx
    )
    return dict(row)


async def get_order_history(patient_id: str, limit: int = 10) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT o.*, u.name AS ordered_by_name
           FROM orders o
           JOIN users u ON o.user_id = u.id
           WHERE o.patient_id = $1
           ORDER BY o.ordered_at DESC LIMIT $2""",
        patient_id, limit
    )
    return [dict(r) for r in rows]


# ── Reminder Queries ──────────────────────────────────────────

async def create_reminder(user_id: str, patient_id: str, order_id: str,
                            drug_name: str, dose: str, meal_instruction: str,
                            remind_times: list[str], end_date,
                            total_qty: int = None) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """INSERT INTO reminders
               (user_id, patient_id, order_id, drug_name, dose,
                meal_instruction, remind_times, end_date, total_qty, qty_remaining)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
           RETURNING *""",
        user_id, patient_id, order_id, drug_name, dose,
        meal_instruction, remind_times, end_date, total_qty
    )
    return dict(row)


async def log_reminder_sent(reminder_id: str, user_id: str, patient_id: str,
                              drug_name: str, dose: str, scheduled_at) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """INSERT INTO reminder_logs
               (reminder_id, user_id, patient_id, drug_name, dose, scheduled_at, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           RETURNING *""",
        reminder_id, user_id, patient_id, drug_name, dose, scheduled_at
    )
    return dict(row)


async def acknowledge_reminder(log_id: str, status: str) -> dict:
    """status: 'taken' | 'skipped'"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE reminder_logs
               SET ack_status = $2, ack_received_at = NOW()
               WHERE id = $1
               RETURNING *""",
            log_id, status
        )
        if row and status == "taken":
            # Decrement qty_remaining in reminder
            await conn.execute(
                """UPDATE reminders
                   SET qty_remaining = GREATEST(qty_remaining - 1, 0),
                       updated_at = NOW()
                   WHERE id = $1""",
                row["reminder_id"]
            )
    return dict(row) if row else {}


async def escalate_reminder_log(log_id: str, call_job_id: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """UPDATE reminder_logs
           SET ack_status = 'escalated', escalated = TRUE,
               escalated_at = NOW(), call_job_id = $2
           WHERE id = $1
           RETURNING *""",
        log_id, call_job_id
    )
    return dict(row) if row else {}


async def get_pending_reminders_due(refill_threshold: int = 3) -> list[dict]:
    """For refill prediction — get users whose medicine is running low."""
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM refill_due_view")
    return [dict(r) for r in rows]


async def get_active_reminders_for_user(user_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM reminders WHERE patient_id = $1 AND is_active = TRUE",
        user_id
    )
    return [dict(r) for r in rows]


# ── Conversation Queries ──────────────────────────────────────

async def get_or_create_session(session_id: str, user_id: str,
                                  channel: str = "whatsapp") -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """INSERT INTO conversations (session_id, user_id, channel)
           VALUES ($1, $2, $3)
           ON CONFLICT (session_id) DO UPDATE
               SET last_active = NOW(),
                   message_count = conversations.message_count + 1
           RETURNING *""",
        session_id, user_id, channel
    )
    return dict(row)


async def save_message(session_id: str, user_id: str, role: str,
                        content: str, agent_used: str = None,
                        drugs: list = None, safety_flags: list = None,
                        intent: str = None) -> None:
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO conversation_messages
               (session_id, user_id, role, content, agent_used,
                drugs_mentioned, safety_flags, intent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
        session_id, user_id, role, content, agent_used,
        drugs or [], safety_flags or [], intent
    )


async def get_recent_messages(session_id: str, limit: int = 8) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT role, content, created_at FROM conversation_messages
           WHERE session_id = $1
           ORDER BY created_at DESC LIMIT $2""",
        session_id, limit
    )
    return [dict(r) for r in reversed(rows)]
