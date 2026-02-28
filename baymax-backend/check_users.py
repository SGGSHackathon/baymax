import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv()

async def f():
    pool = await asyncpg.create_pool(os.getenv('DATABASE_URL'))
    rows = await pool.fetch('SELECT phone, name, onboarded FROM users')
    for r in rows:
        print(repr(r['phone']), r['name'], r['onboarded'])
    if not rows:
        print("NO USERS FOUND")
    await pool.close()

asyncio.run(f())
