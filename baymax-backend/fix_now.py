import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv()

async def fix():
    pool = await asyncpg.create_pool(os.getenv('DATABASE_URL'))
    await pool.execute("UPDATE users SET phone = $1 WHERE phone = $2", '8329467670', '9183294676')
    rows = await pool.fetch('SELECT phone, name, onboarded FROM users')
    for r in rows:
        print(r['phone'], r['name'], r['onboarded'])
    await pool.close()

asyncio.run(fix())
