"""
FastAPI app factory — lifespan, middleware, router registration.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import C
from app.singletons import (
    get_embedder, get_reranker, get_pinecone, get_llm,
    get_redis, get_pool, close_pool, close_http,
)
from app.services.scheduler import start_scheduler, stop_scheduler
from app.api.middleware import rate_limiter
from app.api.routes import router
from app.api.auth import router as auth_router
from app.api.prescription_router import router as prescription_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medai.v6")


@asynccontextmanager
async def lifespan(application: FastAPI):
    # Initialize all singletons at startup
    get_embedder(); get_reranker(); get_pinecone(); get_llm()
    await get_redis(); await get_pool()
    await start_scheduler()
    logger.info("✅ Medical AI V6 ready")
    yield
    await stop_scheduler()
    await close_pool()
    await close_http()


app = FastAPI(title="Medical AI V6", version="6.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[C.ALLOWED_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(rate_limiter)
app.include_router(auth_router)
app.include_router(router)
app.include_router(prescription_router)
