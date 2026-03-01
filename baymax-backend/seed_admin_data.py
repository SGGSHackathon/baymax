import os
import sys
from datetime import date, datetime, timedelta

import psycopg2
from dotenv import load_dotenv

SEED_TAG = "seed_admin_data_v1"
SEED_PHONE = "+919000000001"


def get_conn():
    load_dotenv()
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is missing in environment")
    return psycopg2.connect(db_url)


def upsert_seed_user(cur):
    cur.execute(
        """
        INSERT INTO users (phone, name, email, onboarded, preferred_language)
        VALUES (%s, %s, %s, TRUE, 'en-IN')
        ON CONFLICT (phone)
        DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            onboarded = TRUE,
            preferred_language = 'en-IN',
            updated_at = NOW()
        RETURNING id
        """,
        (SEED_PHONE, "Admin Seed User", "admin.seed@baymax.local"),
    )
    return cur.fetchone()[0]


def upsert_inventory(cur):
    today = date.today()

    inventory_rows = [
        {
            "drug_name": "metformin",
            "brand_name": "Seed Glyco",
            "strength": "500mg",
            "form": "tablet",
            "unit": "tablet",
            "stock_qty": 14,
            "reorder_level": 25,
            "price_per_unit": 4.5,
            "expiry_date": today + timedelta(days=120),
            "category": "antidiabetic",
            "drug_class": None,
            "is_otc": False,
            "supplier": "Seed Pharma",
        },
        {
            "drug_name": "amlodipine",
            "brand_name": "Seed Amlo",
            "strength": "5mg",
            "form": "tablet",
            "unit": "tablet",
            "stock_qty": 10,
            "reorder_level": 20,
            "price_per_unit": 5.0,
            "expiry_date": today + timedelta(days=70),
            "category": "antihypertensive",
            "drug_class": "calcium_channel_blocker",
            "is_otc": False,
            "supplier": "Seed Pharma",
        },
        {
            "drug_name": "atorvastatin",
            "brand_name": "Seed Atorva",
            "strength": "10mg",
            "form": "tablet",
            "unit": "tablet",
            "stock_qty": 28,
            "reorder_level": 30,
            "price_per_unit": 7.5,
            "expiry_date": today + timedelta(days=48),
            "category": "statin",
            "drug_class": "statin",
            "is_otc": False,
            "supplier": "Seed Pharma",
        },
        {
            "drug_name": "omeprazole",
            "brand_name": "Seed Omez",
            "strength": "20mg",
            "form": "capsule",
            "unit": "capsule",
            "stock_qty": 22,
            "reorder_level": 15,
            "price_per_unit": 6.0,
            "expiry_date": today + timedelta(days=6),
            "category": "ppi",
            "drug_class": "ppi",
            "is_otc": True,
            "supplier": "Seed Pharma",
        },
        {
            "drug_name": "montelukast",
            "brand_name": "Seed Montair",
            "strength": "10mg",
            "form": "tablet",
            "unit": "tablet",
            "stock_qty": 34,
            "reorder_level": 18,
            "price_per_unit": 8.0,
            "expiry_date": today + timedelta(days=24),
            "category": "leukotriene_antagonist",
            "drug_class": None,
            "is_otc": False,
            "supplier": "Seed Pharma",
        },
    ]

    inv_ids = {}
    for row in inventory_rows:
        cur.execute(
            """
            INSERT INTO inventory (
                drug_name, brand_name, composition, category, drug_class,
                form, strength, stock_qty, unit, price_per_unit,
                reorder_level, is_otc, is_active, expiry_date, supplier,
                times_ordered, updated_at
            )
            VALUES (
                %(drug_name)s, %(brand_name)s, %(composition)s, %(category)s, %(drug_class)s,
                %(form)s, %(strength)s, %(stock_qty)s, %(unit)s, %(price_per_unit)s,
                %(reorder_level)s, %(is_otc)s, TRUE, %(expiry_date)s, %(supplier)s,
                0, NOW()
            )
            ON CONFLICT (drug_name, brand_name, strength)
            DO UPDATE SET
                stock_qty = EXCLUDED.stock_qty,
                reorder_level = EXCLUDED.reorder_level,
                price_per_unit = EXCLUDED.price_per_unit,
                expiry_date = EXCLUDED.expiry_date,
                is_active = TRUE,
                supplier = EXCLUDED.supplier,
                updated_at = NOW()
            RETURNING id
            """,
            {
                **row,
                "composition": f"{row['drug_name']} {row['strength']}",
            },
        )
        inv_ids[row["drug_name"]] = cur.fetchone()[0]

    return inv_ids


