"""
Admin CRUD Router — Full CRUD on every database table.
Prefix: /admin
All endpoints return JSON. Pagination via ?page=1&per_page=25.
"""

import json
import logging
import math
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.db.helpers import db_fetch, db_fetchrow, db_execute
from app.singletons import get_pool

logger = logging.getLogger("medai.admin")
router = APIRouter(prefix="/admin", tags=["admin"])


# ══════════════════════════════════════════════════════════════
# JSON serialization helper
# ══════════════════════════════════════════════════════════════

def _serialise(obj: Any) -> Any:
    """Make asyncpg types JSON-safe."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_serialise(i) for i in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, UUID):
        return str(obj)
    return obj


# ══════════════════════════════════════════════════════════════
# Table registry — one entry per table
# ══════════════════════════════════════════════════════════════
# Fields:
#   table       – real PostgreSQL table name
#   pk          – primary-key column (default "id")
#   pk_type     – "uuid" | "text" | "int"
#   search_cols – columns to full-text search on (?q=…)
#   order_by    – default ORDER BY clause

TABLE_REGISTRY: dict[str, dict] = {
    # ── Users & Access ────────────────────────────────────────
    "users": {
        "table": "users",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["phone", "name", "email"],
        "order_by": "created_at DESC",
    },
    "families": {
        "table": "families",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["name"],
        "order_by": "created_at DESC",
    },
    "family-members": {
        "table": "family_members",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["role", "relation"],
        "order_by": "added_at DESC",
    },

    # ── Drug Reference ────────────────────────────────────────
    "drug-classes": {
        "table": "drug_classes",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "class_name"],
        "order_by": "drug_name ASC",
    },
    "dosage-safety-caps": {
        "table": "dosage_safety_caps",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name"],
        "order_by": "drug_name ASC",
    },
    "drug-contraindications": {
        "table": "drug_contraindications",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "condition", "rationale"],
        "order_by": "drug_name ASC",
    },
    "duplicate-therapy-rules": {
        "table": "duplicate_therapy_rules",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_class", "warning"],
        "order_by": "drug_class ASC",
    },
    "renal-dose-rules": {
        "table": "renal_dose_rules",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "note"],
        "order_by": "drug_name ASC",
    },

    # ── Inventory & Orders ────────────────────────────────────
    "inventory": {
        "table": "inventory",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "brand_name", "composition", "category"],
        "order_by": "drug_name ASC",
    },
    "orders": {
        "table": "orders",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "order_number", "status"],
        "order_by": "ordered_at DESC",
    },

    # ── Medications & Reminders ───────────────────────────────
    "active-medications": {
        "table": "active_medications",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "brand_name", "prescribed_by"],
        "order_by": "created_at DESC",
    },
    "reminders": {
        "table": "reminders",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name"],
        "order_by": "created_at DESC",
    },
    "reminder-logs": {
        "table": "reminder_logs",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "ack_status"],
        "order_by": "created_at DESC",
    },
    "medicine-courses": {
        "table": "medicine_courses",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "status"],
        "order_by": "created_at DESC",
    },

    # ── Health Data ───────────────────────────────────────────
    "vitals": {
        "table": "vitals",
        "pk": "id", "pk_type": "uuid",
        "search_cols": [],
        "order_by": "recorded_at DESC",
    },
    "vital-trends": {
        "table": "vital_trends",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["vital_type", "trend"],
        "order_by": "computed_at DESC",
    },
    "adherence-scores": {
        "table": "adherence_scores",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "risk_flag"],
        "order_by": "created_at DESC",
    },
    "adverse-reactions": {
        "table": "adverse_reactions",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name", "reaction", "severity"],
        "order_by": "reported_at DESC",
    },
    "health-events": {
        "table": "health_events",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["event_type", "title", "drug_name"],
        "order_by": "occurred_at DESC",
    },
    "health-episodes": {
        "table": "health_episodes",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["episode_type", "status", "notes"],
        "order_by": "created_at DESC",
    },
    "medical-history": {
        "table": "medical_history",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["condition", "status", "notes"],
        "order_by": "created_at DESC",
    },
    "symptom-followups": {
        "table": "symptom_followups",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["symptom", "response"],
        "order_by": "created_at DESC",
    },

    # ── Conversations ─────────────────────────────────────────
    "conversations": {
        "table": "conversations",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["session_id", "channel"],
        "order_by": "last_active DESC",
    },
    "conversation-messages": {
        "table": "conversation_messages",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["content", "role", "agent_used", "intent"],
        "order_by": "created_at DESC",
    },
    "conversation-summaries": {
        "table": "conversation_summaries",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["summary_text"],
        "order_by": "created_at DESC",
    },

    # ── Clinical & AI Logs ────────────────────────────────────
    "extracted-medical-facts": {
        "table": "extracted_medical_facts",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["fact_type", "value", "source_msg"],
        "order_by": "created_at DESC",
    },
    "clinical-decision-log": {
        "table": "clinical_decision_log",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name"],
        "order_by": "created_at DESC",
    },
    "dfe-question-log": {
        "table": "dfe_question_log",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["symptom_context", "missing_field", "question_generated"],
        "order_by": "created_at DESC",
    },
    "web-search-log": {
        "table": "web_search_log",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["query", "trigger_type", "domain_used"],
        "order_by": "created_at DESC",
    },
    "dfe-field-registry": {
        "table": "dfe_field_registry",
        "pk": "field_name", "pk_type": "text",
        "search_cols": ["field_name", "priority_cat", "description"],
        "order_by": "weight DESC",
    },
    "user-behavioral-profiles": {
        "table": "user_behavioral_profiles",
        "pk": "user_id", "pk_type": "uuid",
        "search_cols": ["preferred_channel"],
        "order_by": "last_updated DESC",
    },

    # ── Admin & Audit ─────────────────────────────────────────
    "audit-log": {
        "table": "audit_log",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["action", "entity_type", "performed_by"],
        "order_by": "occurred_at DESC",
    },
    "abuse-scores": {
        "table": "abuse_scores",
        "pk": "user_id", "pk_type": "uuid",
        "search_cols": ["notes"],
        "order_by": "last_updated DESC",
    },
    "user-consents": {
        "table": "user_consents",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["consent_type"],
        "order_by": "accepted_at DESC",
    },

    # ── Prescriptions ─────────────────────────────────────────
    "prescription-uploads": {
        "table": "prescription_uploads",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["s3_key", "ocr_status", "error_message"],
        "order_by": "created_at DESC",
    },
    "prescription-extracted-drugs": {
        "table": "prescription_extracted_drugs",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["drug_name_raw", "drug_name_matched", "brand_name"],
        "order_by": "created_at DESC",
    },
    "prescription-observations": {
        "table": "prescription_observations",
        "pk": "id", "pk_type": "uuid",
        "search_cols": ["observation_text", "observation_type", "body_part"],
        "order_by": "created_at DESC",
    },
}


# ══════════════════════════════════════════════════════════════
# Helper: safe identifier check
# ══════════════════════════════════════════════════════════════

_IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

def _safe_ident(value: str) -> str:
    """Ensure a value is a safe SQL identifier (column/table name)."""
    if not _IDENT_RE.match(value):
        raise HTTPException(400, f"Invalid identifier: {value}")
    return value


def _cast_pk(pk_type: str, value: str):
    """Cast the PK string from the URL to the correct Python type."""
    if pk_type == "uuid":
        try:
            return UUID(value)
        except Exception:
            raise HTTPException(400, "Invalid UUID")
    if pk_type == "int":
        try:
            return int(value)
        except Exception:
            raise HTTPException(400, "Invalid integer ID")
    return value  # text


# ══════════════════════════════════════════════════════════════
# Schema introspection (column listing)
# ══════════════════════════════════════════════════════════════

_COLUMN_CACHE: dict[str, list[dict]] = {}


async def _get_columns(table_name: str) -> list[dict]:
    """Return column metadata from information_schema. Cached per table."""
    if table_name in _COLUMN_CACHE:
        return _COLUMN_CACHE[table_name]
    rows = await db_fetch(
        """SELECT column_name, data_type, is_nullable, column_default,
                  is_generated
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position""",
        table_name,
    )
    _COLUMN_CACHE[table_name] = rows
    return rows


async def _writable_columns(table_name: str) -> set[str]:
    """Return set of column names that can be written (skip generated, serial, pk defaults)."""
    cols = await _get_columns(table_name)
    skip = set()
    for c in cols:
        name = c["column_name"]
        # Skip GENERATED ALWAYS columns
        if c.get("is_generated") and c["is_generated"] != "NEVER":
            skip.add(name)
            continue
        # Skip auto-timestamp columns only when they have a default
        if name in ("created_at", "updated_at", "ordered_at", "added_at",
                     "reported_at", "occurred_at", "accepted_at",
                     "last_updated", "computed_at", "recorded_at",
                     "started_at") and c.get("column_default"):
            skip.add(name)
    return {c["column_name"] for c in cols} - skip


# ══════════════════════════════════════════════════════════════
# List tables endpoint
# ══════════════════════════════════════════════════════════════

@router.get("/tables")
async def list_tables():
    """Return all manageable table slugs with metadata."""
    out = []
    for slug, cfg in TABLE_REGISTRY.items():
        out.append({
            "slug": slug,
            "table": cfg["table"],
            "pk": cfg["pk"],
            "search_cols": cfg["search_cols"],
        })
    return out


# ══════════════════════════════════════════════════════════════
# Schema endpoint — column info for a table
# ══════════════════════════════════════════════════════════════

@router.get("/tables/{slug}/schema")
async def table_schema(slug: str):
    cfg = TABLE_REGISTRY.get(slug)
    if not cfg:
        raise HTTPException(404, f"Unknown table: {slug}")
    cols = await _get_columns(cfg["table"])
    return {"slug": slug, "table": cfg["table"], "columns": _serialise(cols)}


# ══════════════════════════════════════════════════════════════
# Dashboard stats endpoint
# ══════════════════════════════════════════════════════════════

@router.get("/stats")
async def dashboard_stats():
    """Quick counts for every table — used by the admin dashboard."""
    counts = {}
    for slug, cfg in TABLE_REGISTRY.items():
        row = await db_fetchrow(f'SELECT COUNT(*) AS cnt FROM {_safe_ident(cfg["table"])}')
        counts[slug] = row["cnt"] if row else 0
    return counts


# ══════════════════════════════════════════════════════════════
# Generic CRUD functions
# ══════════════════════════════════════════════════════════════

async def _list_rows(
    cfg: dict,
    page: int = 1,
    per_page: int = 25,
    q: Optional[str] = None,
    sort: Optional[str] = None,
    order: str = "desc",
    filters: Optional[dict] = None,
) -> dict:
    """Paginated list with optional search & sort."""
    table = _safe_ident(cfg["table"])
    params: list[Any] = []
    wheres: list[str] = []
    idx = 1

    # Full-text search across searchable columns
    if q and cfg["search_cols"]:
        or_parts = []
        for col in cfg["search_cols"]:
            _safe_ident(col)
            or_parts.append(f"{col}::TEXT ILIKE ${idx}")
        params.append(f"%{q}%")
        idx += 1
        wheres.append(f"({' OR '.join(or_parts)})")

    # Exact-match filters (?filter_status=active, ?filter_user_id=...)
    if filters:
        for col, val in filters.items():
            _safe_ident(col)
            wheres.append(f"{col}::TEXT = ${idx}")
            params.append(val)
            idx += 1

    where_sql = (" WHERE " + " AND ".join(wheres)) if wheres else ""

    # Count
    count_row = await db_fetchrow(f"SELECT COUNT(*) AS total FROM {table}{where_sql}", *params)
    total = count_row["total"] if count_row else 0

    # Sort
    if sort:
        _safe_ident(sort)
        order_sql = f"{sort} {'ASC' if order.lower() == 'asc' else 'DESC'}"
    else:
        order_sql = cfg["order_by"]

    # Pagination
    offset = (page - 1) * per_page
    params.extend([per_page, offset])
    limit_idx = idx
    data_sql = (
        f"SELECT * FROM {table}{where_sql} "
        f"ORDER BY {order_sql} "
        f"LIMIT ${limit_idx} OFFSET ${limit_idx + 1}"
    )
    rows = await db_fetch(data_sql, *params)

    return {
        "table": cfg["table"],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": max(1, -(-total // per_page)),
        "data": _serialise(rows),
    }


async def _get_row(cfg: dict, pk_value) -> dict:
    table = _safe_ident(cfg["table"])
    pk = _safe_ident(cfg["pk"])
    row = await db_fetchrow(f"SELECT * FROM {table} WHERE {pk} = $1", pk_value)
    if not row:
        raise HTTPException(404, "Row not found")
    return _serialise(row)


async def _create_row(cfg: dict, body: dict) -> dict:
    table = _safe_ident(cfg["table"])
    writable = await _writable_columns(cfg["table"])

    # Only insert writable columns that are present in body
    cols = [k for k in body if k in writable and body[k] is not None]
    if not cols:
        raise HTTPException(400, "No valid columns provided")

    col_names = ", ".join(_safe_ident(c) for c in cols)
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    values = [body[c] for c in cols]

    row = await db_fetchrow(
        f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) RETURNING *",
        *values,
    )
    if not row:
        raise HTTPException(500, "Insert failed")
    return _serialise(row)


async def _update_row(cfg: dict, pk_value, body: dict) -> dict:
    table = _safe_ident(cfg["table"])
    pk = _safe_ident(cfg["pk"])
    writable = await _writable_columns(cfg["table"])

    # Filter to writable columns only; skip PK itself
    cols = [k for k in body if k in writable and k != cfg["pk"]]
    if not cols:
        raise HTTPException(400, "No updatable columns provided")

    set_parts = [f"{_safe_ident(c)} = ${i+1}" for i, c in enumerate(cols)]
    values = [body[c] for c in cols]
    values.append(pk_value)

    row = await db_fetchrow(
        f"UPDATE {table} SET {', '.join(set_parts)} WHERE {pk} = ${len(values)} RETURNING *",
        *values,
    )
    if not row:
        raise HTTPException(404, "Row not found")

    # Bust column cache for this table in case schema changed
    _COLUMN_CACHE.pop(cfg["table"], None)
    return _serialise(row)


async def _delete_row(cfg: dict, pk_value) -> dict:
    table = _safe_ident(cfg["table"])
    pk = _safe_ident(cfg["pk"])
    row = await db_fetchrow(
        f"DELETE FROM {table} WHERE {pk} = $1 RETURNING *", pk_value
    )
    if not row:
        raise HTTPException(404, "Row not found")
    return {"deleted": True, "row": _serialise(row)}


# ══════════════════════════════════════════════════════════════
# Dynamic CRUD routes for every registered table
# ══════════════════════════════════════════════════════════════

@router.get("/crud/{slug}")
async def crud_list(
    slug: str,
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    q: Optional[str] = Query(None, description="Search across text columns"),
    sort: Optional[str] = Query(None, description="Column to sort by"),
    order: str = Query("desc", regex="^(asc|desc)$"),
):
    """List rows with pagination, search, sort, and column filters.

    Extra query params prefixed with `filter_` become exact-match WHERE clauses.
    Example: ?filter_status=active&filter_user_id=<uuid>
    """
    cfg = TABLE_REGISTRY.get(slug)
    if not cfg:
        raise HTTPException(404, f"Unknown table: {slug}")

    # Collect filter_* params
    filters = {}
    for k, v in request.query_params.items():
        if k.startswith("filter_"):
            col = k[7:]  # strip "filter_"
            filters[col] = v

    return await _list_rows(cfg, page, per_page, q, sort, order, filters or None)


@router.get("/crud/{slug}/{pk_value}")
async def crud_get(slug: str, pk_value: str):
    """Get a single row by primary key."""
    cfg = TABLE_REGISTRY.get(slug)
    if not cfg:
        raise HTTPException(404, f"Unknown table: {slug}")
    pk = _cast_pk(cfg["pk_type"], pk_value)
    return await _get_row(cfg, pk)


@router.post("/crud/{slug}")
async def crud_create(slug: str, request: Request):
    """Create a new row. Body is JSON with column:value pairs."""
    cfg = TABLE_REGISTRY.get(slug)
    if not cfg:
        raise HTTPException(404, f"Unknown table: {slug}")
    body = await request.json()
    return await _create_row(cfg, body)


@router.put("/crud/{slug}/{pk_value}")
async def crud_update(slug: str, pk_value: str, request: Request):
    """Update an existing row. Body is JSON with column:value pairs."""
    cfg = TABLE_REGISTRY.get(slug)
    if not cfg:
        raise HTTPException(404, f"Unknown table: {slug}")
    pk = _cast_pk(cfg["pk_type"], pk_value)
    body = await request.json()
    return await _update_row(cfg, pk, body)


@router.delete("/crud/{slug}/{pk_value}")
async def crud_delete(slug: str, pk_value: str):
    """Delete a row by primary key."""
    cfg = TABLE_REGISTRY.get(slug)
    if not cfg:
        raise HTTPException(404, f"Unknown table: {slug}")
    pk = _cast_pk(cfg["pk_type"], pk_value)
    return await _delete_row(cfg, pk)


# ══════════════════════════════════════════════════════════════
# Bulk operations
# ══════════════════════════════════════════════════════════════

@router.post("/crud/{slug}/bulk-delete")
async def crud_bulk_delete(slug: str, request: Request):
    """Delete multiple rows. Body: {"ids": ["pk1", "pk2", ...]}"""
    cfg = TABLE_REGISTRY.get(slug)
    if not cfg:
        raise HTTPException(404, f"Unknown table: {slug}")
    body = await request.json()
    ids = body.get("ids", [])
    if not ids:
        raise HTTPException(400, "No IDs provided")

    table = _safe_ident(cfg["table"])
    pk = _safe_ident(cfg["pk"])
    cast_ids = [_cast_pk(cfg["pk_type"], i) for i in ids]
    result = await db_execute(
        f"DELETE FROM {table} WHERE {pk} = ANY($1)", cast_ids
    )
    count = int(result.split()[-1]) if result else 0
    return {"deleted": count}


# ══════════════════════════════════════════════════════════════
# Existing admin endpoints (migrated from routes.py)
# Keep them here under /admin prefix for backward compat
# ══════════════════════════════════════════════════════════════

@router.get("/abuse-risk")
async def abuse_risk_list():
    """Users flagged for abuse review."""
    from app.config import C
    return await db_fetch(
        """SELECT u.phone, u.name, ab.score, ab.flags, ab.review_required, ab.blocked
           FROM abuse_scores ab JOIN users u ON ab.user_id=u.id
           WHERE ab.score >= $1 OR ab.review_required=TRUE
           ORDER BY ab.score DESC""",
        C.ABUSE_REVIEW_SCORE,
    )


@router.get("/vital-trend-alerts")
async def vital_trend_alerts():
    """Vital trends needing attention."""
    return await db_fetch("SELECT * FROM vital_trend_alerts_view")


@router.get("/cde-log")
async def cde_log(limit: int = 50):
    """Clinical Decision Engine audit log."""
    return await db_fetch(
        "SELECT * FROM clinical_decision_log ORDER BY created_at DESC LIMIT $1", limit
    )


# ══════════════════════════════════════════════════════════════
# Proactive Refill Alerts — patients running low
# ══════════════════════════════════════════════════════════════

@router.get("/refill-alerts")
async def refill_alerts():
    """Patients whose medicine courses / reminders are running low.

    Combines two sources:
    1. `reminders` with qty_remaining <= refill_alert_at
    2. `medicine_courses` with qty_remaining <= 3 days worth of doses

    Returns a unified list sorted by urgency (fewest remaining first).
    """
    rows = await db_fetch(
        """
        -- Source 1: reminder-based refills (existing refill_due_view logic)
        SELECT
            r.id              AS record_id,
            'reminder'        AS source,
            r.user_id,
            u.phone,
            u.name            AS patient_name,
            r.drug_name,
            r.qty_remaining,
            r.refill_alert_at,
            r.end_date,
            r.is_active,
            CASE
                WHEN r.qty_remaining <= 0 THEN 'out_of_stock'
                WHEN r.qty_remaining <= r.refill_alert_at THEN 'critical'
                ELSE 'low'
            END AS urgency,
            r.updated_at
        FROM reminders r
        JOIN users u ON r.patient_id = u.id
        WHERE r.is_active = TRUE
          AND r.qty_remaining IS NOT NULL
          AND r.qty_remaining <= r.refill_alert_at

        UNION ALL

        -- Source 2: medicine-course-based refills
        SELECT
            mc.id             AS record_id,
            'course'          AS source,
            mc.user_id,
            u.phone,
            u.name            AS patient_name,
            mc.drug_name,
            mc.qty_remaining,
            3                 AS refill_alert_at,
            mc.end_date,
            (mc.status = 'active') AS is_active,
            CASE
                WHEN mc.qty_remaining <= 0 THEN 'out_of_stock'
                WHEN mc.qty_remaining <= mc.frequency THEN 'critical'
                ELSE 'low'
            END AS urgency,
            mc.updated_at
        FROM medicine_courses mc
        JOIN users u ON mc.user_id = u.id
        WHERE mc.status = 'active'
          AND mc.qty_remaining IS NOT NULL
          AND mc.qty_remaining <= (mc.frequency * 3)

        ORDER BY qty_remaining ASC, updated_at DESC
        """
    )
    return _serialise(rows)


@router.get("/refill-forecast")
async def refill_forecast(days_ahead: int = Query(14, ge=1, le=90)):
    """Predict which patients will need refills in the next N days.

    For every active reminder / course, estimate:
      - daily_consumption = frequency (doses per day)
      - remaining_days   = qty_remaining / daily_consumption
      - predicted_runout = today + remaining_days

    Returns patients whose predicted runout is within `days_ahead`.
    """
    today = date.today()
    cutoff = today + timedelta(days=days_ahead)

    rows = await db_fetch(
        """
        WITH consumption AS (
            -- Reminders: infer daily consumption from array length of remind_times
            SELECT
                r.id                       AS record_id,
                'reminder'                 AS source,
                r.user_id,
                u.phone,
                u.name                     AS patient_name,
                r.drug_name,
                r.qty_remaining,
                COALESCE(ARRAY_LENGTH(r.remind_times, 1), 1) AS daily_doses,
                r.end_date,
                r.updated_at
            FROM reminders r
            JOIN users u ON r.patient_id = u.id
            WHERE r.is_active = TRUE
              AND r.qty_remaining IS NOT NULL
              AND r.qty_remaining > 0

            UNION ALL

            -- Medicine courses: frequency = doses/day
            SELECT
                mc.id                      AS record_id,
                'course'                   AS source,
                mc.user_id,
                u.phone,
                u.name                     AS patient_name,
                mc.drug_name,
                mc.qty_remaining,
                GREATEST(mc.frequency, 1)  AS daily_doses,
                mc.end_date,
                mc.updated_at
            FROM medicine_courses mc
            JOIN users u ON mc.user_id = u.id
            WHERE mc.status = 'active'
              AND mc.qty_remaining IS NOT NULL
              AND mc.qty_remaining > 0
        )
        SELECT *,
               CEIL(qty_remaining::NUMERIC / daily_doses) AS remaining_days,
               CURRENT_DATE + (CEIL(qty_remaining::NUMERIC / daily_doses))::INT AS predicted_runout
        FROM consumption
        WHERE CURRENT_DATE + (CEIL(qty_remaining::NUMERIC / daily_doses))::INT <= $1
        ORDER BY predicted_runout ASC, qty_remaining ASC
        """,
        cutoff,
    )
    return {
        "days_ahead": days_ahead,
        "cutoff_date": cutoff.isoformat(),
        "patients_needing_refill": len(rows),
        "data": _serialise(rows),
    }


# ══════════════════════════════════════════════════════════════
# Future Stock Prediction — inventory demand forecasting
# ══════════════════════════════════════════════════════════════

@router.get("/stock-prediction")
async def stock_prediction(
    days_ahead: int = Query(30, ge=1, le=180),
    include_all: bool = Query(False, description="Include drugs with sufficient stock too"),
):
    """Predict future inventory stock levels for every active drug.

    Methodology:
      1. **Historical demand** — average daily units ordered over the last 90 days.
      2. **Active consumption** — sum of daily doses across all active reminders &
         courses for each drug (real-time demand signal).
      3. Blended daily rate = MAX(historical_avg, active_consumption) to be conservative.
      4. predicted_stock_in_N_days = current_stock - (blended_rate × N)
      5. days_until_stockout = current_stock / blended_rate

    Returns per-drug forecast sorted by days_until_stockout (most urgent first).
    """
    rows = await db_fetch(
        """
        WITH historic_demand AS (
            -- Average daily units ordered per drug in past 90 days
            SELECT
                LOWER(drug_name) AS drug,
                COALESCE(SUM(quantity)::NUMERIC / NULLIF(90, 0), 0) AS avg_daily_ordered
            FROM orders
            WHERE ordered_at >= NOW() - INTERVAL '90 days'
              AND status NOT IN ('cancelled')
            GROUP BY LOWER(drug_name)
        ),
        active_consumption AS (
            -- Sum daily doses from active reminders per drug
            SELECT
                LOWER(r.drug_name) AS drug,
                SUM(COALESCE(ARRAY_LENGTH(r.remind_times, 1), 1))::NUMERIC AS total_daily_doses
            FROM reminders r
            WHERE r.is_active = TRUE
            GROUP BY LOWER(r.drug_name)

            UNION ALL

            -- Sum daily doses from active courses per drug
            SELECT
                LOWER(mc.drug_name) AS drug,
                SUM(GREATEST(mc.frequency, 1))::NUMERIC AS total_daily_doses
            FROM medicine_courses mc
            WHERE mc.status = 'active'
            GROUP BY LOWER(mc.drug_name)
        ),
        active_agg AS (
            SELECT drug, SUM(total_daily_doses) AS active_daily
            FROM active_consumption
            GROUP BY drug
        ),
        forecast AS (
            SELECT
                i.id,
                i.drug_name,
                i.brand_name,
                i.stock_qty                  AS current_stock,
                i.reorder_level,
                i.unit,
                i.expiry_date,
                i.is_active,
                COALESCE(hd.avg_daily_ordered, 0)   AS hist_daily_demand,
                COALESCE(aa.active_daily, 0)         AS active_daily_demand,
                GREATEST(
                    COALESCE(hd.avg_daily_ordered, 0),
                    COALESCE(aa.active_daily, 0),
                    0.01   -- floor to avoid div-by-zero for never-ordered drugs
                ) AS blended_daily_rate
            FROM inventory i
            LEFT JOIN historic_demand hd ON LOWER(i.drug_name) = hd.drug
            LEFT JOIN active_agg      aa ON LOWER(i.drug_name) = aa.drug
            WHERE i.is_active = TRUE
        )
        SELECT *,
               ROUND(stock_qty_forecast, 0)          AS predicted_stock,
               ROUND(raw_stockout_days, 1)            AS days_until_stockout,
               reorder_flag
        FROM (
            SELECT f.*,
                   f.current_stock - (f.blended_daily_rate * $1) AS stock_qty_forecast,
                   f.current_stock / f.blended_daily_rate        AS raw_stockout_days,
                   CASE
                       WHEN f.current_stock <= f.reorder_level THEN 'reorder_now'
                       WHEN f.current_stock - (f.blended_daily_rate * $1) <= f.reorder_level THEN 'reorder_soon'
                       ELSE 'sufficient'
                   END AS reorder_flag
            FROM forecast f
        ) sub
        ORDER BY
            CASE reorder_flag
                WHEN 'reorder_now'  THEN 0
                WHEN 'reorder_soon' THEN 1
                ELSE 2
            END,
            raw_stockout_days ASC
        """,
        days_ahead,
    )

    # Optionally filter to only items needing attention
    if not include_all:
        rows = [r for r in rows if r.get("reorder_flag") != "sufficient"]

    # Summary stats
    now_count = sum(1 for r in rows if r.get("reorder_flag") == "reorder_now")
    soon_count = sum(1 for r in rows if r.get("reorder_flag") == "reorder_soon")

    return {
        "days_ahead": days_ahead,
        "reorder_now": now_count,
        "reorder_soon": soon_count,
        "total_items": len(rows),
        "data": _serialise(rows),
    }


@router.get("/stock-prediction/{drug_name}")
async def stock_prediction_drug(
    drug_name: str,
    days_ahead: int = Query(30, ge=1, le=180),
):
    """Detailed stock forecast for a single drug.

    Returns daily breakdown: [day_1_stock, day_2_stock, ... day_N_stock]
    plus order history, expiry info, and active patient count.
    """
    drug_lower = drug_name.strip().lower()

    # Current inventory
    inv_rows = await db_fetch(
        """SELECT id, drug_name, brand_name, stock_qty, reorder_level,
                  unit, expiry_date, times_ordered, price_per_unit
           FROM inventory
           WHERE LOWER(drug_name) = $1 AND is_active = TRUE
           ORDER BY expiry_date ASC""",
        drug_lower,
    )
    if not inv_rows:
        raise HTTPException(404, f"No active inventory for '{drug_name}'")

    total_stock = sum(r["stock_qty"] for r in inv_rows)

    # Historic daily demand (90d window)
    hist = await db_fetchrow(
        """SELECT COALESCE(SUM(quantity)::NUMERIC / 90, 0) AS avg_daily
           FROM orders
           WHERE LOWER(drug_name) = $1
             AND ordered_at >= NOW() - INTERVAL '90 days'
             AND status != 'cancelled'""",
        drug_lower,
    )
    hist_daily = float(hist["avg_daily"]) if hist else 0.0

    # Active consumption (reminders + courses)
    active = await db_fetchrow(
        """SELECT COALESCE(SUM(daily), 0) AS total_daily FROM (
               SELECT SUM(COALESCE(ARRAY_LENGTH(r.remind_times, 1), 1)) AS daily
               FROM reminders r WHERE r.is_active = TRUE AND LOWER(r.drug_name) = $1
             UNION ALL
               SELECT SUM(GREATEST(mc.frequency, 1)) AS daily
               FROM medicine_courses mc WHERE mc.status = 'active' AND LOWER(mc.drug_name) = $1
           ) sub""",
        drug_lower,
    )
    active_daily = float(active["total_daily"]) if active else 0.0

    blended = max(hist_daily, active_daily, 0.01)

    # Active patients on this drug
    patients = await db_fetch(
        """SELECT DISTINCT u.id, u.phone, u.name
           FROM reminders r
           JOIN users u ON r.patient_id = u.id
           WHERE r.is_active = TRUE AND LOWER(r.drug_name) = $1

           UNION

           SELECT DISTINCT u.id, u.phone, u.name
           FROM medicine_courses mc
           JOIN users u ON mc.user_id = u.id
           WHERE mc.status = 'active' AND LOWER(mc.drug_name) = $1""",
        drug_lower,
    )

    # Recent order history (last 30 orders)
    recent_orders = await db_fetch(
        """SELECT order_number, quantity, status, ordered_at
           FROM orders
           WHERE LOWER(drug_name) = $1
           ORDER BY ordered_at DESC LIMIT 30""",
        drug_lower,
    )

    # Daily forecast curve
    daily_forecast = []
    stock = float(total_stock)
    for day in range(1, days_ahead + 1):
        stock -= blended
        daily_forecast.append({
            "day": day,
            "date": (date.today() + timedelta(days=day)).isoformat(),
            "predicted_stock": round(max(stock, 0), 1),
        })

    days_until_stockout = total_stock / blended if blended > 0 else None
    reorder_date = None
    if days_until_stockout is not None:
        # Reorder should trigger when stock hits reorder_level
        reorder_level = inv_rows[0]["reorder_level"] or 0
        days_until_reorder = max((total_stock - reorder_level) / blended, 0)
        reorder_date = (date.today() + timedelta(days=int(math.ceil(days_until_reorder)))).isoformat()

    return {
        "drug_name": drug_name,
        "inventory_batches": _serialise(inv_rows),
        "total_current_stock": total_stock,
        "demand": {
            "historic_daily_avg": round(hist_daily, 2),
            "active_daily_consumption": round(active_daily, 2),
            "blended_daily_rate": round(blended, 2),
        },
        "forecast": {
            "days_ahead": days_ahead,
            "days_until_stockout": round(days_until_stockout, 1) if days_until_stockout else None,
            "predicted_reorder_date": reorder_date,
            "predicted_stock_at_end": round(max(total_stock - blended * days_ahead, 0), 1),
            "daily": daily_forecast,
        },
        "active_patients": _serialise(patients),
        "active_patient_count": len(patients),
        "recent_orders": _serialise(recent_orders),
    }


@router.get("/expiry-risk")
async def expiry_risk(days_ahead: int = Query(60, ge=1, le=365)):
    """Inventory items expiring within N days, with estimated waste.

    For each expiring batch, estimates whether current demand will consume
    the stock before expiry — or if it will go to waste.
    """
    cutoff = date.today() + timedelta(days=days_ahead)

    rows = await db_fetch(
        """
        WITH expiring AS (
            SELECT
                i.id, i.drug_name, i.brand_name, i.stock_qty,
                i.unit, i.expiry_date, i.price_per_unit,
                (i.expiry_date - CURRENT_DATE) AS days_left
            FROM inventory i
            WHERE i.is_active = TRUE
              AND i.expiry_date IS NOT NULL
              AND i.expiry_date <= $1
            ORDER BY i.expiry_date ASC
        ),
        demand AS (
            SELECT
                LOWER(drug_name) AS drug,
                COALESCE(SUM(quantity)::NUMERIC / NULLIF(90, 0), 0) AS avg_daily
            FROM orders
            WHERE ordered_at >= NOW() - INTERVAL '90 days'
              AND status != 'cancelled'
            GROUP BY LOWER(drug_name)
        )
        SELECT
            e.*,
            COALESCE(d.avg_daily, 0)                AS daily_demand,
            ROUND(COALESCE(d.avg_daily, 0) * e.days_left, 0) AS units_consumed_before_expiry,
            GREATEST(e.stock_qty - ROUND(COALESCE(d.avg_daily, 0) * e.days_left, 0), 0) AS estimated_waste_units,
            ROUND(
                GREATEST(e.stock_qty - ROUND(COALESCE(d.avg_daily, 0) * e.days_left, 0), 0)
                * COALESCE(e.price_per_unit, 0), 2
            ) AS estimated_waste_value,
            CASE
                WHEN e.days_left <= 7 THEN 'critical'
                WHEN e.days_left <= 30 THEN 'warning'
                ELSE 'watch'
            END AS risk_level
        FROM expiring e
        LEFT JOIN demand d ON LOWER(e.drug_name) = d.drug
        ORDER BY e.expiry_date ASC
        """,
        cutoff,
    )

    total_waste_value = sum(float(r.get("estimated_waste_value", 0)) for r in rows)

    return {
        "days_ahead": days_ahead,
        "cutoff_date": cutoff.isoformat(),
        "expiring_items": len(rows),
        "total_estimated_waste_value": round(total_waste_value, 2),
        "data": _serialise(rows),
    }
