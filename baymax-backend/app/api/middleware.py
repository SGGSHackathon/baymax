"""
HTTP middleware — rate limiter + observability.
Extracted from main_v6.py §20.
"""

import hashlib

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.responses import StreamingResponse

from app.config import C
from app.db.redis_helpers import r_incr
from app.observability.langfuse_client import get_trace, capture_exception, finalize_trace


def _derive_session_id(request: Request) -> str:
    explicit = request.headers.get("x-session-id") or request.query_params.get("session_id")
    if explicit:
        return explicit
    phone = request.headers.get("x-phone") or request.query_params.get("phone") or "anonymous"
    return f"http_{hashlib.md5(phone.encode()).hexdigest()[:12]}"


def _derive_user_id(request: Request) -> str:
    return request.headers.get("x-user-id") or request.query_params.get("user_id") or request.headers.get("x-phone") or request.query_params.get("phone") or "anonymous"


async def observability_middleware(request: Request, call_next):
    session_id = _derive_session_id(request)
    user_id = _derive_user_id(request)
    trace = get_trace(user_id=user_id, session_id=session_id)
    request.state.trace = trace

    def _finalize(status_code: int | None = None) -> None:
        finalize_trace(
            trace,
            status_code=status_code,
            metadata={
                "path": request.url.path,
                "method": request.method,
            },
        )

    try:
        response = await call_next(request)
    except Exception as exc:
        capture_exception(
            trace,
            exc,
            context="middleware.request",
            metadata={"path": request.url.path, "method": request.method},
        )
        _finalize(status_code=500)
        raise

    if isinstance(response, StreamingResponse):
        original_iterator = response.body_iterator

        async def wrapped_iterator():
            try:
                async for chunk in original_iterator:
                    yield chunk
            except Exception as exc:
                capture_exception(
                    trace,
                    exc,
                    context="middleware.streaming_response",
                    metadata={"path": request.url.path, "method": request.method},
                )
                raise
            finally:
                _finalize(status_code=response.status_code)

        response.body_iterator = wrapped_iterator()
        return response

    _finalize(status_code=response.status_code)
    return response


async def rate_limiter(request: Request, call_next):
    if request.url.path == "/whatsapp":
        phone = request.headers.get("X-Phone", "unknown")
        count = await r_incr(f"rate:{phone}", ttl=60)
        if count and count > C.RATE_LIMIT_MIN:
            return JSONResponse(status_code=429, content={"detail": "Too many requests"})
    return await call_next(request)
