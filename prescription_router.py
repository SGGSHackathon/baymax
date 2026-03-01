"""
Prescription OCR Router — Complete rewrite with Sarvam Vision + smart extraction.

Pipeline:
  1. S3 presigned URL (upload)
  2. Background: S3 download -> Sarvam Vision OCR -> Groq LLM (structured JSON extraction)
     -> Pinecone drug matching -> Inventory stock check -> DB save
  3. Poll status endpoint returns everything including stock info + name match

Prefix: /prescriptions
"""

import os
import re
import io
import json
import uuid
import math
import zipfile
import logging
import tempfile
import httpx
from difflib import SequenceMatcher
from pathlib import Path
from datetime import date, datetime, timezone, timedelta
from typing import Optional, Any

import boto3
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor, execute_values
from pinecone import Pinecone
from sarvamai import SarvamAI
from groq import Groq
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field

# -- Logging
logger = logging.getLogger(__name__)

# -- Config
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
SARVAM_API_KEY = os.environ["SARVAM_API_KEY"]
PINECONE_API_KEY = os.environ["PINECONE_API_KEY"]
PINECONE_INDEX = os.environ["PINECONE_INDEX"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
BUCKET_NAME = os.environ.get("PRESCRIPTION_BUCKET", "medical-prescriptions-ai-agent")
AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")
URL_EXPIRATION = int(os.environ.get("URL_EXPIRATION_SECONDS", "300"))
PINECONE_NAMESPACE = "drug_database"

# -- Clients
s3_client = boto3.client("s3", region_name=AWS_REGION)
sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
pc = Pinecone(api_key=PINECONE_API_KEY)
pc_index = pc.Index(PINECONE_INDEX)
groq_client = Groq(api_key=GROQ_API_KEY)

# -- Allowed uploads
ALLOWED_CONTENT_TYPES = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
}
EXT_TO_CONTENT_TYPE = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "zip": "application/zip",
}

# -- Medicine form prefixes
FORM_MAP = {
    "t": "tablet", "tab": "tablet", "tablet": "tablet",
    "cap": "capsule", "cp": "capsule", "capsule": "capsule",
    "syp": "syrup", "syr": "syrup", "syrup": "syrup",
    "inj": "injection", "injection": "injection",
    "oint": "ointment", "ointment": "ointment",
    "gel": "gel", "cream": "cream",
    "drop": "drops", "drops": "drops",
    "sus": "suspension", "susp": "suspension",
    "sol": "solution", "lotn": "lotion", "lot": "lotion",
    "inh": "inhaler", "neb": "nebulizer",
    "pow": "powder", "sach": "sachet",
}

# -- Router
router = APIRouter(prefix="/prescriptions", tags=["Prescriptions"])


# ==============================
# PYDANTIC MODELS
# ==============================

class UploadRequest(BaseModel):
    user_id: str = Field(..., description="User UUID")
    file_name: str = Field(..., description="Original file name")
    content_type: Optional[str] = Field(None, description="MIME type (auto-detected if omitted)")

class UploadResponse(BaseModel):
    upload_url: str
    s3_key: str
    bucket: str
    content_type: str
    expires_in: int
    prescription_id: str

class ProcessRequest(BaseModel):
    prescription_id: str = Field(..., description="Prescription UUID from /upload")
    s3_key: str = Field(..., description="S3 key from /upload")

class ProcessResponse(BaseModel):
    prescription_id: str
    status: str
    message: str


# ==============================
# DATABASE HELPERS
# ==============================

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def _serialize_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, (uuid.UUID, datetime)):
            out[k] = str(v)
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif isinstance(v, memoryview):
            out[k] = bytes(v).decode("utf-8", errors="replace")
        else:
            out[k] = v
    return out


def _fetch_prescription_by_id(conn, prescription_id: str) -> dict | None:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT id, user_id, s3_key, file_type, ocr_status,
                   sarvam_job_id, raw_extracted_text,
                   error_message, processed_at, created_at,
                   hospital_name, doctor_name,
                   patient_name_ocr, patient_age_ocr, patient_gender_ocr,
                   patient_weight_ocr, patient_height_ocr,
                   prescription_date, name_match_score, name_match_warning
            FROM prescription_uploads WHERE id = %s
        """, (prescription_id,))
        prescription = cur.fetchone()
        if not prescription:
            return None

        cur.execute("""
            SELECT drug_name_raw, drug_name_matched, match_score,
                   brand_name, dosage, frequency, frequency_raw,
                   morning_dose, afternoon_dose, night_dose,
                   duration, duration_days, instructions, meal_relation,
                   form, course_start_date, course_end_date,
                   stock_status, stock_qty_available,
                   alternative_drug, alternative_inv_id,
                   pinecone_metadata
            FROM prescription_extracted_drugs
            WHERE prescription_id = %s ORDER BY created_at
        """, (prescription_id,))
        drugs = cur.fetchall()

        cur.execute("""
            SELECT observation_type, observation_text, body_part, severity
            FROM prescription_observations
            WHERE prescription_id = %s ORDER BY created_at
        """, (prescription_id,))
        observations = cur.fetchall()

    return {
        **_serialize_row(dict(prescription)),
        "drugs": [_serialize_row(dict(d)) for d in drugs],
        "observations": [_serialize_row(dict(o)) for o in observations],
    }


def _fetch_prescriptions_by_user(conn, user_id: str) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT pu.id, pu.s3_key, pu.file_type, pu.ocr_status,
                   pu.error_message, pu.processed_at, pu.created_at,
                   pu.hospital_name, pu.doctor_name, pu.patient_name_ocr,
                   pu.prescription_date, pu.name_match_score, pu.name_match_warning,
                   COUNT(ped.id) AS drugs_found,
                   COUNT(po.id) AS observations_found
            FROM prescription_uploads pu
            LEFT JOIN prescription_extracted_drugs ped ON pu.id = ped.prescription_id
            LEFT JOIN prescription_observations po ON pu.id = po.prescription_id
            WHERE pu.user_id = %s
            GROUP BY pu.id
            ORDER BY pu.created_at DESC LIMIT 50
        """, (user_id,))
        return [_serialize_row(dict(r)) for r in cur.fetchall()]


