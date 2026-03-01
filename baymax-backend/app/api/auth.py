"""
JWT Authentication — signup, login, token verification.
Passwords are hashed with bcrypt.  Tokens are HS256 JWTs.
"""

import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status, Request, BackgroundTasks
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from app.config import C
from app.singletons import get_pool, get_redis
from app.db.helpers import update_user
from app.db.redis_helpers import r_del
from app.models import normalize_phone
from app.api.order_router import send_registration_email, send_sms

logger = logging.getLogger("medai.v6")
router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer()

# Supported languages for the AI chat
SUPPORTED_LANGUAGES = [
    "en-IN",   # English
    "hi-IN",   # Hindi
    "bn-IN",   # Bengali
    "gu-IN",   # Gujarati
    "kn-IN",   # Kannada
    "ml-IN",   # Malayalam
    "mr-IN",   # Marathi
    "pa-IN",   # Punjabi
    "ta-IN",   # Tamil
    "te-IN",   # Telugu
    "ur-IN",   # Urdu
]


# ── Pydantic models ──────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str
    phone: str
    email: str
    password: str
    pincode: str
    city: str
    country: str = "India"
    preferred_language: str = "en-IN"
    age: Optional[int] = None
    gender: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Name must be at least 2 characters")
        return v

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", v):
            raise ValueError("Invalid email format")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, v: str) -> str:
        cleaned = normalize_phone(v)
        if len(cleaned) < 10:
            raise ValueError("Phone number must be at least 10 digits")
        return cleaned

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Pincode is required")
        return v

    @field_validator("city")
    @classmethod
    def validate_city(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("City must be at least 2 characters")
        return v

    @field_validator("preferred_language")
    @classmethod
    def validate_language(cls, v: str) -> str:
        if v not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Unsupported language. Choose from: {', '.join(SUPPORTED_LANGUAGES)}")
        return v


class LoginRequest(BaseModel):
    identifier: str          # email OR phone number
    password: str

    @field_validator("identifier")
    @classmethod
    def normalise_identifier(cls, v: str) -> str:
        return v.strip().lower()


class AuthResponse(BaseModel):
    token: str
    user: dict


# ── Helpers ───────────────────────────────────────────────────

def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=C.JWT_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, C.JWT_SECRET, algorithm=C.JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, C.JWT_SECRET, algorithms=[C.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


def _user_dict(row) -> dict:
    """Build a consistent user dict from a DB row."""
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "phone": row["phone"],
        "email": row["email"],
        "pincode": row.get("pincode"),
        "city": row.get("city"),
        "country": row.get("country"),
        "preferred_language": row.get("preferred_language"),
        "onboarded": row.get("onboarded"),
    }


# ── Dependency: get current user from Bearer token ───────────

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    """FastAPI dependency — extracts and validates JWT, returns user row."""
    payload = _decode_token(creds.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token payload")

    pool = await get_pool()
    user = await pool.fetchrow(
        """SELECT id, email, phone, name, age, gender, onboarded,
                  preferred_language, pincode, city, country, created_at
           FROM users WHERE id = $1""", user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return dict(user)


# ── Routes ────────────────────────────────────────────────────

@router.post("/signup", response_model=AuthResponse, status_code=201)
async def signup(req: SignupRequest, background_tasks: BackgroundTasks):
    """Register a new user with full profile."""
    pool = await get_pool()

    # Check duplicate email
    existing = await pool.fetchrow("SELECT id FROM users WHERE email = $1", req.email)
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    # Check duplicate phone
    existing_phone = await pool.fetchrow("SELECT id FROM users WHERE phone = $1", req.phone)
    if existing_phone:
        raise HTTPException(status.HTTP_409_CONFLICT, "Phone number already registered")

    hashed = _hash_password(req.password)

    row = await pool.fetchrow(
        """INSERT INTO users
           (name, phone, email, password_hash, pincode, city, country,
            preferred_language, age, gender, onboarded, onboarding_step)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 'done')
           RETURNING id, name, phone, email, pincode, city, country,
                     preferred_language, age, gender, onboarded, created_at""",
        req.name, req.phone, req.email, hashed,
        req.pincode, req.city, req.country, req.preferred_language,
        req.age, req.gender)

    user_id = str(row["id"])
    token = _create_token(user_id, req.email)

    logger.info(f"Signup: {req.email} / {req.phone} → {user_id}")

    # Send welcome email + SMS in background
    if req.email:
        background_tasks.add_task(send_registration_email, req.email, req.name)
    if req.phone:
        background_tasks.add_task(
            send_sms, req.phone,
            f"Welcome to BayMax, {req.name}! 🏥 Your AI health assistant is ready. "
            f"Login at {C.WEBSITE_BASE_URL}/login to get started!"
        )

    return AuthResponse(token=token, user=_user_dict(row))


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    """Authenticate with email/phone + password, return JWT."""
    pool = await get_pool()

    # Detect if identifier is email or phone
    is_email = "@" in req.identifier
    if is_email:
        row = await pool.fetchrow(
            """SELECT id, email, phone, name, password_hash, onboarded,
                      preferred_language, pincode, city, country
               FROM users WHERE email = $1""",
            req.identifier)
    else:
        # Normalize phone for lookup (always bare 10 digits)
        clean = normalize_phone(req.identifier)
        row = await pool.fetchrow(
            """SELECT id, email, phone, name, password_hash, onboarded,
                      preferred_language, pincode, city, country
               FROM users WHERE phone = $1""",
            clean)

    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    if not row["password_hash"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "This account was created via WhatsApp. Please set a password first.")

    if not _verify_password(req.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    user_id = str(row["id"])
    token = _create_token(user_id, row["email"])

    logger.info(f"Login: {req.identifier} → {user_id}")
    return AuthResponse(token=token, user=_user_dict(row))


@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)):
    """
    Clean up all session data for the logged-in user:
    - Delete conversations + messages (CASCADE) from Postgres
    - Delete conversation summaries
    - Flush per-user Redis keys (pending_action, dup_override, pending_order, etc.)
    """
    uid = str(user["id"])
    phone = user["phone"]
    pool = await get_pool()

    # 1. Delete conversation messages + conversations (CASCADE handles messages)
    deleted_convs = await pool.execute(
        "DELETE FROM conversations WHERE user_id = $1", user["id"])

    # 2. Delete conversation summaries
    await pool.execute(
        "DELETE FROM conversation_summaries WHERE user_id = $1", user["id"])

    # 3. Clear all per-user Redis state keys
    redis_keys = [
        f"pending_action:{phone}",
        f"dup_override:{phone}",
        f"pending_order:{phone}",
        f"pending_question:{phone}",
        f"family_step:{phone}",
    ]
    for key in redis_keys:
        await r_del(key)

    # 4. Scan and delete any other Redis keys matching this phone
    rd = await get_redis()
    if rd:
        try:
            cursor = 0
            while True:
                cursor, keys = await rd.scan(cursor, match=f"*{phone}*", count=100)
                if keys:
                    await rd.delete(*keys)
                if cursor == 0:
                    break
        except Exception as e:
            logger.warning(f"Redis scan cleanup for {phone}: {e}")

    logger.info(f"Logout: {phone} ({uid}) — sessions and Redis state cleared")
    return {"message": "Logged out and session data cleared"}


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    return {
        "id": str(user["id"]),
        "name": user["name"],
        "email": user["email"],
        "phone": user["phone"],
        "age": user.get("age"),
        "gender": user.get("gender"),
        "pincode": user.get("pincode"),
        "city": user.get("city"),
        "country": user.get("country"),
        "preferred_language": user.get("preferred_language"),
        "onboarded": user["onboarded"],
    }


@router.put("/profile")
async def update_profile(request: Request, user: dict = Depends(get_current_user)):
    """Update the authenticated user's profile fields."""
    body = await request.json()
    allowed = {"name", "age", "gender", "city", "pincode", "preferred_language", "blood_group", "weight_kg"}
    updates = {k: v for k, v in body.items() if k in allowed and v is not None}
    if not updates:
        raise HTTPException(400, "No valid fields to update.")

    # Type coercions to match DB schema
    if "age" in updates:
        try:
            updates["age"] = int(updates["age"])
        except (ValueError, TypeError):
            raise HTTPException(400, "Age must be a number.")

    try:
        row = await update_user(user["phone"], **updates)
    except Exception as e:
        logger.error(f"Profile update DB error: {e}", exc_info=True)
        raise HTTPException(500, f"Database error: {str(e)}")

    return {"message": "Profile updated successfully", "updated_fields": list(updates.keys())}


@router.get("/languages")
async def get_languages():
    """Return supported languages for the AI chat."""
    lang_names = {
        "en-IN": "English",
        "hi-IN": "Hindi",
        "bn-IN": "Bengali",
        "gu-IN": "Gujarati",
        "kn-IN": "Kannada",
        "ml-IN": "Malayalam",
        "mr-IN": "Marathi",
        "pa-IN": "Punjabi",
        "ta-IN": "Tamil",
        "te-IN": "Telugu",
        "ur-IN": "Urdu",
    }
    return [{"code": code, "name": lang_names.get(code, code)} for code in SUPPORTED_LANGUAGES]
