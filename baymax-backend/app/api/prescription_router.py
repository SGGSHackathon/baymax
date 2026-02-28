import os
import re
import json
import uuid
import zipfile
import logging
import tempfile
from datetime import datetime, timezone
from typing import Optional

import boto3
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from pinecone import Pinecone
from sarvamai import SarvamAI
from groq import Groq
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field

# ── Logging ───────────────────────────────────────────────────
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────
DATABASE_URL = os.environ["DATABASE_URL"]
SARVAM_API_KEY = os.environ["SARVAM_API_KEY"]
PINECONE_API_KEY = os.environ["PINECONE_API_KEY"]
PINECONE_INDEX = os.environ["PINECONE_INDEX"]
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
BUCKET_NAME = os.environ.get("PRESCRIPTION_BUCKET", "medical-ai-prescriptions")
AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")
URL_EXPIRATION = int(os.environ.get("URL_EXPIRATION_SECONDS", "300"))
PINECONE_NAMESPACE = "drug_database"

# ── Clients (initialized once) ───────────────────────────────
s3_client = boto3.client("s3", region_name=AWS_REGION)
sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
pc = Pinecone(api_key=PINECONE_API_KEY)
pc_index = pc.Index(PINECONE_INDEX)
groq_client = Groq(api_key=GROQ_API_KEY)

# ── Allowed uploads ───────────────────────────────────────────
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

# ── Router ────────────────────────────────────────────────────
router = APIRouter(prefix="/prescriptions", tags=["Prescriptions"])


# ══════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════

class UploadRequest(BaseModel):
    user_id: str = Field(..., description="User UUID")
    file_name: str = Field(..., description="Original file name, e.g. rx.pdf")
    content_type: Optional[str] = Field(None, description="MIME type (auto-detected if omitted)")

class UploadResponse(BaseModel):
    upload_url: str
    s3_key: str
    bucket: str
    content_type: str
    expires_in: int
    prescription_id: str

class ProcessRequest(BaseModel):
    prescription_id: str = Field(..., description="Prescription UUID returned from /upload")
    s3_key: str = Field(..., description="S3 key returned from /upload")

class ProcessResponse(BaseModel):
    prescription_id: str
    status: str
    message: str


# ══════════════════════════════════════════════════════════════
# DATABASE HELPERS
# ══════════════════════════════════════════════════════════════

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def _serialize_row(row: dict) -> dict:
    return {
        k: str(v) if isinstance(v, (uuid.UUID, datetime)) else v
        for k, v in row.items()
    }


def _fetch_prescription_by_id(conn, prescription_id: str) -> dict | None:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT id, user_id, s3_key, file_type, ocr_status,
                   sarvam_job_id, raw_extracted_text,
                   error_message, processed_at, created_at
            FROM prescription_uploads WHERE id = %s
        """, (prescription_id,))
        prescription = cur.fetchone()
        if not prescription:
            return None

        cur.execute("""
            SELECT drug_name_raw, drug_name_matched, match_score,
                   brand_name, dosage, frequency, frequency_raw,
                   morning_dose, afternoon_dose, night_dose,
                   duration, duration_days, instructions, meal_relation
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
        "drugs": [dict(d) for d in drugs],
        "observations": [dict(o) for o in observations],
    }


def _fetch_prescriptions_by_user(conn, user_id: str) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT pu.id, pu.s3_key, pu.file_type, pu.ocr_status,
                   pu.error_message, pu.processed_at, pu.created_at,
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


def _fetch_prescription_by_s3_key(conn, s3_key: str) -> dict | None:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT id FROM prescription_uploads WHERE s3_key = %s", (s3_key,))
        row = cur.fetchone()
        if not row:
            return None
        return _fetch_prescription_by_id(conn, str(row["id"]))


# ══════════════════════════════════════════════════════════════
# DB SAVE HELPERS
# ══════════════════════════════════════════════════════════════