# ==============================
# DB SAVE HELPERS
# ==============================

def save_prescription_upload(
    conn, prescription_id, user_id, bucket, key,
    file_type, file_size, sarvam_job_id, ocr_status,
    raw_text, error_message=None, header_info=None,
):
    hi = header_info or {}
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO prescription_uploads
                (id, user_id, s3_bucket, s3_key, file_type, file_size_bytes,
                 sarvam_job_id, ocr_status, raw_extracted_text, error_message, processed_at,
                 hospital_name, doctor_name, patient_name_ocr, patient_age_ocr,
                 patient_gender_ocr, patient_weight_ocr, patient_height_ocr,
                 prescription_date, name_match_score, name_match_warning)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (s3_bucket, s3_key) DO UPDATE SET
                ocr_status = EXCLUDED.ocr_status,
                raw_extracted_text = COALESCE(EXCLUDED.raw_extracted_text, prescription_uploads.raw_extracted_text),
                sarvam_job_id = COALESCE(EXCLUDED.sarvam_job_id, prescription_uploads.sarvam_job_id),
                error_message = EXCLUDED.error_message,
                processed_at = EXCLUDED.processed_at,
                hospital_name = COALESCE(EXCLUDED.hospital_name, prescription_uploads.hospital_name),
                doctor_name = COALESCE(EXCLUDED.doctor_name, prescription_uploads.doctor_name),
                patient_name_ocr = COALESCE(EXCLUDED.patient_name_ocr, prescription_uploads.patient_name_ocr),
                patient_age_ocr = COALESCE(EXCLUDED.patient_age_ocr, prescription_uploads.patient_age_ocr),
                patient_gender_ocr = COALESCE(EXCLUDED.patient_gender_ocr, prescription_uploads.patient_gender_ocr),
                patient_weight_ocr = COALESCE(EXCLUDED.patient_weight_ocr, prescription_uploads.patient_weight_ocr),
                patient_height_ocr = COALESCE(EXCLUDED.patient_height_ocr, prescription_uploads.patient_height_ocr),
                prescription_date = COALESCE(EXCLUDED.prescription_date, prescription_uploads.prescription_date),
                name_match_score = COALESCE(EXCLUDED.name_match_score, prescription_uploads.name_match_score),
                name_match_warning = COALESCE(EXCLUDED.name_match_warning, prescription_uploads.name_match_warning),
                updated_at = NOW()
            RETURNING id
        """, (
            prescription_id, user_id, bucket, key, file_type, file_size,
            sarvam_job_id, ocr_status, raw_text, error_message,
            datetime.now(timezone.utc) if ocr_status in ("completed", "failed") else None,
            hi.get("hospital_name"), hi.get("doctor_name"),
            hi.get("patient_name"), hi.get("patient_age"),
            hi.get("patient_gender"), hi.get("patient_weight"),
            hi.get("patient_height"), hi.get("prescription_date"),
            hi.get("name_match_score"), hi.get("name_match_warning"),
        ))
        result = cur.fetchone()
        prescription_id = str(result[0])
    conn.commit()
    return prescription_id


def save_extracted_drugs(conn, prescription_id, user_id, matched_drugs):
    if not matched_drugs:
        return
    rows = []
    for d in matched_drugs:
        rows.append((
            str(uuid.uuid4()), prescription_id, user_id,
            d["drug_name_raw"], d.get("drug_name_matched"), d.get("match_score", 0.0),
            d.get("brand_name"), d.get("dosage"), d.get("frequency"), d.get("frequency_raw"),
            d.get("morning_dose", 0.0), d.get("afternoon_dose", 0.0), d.get("night_dose", 0.0),
            d.get("duration"), d.get("duration_days"), d.get("instructions"),
            d.get("meal_relation"), d.get("form"),
            d.get("course_start_date"), d.get("course_end_date"),
            d.get("stock_status"), d.get("stock_qty_available"),
            d.get("alternative_drug"), d.get("alternative_inv_id"),
            json.dumps(d.get("pinecone_metadata", {})),
        ))
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO prescription_extracted_drugs
                (id, prescription_id, user_id, drug_name_raw, drug_name_matched,
                 match_score, brand_name, dosage, frequency, frequency_raw,
                 morning_dose, afternoon_dose, night_dose,
                 duration, duration_days, instructions, meal_relation, form,
                 course_start_date, course_end_date,
                 stock_status, stock_qty_available,
                 alternative_drug, alternative_inv_id,
                 pinecone_metadata)
            VALUES %s
        """, rows)
    conn.commit()
    logger.info(f"Saved {len(rows)} drugs for prescription {prescription_id}")


