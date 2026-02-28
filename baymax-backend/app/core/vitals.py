"""
Vital trend analysis engine.
Extracted from main_v6.py §11.
"""

import logging

from app.singletons import get_pool

logger = logging.getLogger("medai.v6")


async def analyze_vital_trends(user_id: str) -> list[dict]:
    """
    Detect rising/falling trends across last 5 readings.
    Alerts returned as list of {vital, trend, last, message}.
    """
    pool   = await get_pool()
    alerts = []
    check  = ["bp_systolic", "blood_sugar", "spo2_pct", "heart_rate", "temp_celsius"]

    for vital in check:
        rows = await pool.fetch(
            f"SELECT {vital} FROM vitals WHERE user_id=$1 AND {vital} IS NOT NULL ORDER BY recorded_at DESC LIMIT 5",
            user_id)
        values = [float(r[vital]) for r in rows if r[vital] is not None]
        if len(values) < 3: continue

        recent = values[:3]
        if   all(recent[i] > recent[i+1] for i in range(len(recent)-1)): trend = "rising"
        elif all(recent[i] < recent[i+1] for i in range(len(recent)-1)): trend = "falling"
        else: trend = "stable"

        avg = round(sum(values) / len(values), 2)
        chg = round((values[0] - avg) / avg * 100, 1) if avg else 0

        # Upsert vital_trends table
        try:
            await pool.execute(
                """INSERT INTO vital_trends(user_id, vital_type, trend, readings_count, last_value, avg_value, change_pct)
                   VALUES($1,$2,$3,$4,$5,$6,$7)
                   ON CONFLICT(user_id, vital_type) DO UPDATE SET
                     trend=EXCLUDED.trend, readings_count=EXCLUDED.readings_count,
                     last_value=EXCLUDED.last_value, avg_value=EXCLUDED.avg_value,
                     change_pct=EXCLUDED.change_pct, computed_at=NOW(), alert_sent=FALSE""",
                user_id, vital, trend, len(values), values[0], avg, chg)
        except Exception as e:
            logger.error(f"vital_trends upsert: {e}")

        # Generate alerts for actionable trends
        if trend == "rising" and vital in ("bp_systolic", "blood_sugar"):
            alerts.append({
                "vital": vital, "trend": "rising", "last": values[0],
                "message": (f"📈 *Trend Alert — {vital.replace('_',' ').title()}*\n\n"
                            f"Your readings have been *rising* over the last {len(recent)} measurements "
                            f"(latest: {values[0]}, avg: {avg}).\n\n"
                            "Please consult your doctor for evaluation.")
            })
        elif trend == "falling" and vital == "spo2_pct":
            alerts.append({
                "vital": vital, "trend": "falling", "last": values[0],
                "message": (f"📉 *Oxygen Level Trending Down*\n\n"
                            f"Latest SpO₂: *{values[0]}%* (avg: {avg}%).\n\n"
                            "Please seek medical attention if this continues.")
            })

    return alerts
