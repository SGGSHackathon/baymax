from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, Optional

from app.config import C

logger = logging.getLogger("medai.v6")


@lru_cache(maxsize=1)
def _get_langfuse_client() -> Optional[Any]:
    public_key = C.LANGFUSE_PUBLIC_KEY
    secret_key = C.LANGFUSE_SECRET_KEY
    host = C.LANGFUSE_HOST

    if not public_key or not secret_key or not host:
        logger.info("Langfuse disabled: missing LANGFUSE_PUBLIC_KEY/SECRET_KEY/HOST")
        return None

    try:
        from langfuse import Langfuse

        client = Langfuse(public_key=public_key, secret_key=secret_key, host=host)
        logger.info("Langfuse enabled: host=%s", host)
        return client
    except Exception as exc:
        logger.error("Langfuse init failed: %s", exc, exc_info=True)
        return None


def _safe_call(target: Any, method: str, **kwargs: Any) -> Any:
    if target is None:
        return None
    fn = getattr(target, method, None)
    if not callable(fn):
        return None
    try:
        return fn(**kwargs)
    except Exception as exc:
        logger.error("Langfuse %s failed: %s", method, exc, exc_info=True)
        return None


def get_trace(user_id: str, session_id: str) -> Optional[Any]:
    client = _get_langfuse_client()
    if client is None:
        return None
    try:
        return client.trace(
            user_id=user_id or "anonymous",
            session_id=session_id or "unknown-session",
            name="http.request",
        )
    except Exception as exc:
        logger.error("Langfuse trace creation failed: %s", exc, exc_info=True)
        return None


def start_generation(trace: Any, *, name: str, model: str, input_data: Any = None, metadata: dict[str, Any] | None = None) -> Optional[Any]:
    return _safe_call(
        trace,
        "generation",
        name=name,
        model=model,
        input=input_data,
        metadata=metadata or {},
    )


def start_span(trace: Any, *, name: str, input_data: Any = None, metadata: dict[str, Any] | None = None) -> Optional[Any]:
    return _safe_call(
        trace,
        "span",
        name=name,
        input=input_data,
        metadata=metadata or {},
    )


def end_observation(observation: Any, *, output: Any = None, level: str | None = None, status_message: str | None = None, metadata: dict[str, Any] | None = None) -> None:
    if observation is None:
        return
    kwargs: dict[str, Any] = {}
    if output is not None:
        kwargs["output"] = output
    if level is not None:
        kwargs["level"] = level
    if status_message is not None:
        kwargs["status_message"] = status_message
    if metadata:
        kwargs["metadata"] = metadata
    _safe_call(observation, "end", **kwargs)


def capture_exception(trace: Any, exc: Exception, *, context: str, metadata: dict[str, Any] | None = None) -> None:
    _safe_call(
        trace,
        "event",
        name="exception",
        level="ERROR",
        input={
            "context": context,
            "error_type": type(exc).__name__,
            "message": str(exc),
            "metadata": metadata or {},
        },
    )


def finalize_trace(trace: Any, *, status_code: int | None = None, metadata: dict[str, Any] | None = None) -> None:
    _safe_call(
        trace,
        "event",
        name="request.completed",
        input={
            "status_code": status_code,
            "metadata": metadata or {},
        },
    )
    client = _get_langfuse_client()
    _safe_call(client, "flush")