def save_observations(conn, prescription_id, user_id, observations):
    if not observations:
        return
    valid_types = {"symptom", "diagnosis", "vital_sign", "lifestyle", "investigation", "doctor_note", "other"}
    rows = []
    for obs in observations:
        obs_type = obs.get("observation_type", "other")
        if obs_type not in valid_types:
            obs_type = "other"
        obs_text = obs.get("observation_text", "").strip()
        if not obs_text:
            continue
        severity = obs.get("severity")
        if severity and severity not in ("mild", "moderate", "severe"):
            severity = None
        rows.append((
            str(uuid.uuid4()), prescription_id, user_id,
            obs_type, obs_text, obs.get("body_part"), severity,
        ))
    if not rows:
        return
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO prescription_observations
                (id, prescription_id, user_id, observation_type,
                 observation_text, body_part, severity)
            VALUES %s
        """, rows)
    conn.commit()
    logger.info(f"Saved {len(rows)} observations for prescription {prescription_id}")


# ==============================
# OCR ENGINE - Sarvam Vision
# ==============================

def detect_file_type(key):
    ext = key.rsplit(".", 1)[-1].lower()
    if ext in ("jpg", "jpeg"):
        return "jpeg"
    if ext in ("png", "pdf", "zip"):
        return ext
    return "pdf"


def download_s3_file(bucket, key):
    response = s3_client.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read()
    file_type = detect_file_type(key)
    logger.info(f"Downloaded s3://{bucket}/{key} - {len(body)} bytes, type={file_type}")
    return body, file_type


def run_sarvam_ocr(file_bytes, file_type):
    """Run Sarvam Vision OCR via SDK. Returns (extracted_text, job_id)."""
    logger.info(f"Starting Sarvam Vision OCR for file_type={file_type}")

    # Convert images to PDF (Sarvam only accepts PDF/ZIP natively)
    if file_type in ("jpg", "jpeg", "png"):
        try:
            from PIL import Image
            image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            logger.info(f"Image dimensions: {image.size[0]}x{image.size[1]}")
            pdf_buf = io.BytesIO()
            image.save(pdf_buf, format="PDF", resolution=150.0, save_all=True)
            file_bytes = pdf_buf.getvalue()
            file_type = "pdf"
            logger.info(f"Converted image to PDF ({len(file_bytes)} bytes)")
        except Exception as e:
            logger.error(f"Image to PDF conversion failed: {e}")
            raise RuntimeError(f"Failed to convert image to PDF: {e}")

    MAX_RETRIES = 2
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            job = sarvam_client.document_intelligence.create_job(
                language="en-IN", output_format="md"
            )
            sarvam_job_id = job.job_id
            logger.info(f"Sarvam job created: {sarvam_job_id} (attempt {attempt})")

            suffix = f".{file_type}"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name

            try:
                job.upload_file(tmp_path)
                logger.info(f"File uploaded to Sarvam job {sarvam_job_id}")
                job.start()
                logger.info(f"Sarvam job {sarvam_job_id} started, waiting...")

                try:
                    status = job.wait_until_complete(timeout=600.0)
                except (TimeoutError, Exception) as wait_err:
                    logger.warning(f"Sarvam wait error (attempt {attempt}): {wait_err}")
                    last_error = wait_err
                    if attempt < MAX_RETRIES:
                        continue
                    raise RuntimeError(f"Sarvam OCR timed out after {MAX_RETRIES} attempts: {wait_err}")

                if status.job_state not in ("Completed", "PartiallyCompleted"):
                    logger.warning(f"Sarvam job state: {status.job_state} (attempt {attempt})")
                    last_error = RuntimeError(f"Job state: {status.job_state}")
                    if attempt < MAX_RETRIES:
                        continue
                    raise RuntimeError(f"Sarvam job failed: {status.job_state}")

                try:
                    metrics = job.get_page_metrics()
                    logger.info(f"Page metrics: {metrics}")
                except Exception:
                    pass

                output_dir = tempfile.mkdtemp()
                output_zip_path = os.path.join(output_dir, "output.zip")
                job.download_output(output_zip_path)

                extracted_text = ""
                with zipfile.ZipFile(output_zip_path, "r") as zf:
                    for name in sorted(zf.namelist()):
                        if name.endswith((".md", ".html", ".txt", ".json")):
                            content = zf.read(name).decode("utf-8", errors="replace")
                            extracted_text += content + "\n\n"

                if not extracted_text.strip():
                    logger.warning(f"Empty OCR text (attempt {attempt})")
                    last_error = RuntimeError("Empty OCR result")
                    if attempt < MAX_RETRIES:
                        continue
                    raise RuntimeError("Sarvam returned empty text")

                logger.info(f"OCR extracted {len(extracted_text)} chars")
                return extracted_text.strip(), sarvam_job_id
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"Sarvam OCR attempt {attempt} error: {e}")
            last_error = e
            if attempt >= MAX_RETRIES:
                raise RuntimeError(f"Sarvam OCR failed after {MAX_RETRIES} attempts: {e}")

    raise RuntimeError(f"Sarvam OCR exhausted retries: {last_error}")


# ==============================
# SMART EXTRACTION - Groq LLM
# ==============================

def extract_prescription_data_llm(ocr_text):
    """Use Groq LLM to extract structured prescription data from OCR text."""
    if not ocr_text.strip():
        return {"header": {}, "drugs": [], "observations": []}

    prompt = f"""You are an expert medical prescription parser. Parse the following OCR-extracted
prescription text and extract ALL information in a structured JSON format.

## PRESCRIPTION LAYOUT CONTEXT
Indian prescriptions typically follow this layout:
1. **TOP**: Hospital/clinic name, address, phone - sometimes with a logo
2. **HEADER ROW**: Doctor name (Dr. ..., MBBS, MD, etc.)
3. **PATIENT INFO**: Patient name, age, sex/gender, weight, height, date
4. **Rx SECTION**: This is the MAIN part - all prescribed medications listed here
5. **BOTTOM**: Doctor signature, stamps, follow-up date

