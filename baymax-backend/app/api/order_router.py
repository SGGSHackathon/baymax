"""
Order processing router — Razorpay payment, email + SMS confirmation.
Handles:
  POST /orders/create          — create Razorpay order + DB row
  POST /orders/verify-payment  — verify Razorpay signature + mark paid
  GET  /orders/{order_id}      — get order details
  GET  /orders/user/{user_id}  — list user orders
"""

import os
import hmac
import hashlib
import logging
import smtplib
import uuid
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone
from typing import Optional

import httpx
import razorpay
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

logger = logging.getLogger(__name__)

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# ── Config ────────────────────────────────────────────────────
DATABASE_URL = os.environ["DATABASE_URL"]
RAZORPAY_KEY_ID = os.environ.get("key_id", "")
RAZORPAY_KEY_SECRET = os.environ.get("key_secret", "")
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER)
SMS_URL = os.environ.get("SMS_URL", "http://localhost:5001/send-sms")
WEBSITE_BASE_URL = os.environ.get("WEBSITE_BASE_URL", "http://localhost:3000")

# ── Razorpay client ──────────────────────────────────────────
razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

router = APIRouter(prefix="/orders", tags=["orders"])


def get_db_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def _normalize_indian_phone(raw: str | None) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) >= 10:
        return digits[-10:]
    return digits


# ── Pydantic models ──────────────────────────────────────────

class OrderItem(BaseModel):
    drug_name: str
    quantity: int
    unit_price: float
    inventory_id: Optional[str] = None

class CreateOrderRequest(BaseModel):
    user_id: str
    items: list[OrderItem]
    prescription_id: Optional[str] = None
    delivery_address: Optional[str] = None
    notes: Optional[str] = None

class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

class OrderResponse(BaseModel):
    order_id: str
    razorpay_order_id: str
    amount: float
    currency: str
    key_id: str
    user_name: str
    user_email: str
    user_phone: str
    items: list[dict]


# ══════════════════════════════════════════════════════════════
# EMAIL SERVICE
# ══════════════════════════════════════════════════════════════

def send_email(to_email: str, subject: str, html_body: str):
    """Send an email via SMTP (Gmail app password)."""
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured, skipping email")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = SMTP_FROM
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)

        logger.info(f"Email sent to {to_email}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Email send failed to {to_email}: {e}")
        return False