def save_prescription_upload(
    conn, prescription_id: str, user_id: str | None, bucket: str, key: str,
    file_type: str, file_size: int, sarvam_job_id: str, ocr_status: str,
    raw_text: str | None, error_message: str | None = None,
) -> str:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO prescription_uploads
                (id, user_id, s3_bucket, s3_key, file_type, file_size_bytes,
                 sarvam_job_id, ocr_status, raw_extracted_text, error_message, processed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (s3_bucket, s3_key) DO UPDATE SET
                ocr_status = EXCLUDED.ocr_status,
                raw_extracted_text = EXCLUDED.raw_extracted_text,
                sarvam_job_id = EXCLUDED.sarvam_job_id,
                error_message = EXCLUDED.error_message,
                processed_at = EXCLUDED.processed_at,
                updated_at = NOW()
            RETURNING id
        """, (
            prescription_id, user_id, bucket, key, file_type, file_size,
            sarvam_job_id, ocr_status, raw_text, error_message,
            datetime.now(timezone.utc) if ocr_status in ("completed", "failed") else None,
        ))
        result = cur.fetchone()
        prescription_id = str(result[0])
    conn.commit()
    return prescription_id


def save_extracted_drugs(conn, prescription_id: str, user_id: str | None, matched_drugs: list[dict]):
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
            d.get("meal_relation"), json.dumps(d.get("pinecone_metadata", {})),
        ))
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO prescription_extracted_drugs
                (id, prescription_id, user_id, drug_name_raw, drug_name_matched,
                 match_score, brand_name, dosage, frequency, frequency_raw,
                 morning_dose, afternoon_dose, night_dose,
                 duration, duration_days, instructions, meal_relation, pinecone_metadata)
            VALUES %s
        """, rows)
    conn.commit()
    logger.info(f"Saved {len(rows)} drugs for prescription {prescription_id}")


def save_observations(conn, prescription_id: str, user_id: str | None, observations: list[dict]):
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


# ══════════════════════════════════════════════════════════════
# OCR + LLM + PINECONE PROCESSING
# ══════════════════════════════════════════════════════════════

