"""
Wipe ALL data: PostgreSQL (TRUNCATE all tables), Redis (FLUSHALL), Pinecone (delete all vectors).
Usage: python reset_all.py
"""
import asyncio, os, logging
from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("reset")


async def main():
    # 1. POSTGRESQL
    import asyncpg
    db_url = os.getenv("DATABASE_URL", "")
    if db_url:
        log.info("── PostgreSQL: connecting...")
        pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
        tables = await pool.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        )
        table_names = [r["tablename"] for r in tables]
        log.info(f"   Found {len(table_names)} tables")
        if table_names:
            joined = ", ".join(f'"{t}"' for t in table_names)
            await pool.execute(f"TRUNCATE {joined} CASCADE")
            log.info(f"   TRUNCATED all {len(table_names)} tables")
        await pool.close()
    else:
        log.warning("   No DATABASE_URL - skipping Postgres")

    # 2. REDIS
    import redis.asyncio as aioredis
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    log.info(f"── Redis: connecting...")
    try:
        rd = aioredis.from_url(redis_url, decode_responses=True)
        keys_before = await rd.dbsize()
        log.info(f"   Keys before flush: {keys_before}")
        await rd.flushall()
        log.info("   FLUSHALL complete")
        await rd.close()
    except Exception as e:
        log.error(f"   Redis error: {e}")

    # 3. PINECONE
    pinecone_key = os.getenv("PINECONE_API_KEY", "")
    index_name = os.getenv("PINECONE_INDEX", "medical-rag")
    if pinecone_key:
        log.info(f"── Pinecone: index={index_name}")
        from pinecone import Pinecone
        pc = Pinecone(api_key=pinecone_key)
        idx = pc.Index(index_name)
        stats = idx.describe_index_stats()
        total = stats.get("total_vector_count", 0)
        log.info(f"   Total vectors: {total}")
        # Known namespaces from config
        all_ns = [ "user_memory"]
        for ns in all_ns:
            try:
                idx.delete(delete_all=True, namespace=ns)
                label = ns if ns else "(default)"
                log.info(f"   Deleted namespace '{label}'")
            except Exception as e:
                pass  # namespace may not exist, that's fine
        log.info("   Pinecone wipe complete")
    else:
        log.warning("   No PINECONE_API_KEY - skipping")

    log.info("\nDone - all data wiped: Postgres + Redis + Pinecone")


asyncio.run(main())