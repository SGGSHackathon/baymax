"""
Singleton factories for shared resources.
Extracted from main_v6.py §2.
"""

import logging
import httpx
import asyncpg
import redis.asyncio as aioredis
import torch  # Add this import at the top if not already present

from app.config import C

logger = logging.getLogger("medai.v6")

logger.info(f"Torch version: {torch.__version__}")  # Add this line right after logger definition to log the version on import

_embedder = _reranker = _pinecone = _redis = _llm = _http = _pool = None


def get_embedder():
    global _embedder
    if not _embedder:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer(C.EMBED_MODEL, trust_remote_code=True)  # Remove model_kwargs={'use_safetensors': True}
        logger.info(f"✅ Embedder: {C.EMBED_MODEL}")
    return _embedder


def get_reranker():
    global _reranker
    if not _reranker:
        from sentence_transformers import CrossEncoder
        _reranker = CrossEncoder(C.RERANK_MODEL)
        logger.info(f"✅ Reranker: {C.RERANK_MODEL}")
    return _reranker


def get_pinecone():
    global _pinecone
    if not _pinecone:
        from pinecone import Pinecone
        _pinecone = Pinecone(api_key=C.PINECONE_KEY).Index(C.INDEX_NAME)
        logger.info(f"✅ Pinecone: {C.INDEX_NAME}")
    return _pinecone


def get_llm():
    global _llm
    if not _llm:
        from langchain_groq import ChatGroq
        _llm = ChatGroq(api_key=C.GROQ_API_KEY, model=C.LLM_MODEL, temperature=0.1, max_tokens=1200)
        logger.info(f"✅ LLM: {C.LLM_MODEL}")
    return _llm


async def get_redis():
    global _redis
    # If we have a connection, verify it's alive
    if _redis:
        try:
            await _redis.ping()
            return _redis
        except Exception as e:
            logger.warning(f"Redis connection lost, reconnecting: {e}")
            _redis = None
    # Create new connection
    try:
        _redis = aioredis.from_url(C.REDIS_URL, decode_responses=True)
        await _redis.ping()
        logger.info("✅ Redis connected")
    except Exception as e:
        logger.error(f"Redis unavailable: {e}")
        _redis = None
    return _redis


async def get_pool():
    global _pool
    if not _pool:
        _pool = await asyncpg.create_pool(dsn=C.DATABASE_URL, min_size=2, max_size=12, command_timeout=30)
        logger.info("✅ DB pool ready")
    return _pool


async def get_http():
    global _http
    if not _http:
        _http = httpx.AsyncClient(timeout=10.0)
    return _http


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()


async def close_http():
    global _http
    if _http:
        await _http.aclose()