def detect_file_type(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower()
    if ext in ("jpg", "jpeg"):
        return "jpeg"
    if ext in ("png", "pdf", "zip"):
        return ext
    return "pdf"


def download_s3_file(bucket: str, key: str) -> tuple[bytes, str]:
    response = s3_client.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read()
    file_type = detect_file_type(key)
    logger.info(f"Downloaded s3://{bucket}/{key} — {len(body)} bytes, type={file_type}")
    return body, file_type


def run_sarvam_ocr(file_bytes: bytes, file_type: str) -> tuple[str, str]:
    """Run Sarvam Vision OCR. Returns (extracted_text, sarvam_job_id)."""
    logger.info(f"Starting Sarvam Vision OCR for file_type={file_type}")

    # Sarvam Vision only natively accepts PDF/ZIP. Convert images to PDF at FULL resolution
    # for maximum OCR accuracy — do NOT resize.
    if file_type in ("jpg", "jpeg", "png"):
        try:
            from PIL import Image
            import io
            image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            logger.info(f"Image dimensions: {image.size[0]}x{image.size[1]}")
            pdf_bytes = io.BytesIO()
            # Use DPI 150 for a good balance of quality and file size
            image.save(pdf_bytes, format="PDF", resolution=150.0, save_all=True)
            file_bytes = pdf_bytes.getvalue()
            file_type = "pdf"
            logger.info(f"Converted image to PDF ({len(file_bytes)} bytes) at full resolution for max accuracy.")
        except Exception as e:
            logger.error(f"Image to PDF conversion failed: {e}")
            raise RuntimeError(f"Failed to convert image to PDF: {e}")

    MAX_RETRIES = 2
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            job = sarvam_client.document_intelligence.create_job(language="en-IN", output_format="md")
            sarvam_job_id = job.job_id
            logger.info(f"Sarvam job created: {sarvam_job_id} (attempt {attempt}/{MAX_RETRIES})")

            suffix = f".{file_type}"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name

            try:
                job.upload_file(tmp_path)
                logger.info(f"File uploaded to Sarvam job {sarvam_job_id}")
                job.start()
                logger.info(f"Sarvam job {sarvam_job_id} started, waiting for completion...")

                try:
                    status = job.wait_until_complete(timeout=600.0)
                except (TimeoutError, Exception) as wait_err:
                    logger.warning(f"Sarvam wait error (attempt {attempt}): {wait_err}")
                    last_error = wait_err
                    if attempt < MAX_RETRIES:
                        continue
                    raise RuntimeError(f"Sarvam Vision OCR timed out/failed after {MAX_RETRIES} attempts: {wait_err}")

                if status.job_state not in ("Completed", "PartiallyCompleted"):
                    logger.warning(f"Sarvam job state: {status.job_state} (attempt {attempt})")
                    last_error = RuntimeError(f"Job state: {status.job_state}")
                    if attempt < MAX_RETRIES:
                        continue
                    raise RuntimeError(f"Sarvam Vision job failed after {MAX_RETRIES} attempts: {status.job_state}")

                try:
                    metrics = job.get_page_metrics()
                    logger.info(f"Sarvam page metrics: {metrics}")
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
                    logger.warning(f"Sarvam returned empty text (attempt {attempt})")
                    last_error = RuntimeError("Sarvam returned empty OCR result")
                    if attempt < MAX_RETRIES:
                        continue
                    raise RuntimeError("Sarvam Vision returned empty text after retries")

                logger.info(f"OCR extracted {len(extracted_text)} chars on attempt {attempt}")
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
                raise RuntimeError(f"Sarvam Vision OCR failed after {MAX_RETRIES} attempts: {e}")

    raise RuntimeError(f"Sarvam Vision OCR exhausted retries: {last_error}")


def extract_prescription_data_llm(ocr_text: str) -> dict:
    """Use Groq LLM to extract drugs + observations from OCR text."""
    if not ocr_text.strip():
        return {"drugs": [], "observations": []}

    prompt = f"""You are an expert medical prescription parser. Analyze the following OCR-extracted
prescription text and extract TWO things:

## 1. DRUGS
Extract ALL medications/drugs with their details.

For each drug return:
- "drug_name": medication name as written (required)
- "dosage": strength e.g. "500mg", "10mg" (or null)
- "frequency": the dosage pattern — ALWAYS use the X-Y-Z format where:
    X = morning dose count, Y = afternoon dose count, Z = night dose count
    Examples: "1-0-1" means 1 in morning, 0 in afternoon, 1 at night
              "2-0-1" means 2 in morning, 0 in afternoon, 1 at night
              "1-1-1" means 1 thrice daily
              "0-0-1" means night only
  If "twice daily" or "BD", convert to: "1-0-1"
  If "once daily" or "OD", use: "1-0-0"
  If "thrice daily" or "TDS", use: "1-1-1"
  If "at night" or "HS", use: "0-0-1"
  If "SOS" or "PRN" (as needed), keep as: "SOS"
  ALWAYS preserve the original pattern if already in X-Y-Z format.
- "duration": how long e.g. "5 days", "1 week", "2 weeks" (or null)
- "instructions": meal/timing instructions e.g. "after food", "before meal",
  "empty stomach", "before sleep" (or null)

## 2. OBSERVATIONS
Extract ALL clinical observations, symptoms, diagnoses, complaints,
examination findings, and doctor notes that are NOT drug names.

For each observation return:
- "observation_type": one of: "symptom", "diagnosis", "vital_sign",
  "lifestyle", "investigation", "doctor_note", "other"
- "observation_text": the finding as written
- "body_part": relevant body part if mentioned, or null
- "severity": "mild", "moderate", or "severe" if mentioned, else null

Return ONLY a JSON object:
{{
  "drugs": [ ... ],
  "observations": [ ... ]
}}

No other text. If nothing found, return {{"drugs": [], "observations": []}}.

Prescription Text:
---
{ocr_text[:6000]}
---"""

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a precise medical prescription parser. "
                    "Extract drugs with exact dosage patterns (X-Y-Z format "
                    "for morning-afternoon-night) and all clinical observations. "
                    "Output ONLY valid JSON."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        max_tokens=4000,
    )

    raw = response.choices[0].message.content.strip()
    logger.info(f"LLM raw response: {raw[:500]}")

    json_obj_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if json_obj_match:
        try:
            data = json.loads(json_obj_match.group())
            return {"drugs": data.get("drugs", []), "observations": data.get("observations", [])}
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")

    json_arr_match = re.search(r'\[.*\]', raw, re.DOTALL)
    if json_arr_match:
        try:
            return {"drugs": json.loads(json_arr_match.group()), "observations": []}
        except json.JSONDecodeError:
            pass

    return {"drugs": [], "observations": []}


