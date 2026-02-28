"""
Async database helper functions with Redis caching.
Extracted from main_v6.py §4.
"""

import json
import logging
from typing import Optional
from datetime import date, timedelta

from app.singletons import get_pool
from app.db.redis_helpers import r_get_json, r_set, r_del

logger = logging.getLogger("medai.v6")


# ── Cache helpers ─────────────────────────────────────────────
async def _cache_get(key: str) -> Optional[dict]:
    """Get from Redis cache. Returns None on miss."""
    try:
        return await r_get_json(key)
    except Exception:
        return None


async def _cache_set(key: str, data, ttl: int = 300):
    """Set Redis cache."""
    try:
        await r_set(key, data, ttl=ttl)
    except Exception as e:
        logger.debug(f"Cache set error: {e}")


async def _cache_del(key: str):
    """Delete Redis cache key."""
    try:
        await r_del(key)
    except Exception:
        pass


async def db_fetchrow(sql: str, *args) -> Optional[dict]:
    pool = await get_pool()
    row  = await pool.fetchrow(sql, *args)
    return dict(row) if row else None


async def db_fetch(sql: str, *args) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(sql, *args)
    return [dict(r) for r in rows]


async def db_execute(sql: str, *args) -> str:
    pool = await get_pool()
    return await pool.execute(sql, *args)


async def get_user_by_phone(phone: str) -> Optional[dict]:
    # Normalize phone to bare 10 digits for consistent lookups
    from app.models import normalize_phone
    phone = normalize_phone(phone)

    # Try cache first
    cache_key = f"cache:user:{phone}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    row = await db_fetchrow(
        """SELECT u.id, u.phone, u.name, u.age, u.gender, u.allergies,
                  u.is_pregnant, u.onboarded, u.onboarding_step, u.consent_accepted,
                  u.preferred_language, u.chronic_conditions, u.egfr, u.address,
                  ARRAY_AGG(DISTINCT am.drug_name) FILTER (WHERE am.is_active) AS current_meds
           FROM users u
           LEFT JOIN active_medications am ON u.id = am.user_id AND am.is_active = TRUE
           WHERE u.phone = $1
           GROUP BY u.id""", phone)
    if row:
        await _cache_set(cache_key, row, ttl=300)
    return row


async def create_user(phone: str) -> dict:
    row = await db_fetchrow(
        """INSERT INTO users(phone, onboarded, onboarding_step)
           VALUES($1, FALSE, 'name')
           ON CONFLICT(phone) DO UPDATE SET updated_at = NOW()
           RETURNING id, phone, onboarded, onboarding_step, name, age, gender,
                     allergies, is_pregnant, consent_accepted, preferred_language""", phone)
    # Invalidate cache
    await _cache_del(f"cache:user:{phone}")
    return row


async def update_user(phone: str, **fields) -> dict:
    if not fields: return {}
    pool = await get_pool()
    sets = ", ".join(f"{k}=${i+2}" for i, k in enumerate(fields))
    row  = await pool.fetchrow(
        f"UPDATE users SET {sets}, updated_at=NOW() WHERE phone=$1 RETURNING id, phone, name, age, gender, allergies, is_pregnant, onboarded, onboarding_step",
        phone, *fields.values())
    # Invalidate cache on every write
    await _cache_del(f"cache:user:{phone}")
    return dict(row) if row else {}


async def get_recent_messages(session_id: str, limit: int = 6) -> list[dict]:
    rows = await db_fetch(
        "SELECT role, content, created_at FROM conversation_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT $2",
        session_id, limit)
    return list(reversed(rows))


async def get_session_summary(user_id: str) -> Optional[str]:
    row = await db_fetchrow(
        "SELECT summary_text FROM conversation_summaries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", user_id)
    return row["summary_text"] if row else None


async def get_drug_classes_for(drug: str) -> list[str]:
    cache_key = f"cache:classes:{drug.lower()}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached
    rows = await db_fetch("SELECT class_name FROM drug_classes WHERE drug_name=LOWER($1)", drug)
    result = [r["class_name"] for r in rows]
    await _cache_set(cache_key, result, ttl=3600)
    return result