def reseed_orders(cur, user_id, inv_ids):
    # Clear previous seed orders for idempotency
    cur.execute("DELETE FROM orders WHERE notes = %s", (SEED_TAG,))

    base = datetime.utcnow()
    order_plan = [
        ("metformin", 2, 4.5, [2, 6, 11, 17, 24, 35, 44, 58, 70, 84]),
        ("amlodipine", 1, 5.0, [1, 7, 13, 21, 30, 41, 52, 63, 77, 88]),
        ("atorvastatin", 1, 7.5, [3, 9, 16, 25, 33, 42, 54, 66, 79]),
        ("omeprazole", 1, 6.0, [4, 10, 18, 27, 39, 49, 61, 73, 86]),
        ("montelukast", 1, 8.0, [5, 12, 20, 29, 38, 47, 57, 68, 82]),
    ]

    inserted = 0
    for drug_name, qty, unit_price, days_back_list in order_plan:
        inventory_id = inv_ids[drug_name]
        for i, days_back in enumerate(days_back_list, start=1):
            status = "delivered" if i % 3 != 0 else "confirmed"
            ordered_at = base - timedelta(days=days_back)
            cur.execute(
                """
                INSERT INTO orders (
                    user_id, patient_id, placed_by_role, inventory_id,
                    drug_name, quantity, unit_price, requires_rx, rx_verified,
                    status, delivery_address, notes, ordered_at, updated_at
                )
                VALUES (
                    %s, %s, 'self', %s,
                    %s, %s, %s, FALSE, TRUE,
                    %s, 'Seed City', %s, %s, NOW()
                )
                """,
                (
                    user_id,
                    user_id,
                    inventory_id,
                    drug_name,
                    qty,
                    unit_price,
                    status,
                    SEED_TAG,
                    ordered_at,
                ),
            )
            inserted += 1


def reseed_refill_sources(cur, user_id):
    # Remove previous seed rows for this user + selected drugs
    drugs = ("metformin", "amlodipine", "atorvastatin")

    cur.execute(
        "DELETE FROM reminders WHERE user_id = %s AND patient_id = %s AND drug_name = ANY(%s)",
        (user_id, user_id, list(drugs)),
    )
    cur.execute(
        "DELETE FROM medicine_courses WHERE user_id = %s AND drug_name = ANY(%s)",
        (user_id, list(drugs)),
    )

    cur.execute(
        """
        INSERT INTO reminders (
            user_id, patient_id, drug_name, dose, meal_instruction,
            remind_times, start_date, end_date, is_active,
            total_qty, qty_remaining, refill_alert_at, updated_at
        )
        VALUES
            (%s, %s, 'metformin', '1 tablet', 'after_meal', ARRAY['08:00','20:00'], CURRENT_DATE - 10, CURRENT_DATE + 20, TRUE, 60, 2, 5, NOW()),
            (%s, %s, 'atorvastatin', '1 tablet', 'before_sleep', ARRAY['22:00'], CURRENT_DATE - 20, CURRENT_DATE + 15, TRUE, 30, 1, 3, NOW())
        """,
        (user_id, user_id, user_id, user_id),
    )

    cur.execute(
        """
        INSERT INTO medicine_courses (
            user_id, drug_name, dose, frequency, times, meal_instruction,
            duration_days, start_date, end_date, total_qty, qty_remaining,
            doses_taken, doses_skipped, status, updated_at
        )
        VALUES
            (%s, 'amlodipine', '1 tablet', 1, ARRAY['09:00'], 'after_meal', 30, CURRENT_DATE - 20, CURRENT_DATE + 10, 30, 2, 18, 0, 'active', NOW()),
            (%s, 'metformin',  '1 tablet', 2, ARRAY['08:00','20:00'], 'after_meal', 30, CURRENT_DATE - 15, CURRENT_DATE + 12, 60, 4, 26, 0, 'active', NOW())
        """,
        (user_id, user_id),
    )


def print_quick_verification(cur):
    cur.execute(
        "SELECT COUNT(*) FROM inventory WHERE brand_name LIKE 'Seed %' AND is_active = TRUE"
    )
    inv = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM orders WHERE notes = %s", (SEED_TAG,))
    orders = cur.fetchone()[0]

    cur.execute(
        "SELECT COUNT(*) FROM reminders WHERE user_id = (SELECT id FROM users WHERE phone = %s) AND is_active = TRUE",
        (SEED_PHONE,),
    )
    reminders = cur.fetchone()[0]

    cur.execute(
        "SELECT COUNT(*) FROM medicine_courses WHERE user_id = (SELECT id FROM users WHERE phone = %s) AND status = 'active'",
        (SEED_PHONE,),
    )
    courses = cur.fetchone()[0]

    cur.execute(
        """
        SELECT COUNT(*) FROM inventory
        WHERE is_active = TRUE
          AND expiry_date IS NOT NULL
          AND expiry_date <= CURRENT_DATE + INTERVAL '60 days'
          AND brand_name LIKE 'Seed %'
        """
    )
    expiring_60 = cur.fetchone()[0]

    print("Seed complete ✅")
    print(f"- seed inventory rows: {inv}")
    print(f"- seed orders rows: {orders}")
    print(f"- active reminders for seed user: {reminders}")
    print(f"- active courses for seed user: {courses}")
    print(f"- seed items expiring <=60 days: {expiring_60}")


def clear_admin_cache():
    load_dotenv()
    redis_url = os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
    if not redis_url:
        print("No REDIS_URL/UPSTASH_REDIS_URL found; skipping cache clear.")
        return

    try:
        import redis

        client = redis.from_url(redis_url, decode_responses=True)
        keys = client.keys("admin:*")
        if keys:
            client.delete(*keys)
            print(f"Cleared {len(keys)} Redis keys matching admin:*")
        else:
            print("No admin:* Redis keys found.")
    except Exception as exc:
        print(f"Cache clear skipped (Redis error): {exc}")


def main():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                user_id = upsert_seed_user(cur)
                inv_ids = upsert_inventory(cur)
                reseed_orders(cur, user_id, inv_ids)
                reseed_refill_sources(cur, user_id)
                print_quick_verification(cur)
            conn.commit()

        clear_admin_cache()
        print("Done.")
    except Exception as exc:
        print(f"Seed failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
