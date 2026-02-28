"""
RAG retrieval engine — Pinecone + BGE reranker + Redis cache.
Extracted from main_v6.py §6.
"""

import json
import hashlib
import logging

from app.config import C
from app.singletons import get_embedder, get_reranker, get_pinecone, get_redis

logger = logging.getLogger("medai.v6")


def _embed(text: str) -> list[float]:
    return get_embedder().encode(text, normalize_embeddings=True).tolist()


def _rerank(query: str, docs: list[str]) -> list[tuple]:
    if not docs: return []
    # Skip reranker if ≤3 docs — not worth 9s of CPU time
    if len(docs) <= 3:
        return [(d, 1.0) for d in docs]
    scores = get_reranker().predict([(query, d) for d in docs])
    return sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)[:C.RERANK_TOP]


async def retrieve(query: str, namespace: str, top_k: int = None, filters: dict = None) -> list[dict]:
    top_k = top_k or C.RETRIEVAL_TOP_K
    ck    = f"rag:{namespace}:{hashlib.md5(query.encode()).hexdigest()}"
    rd    = await get_redis()
    if rd:
        try:
            cached = await rd.get(ck)
            if cached: return json.loads(cached)
        except: pass
    try:
        kw = dict(vector=_embed(query), top_k=top_k, namespace=namespace, include_metadata=True)
        if filters: kw["filter"] = filters
        matches = get_pinecone().query(**kw).get("matches", [])
    except Exception as e:
        logger.error(f"Pinecone: {e}"); return []
    if not matches: return []
    texts    = [m["metadata"].get("text", "") for m in matches]
    reranked = _rerank(query, texts)
    output   = []
    for text, score in reranked:
        orig = next((m for m in matches if m["metadata"].get("text", "") == text), None)
        if orig:
            output.append({"text": text, "score": round(float(score), 4),
                           "source": orig["metadata"].get("source", ""),
                           "severity": orig["metadata"].get("severity", "")})
    if rd:
        try: await rd.setex(ck, 1800, json.dumps(output))
        except: pass
    return output


def needs_rag(query: str) -> bool:
    """Return True only if the query likely needs RAG retrieval.
    Short greetings, confirmations, numbers etc. skip the expensive 22s+ embed call."""
    q = query.lower().strip()
    # Extremely short messages are never medical queries
    if len(q) < 4:
        return False
    # Common non-medical patterns
    skip_patterns = [
        "hi", "hello", "hey", "thanks", "thank you", "ok", "okay",
        "yes", "no", "none", "cancel", "bye", "good", "fine",
        "hii", "hiii", "namaste", "namaskar", "sup", "yo",
        "good morning", "good evening", "good night",
    ]
    if q.rstrip("!.?,") in skip_patterns:
        return False
    # Pure numbers (quantity responses)
    if q.replace(" ", "").isdigit():
        return False
    # Messages under 3 words with no medical signal
    words = q.split()
    if len(words) <= 2:
        medical_signals = [
            "pain", "fever", "cough", "cold", "headache", "tablet", "capsule",
            "dose", "dosage", "mg", "medicine", "drug", "allergy", "allergic",
            "effect", "interaction", "pregnant", "bp", "sugar", "side",
            "symptom", "cure", "treat", "heal", "remedy",
        ]
        if not any(s in q for s in medical_signals):
            return False
    return True