async def get_drugs_in_class(cls: str) -> list[str]:
    cache_key = f"cache:drugs_in_class:{cls}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached
    rows = await db_fetch("SELECT drug_name FROM drug_classes WHERE class_name=$1", cls)
    result = [r["drug_name"] for r in rows]
    await _cache_set(cache_key, result, ttl=3600)
    return result


async def get_dosage_cap(drug: str) -> Optional[dict]:
    cache_key = f"cache:dosage:{drug.lower()}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached
    row = await db_fetchrow(
        """SELECT drug_name, adult_max_daily_mg, pediatric_max_mg_per_kg, single_dose_max_mg, notes
           FROM dosage_safety_caps WHERE drug_name=LOWER($1)""", drug)
    if row:
        await _cache_set(cache_key, row, ttl=3600)
    return row


async def get_inventory_fuzzy(query: str, limit: int = 5) -> list[dict]:
    return await db_fetch(
        """SELECT id, drug_name, brand_name, strength, form, stock_qty, unit, price_per_unit, is_otc, drug_class
           FROM inventory
           WHERE is_active=TRUE AND stock_qty>0
             AND (drug_name ILIKE $2 OR brand_name ILIKE $2
                  OR similarity(LOWER(drug_name), LOWER($1)) > 0.25
                  OR similarity(LOWER(brand_name), LOWER($1)) > 0.25)
           ORDER BY GREATEST(similarity(LOWER(drug_name),LOWER($1)),
                             similarity(LOWER(brand_name),LOWER($1))) DESC
           LIMIT $3""",
        query, f"%{query}%", limit)


async def check_stock(drug: str) -> Optional[dict]:
    cache_key = f"cache:stock:{drug.lower()}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached
    row = await db_fetchrow(
        """SELECT id, drug_name, brand_name, stock_qty, unit, price_per_unit, is_otc, strength, form, drug_class
           FROM inventory
           WHERE (LOWER(drug_name)=LOWER($1) OR LOWER(brand_name)=LOWER($1))
             AND is_active=TRUE AND stock_qty>0
           ORDER BY expiry_date ASC LIMIT 1""", drug)
    if row:
        await _cache_set(cache_key, row, ttl=60)  # Short TTL: stock changes frequently
    return row


async def log_audit(user_id: str, action: str, entity_type: str = None,
                    entity_id: str = None, old_val: dict = None,
                    new_val: dict = None, performed_by: str = "system"):
    await db_execute(
        """INSERT INTO audit_log(user_id, action, entity_type, entity_id, old_value, new_value, performed_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)""",
        user_id, action, entity_type, entity_id,
        json.dumps(old_val) if old_val else None,
        json.dumps(new_val) if new_val else None,
        performed_by)


async def log_health_event(user_id: str, event_type: str, title: str,
                           description: str = None, drug_name: str = None,
                           metadata: dict = None, episode_id: str = None):
    await db_execute(
        """INSERT INTO health_events(user_id, event_type, title, description, drug_name, metadata, episode_id)
           VALUES($1,$2,$3,$4,$5,$6,$7)""",
        user_id, event_type, title, description, drug_name,
        json.dumps(metadata or {}), episode_id)


async def update_adherence(user_id: str, drug_name: str, taken: bool):
    week_start = date.today() - timedelta(days=date.today().weekday())
    pool = await get_pool()
    row  = await pool.fetchrow(
        """INSERT INTO adherence_scores(user_id, drug_name, week_start, total_scheduled, total_taken, total_skipped)
           VALUES($1,$2,$3,1,$4,$5)
           ON CONFLICT(user_id, drug_name, week_start) DO UPDATE SET
               total_scheduled = adherence_scores.total_scheduled + 1,
               total_taken     = adherence_scores.total_taken + $4,
               total_skipped   = adherence_scores.total_skipped + $5
           RETURNING score""",
        user_id, drug_name, week_start,
        1 if taken else 0, 0 if taken else 1)
    if row:
        score = float(row["score"])
        flag  = "low" if score < 50 else ("medium" if score < 70 else "high")
        await pool.execute(
            "UPDATE adherence_scores SET risk_flag=$4 WHERE user_id=$1 AND drug_name=$2 AND week_start=$3",
            user_id, drug_name, week_start, flag)
        await pool.execute(
            """UPDATE users SET overall_adherence=(
                   SELECT ROUND(AVG(score),2) FROM adherence_scores
                   WHERE user_id=$1 AND week_start >= CURRENT_DATE - 28)
               WHERE id=$1""", user_id)