## EXTRACTION RULES

### A. HEADER INFO
Extract these from the top/header area:
- "hospital_name": Hospital/clinic name (first prominent text, usually bold/large)
- "doctor_name": Doctor full name with qualifications
- "patient_name": Patient name (look for "Name:", "Pt:", "Patient:" labels)
- "patient_age": Age (look for "Age:", might say "25Y" or "25 years")
- "patient_gender": Gender (M/F/Male/Female)
- "patient_weight": Weight if mentioned (e.g. "62kg")
- "patient_height": Height if mentioned
- "prescription_date": Date on the prescription in YYYY-MM-DD format.
  Look for "Date:", numbers like "15/02/2026", "Feb 15, 2026" etc. Convert to YYYY-MM-DD.

### B. DRUGS (Rx section)
This is the MOST IMPORTANT part. Look for the Rx symbol/section.
Common medicine prefixes on Indian prescriptions:
- T. or Tab. = Tablet
- Cap. or Cp. = Capsule
- Syp. or Syr. = Syrup
- Inj. = Injection
- Oint. = Ointment
- Gel, Cream, Drop, Susp. = respective forms

For EACH medicine extract:
- "drug_name": The medicine name WITHOUT the prefix (e.g. "Azithromycin 500" not "Tab. Azithromycin 500")
- "form": The dosage form: "tablet", "capsule", "syrup", "injection", "ointment", "cream", "drops", "gel", "suspension", "inhaler", "powder", "sachet" etc.
- "dosage": Strength like "500mg", "250mg", "10mg/5ml" etc. (or null)
- "frequency": MUST be in X-Y-Z format representing morning-afternoon-night doses:
    - "1-0-1" = 1 morning, 0 afternoon, 1 night
    - "1-1-1" = thrice daily
    - "0-0-1" = night only
    - "1-0-0" = morning only
    - BD/twice daily -> "1-0-1"
    - OD/once daily -> "1-0-0"
    - TDS/thrice daily -> "1-1-1"
    - QID/four times -> "1-1-1-1"
    - HS/at night -> "0-0-1"
    - SOS/PRN -> "SOS"
    - If already written as X-Y-Z, preserve it exactly
- "duration": How long - "5 days", "1 week", "2 weeks", "1 month" etc. (or null)
- "instructions": Meal/timing - "after food", "before meal", "empty stomach", "with milk", "before sleep" etc. (or null)

### C. OBSERVATIONS
Extract ALL clinical findings that are NOT medicine names:
- Symptoms/complaints (e.g. "fever since 3 days", "headache")
- Diagnosis (e.g. "Acute Pharyngitis", "URTI", "Hypertension")
- Vital signs (e.g. "BP 130/80", "Temp 101F", "SpO2 98%")
- Investigations (e.g. "CBC ordered", "X-ray chest")
- Doctor notes (e.g. "Review after 5 days", "Avoid cold water")

For each: {{"observation_type": "symptom"|"diagnosis"|"vital_sign"|"investigation"|"doctor_note"|"lifestyle"|"other", "observation_text": "...", "body_part": "..." or null, "severity": "mild"|"moderate"|"severe" or null}}

## OUTPUT FORMAT
Return ONLY valid JSON - no markdown, no explanation:
{{
  "header": {{
    "hospital_name": "...",
    "doctor_name": "...",
    "patient_name": "...",
    "patient_age": "...",
    "patient_gender": "...",
    "patient_weight": "...",
    "patient_height": "...",
    "prescription_date": "YYYY-MM-DD"
  }},
  "drugs": [
    {{
      "drug_name": "...",
      "form": "tablet",
      "dosage": "500mg",
      "frequency": "1-0-1",
      "duration": "5 days",
      "instructions": "after food"
    }}
  ],
  "observations": [
    {{
      "observation_type": "diagnosis",
      "observation_text": "...",
      "body_part": null,
      "severity": null
    }}
  ]
}}

If a field is not found, use null. If no drugs/observations found, use empty arrays [].

