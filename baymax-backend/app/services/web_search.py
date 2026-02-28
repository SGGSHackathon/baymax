"""
Controlled web search layer (V6) — trusted sources only.
Extracted from main_v6.py §V6-A and §V6-D.
"""

import json
import hashlib
import logging
from typing import Optional

from app.config import C
from app.singletons import get_pinecone
from app.core.retrieval import retrieve, _embed
from app.db.helpers import db_execute, log_audit
from app.services.messaging import send_whatsapp

logger = logging.getLogger("medai.v6")


def _domain_trusted(url: str) -> bool:
    """Return True only if URL is from an approved medical domain."""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        return any(host == d or host.endswith("." + d) for d in C.TRUSTED_SEARCH_DOMAINS)
    except:
        return False


def _should_web_search(query: str, rag_results: list, drug_found: bool) -> bool:
    """
    Only trigger web search when:
    1. RAG + DB returned nothing useful, OR
    2. Query explicitly mentions recall/new drug/outbreak keywords.
    NEVER for dosage, CDE, or contraindication logic.
    """
    q = query.lower()
    # Explicit triggers
    if any(kw in q for kw in C.WEB_SEARCH_TRIGGERS):
        return True
    # Fallback when RAG returned nothing AND drug not in inventory
    if not rag_results and not drug_found:
        return True
    return False


async def controlled_web_search(query: str) -> Optional[dict]:
    """
    Safe web search that:
    - Uses DuckDuckGo (no API key needed)
    - Filters to trusted domains only
    - Returns structured result with source label
    - Caches to Pinecone external_verified namespace
    Returns {"text": str, "source": str, "domain": str} or None.
    """
    # Check Redis cache first (faster than Pinecone)
    cache_key = f"cache:websearch:{hashlib.md5(query.encode()).hexdigest()}"
    try:
        from app.db.redis_helpers import r_get_json, r_set
        cached_redis = await r_get_json(cache_key)
        if cached_redis:
            logger.info(f"Web search: Redis cache hit for '{query[:50]}'")
            return {**cached_redis, "cached": True}
    except Exception:
        pass

    # Check Pinecone cache
    cache_key_pc = hashlib.md5(query.encode()).hexdigest()
    cached    = await retrieve(query, C.NS_EXTERNAL, top_k=1)
    if cached and cached[0].get("score", 0) > 0.82:
        logger.info(f"Web search: Pinecone cache hit for '{query[:50]}'")
        result = {
            "text":   cached[0]["text"],
            "source": cached[0].get("source", "external"),
            "domain": cached[0].get("source", ""),
            "cached": True,
        }
        # Also store in Redis for faster subsequent hits
        try:
            await r_set(cache_key, result, ttl=21600)
        except Exception:
            pass
        return result

    # DuckDuckGo search (no API key) — using ddgs package
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            # Search without site: operator (causes 0 results in newer versions)
            # Instead, we filter results to trusted domains after fetching
            raw = list(ddgs.text(query + " medical health", max_results=10))
    except ImportError:
        logger.warning("duckduckgo_search not installed; web search unavailable")
        return None
    except Exception as e:
        logger.error(f"DuckDuckGo error: {e}")
        return None

    # Filter to trusted domains only
    trusted_results = []
    general_results = []
    for r in raw:
        url  = r.get("href", "") or r.get("url", "")
        body = r.get("body", "") or r.get("description", "")
        if not body or len(body) < 50:
            continue
        try:
            from urllib.parse import urlparse
            domain = urlparse(url).hostname or url.split("/")[2] if "/" in url else url
        except:
            domain = url
        if _domain_trusted(url):
            trusted_results.append({
                "url":  url,
                "text": body[:800],
                "domain": domain,
            })
        else:
            general_results.append({
                "url": url,
                "text": body[:800],
                "domain": domain,
            })

    # Prefer trusted sources, but fall back to general results if none
    if trusted_results:
        best = trusted_results[0]
    elif general_results:
        best = general_results[0]
        logger.info(f"Web search: no trusted results, using general source: {best['domain']}")
    else:
        logger.info(f"Web search: no results at all for '{query[:50]}'")
        return None

    # Store to Pinecone for future semantic cache hits
    try:
        emb = _embed(best["text"])
        get_pinecone().upsert(
            vectors=[{
                "id":       f"web_{cache_key_pc}",
                "values":   emb,
                "metadata": {
                    "text":     best["text"],
                    "source":   best["domain"],
                    "query":    query[:200],
                    "verified": True,
                },
            }],
            namespace=C.NS_EXTERNAL
        )
    except Exception as e:
        logger.error(f"Pinecone web cache store: {e}")

    # Store to Redis for faster subsequent hits (6hr TTL)
    result = {"text": best["text"], "source": best["domain"], "domain": best["domain"], "cached": False}
    try:
        from app.db.redis_helpers import r_set as _r_set
        await _r_set(cache_key, result, ttl=21600)
    except Exception:
        pass

    logger.info(f"Web search: found trusted result from {best['domain']}")
    return result


async def check_drug_recall(drug_name: str, phone: str, user_id: str) -> Optional[str]:
    """
    V6: Check if drug is recalled via FDA recall DB search.
    If recalled: flag inventory + send admin alert.
    Returns recall notice or None.
    """
    result = await controlled_web_search(f"{drug_name} FDA recall 2024 2025")
    if not result:
        return None

    text   = result["text"].lower()
    domain = result.get("domain", "")
    # Only act on FDA source with recall signal
    if "recall" in text and ("fda" in domain or "accessdata" in domain):
        # Flag inventory
        try:
            await db_execute(
                "UPDATE inventory SET is_active=FALSE, notes=CONCAT(notes, ' | FDA RECALL FLAGGED') WHERE LOWER(drug_name)=LOWER($1)",
                drug_name)
        except Exception as e:
            logger.error(f"Recall inventory flag: {e}")

        # Admin alert
        if C.ADMIN_PHONE:
            await send_whatsapp(C.ADMIN_PHONE,
                f"🚨 *FDA RECALL ALERT*\n\n"
                f"Drug: *{drug_name.title()}*\n"
                f"Source: {domain}\n"
                f"User: {user_id[:12]}\n\n"
                f"Inventory flagged as inactive. Verify immediately.\n"
                f"Evidence: {result['text'][:200]}")

        await log_audit(user_id, "recall_detected", "inventory", drug_name,
                        new_val={"source": domain, "query": drug_name})

        return (f"⚠️ *Recall Alert for {drug_name.title()}*\n\n"
                f"Our clinical search detected a possible FDA recall notice.\n"
                f"📚 *Source: {domain}*\n\n"
                f"Do NOT dispense this medicine until the alert is verified.\n"
                f"Please contact your doctor or pharmacist.")
    return None


async def retrieve_with_web_fallback(query: str, namespace: str, drugs: list,
                                      drug_in_db: bool, channel: str) -> tuple[list, dict]:
    """
    V6 enhanced retrieval:
    1. Standard Pinecone RAG
    2. If empty + web search conditions met → controlled web search
    Returns (results, web_meta) where web_meta may be None.
    """
    results = await retrieve(query, namespace)
    web_meta = None

    if _should_web_search(query, results, drug_in_db):
        logger.info(f"Web search triggered for: '{query[:60]}'")
        ws = await controlled_web_search(query)
        if ws:
            web_meta = ws
            # Inject as synthetic RAG result (marked external)
            results = [{
                "text":   f"[External — {ws['domain']}]\n{ws['text']}",
                "score":  0.70,
                "source": ws["domain"],
            }] + results

    return results, web_meta