# ── Dosage / duration / meal parsers ─────────────────────────

def parse_dosage_pattern(frequency: str | None) -> dict:
    result = {
        "frequency_raw": frequency, "morning_dose": 0.0,
        "afternoon_dose": 0.0, "night_dose": 0.0, "frequency_text": frequency,
    }
    if not frequency:
        return result

    freq = frequency.strip()
    normalized = freq.replace("\u00bd", "0.5").replace("\u00bc", "0.25").replace("\u00be", "0.75")
    pattern = r'^(\d+(?:\.\d+)?(?:/\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?(?:/\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?(?:/\d+)?)$'
    match = re.match(pattern, normalized)

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
        if morning > 0:   slots.append(f"morning {morning:g}")
        if afternoon > 0:  slots.append(f"afternoon {afternoon:g}")
        if night > 0:      slots.append(f"night {night:g}")
        result["frequency_text"] = ", ".join(slots) if slots else freq
        return result

    freq_lower = freq.lower().strip()
    text_map = {
        "once daily": (1,0,0,"morning 1"), "once a day": (1,0,0,"morning 1"),
        "od": (1,0,0,"morning 1"),
        "twice daily": (1,0,1,"morning 1, night 1"), "twice a day": (1,0,1,"morning 1, night 1"),
        "bd": (1,0,1,"morning 1, night 1"), "bid": (1,0,1,"morning 1, night 1"),
        "thrice daily": (1,1,1,"morning 1, afternoon 1, night 1"),
        "three times a day": (1,1,1,"morning 1, afternoon 1, night 1"),
        "tid": (1,1,1,"morning 1, afternoon 1, night 1"),
        "tds": (1,1,1,"morning 1, afternoon 1, night 1"),
        "at night": (0,0,1,"night 1"), "at bedtime": (0,0,1,"night 1"),
        "hs": (0,0,1,"night 1"), "in the morning": (1,0,0,"morning 1"),
        "sos": (0,0,0,"as needed (SOS)"), "prn": (0,0,0,"as needed (PRN)"),
        "stat": (1,0,0,"immediately (STAT)"),
    }
    for key, (m, a, n, txt) in text_map.items():
        if key in freq_lower:
            result.update({"morning_dose": float(m), "afternoon_dose": float(a),
                           "night_dose": float(n), "frequency_text": txt})
            return result

    return result


def parse_duration_days(duration: str | None) -> int | None:
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


def parse_meal_relation(instructions: str | None) -> str | None:
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


# ── Pinecone drug matching ───────────────────────────────────

def get_embedding(text: str) -> list[float]:
    response = pc.inference.embed(
        model="multilingual-e5-large", inputs=[text],
        parameters={"input_type": "query"},
    )
    return response[0].values


def match_drugs_pinecone(drug_candidates: list[dict]) -> list[dict]:
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
                logger.info(f"Drug '{drug_name}' → '{best_match}' (score={best_score:.4f})")

            dosage_parsed = parse_dosage_pattern(candidate.get("frequency"))
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
                "duration_days": parse_duration_days(candidate.get("duration")),
                "instructions": candidate.get("instructions"),
                "meal_relation": parse_meal_relation(candidate.get("instructions")),
                "pinecone_metadata": best_meta,
            })
        except Exception as e:
            logger.error(f"Pinecone error for '{drug_name}': {e}")
            dosage_parsed = parse_dosage_pattern(candidate.get("frequency"))
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
                "duration_days": parse_duration_days(candidate.get("duration")),
                "instructions": candidate.get("instructions"),
                "meal_relation": parse_meal_relation(candidate.get("instructions")),
                "pinecone_metadata": {},
            })
    return matched


# ══════════════════════════════════════════════════════════════
# BACKGROUND PROCESSING TASK
# ══════════════════════════════════════════════════════════════