## PRESCRIPTION TEXT:
---
{ocr_text[:8000]}
---"""

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a precise Indian medical prescription parser. "
                    "Extract hospital, doctor, patient info, ALL medicines with X-Y-Z dosage format, "
                    "and clinical observations. Output ONLY valid JSON, nothing else."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.05,
        max_tokens=6000,
    )

    raw = response.choices[0].message.content.strip()
    logger.info(f"LLM raw response (first 600 chars): {raw[:600]}")

    # Parse JSON from response
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if json_match:
        try:
            data = json.loads(json_match.group())
            return {
                "header": data.get("header", {}),
                "drugs": data.get("drugs", []),
                "observations": data.get("observations", []),
            }
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")

    return {"header": {}, "drugs": [], "observations": []}


# ==============================
# NAME SIMILARITY SCORING
# ==============================

def compute_name_similarity(user_name, ocr_name):
    """Compare user account name with name extracted from prescription.
    Returns (score 0.0-1.0, warning_message or None).
    """
    if not user_name or not ocr_name:
        return (0.0, None)

    def norm(s):
        return " ".join(s.strip().lower().split())

    n1 = norm(user_name)
    n2 = norm(ocr_name)

    if not n1 or not n2:
        return (0.0, None)

    # Full string similarity
    score = SequenceMatcher(None, n1, n2).ratio()

    # Also check token overlap (handles partial names like "Rahul" vs "Rahul Sharma")
    tokens1 = set(n1.split())
    tokens2 = set(n2.split())
    if tokens1 and tokens2:
        overlap = len(tokens1 & tokens2)
        token_score = overlap / max(len(tokens1), len(tokens2))
        score = max(score, token_score)

    warning = None
    if score < 0.4:
        warning = f"Low name match ({score:.0%}): The prescription appears to be for \"{ocr_name}\" but your account name is \"{user_name}\". This prescription may belong to a different person."
    elif score < 0.7:
        warning = f"Partial name match ({score:.0%}): Prescription name \"{ocr_name}\" partially matches your account name \"{user_name}\". Please verify."

    return (round(score, 4), warning)


# ==============================
# DOSAGE / DURATION / MEAL PARSERS
# ==============================

def parse_dosage_pattern(frequency):
    result = {
        "frequency_raw": frequency, "morning_dose": 0.0,
        "afternoon_dose": 0.0, "night_dose": 0.0, "frequency_text": frequency,
    }
    if not frequency:
        return result

    freq = frequency.strip()
    normalized = freq.replace("\u00bd", "0.5").replace("\u00bc", "0.25").replace("\u00be", "0.75")

    # X-Y-Z pattern (3-part: X-Y-Z)
    pattern_3 = r'^(\d+(?:\.\d+)?(?:/\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?(?:/\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?(?:/\d+)?)$'
    match = re.match(pattern_3, normalized)

    if match:
        def parse_frac(s):
            s = s.strip()
            if '/' in s:
                parts = s.split('/')
                try:
                    return float(parts[0]) / float(parts[1])
                except (ValueError, ZeroDivisionError):
                    return 0.0
            try:
                return float(s)
            except ValueError:
                return 0.0

        morning = parse_frac(match.group(1))
        afternoon = parse_frac(match.group(2))
        night = parse_frac(match.group(3))
        result.update({
            "frequency_raw": freq, "morning_dose": morning,
            "afternoon_dose": afternoon, "night_dose": night,
        })
        slots = []
        if morning > 0: slots.append(f"morning {morning:g}")
        if afternoon > 0: slots.append(f"afternoon {afternoon:g}")
        if night > 0: slots.append(f"night {night:g}")
        result["frequency_text"] = ", ".join(slots) if slots else freq
        return result

    # Text-based patterns
    freq_lower = freq.lower().strip()
    text_map = {
        "once daily": (1, 0, 0, "morning 1"), "once a day": (1, 0, 0, "morning 1"),
        "od": (1, 0, 0, "morning 1"),
        "twice daily": (1, 0, 1, "morning 1, night 1"), "twice a day": (1, 0, 1, "morning 1, night 1"),
        "bd": (1, 0, 1, "morning 1, night 1"), "bid": (1, 0, 1, "morning 1, night 1"),
        "thrice daily": (1, 1, 1, "morning 1, afternoon 1, night 1"),
        "three times a day": (1, 1, 1, "morning 1, afternoon 1, night 1"),
        "tid": (1, 1, 1, "morning 1, afternoon 1, night 1"),
        "tds": (1, 1, 1, "morning 1, afternoon 1, night 1"),
        "qid": (1, 1, 1, "4 times daily"),
        "at night": (0, 0, 1, "night 1"), "at bedtime": (0, 0, 1, "night 1"),
        "hs": (0, 0, 1, "night 1"), "in the morning": (1, 0, 0, "morning 1"),
        "sos": (0, 0, 0, "as needed (SOS)"), "prn": (0, 0, 0, "as needed (PRN)"),
        "stat": (1, 0, 0, "immediately (STAT)"),
    }
    for key, (m, a, n, txt) in text_map.items():
        if key in freq_lower:
            result.update({"morning_dose": float(m), "afternoon_dose": float(a),
                           "night_dose": float(n), "frequency_text": txt})
            return result

    return result


def parse_duration_days(duration):
    if not duration:
        return None
    d = duration.lower().strip()
    m = re.search(r'(\d+)\s*days?', d)
    if m: return int(m.group(1))
    m = re.search(r'(\d+)\s*weeks?', d)
    if m: return int(m.group(1)) * 7
    m = re.search(r'(\d+)\s*months?', d)
    if m: return int(m.group(1)) * 30
    return None


def parse_meal_relation(instructions):
    if not instructions:
        return None
    inst = instructions.lower().strip()
    if any(x in inst for x in ["before meal", "before food", "before eating"]):
        return "before_meal"
    if "empty stomach" in inst:
        return "empty_stomach"
    if any(x in inst for x in ["after meal", "after food", "after eating"]):
        return "after_meal"
    if "with meal" in inst or "with food" in inst:
        return "with_meal"
    if any(x in inst for x in ["before sleep", "bedtime", "at night"]):
        return "before_sleep"
    return "any"


def parse_form(form_str, drug_name_raw=None):
    """Detect medicine form from explicit field or from drug name prefix."""
    if form_str:
        f = form_str.strip().lower().rstrip(".")
        if f in FORM_MAP:
            return FORM_MAP[f]
        for k, v in FORM_MAP.items():
            if k in f or v in f:
                return v

    if drug_name_raw:
        prefix_match = re.match(r'^([A-Za-z]+)\.?\s', drug_name_raw.strip())
        if prefix_match:
            prefix = prefix_match.group(1).lower()
            if prefix in FORM_MAP:
                return FORM_MAP[prefix]

    return None


def compute_course_dates(prescription_date_str, duration_days):
    """Calculate course start and end dates.
    start = prescription_date if available, else today
    end = start + duration_days
    """
    today = date.today()

    if prescription_date_str:
        try:
            start = date.fromisoformat(prescription_date_str)
        except (ValueError, TypeError):
            start = today
    else:
        start = today

    end = None
    if duration_days and duration_days > 0:
        end = start + timedelta(days=duration_days)

    return (start, end)


# ==============================
# INVENTORY STOCK CHECK
# ==============================

def check_stock_availability(conn, drug_name, drug_class=None):
    """Check if a drug is available in inventory."""
    result = {
        "status": "not_found",
        "qty_available": 0,
        "inventory_id": None,
        "alternative_drug": None,
        "alternative_inv_id": None,
    }

    if not drug_name:
        return result

    drug_lower = drug_name.strip().lower()

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT id, drug_name, brand_name, stock_qty, reorder_level,
                   drug_class, is_active, category, strength
            FROM inventory
            WHERE is_active = TRUE
              AND (LOWER(drug_name) = %s
                   OR LOWER(brand_name) = %s
                   OR drug_name ILIKE %s
                   OR brand_name ILIKE %s)
            ORDER BY stock_qty DESC
            LIMIT 1
        """, (drug_lower, drug_lower, f"%{drug_lower}%", f"%{drug_lower}%"))
        row = cur.fetchone()

        if row:
            qty = row["stock_qty"] or 0
            reorder = row["reorder_level"] or 10
            result["inventory_id"] = str(row["id"])
            result["qty_available"] = qty
            if qty <= 0:
                result["status"] = "out_of_stock"
            elif qty <= reorder:
                result["status"] = "low_stock"
            else:
                result["status"] = "in_stock"

            if result["status"] == "out_of_stock":
                alt_class = row.get("drug_class") or drug_class
                alt_category = row.get("category")
                if alt_class:
                    cur.execute("""
                        SELECT id, drug_name, brand_name, stock_qty
                        FROM inventory
                        WHERE is_active = TRUE AND stock_qty > 0
                          AND drug_class = %s
                          AND LOWER(drug_name) != %s
                        ORDER BY stock_qty DESC LIMIT 1
                    """, (alt_class, drug_lower))
                    alt = cur.fetchone()
                    if alt:
                        result["alternative_drug"] = f"{alt['drug_name']} ({alt['brand_name']})" if alt['brand_name'] else alt['drug_name']
                        result["alternative_inv_id"] = str(alt["id"])
                elif alt_category:
                    cur.execute("""
                        SELECT id, drug_name, brand_name, stock_qty
                        FROM inventory
                        WHERE is_active = TRUE AND stock_qty > 0
                          AND category = %s
                          AND LOWER(drug_name) != %s
                        ORDER BY stock_qty DESC LIMIT 1
                    """, (alt_category, drug_lower))
                    alt = cur.fetchone()
                    if alt:
                        result["alternative_drug"] = f"{alt['drug_name']} ({alt['brand_name']})" if alt['brand_name'] else alt['drug_name']
                        result["alternative_inv_id"] = str(alt["id"])
        else:
            result["status"] = "not_found"

    return result


