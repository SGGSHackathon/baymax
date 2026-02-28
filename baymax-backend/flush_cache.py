"""Flush all user cache entries from Redis."""
import asyncio, os
from dotenv import load_dotenv
load_dotenv()

import redis.asyncio as aioredis

async def flush():
    url = os.getenv('REDIS_URL')
    rd = aioredis.from_url(url, decode_responses=True)
    
    # Find and delete all user cache keys
    cursor = 0
    deleted = 0
    while True:
        cursor, keys = await rd.scan(cursor, match='cache:user:*', count=100)
        if keys:
            for k in keys:
                val = await rd.get(k)
                print(f"  Deleting: {k} = {str(val)[:80]}")
            await rd.delete(*keys)
            deleted += len(keys)
        if cursor == 0:
            break
    
    print(f"Deleted {deleted} cache entries")
    await rd.close()

asyncio.run(flush())
