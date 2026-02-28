"""
Pydantic request/response models.
Extracted from main_v6.py §3.
"""

import re
from typing import Optional
from pydantic import BaseModel, field_validator

from app.config import C


class WhatsAppIncoming(BaseModel):
    phone: str
    message: str
    session_id: Optional[str] = None
    channel: str = "whatsapp"

    @field_validator("message")
    @classmethod
    def clean_msg(cls, v):
        v = v.strip()[:C.MAX_MSG_LEN]
        # Prompt-injection hardening
        v = re.sub(r"(ignore previous|disregard all|system:\s|<\|im_start\|>)", "", v, flags=re.I)
        return v

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, v):
        return re.sub(r"[^\d+]", "", v)[:20]


class ChatResponse(BaseModel):
    reply: str
    reply_english: Optional[str] = None
    session_id: str
    agent_used: str
    emergency: bool = False
    safety_flags: list[str] = []
    triage_level: Optional[str] = None
    requires_action: Optional[str] = None
    risk_tier: int = 1
    # V6 additions
    channel: str = "whatsapp"
    dfe_triggered: bool = False
    web_search_used: bool = False
    web_search_source: Optional[str] = None


class AckRequest(BaseModel):
    log_id: str
    response: str


class VitalInput(BaseModel):
    phone: str
    bp_systolic:  Optional[int]   = None
    bp_diastolic: Optional[int]   = None
    blood_sugar:  Optional[float] = None
    spo2_pct:     Optional[float] = None
    temp_celsius: Optional[float] = None
    heart_rate:   Optional[int]   = None
    weight_kg:    Optional[float] = None


# ════════════════════════════════════════════════════════════
# Data Validation Models — used internally for type safety
# ════════════════════════════════════════════════════════════

from typing import Literal
from datetime import datetime


class UserProfile(BaseModel):
    """Validated user profile from database."""
    id: str
    phone: str
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    allergies: Optional[list[str]] = None
    is_pregnant: bool = False
    onboarded: bool = False
    onboarding_step: str = "name"
    consent_accepted: bool = False
    preferred_language: Optional[str] = "en-IN"
    current_meds: Optional[list[str]] = None
    chronic_conditions: Optional[list[str]] = None
    egfr: Optional[float] = None
    address: Optional[str] = None

    @field_validator("allergies", "current_meds", "chronic_conditions", mode="before")
    @classmethod
    def clean_list(cls, v):
        if v is None: return None
        if isinstance(v, list): return [x for x in v if x is not None]
        return v

    @field_validator("id", mode="before")
    @classmethod
    def id_to_str(cls, v):
        return str(v) if v else ""

    class Config:
        from_attributes = True


class InventoryItem(BaseModel):
    """Validated inventory record."""
    id: str
    drug_name: str
    brand_name: Optional[str] = None
    strength: Optional[str] = None
    form: Optional[str] = None
    stock_qty: int = 0
    unit: str = "tablet"
    price_per_unit: float = 0
    is_otc: bool = True
    drug_class: Optional[str] = None

    @field_validator("id", mode="before")
    @classmethod
    def id_to_str(cls, v):
        return str(v) if v else ""

    @field_validator("price_per_unit", mode="before")
    @classmethod
    def price_to_float(cls, v):
        return float(v) if v else 0.0

    class Config:
        from_attributes = True


class DosageCap(BaseModel):
    """Dosage safety cap for a drug."""
    drug_name: str
    adult_max_daily_mg: float = 0
    child_max_daily_mg: Optional[float] = None
    elderly_max_daily_mg: Optional[float] = None

    class Config:
        from_attributes = True


class OrderRecord(BaseModel):
    """Order record for history display."""
    id: str
    drug_name: str
    quantity: int
    unit_price: float
    status: str = "pending"
    ordered_at: Optional[datetime] = None

    @field_validator("id", mode="before")
    @classmethod
    def id_to_str(cls, v):
        return str(v) if v else ""

    @field_validator("unit_price", mode="before")
    @classmethod
    def price_to_float(cls, v):
        return float(v) if v else 0.0

    class Config:
        from_attributes = True