# ==============================
# PINECONE DRUG MATCHING
# ==============================

def get_embedding(text):
    response = pc.inference.embed(
        model="multilingual-e5-large", inputs=[text],
        parameters={"input_type": "query"},
    )
    return response[0].values


def match_drugs_pinecone(conn, drug_candidates, prescription_date_str=None):
    """Match extracted drugs against Pinecone + check inventory stock."""
    matched = []
    for candidate in drug_candidates:
        drug_name = candidate.get("drug_name", "").strip()
        if not drug_name:
            continue

        try:
            embedding = get_embedding(drug_name.lower())
            results = pc_index.query(
                vector=embedding, top_k=3,
                namespace=PINECONE_NAMESPACE, include_metadata=True,
            )
            best_match, best_score, best_meta = None, 0.0, {}
            if results.matches:
                top = results.matches[0]
                best_score = top.score
                best_meta = top.metadata or {}
                best_match = best_meta.get("drug_name", best_meta.get("name", drug_name))
                logger.info(f"Drug '{drug_name}' matched '{best_match}' (score={best_score:.4f})")

            dosage_parsed = parse_dosage_pattern(candidate.get("frequency"))
            duration_days = parse_duration_days(candidate.get("duration"))
            form = parse_form(candidate.get("form"), drug_name)
            start_date, end_date = compute_course_dates(prescription_date_str, duration_days)

            search_name = best_match if best_match and best_score >= 0.5 else drug_name
            stock_info = check_stock_availability(conn, search_name, best_meta.get("drug_class"))

            matched.append({
                "drug_name_raw": drug_name,
                "drug_name_matched": best_match if best_score >= 0.5 else None,
                "match_score": round(best_score, 4),
                "brand_name": best_meta.get("brand_name"),
                "dosage": candidate.get("dosage"),
                "frequency": dosage_parsed["frequency_text"],
                "frequency_raw": dosage_parsed["frequency_raw"],
                "morning_dose": dosage_parsed["morning_dose"],
                "afternoon_dose": dosage_parsed["afternoon_dose"],
                "night_dose": dosage_parsed["night_dose"],
                "duration": candidate.get("duration"),
                "duration_days": duration_days,
                "instructions": candidate.get("instructions"),
                "meal_relation": parse_meal_relation(candidate.get("instructions")),
                "form": form,
                "course_start_date": start_date.isoformat() if start_date else None,
                "course_end_date": end_date.isoformat() if end_date else None,
                "stock_status": stock_info["status"],
                "stock_qty_available": stock_info["qty_available"],
                "alternative_drug": stock_info["alternative_drug"],
                "alternative_inv_id": stock_info["alternative_inv_id"],
                "pinecone_metadata": best_meta,
                "matched_inventory_id": stock_info["inventory_id"],
            })
        except Exception as e:
            logger.error(f"Processing error for '{drug_name}': {e}")
            dosage_parsed = parse_dosage_pattern(candidate.get("frequency"))
            duration_days = parse_duration_days(candidate.get("duration"))
            form = parse_form(candidate.get("form"), drug_name)
            start_date, end_date = compute_course_dates(prescription_date_str, duration_days)
            matched.append({
                "drug_name_raw": drug_name, "drug_name_matched": None,
                "match_score": 0.0, "brand_name": None,
                "dosage": candidate.get("dosage"),
                "frequency": dosage_parsed["frequency_text"],
                "frequency_raw": dosage_parsed["frequency_raw"],
                "morning_dose": dosage_parsed["morning_dose"],
                "afternoon_dose": dosage_parsed["afternoon_dose"],
                "night_dose": dosage_parsed["night_dose"],
                "duration": candidate.get("duration"),
                "duration_days": duration_days,
                "instructions": candidate.get("instructions"),
                "meal_relation": parse_meal_relation(candidate.get("instructions")),
                "form": form,
                "course_start_date": start_date.isoformat() if start_date else None,
                "course_end_date": end_date.isoformat() if end_date else None,
                "stock_status": "not_found", "stock_qty_available": 0,
                "alternative_drug": None, "alternative_inv_id": None,
                "pinecone_metadata": {},
                "matched_inventory_id": None,
            })
    return matched