async def check_duplicate_order(user_id: str, drug_name: str, patient_id: str = None) -> Optional[dict]:
    """Check if same drug was ordered for same patient in last 24 hours."""
    target = patient_id or user_id
    return await db_fetchrow(
        """SELECT id, drug_name, quantity, status, ordered_at
           FROM orders
           WHERE patient_id=$1 AND LOWER(drug_name)=LOWER($2)
             AND status NOT IN ('cancelled')
             AND ordered_at > NOW() - INTERVAL '24 hours'
           ORDER BY ordered_at DESC LIMIT 1""",
        target, drug_name)


# ── Family Helpers ────────────────────────────────────────────

async def get_or_create_family(user_id: str, family_name: str = "My Family") -> dict:
    """Get existing family or create one. Returns family dict."""
    pool = await get_pool()
    # Check if user already has a family
    row = await pool.fetchrow(
        """SELECT f.* FROM families f
           JOIN family_members fm ON f.id = fm.family_id
           WHERE fm.user_id = $1 LIMIT 1""", user_id)
    if row:
        return dict(row)
    # Create new family
    row = await pool.fetchrow(
        """INSERT INTO families(name, created_by) VALUES($1, $2) RETURNING *""",
        family_name, user_id)
    family = dict(row)
    # Add creator as admin
    await pool.execute(
        """INSERT INTO family_members(family_id, user_id, role, can_order_for)
           VALUES($1, $2, 'admin', ARRAY[$2]::UUID[])
           ON CONFLICT DO NOTHING""",
        str(family["id"]), user_id)
    return family


async def add_family_member(family_id: str, member_user_id: str,
                             role: str = "dependent", admin_user_id: str = None,
                             relation: str = None) -> dict:
    """Add a user to a family. Also grants admin ordering rights."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """INSERT INTO family_members(family_id, user_id, role, relation)
           VALUES($1, $2, $3, $4)
           ON CONFLICT(family_id, user_id) DO UPDATE SET role=$3, relation=COALESCE($4, family_members.relation)
           RETURNING *""",
        family_id, member_user_id, role, relation)
    # Grant admin ordering rights for this member
    if admin_user_id:
        await pool.execute(
            """UPDATE family_members SET can_order_for = array_append(
                   COALESCE(can_order_for, '{}'), $2::UUID)
               WHERE family_id=$1 AND user_id=$3
                 AND NOT ($2::UUID = ANY(COALESCE(can_order_for, '{}')))""",
            family_id, member_user_id, admin_user_id)
    return dict(row) if row else {}


async def get_family_members(user_id: str) -> list[dict]:
    """Get all family members for a user."""
    return await db_fetch(
        """SELECT u.id, u.phone, u.name, u.age, u.gender, u.address,
                  fm.role, fm.relation, fm.can_order_for
           FROM family_members fm
           JOIN users u ON fm.user_id = u.id
           WHERE fm.family_id IN (
               SELECT family_id FROM family_members WHERE user_id = $1
           )
           ORDER BY fm.role, u.name""", user_id)


async def get_family_member_by_relation(user_id: str, relation: str) -> Optional[dict]:
    """Find a family member by relation, name, or keyword."""
    members = await get_family_members(user_id)
    rel = relation.lower().strip()

    # 1. Check stored relation column first (exact match)
    for m in members:
        if str(m["id"]) == str(user_id):
            continue  # Skip self
        stored_rel = (m.get("relation") or "").lower()
        if stored_rel and stored_rel == rel:
            return m

    # 2. Check name match
    for m in members:
        if str(m["id"]) == str(user_id):
            continue
        name = (m.get("name") or "").lower()
        if rel in name or name in rel:
            return m

    # 3. Partial relation match
    for m in members:
        if str(m["id"]) == str(user_id):
            continue
        stored_rel = (m.get("relation") or "").lower()
        if stored_rel and (rel in stored_rel or stored_rel in rel):
            return m

    # 4. Fallback: first non-self dependent
    for m in members:
        if str(m["id"]) != str(user_id) and m.get("role") in ("dependent", "caregiver"):
            return m
    return None