def _update_ocr_status(conn, prescription_id: str, status: str, error_message: str | None = None):
    """Quick helper to update just the ocr_status (and optionally error_message) for progress tracking."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE prescription_uploads SET ocr_status=%s, error_message=%s, updated_at=NOW() WHERE id=%s",
                (status, error_message, prescription_id),
            )
        conn.commit()
    except Exception as e:
        logger.warning(f"Status update failed: {e}")


def process_prescription_background(prescription_id: str, user_id: str, s3_key: str):
    """
    Background task: S3 download → Sarvam OCR → Groq LLM → Pinecone → DB.
    Called by POST /prescriptions/process.
    Stores intermediate status so the frontend can show real progress.
    """
    conn = None
    sarvam_job_id = ""

    try:
        conn = get_db_connection()

        # Stage 1: Download from S3
        _update_ocr_status(conn, prescription_id, "downloading")
        file_bytes, file_type = download_s3_file(BUCKET_NAME, s3_key)
        logger.info(f"[{prescription_id}] Downloaded {len(file_bytes)} bytes from S3")

        # Stage 2: Sarvam Vision OCR
        _update_ocr_status(conn, prescription_id, "ocr_running")
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), "", "ocr_running", None,
        )

        extracted_text, sarvam_job_id = run_sarvam_ocr(file_bytes, file_type)
        logger.info(f"[{prescription_id}] OCR done: {len(extracted_text)} chars")

        # Stage 3: Save raw OCR text immediately (even if LLM/Pinecone fails later)
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), sarvam_job_id, "extracting", extracted_text,
        )

        # Stage 4: Groq LLM extraction
        _update_ocr_status(conn, prescription_id, "extracting")
        prescription_data = extract_prescription_data_llm(extracted_text)
        drug_candidates = prescription_data["drugs"]
        observations = prescription_data["observations"]
        logger.info(f"[{prescription_id}] LLM found {len(drug_candidates)} drugs, {len(observations)} observations")

        # Stage 5: Pinecone drug matching
        _update_ocr_status(conn, prescription_id, "matching")
        matched_drugs = match_drugs_pinecone(drug_candidates)
        logger.info(f"[{prescription_id}] Pinecone matched {len(matched_drugs)} drugs")

        # Stage 6: Final — mark completed
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), sarvam_job_id, "completed", extracted_text,
        )

        # Stage 7: Save drugs + observations
        save_extracted_drugs(conn, prescription_id, user_id, matched_drugs)
        save_observations(conn, prescription_id, user_id, observations)

        logger.info(f"[{prescription_id}] Prescription processed successfully")

    except Exception as e:
        logger.error(f"Error processing prescription {prescription_id}: {e}", exc_info=True)
        if conn:
            try:
                # Save whatever raw text we got (may be partial) + error
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


# ══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ══════════════════════════════════════════════════════════════

@router.post("/upload", response_model=UploadResponse)
async def get_upload_url(req: UploadRequest):
    """
    **Step 1** — Get a presigned S3 URL for uploading prescription file.

    Returns `upload_url` (PUT the file here from frontend), `s3_key`, and `prescription_id`.
    After uploading to S3, call **POST /prescriptions/process** to start OCR.
    """
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

    # Build S3 key
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_name = req.file_name.replace(" ", "_").replace("/", "_")
    s3_key = f"prescriptions/{req.user_id}/{timestamp}_{safe_name}"
    prescription_id = str(uuid.uuid4())

    # Pre-create DB record (status=pending)
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

    # Generate presigned PUT URL
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
    """
    **Step 2** — Call AFTER the file has been uploaded to S3.

    Triggers background processing: S3 → Sarvam OCR → Groq LLM → Pinecone → DB.
    Then poll **GET /prescriptions/status/{prescription_id}** to check results.
    """
    try:
        uuid.UUID(req.prescription_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid prescription_id")

    # Verify prescription exists
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

    # Kick off background processing
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
    """Get OCR status + extracted drugs and observations for a prescription."""
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
    """List all prescriptions for a user (most recent first, max 50)."""
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
    """Poll by S3 key. Returns 404 if not yet in DB."""
    conn = None
    try:
        conn = get_db_connection()
        result = _fetch_prescription_by_s3_key(conn, s3_key)
        if not result:
            raise HTTPException(status_code=404, detail="Not found — may still be processing.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DB error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if conn:
            conn.close()