# ==============================
# BACKGROUND PROCESSING TASK
# ==============================

def _update_ocr_status(conn, prescription_id, status, error_message=None):
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE prescription_uploads SET ocr_status=%s, error_message=%s, updated_at=NOW() WHERE id=%s",
                (status, error_message, prescription_id),
            )
        conn.commit()
    except Exception as e:
        logger.warning(f"Status update failed: {e}")


def _get_user_name(conn, user_id):
    """Fetch the user name from the users table."""
    if not user_id:
        return None
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            return row["name"] if row else None
    except Exception:
        return None


def process_prescription_background(prescription_id, user_id, s3_key):
    """
    Full background pipeline:
    S3 download -> Sarvam OCR -> Groq LLM extraction (header + drugs + observations)
    -> Name similarity check -> Pinecone drug matching -> Stock check -> DB save
    """
    conn = None
    sarvam_job_id = ""

    try:
        conn = get_db_connection()

        # Stage 1: Download from S3
        _update_ocr_status(conn, prescription_id, "downloading")
        file_bytes, file_type = download_s3_file(BUCKET_NAME, s3_key)
        logger.info(f"[{prescription_id}] Downloaded {len(file_bytes)} bytes")

        # Stage 2: Sarvam Vision OCR
        _update_ocr_status(conn, prescription_id, "ocr_running")
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), "", "ocr_running", None,
        )

        extracted_text, sarvam_job_id = run_sarvam_ocr(file_bytes, file_type)
        logger.info(f"[{prescription_id}] OCR done: {len(extracted_text)} chars")

        # Save raw OCR text immediately
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), sarvam_job_id, "extracting", extracted_text,
        )

        # Stage 3: Groq LLM extraction
        _update_ocr_status(conn, prescription_id, "extracting")
        prescription_data = extract_prescription_data_llm(extracted_text)
        header = prescription_data.get("header", {})
        drug_candidates = prescription_data.get("drugs", [])
        observations = prescription_data.get("observations", [])
        logger.info(f"[{prescription_id}] LLM extracted: header={bool(header)}, "
                     f"{len(drug_candidates)} drugs, {len(observations)} observations")

        # Stage 4: Name similarity check
        user_name = _get_user_name(conn, user_id)
        ocr_patient_name = header.get("patient_name")
        name_score, name_warning = compute_name_similarity(user_name, ocr_patient_name)
        header["name_match_score"] = name_score
        header["name_match_warning"] = name_warning

        # Stage 5: Pinecone matching + stock check
        _update_ocr_status(conn, prescription_id, "matching")
        prescription_date_str = header.get("prescription_date")
        matched_drugs = match_drugs_pinecone(conn, drug_candidates, prescription_date_str)
        logger.info(f"[{prescription_id}] Matched {len(matched_drugs)} drugs with stock info")

        # Stage 6: Final save
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), sarvam_job_id, "completed", extracted_text,
            header_info=header,
        )
        save_extracted_drugs(conn, prescription_id, user_id, matched_drugs)
        save_observations(conn, prescription_id, user_id, observations)

        logger.info(f"[{prescription_id}] Prescription processed successfully")

    except Exception as e:
        logger.error(f"Error processing prescription {prescription_id}: {e}", exc_info=True)
        if conn:
            try:
                save_prescription_upload(
                    conn, prescription_id, user_id, BUCKET_NAME, s3_key,
                    detect_file_type(s3_key), 0, sarvam_job_id, "failed",
                    None, str(e)[:500],
                )
            except Exception as db_err:
                logger.error(f"DB error on failure update: {db_err}")
    finally:
        if conn:
            conn.close()


# ==============================
# API ENDPOINTS
# ==============================

