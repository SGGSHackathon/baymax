"""
HTTP middleware — rate limiter.
Extracted from main_v6.py §20.
"""

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import C
from app.db.redis_helpers import r_incr


async def rate_limiter(request: Request, call_next):
    if request.url.path == "/whatsapp":
        phone = request.headers.get("X-Phone", "unknown")
        count = await r_incr(f"rate:{phone}", ttl=60)
        if count and count > C.RATE_LIMIT_MIN:
            return JSONResponse(status_code=429, content={"detail": "Too many requests"})
    return await call_next(request)