def send_order_confirmation_email(to_email: str, user_name: str, order_data: dict):
    """Send order confirmation email with details."""
    items_html = ""
    for item in order_data.get("items", []):
        items_html += f"""
        <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#334155">{item['drug_name']}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:14px;text-align:center;color:#334155">{item['quantity']}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:14px;text-align:right;color:#334155">₹{item.get('unit_price', 0):.2f}</td>
            <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:14px;text-align:right;font-weight:600;color:#0f172a">₹{item['quantity'] * item.get('unit_price', 0):.2f}</td>
        </tr>"""

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
        <div style="max-width:600px;margin:40px auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
            <div style="background:linear-gradient(135deg,#059669,#0d9488);padding:40px 32px;text-align:center">
                <h1 style="margin:0;color:white;font-size:28px;font-weight:800">Order Confirmed! ✅</h1>
                <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px">Your medicines are being prepared</p>
            </div>
            <div style="padding:32px">
                <p style="font-size:16px;color:#334155;margin:0 0 8px">Hi <strong>{user_name}</strong>,</p>
                <p style="font-size:14px;color:#64748b;margin:0 0 24px;line-height:1.6">
                    Thank you for your order! Your payment has been received and your medicines are being prepared for delivery.
                </p>

                <div style="background:#f8fafc;border-radius:16px;padding:20px;margin-bottom:24px">
                    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
                        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Order ID</span>
                        <span style="font-size:14px;font-weight:700;color:#0f172a">{order_data.get('order_number', 'N/A')}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
                        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Payment ID</span>
                        <span style="font-size:14px;font-weight:600;color:#0f172a">{order_data.get('payment_id', 'N/A')}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between">
                        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">Total Amount</span>
                        <span style="font-size:20px;font-weight:800;color:#059669">₹{order_data.get('total_amount', 0):.2f}</span>
                    </div>
                </div>

                <table style="width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
                    <thead>
                        <tr style="background:#f1f5f9">
                            <th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Medicine</th>
                            <th style="padding:12px 16px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Qty</th>
                            <th style="padding:12px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Price</th>
                            <th style="padding:12px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">Total</th>
                        </tr>
                    </thead>
                    <tbody>{items_html}</tbody>
                </table>

                <div style="text-align:center;margin-top:32px">
                    <a href="{WEBSITE_BASE_URL}/dashboard" style="display:inline-block;background:#0f172a;color:white;padding:14px 32px;border-radius:12px;font-size:14px;font-weight:700;text-decoration:none">View Dashboard</a>
                </div>
            </div>
            <div style="padding:20px 32px;background:#f8fafc;text-align:center;border-top:1px solid #e2e8f0">
                <p style="margin:0;font-size:12px;color:#94a3b8;font-weight:600">BayMax Medical Assistant — Your health, our priority</p>
            </div>
        </div>
    </body>
    </html>"""

    return send_email(to_email, f"Order Confirmed — {order_data.get('order_number', 'BayMax')}", html)


def send_registration_email(to_email: str, user_name: str):
    """Send welcome email on new user registration."""
    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
        <div style="max-width:600px;margin:40px auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
            <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:48px 32px;text-align:center">
                <h1 style="margin:0;color:white;font-size:32px;font-weight:800">Welcome to BayMax! 🏥</h1>
                <p style="margin:12px 0 0;color:rgba(255,255,255,0.7);font-size:15px">Your AI-powered medical assistant</p>
            </div>
            <div style="padding:40px 32px">
                <p style="font-size:18px;color:#0f172a;margin:0 0 8px;font-weight:700">Hi {user_name}! 👋</p>
                <p style="font-size:14px;color:#64748b;margin:0 0 28px;line-height:1.7">
                    Welcome to BayMax — your personal AI health assistant. We're thrilled to have you on board!
                    Here's what you can do:
                </p>

                <div style="display:grid;gap:16px;margin-bottom:32px">
                    <div style="background:#f0fdf4;padding:16px 20px;border-radius:14px;border-left:4px solid #059669">
                        <p style="margin:0;font-size:14px;font-weight:700;color:#059669">💬 AI Health Chat</p>
                        <p style="margin:4px 0 0;font-size:13px;color:#64748b">Get instant medical guidance in your language</p>
                    </div>
                    <div style="background:#eff6ff;padding:16px 20px;border-radius:14px;border-left:4px solid #3b82f6">
                        <p style="margin:0;font-size:14px;font-weight:700;color:#3b82f6">📋 Prescription OCR</p>
                        <p style="margin:4px 0 0;font-size:13px;color:#64748b">Upload prescriptions for automatic digitization</p>
                    </div>
                    <div style="background:#fef3c7;padding:16px 20px;border-radius:14px;border-left:4px solid #f59e0b">
                        <p style="margin:0;font-size:14px;font-weight:700;color:#f59e0b">💊 Order Medicines</p>
                        <p style="margin:4px 0 0;font-size:13px;color:#64748b">Quick checkout with secure Razorpay payments</p>
                    </div>
                    <div style="background:#fdf2f8;padding:16px 20px;border-radius:14px;border-left:4px solid #ec4899">
                        <p style="margin:0;font-size:14px;font-weight:700;color:#ec4899">⏰ Smart Reminders</p>
                        <p style="margin:4px 0 0;font-size:13px;color:#64748b">Never miss a dose with WhatsApp reminders</p>
                    </div>
                </div>

                <div style="text-align:center">
                    <a href="{WEBSITE_BASE_URL}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#059669,#0d9488);color:white;padding:16px 40px;border-radius:14px;font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 4px 12px rgba(5,150,105,0.3)">
                        Get Started →
                    </a>
                </div>
            </div>
            <div style="padding:24px 32px;background:#f8fafc;text-align:center;border-top:1px solid #e2e8f0">
                <p style="margin:0;font-size:12px;color:#94a3b8;font-weight:600">BayMax Medical Assistant — AI-powered healthcare for everyone</p>
            </div>
        </div>
    </body>
    </html>"""

    return send_email(to_email, "Welcome to BayMax! 🏥 — Your AI Health Assistant", html)


