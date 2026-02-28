"""One-time script to normalize all phone numbers in the DB to bare 10-digit format."""
import asyncio, asyncpg, os, re
from dotenv import load_dotenv
load_dotenv()

def normalize(raw):
    digits = re.sub(r'[^\d]', '', raw)
    if len(digits) > 10 and digits.startswith('91'):
        digits = digits[2:]
    return digits[-10:]

async def fix():
    pool = await asyncpg.create_pool(os.getenv('DATABASE_URL'))
    rows = await pool.fetch('SELECT id, phone, onboarded, created_at FROM users ORDER BY created_at')
    print(f'Found {len(rows)} users')

    # Group by normalized phone to detect duplicates
    groups = {}
    for r in rows:
        norm = normalize(r['phone'])
        groups.setdefault(norm, []).append(r)

    updated = 0
    deleted = 0
    for norm, entries in groups.items():
        if len(entries) == 1:
            r = entries[0]
            if r['phone'] != norm:
                print(f'  UPDATE: {r["phone"]} -> {norm}')
                await pool.execute('UPDATE users SET phone = $1 WHERE id = $2', norm, r['id'])
                updated += 1
        else:
            # Duplicates: keep the one that's onboarded, or the newest
            keep = next((e for e in entries if e['onboarded']), entries[-1])
            for e in entries:
                if e['id'] != keep['id']:
                    print(f'  DELETE duplicate: {e["phone"]} (id={e["id"]})')
                    await pool.execute('DELETE FROM users WHERE id = $1', e['id'])
                    deleted += 1
            if keep['phone'] != norm:
                print(f'  UPDATE kept: {keep["phone"]} -> {norm}')
                await pool.execute('UPDATE users SET phone = $1 WHERE id = $2', norm, keep['id'])
                updated += 1

    print(f'Updated {updated}, deleted {deleted} duplicates')
    await pool.close()

asyncio.run(fix())
