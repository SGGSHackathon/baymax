"""
Redis helper wrappers — hardened with logging, safe JSON serialization,
and auto-deserialization.
"""

import json
import logging
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from app.config import C
from app.singletons import get_redis

logger = logging.getLogger("medai.v6")


class _SafeEncoder(json.JSONEncoder):
    """Handles UUID, Decimal, datetime, date from asyncpg rows."""
    def default(self, o):
        if isinstance(o, uuid.UUID):
            return str(o)
        if isinstance(o, Decimal):
            return float(o)
        if isinstance(o, datetime):
            return o.isoformat()
        if isinstance(o, date):
            return o.isoformat()
        if isinstance(o, set):
            return list(o)
        return super().default(o)


def _safe_dumps(val: Any) -> str:
    """JSON-serialize any value, handling DB types safely."""
    return json.dumps(val, cls=_SafeEncoder)


async def r_get(key: str) -> Optional[str]:
    rd = await get_redis()
    if rd:
        try:
            return await rd.get(key)
        except Exception as e:
            logger.error(f"Redis GET failed key={key}: {e}")
    return None


async def r_get_json(key: str) -> Optional[Any]:
    """Get and auto-deserialize JSON from Redis. Returns None on miss or error."""
    raw = await r_get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        logger.error(f"Redis JSON decode failed key={key}: {e}")
        return None


async def r_set(key: str, val: Any, ttl: int = C.CACHE_TTL):
    rd = await get_redis()
    if rd:
        try:
            data = _safe_dumps(val) if not isinstance(val, str) else val
            await rd.setex(key, ttl, data)
            logger.debug(f"Redis SET key={key} ttl={ttl}")
        except Exception as e:
            logger.error(f"Redis SET failed key={key}: {e}")


async def r_del(key: str):
    rd = await get_redis()
    if rd:
        try:
            await rd.delete(key)
        except Exception as e:
            logger.error(f"Redis DEL failed key={key}: {e}")


async def r_incr(key: str, ttl: int = 60) -> int:
    rd = await get_redis()
    if rd:
        try:
            v = await rd.incr(key)
            if v == 1:
                await rd.expire(key, ttl)
            return v
        except Exception as e:
            logger.error(f"Redis INCR failed key={key}: {e}")
    return 0