@router.post("/upload", response_model=UploadResponse)
async def get_upload_url(req: UploadRequest):
    """Step 1 - Get a presigned S3 URL for uploading prescription file."""
    try:
        uuid.UUID(req.user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="user_id must be a valid UUID")

    if not req.file_name:
        raise HTTPException(status_code=400, detail="file_name is required")

    ext = req.file_name.rsplit(".", 1)[-1].lower() if "." in req.file_name else ""
    content_type = req.content_type or EXT_TO_CONTENT_TYPE.get(ext, "")

    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type or ext}. Allowed: PDF, PNG, JPG, ZIP",
        )

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_name = req.file_name.replace(" ", "_").replace("/", "_")
    s3_key = f"prescriptions/{req.user_id}/{timestamp}_{safe_name}"
    prescription_id = str(uuid.uuid4())

    conn = None
    try:
        conn = get_db_connection()
        save_prescription_upload(
            conn, prescription_id, req.user_id, BUCKET_NAME, s3_key,
            ALLOWED_CONTENT_TYPES[content_type], 0, "", "pending", None,
        )
    except Exception as e:
        logger.error(f"DB error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create prescription record")
    finally:
        if conn:
            conn.close()

    try:
        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={"Bucket": BUCKET_NAME, "Key": s3_key, "ContentType": content_type},
            ExpiresIn=URL_EXPIRATION,
        )
    except Exception as e:
        logger.error(f"S3 presigned URL error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate upload URL")

    logger.info(f"Presigned URL for s3://{BUCKET_NAME}/{s3_key}, rx={prescription_id}")

    return UploadResponse(
        upload_url=presigned_url,
        s3_key=s3_key,
        bucket=BUCKET_NAME,
        content_type=content_type,
        expires_in=URL_EXPIRATION,
        prescription_id=prescription_id,
    )


@router.post("/process", response_model=ProcessResponse)
async def trigger_processing(req: ProcessRequest, background_tasks: BackgroundTasks):
    """Step 2 - Trigger OCR processing after S3 upload."""
    try:
        uuid.UUID(req.prescription_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid prescription_id")

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, user_id, ocr_status FROM prescription_uploads WHERE id = %s",
                (req.prescription_id,),
            )
            row = cur.fetchone()
    except Exception as e:
        logger.error(f"DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    finally:
        if conn:
            conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Prescription not found")

    if row["ocr_status"] == "completed":
        return ProcessResponse(
            prescription_id=req.prescription_id,
            status=row["ocr_status"],
            message=f"Already {row['ocr_status']}",
        )

    user_id = str(row["user_id"]) if row["user_id"] else None
    background_tasks.add_task(
        process_prescription_background, req.prescription_id, user_id, req.s3_key,
    )

    return ProcessResponse(
        prescription_id=req.prescription_id,
        status="processing",
        message="Processing started. Poll GET /prescriptions/status/{id} for results.",
    )


@router.get("/status/{prescription_id}")
async def get_prescription_status(prescription_id: str):
    """Get full extraction results: header, drugs (with stock), observations, name match."""
    try:
        uuid.UUID(prescription_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid prescription_id")

    conn = None
    try:
        conn = get_db_connection()
        result = _fetch_prescription_by_id(conn, prescription_id)
        if not result:
            raise HTTPException(status_code=404, detail="Prescription not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DB error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if conn:
            conn.close()


@router.get("/user/{user_id}")
async def get_user_prescriptions(user_id: str):
    """List all prescriptions for a user (most recent first)."""
    try:
        uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    conn = None
    try:
        conn = get_db_connection()
        results = _fetch_prescriptions_by_user(conn, user_id)
        return {"user_id": user_id, "count": len(results), "prescriptions": results}
    except Exception as e:
        logger.error(f"DB error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if conn:
            conn.close()


@router.get("/s3-status")
async def get_status_by_s3_key(
    s3_key: str = Query(..., description="S3 key returned from /upload"),
):
    """Poll by S3 key."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM prescription_uploads WHERE s3_key = %s", (s3_key,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Not found")
            result = _fetch_prescription_by_id(conn, str(row["id"]))
            if not result:
                raise HTTPException(status_code=404, detail="Not found")
            return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DB error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if conn:
            conn.close()


@router.post("/update-duration/{prescription_id}")
async def update_drug_duration(
    prescription_id: str,
    drug_index: int = Query(..., ge=0, description="Index of the drug in the list"),
    duration_days: int = Query(..., ge=1, le=365, description="Course duration in days"),
):
    """Manually set course duration for a drug when auto-detection failed.
    Recalculates end_date = start_date + duration_days.
    """
    try:
        uuid.UUID(prescription_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid prescription_id")

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, course_start_date, duration_days
                FROM prescription_extracted_drugs
                WHERE prescription_id = %s
                ORDER BY created_at
            """, (prescription_id,))
            drugs = cur.fetchall()

            if drug_index >= len(drugs):
                raise HTTPException(status_code=400, detail=f"Drug index {drug_index} out of range (0-{len(drugs)-1})")

            drug = drugs[drug_index]
            start = drug["course_start_date"] or date.today()
            end = start + timedelta(days=duration_days)

            cur.execute("""
                UPDATE prescription_extracted_drugs
                SET duration_days = %s,
                    duration = %s,
                    course_start_date = %s,
                    course_end_date = %s
                WHERE id = %s
            """, (duration_days, f"{duration_days} days", start, end, drug["id"]))
        conn.commit()

        return {
            "success": True,
            "drug_id": str(drug["id"]),
            "duration_days": duration_days,
            "course_start_date": start.isoformat(),
            "course_end_date": end.isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update duration error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update duration")
    finally:
        if conn:
            conn.close()