# ══════════════════════════════════════════════════════════════
# SMS SERVICE
# ══════════════════════════════════════════════════════════════

async def send_sms(phone: str, message: str) -> bool:
    """Send SMS via the WhatsApp server's /send-sms endpoint."""
    phone = _normalize_indian_phone(phone)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(SMS_URL, json={"phone": phone, "message": message})
            if resp.status_code == 200:
                logger.info(f"SMS sent to {phone}")
                return True
            logger.warning(f"SMS failed ({resp.status_code}): {resp.text}")
            return False
    except Exception as e:
        logger.error(f"SMS error to {phone}: {e}")
        return False


async def send_whatsapp_notification(phone: str, message: str) -> bool:
    """Send WhatsApp message via /send endpoint."""
    wa_url = os.environ.get("WHATSAPP_SERVER_URL", "http://localhost:5001")
    phone = _normalize_indian_phone(phone)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{wa_url}/send", json={"number": phone, "message": message})
            return resp.status_code == 200
    except Exception as e:
        logger.error(f"WhatsApp notification failed: {e}")
        return False


# ══════════════════════════════════════════════════════════════
# NOTIFICATION BACKGROUND TASKS
# ══════════════════════════════════════════════════════════════

async def _send_order_notifications(order_id: str):
    """Send email + SMS + WhatsApp after successful payment."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # Get order + user details
            cur.execute("""
                SELECT o.*, u.name, u.email, u.phone
                FROM orders o JOIN users u ON o.user_id = u.id
                WHERE o.id = %s
            """, (order_id,))
            order = cur.fetchone()

            if not order:
                logger.error(f"Order {order_id} not found for notifications")
                return

            # Get all order items (could be multiple rows for multi-item orders)
            cur.execute("""
                SELECT drug_name, quantity, unit_price,
                       (unit_price * quantity) as subtotal
                FROM orders WHERE razorpay_order_id = %s
                ORDER BY ordered_at
            """, (order["razorpay_order_id"],))
            items = cur.fetchall()

            user_name = order["name"]
            user_email = order["email"]
            user_phone = order["phone"]
            order_number = order["order_number"]
            total_amount = sum(float(i["subtotal"] or 0) for i in items)
            payment_id = order.get("razorpay_payment_id", "")

            # 1. Send email
            order_data = {
                "order_number": order_number,
                "payment_id": payment_id,
                "total_amount": total_amount,
                "items": [dict(i) for i in items],
            }
            email_sent = send_order_confirmation_email(user_email, user_name, order_data)

            # 2. Send SMS
            item_names = ", ".join(i["drug_name"] for i in items[:3])
            if len(items) > 3:
                item_names += f" +{len(items) - 3} more"
            sms_message = (
                f"BayMax Order Confirmed! ✅\n"
                f"Order: {order_number}\n"
                f"Items: {item_names}\n"
                f"Amount: Rs.{total_amount:.0f}\n"
                f"Payment: {payment_id}\n"
                f"Your medicines will be delivered soon!"
            )
            sms_sent = await send_sms(user_phone, sms_message)

            # 3. Send WhatsApp
            wa_message = (
                f"✅ *Order Confirmed!*\n\n"
                f"🆔 *Order:* {order_number}\n"
                f"💊 *Items:* {item_names}\n"
                f"💰 *Amount:* ₹{total_amount:.0f}\n"
                f"🧾 *Payment:* {payment_id}\n\n"
                f"Your medicines are being prepared for delivery. "
                f"We'll update you when they're dispatched! 🚚"
            )
            wa_sent = await send_whatsapp_notification(user_phone, wa_message)

            # Mark notification status
            cur.execute("""
                UPDATE orders SET email_sent = %s, sms_sent = %s
                WHERE id = %s
            """, (email_sent, sms_sent, order_id))
            conn.commit()

            logger.info(f"Order {order_number} notifications: email={email_sent}, sms={sms_sent}, wa={wa_sent}")

    except Exception as e:
        logger.error(f"Notification error for order {order_id}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()


# ══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ══════════════════════════════════════════════════════════════

@router.post("/create", response_model=OrderResponse)
async def create_order(req: CreateOrderRequest):
    """Create order rows in DB + a Razorpay order for payment."""
    try:
        uuid.UUID(req.user_id)
    except ValueError:
        raise HTTPException(400, "Invalid user_id")

    if not req.items:
        raise HTTPException(400, "No items in order")

    # Calculate total
    total_amount = sum(item.unit_price * item.quantity for item in req.items)
    if total_amount <= 0:
        raise HTTPException(400, "Order total must be positive")

    # Amount in paise for Razorpay (INR * 100)
    amount_paise = int(round(total_amount * 100))

    conn = None
    try:
        conn = get_db_connection()

        # Get user info for Razorpay prefill
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, email, phone, city, pincode FROM users WHERE id = %s",
                (req.user_id,),
            )
            user = cur.fetchone()
            if not user:
                raise HTTPException(404, "User not found")

        # Create Razorpay order
        razorpay_order = razorpay_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": f"baymax_{uuid.uuid4().hex[:12]}",
            "notes": {
                "user_id": req.user_id,
                "items_count": str(len(req.items)),
            },
        })
        razorpay_order_id = razorpay_order["id"]
        logger.info(f"Razorpay order created: {razorpay_order_id} for ₹{total_amount}")

        # Insert order rows into DB
        order_ids = []
        items_response = []
        delivery_addr = req.delivery_address or f"{user.get('city', '')}, {user.get('pincode', '')}"

        with conn.cursor() as cur:
            for item in req.items:
                order_id = str(uuid.uuid4())
                inv_id = item.inventory_id if item.inventory_id else None

                cur.execute("""
                    INSERT INTO orders
                    (id, user_id, patient_id, placed_by_role, inventory_id,
                     drug_name, quantity, unit_price, requires_rx,
                     delivery_address, notes, status,
                     razorpay_order_id, payment_status, payment_amount, currency,
                     prescription_id)
                    VALUES (%s, %s, %s, 'self', %s,
                            %s, %s, %s, FALSE,
                            %s, %s, 'pending',
                            %s, 'created', %s, 'INR',
                            %s)
                    RETURNING id, order_number
                """, (
                    order_id, req.user_id, req.user_id, inv_id,
                    item.drug_name, item.quantity, item.unit_price,
                    delivery_addr, req.notes,
                    razorpay_order_id, total_amount,
                    req.prescription_id,
                ))
                row = cur.fetchone()
                order_ids.append(row["id"])
                items_response.append({
                    "order_id": str(row["id"]),
                    "order_number": row["order_number"],
                    "drug_name": item.drug_name,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": item.unit_price * item.quantity,
                })

                # Decrement inventory stock
                if inv_id:
                    cur.execute("""
                        UPDATE inventory SET stock_qty = GREATEST(stock_qty - %s, 0)
                        WHERE id = %s
                    """, (item.quantity, inv_id))

            conn.commit()

        return OrderResponse(
            order_id=str(order_ids[0]),
            razorpay_order_id=razorpay_order_id,
            amount=total_amount,
            currency="INR",
            key_id=RAZORPAY_KEY_ID,
            user_name=user["name"],
            user_email=user["email"] or "",
            user_phone=user["phone"] or "",
            items=items_response,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create order failed: {e}", exc_info=True)
        if conn:
            conn.rollback()
        raise HTTPException(500, f"Failed to create order: {str(e)}")
    finally:
        if conn:
            conn.close()


@router.post("/initiate-payment/{order_id}")
async def initiate_payment(order_id: str):
    """
    Create a Razorpay order for an existing DB order (created by the chat graph).
    Used when the order was inserted with status='pending' and payment_status='pending'.
    """
    try:
        uuid.UUID(order_id)
    except ValueError:
        raise HTTPException(400, "Invalid order_id")

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # Fetch the pending order + user info
            cur.execute("""
                SELECT o.id, o.drug_name, o.quantity, o.unit_price, o.user_id,
                       o.inventory_id, o.status, o.razorpay_order_id,
                       (o.unit_price * o.quantity) as total,
                       u.name, u.email, u.phone
                FROM orders o JOIN users u ON o.user_id = u.id
                WHERE o.id = %s
            """, (order_id,))
            order = cur.fetchone()

            if not order:
                raise HTTPException(404, "Order not found")

            # If a Razorpay order was already created, return it
            if order["razorpay_order_id"]:
                return {
                    "order_id": str(order["id"]),
                    "razorpay_order_id": order["razorpay_order_id"],
                    "amount": float(order["total"]),
                    "currency": "INR",
                    "key_id": RAZORPAY_KEY_ID,
                    "user_name": order["name"],
                    "user_email": order["email"] or "",
                    "user_phone": order["phone"] or "",
                }

            total_amount = float(order["total"])
            amount_paise = int(round(total_amount * 100))

            # Create Razorpay order
            razorpay_order = razorpay_client.order.create({
                "amount": amount_paise,
                "currency": "INR",
                "receipt": f"baymax_chat_{uuid.uuid4().hex[:8]}",
                "notes": {
                    "user_id": str(order["user_id"]),
                    "order_id": order_id,
                    "drug_name": order["drug_name"],
                },
            })
            razorpay_order_id = razorpay_order["id"]

            # Update DB with Razorpay order ID
            cur.execute("""
                UPDATE orders SET razorpay_order_id = %s, payment_status = 'created',
                       payment_amount = %s WHERE id = %s
            """, (razorpay_order_id, total_amount, order_id))
            conn.commit()

            logger.info(f"Razorpay order {razorpay_order_id} created for chat order {order_id}")

            return {
                "order_id": str(order["id"]),
                "razorpay_order_id": razorpay_order_id,
                "amount": total_amount,
                "currency": "INR",
                "key_id": RAZORPAY_KEY_ID,
                "user_name": order["name"],
                "user_email": order["email"] or "",
                "user_phone": order["phone"] or "",
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Initiate payment failed for order {order_id}: {e}", exc_info=True)
        raise HTTPException(500, f"Failed to initiate payment: {str(e)}")
    finally:
        if conn:
            conn.close()


@router.post("/verify-payment")
async def verify_payment(req: VerifyPaymentRequest, background_tasks: BackgroundTasks):
    """Verify Razorpay payment signature and mark order as confirmed."""

    # Verify signature
    try:
        razorpay_client.utility.verify_payment_signature({
            "razorpay_order_id": req.razorpay_order_id,
            "razorpay_payment_id": req.razorpay_payment_id,
            "razorpay_signature": req.razorpay_signature,
        })
    except razorpay.errors.SignatureVerificationError:
        raise HTTPException(400, "Payment verification failed — invalid signature")

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # Update all order rows sharing this Razorpay order
            cur.execute("""
                UPDATE orders SET
                    status = 'confirmed',
                    payment_status = 'paid',
                    razorpay_payment_id = %s,
                    razorpay_signature = %s
                WHERE razorpay_order_id = %s
                RETURNING id, order_number, drug_name, quantity, unit_price, user_id
            """, (
                req.razorpay_payment_id,
                req.razorpay_signature,
                req.razorpay_order_id,
            ))
            updated = cur.fetchall()
            if not updated:
                raise HTTPException(404, "Order not found")

            conn.commit()

        first_order_id = str(updated[0]["id"])
        order_number = updated[0]["order_number"]
        total = sum(float(r["unit_price"] or 0) * int(r["quantity"] or 0) for r in updated)

        logger.info(f"Payment verified: {req.razorpay_order_id} → {req.razorpay_payment_id}")

        # Send notifications in background
        background_tasks.add_task(_send_order_notifications, first_order_id)

        return {
            "success": True,
            "order_id": first_order_id,
            "order_number": order_number,
            "payment_id": req.razorpay_payment_id,
            "total_amount": total,
            "items_count": len(updated),
            "message": "Payment verified. Order confirmed!",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment verification DB error: {e}", exc_info=True)
        raise HTTPException(500, "Payment verified but order update failed")
    finally:
        if conn:
            conn.close()


@router.get("/{order_id}")
async def get_order(order_id: str):
    """Get a single order by ID."""
    try:
        uuid.UUID(order_id)
    except ValueError:
        raise HTTPException(400, "Invalid order_id")

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone
                FROM orders o JOIN users u ON o.user_id = u.id
                WHERE o.id = %s
            """, (order_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Order not found")

            # Serialize
            result = dict(row)
            for k, v in result.items():
                if isinstance(v, (datetime,)):
                    result[k] = v.isoformat()
                elif hasattr(v, "hex"):  # UUID
                    result[k] = str(v)
            return result
    finally:
        if conn:
            conn.close()


@router.get("/user/{user_id}")
async def get_user_orders(user_id: str):
    """List all orders for a user (most recent first)."""
    try:
        uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(400, "Invalid user_id")

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, order_number, drug_name, quantity, unit_price,
                       total_price, status, payment_status, razorpay_payment_id,
                       ordered_at, delivery_address
                FROM orders
                WHERE user_id = %s
                ORDER BY ordered_at DESC
                LIMIT 50
            """, (user_id,))
            rows = cur.fetchall()

            orders = []
            for r in rows:
                o = dict(r)
                for k, v in o.items():
                    if isinstance(v, (datetime,)):
                        o[k] = v.isoformat()
                    elif hasattr(v, "hex"):
                        o[k] = str(v)
                orders.append(o)

            return {"user_id": user_id, "count": len(orders), "orders": orders}
    finally:
        if conn:
            conn.close()


@router.get("/razorpay/{razorpay_order_id}")
async def get_order_by_razorpay_id(razorpay_order_id: str):
    """Get orders by Razorpay order ID (for payment success page)."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT o.id, o.order_number, o.drug_name, o.quantity, o.unit_price,
                       o.total_price, o.status, o.payment_status, o.razorpay_payment_id,
                       o.ordered_at, o.email_sent, o.sms_sent,
                       u.name as user_name, u.email as user_email, u.phone as user_phone
                FROM orders o JOIN users u ON o.user_id = u.id
                WHERE o.razorpay_order_id = %s
                ORDER BY o.ordered_at
            """, (razorpay_order_id,))
            rows = cur.fetchall()
            if not rows:
                raise HTTPException(404, "Order not found")

            items = []
            for r in rows:
                o = dict(r)
                for k, v in o.items():
                    if isinstance(v, (datetime,)):
                        o[k] = v.isoformat()
                    elif hasattr(v, "hex"):
                        o[k] = str(v)
                items.append(o)

            total = sum(float(i.get("total_price") or 0) for i in items)

            return {
                "razorpay_order_id": razorpay_order_id,
                "order_number": items[0]["order_number"] if items else None,
                "payment_id": items[0].get("razorpay_payment_id"),
                "payment_status": items[0].get("payment_status"),
                "status": items[0].get("status"),
                "total_amount": total,
                "user_name": items[0].get("user_name"),
                "user_email": items[0].get("user_email"),
                "user_phone": items[0].get("user_phone"),
                "email_sent": items[0].get("email_sent", False),
                "sms_sent": items[0].get("sms_sent", False),
                "items": items,
            }
    finally:
        if conn:
            conn.close()
