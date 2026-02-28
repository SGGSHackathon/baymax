"""Debug: trace phone lookup for 8329467670"""
import asyncio, asyncpg, os, re
from dotenv import load_dotenv
load_dotenv()

def normalize_phone(raw):
    digits = re.sub(r"[^\d]", "", raw)
    if len(digits) > 10 and digits.startswith("91"):
        digits = digits[2:]
    return digits[-10:]

async def debug():
    pool = await asyncpg.create_pool(os.getenv('DATABASE_URL'))
    
    # 1. Show all users
    rows = await pool.fetch('SELECT id, phone, onboarded, name FROM users')
    print("=== ALL USERS ===")
    for r in rows:
        print(f"  phone='{r['phone']}' onboarded={r['onboarded']} name={r['name']}")
    
    # 2. Simulate WhatsApp flow: message.from = "918329467670@c.us"
    wa_from = "918329467670@c.us"
    
    # JS normalization
    digits = re.sub(r'\D', '', wa_from.replace('@c.us', ''))
    js_phone = digits[2:] if len(digits) > 10 and digits.startswith('91') else digits[-10:]
    print(f"\n=== WHATSAPP FLOW ===")
    print(f"message.from = '{wa_from}'")
    print(f"JS normalized = '{js_phone}'")
    
    # Python model validator
    py_phone = normalize_phone(js_phone)
    print(f"Python normalize_phone('{js_phone}') = '{py_phone}'")
    
    # DB lookup
    row = await pool.fetchrow(
        """SELECT id, phone, onboarded, name FROM users WHERE phone = $1""", py_phone)
    print(f"DB lookup result: {dict(row) if row else 'NOT FOUND'}")
    
    # Also try exact match with what's in DB
    row2 = await pool.fetchrow(
        """SELECT id, phone, onboarded FROM users WHERE phone LIKE $1""", '%8329467670%')
    print(f"LIKE search result: {dict(row2) if row2 else 'NOT FOUND'}")
    
    await pool.close()

asyncio.run(debug())
