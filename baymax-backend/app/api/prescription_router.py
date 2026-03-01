import os
import re
import json
import uuid
import zipfile
import logging
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

import boto3
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor, execute_values
from pinecone import Pinecone
from sarvamai import SarvamAI
from groq import Groq
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field

# ── Logging ───────────────────────────────────────────────────
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
SARVAM_API_KEY = os.environ["SARVAM_API_KEY"]
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY", "")
PINECONE_INDEX = os.environ.get("PINECONE_INDEX", "")
GROQ_API_KEY = os.environ["GROQ_API_KEY"]
BUCKET_NAME = os.environ.get("PRESCRIPTION_BUCKET", "medical-prescriptions-ai-agent")
AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")
URL_EXPIRATION = int(os.environ.get("URL_EXPIRATION_SECONDS", "300"))
PINECONE_NAMESPACE = "drug_database"

# ── Clients (initialized once) ───────────────────────────────
s3_client = boto3.client("s3", region_name=AWS_REGION)
sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
# Pinecone (optional — only if used for RAG elsewhere, not for prescription matching)
try:
    pc = Pinecone(api_key=PINECONE_API_KEY) if PINECONE_API_KEY else None
    pc_index = pc.Index(PINECONE_INDEX) if pc and PINECONE_INDEX else None
except Exception:
    pc = None
    pc_index = None
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
                   error_message, processed_at, created_at,
                   hospital_name, doctor_name, patient_name_ocr,
                   patient_age_ocr, patient_gender_ocr,
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
                   form, stock_status, stock_qty_available,
                   course_start_date, course_end_date,
                   alternative_drug
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

    result = {
        **_serialize_row(dict(prescription)),
        "drugs": [dict(d) for d in drugs],
        "observations": [dict(o) for o in observations],
    }

    # Generate a presigned GET URL so the frontend can display the original image
    s3_key = prescription.get("s3_key") or prescription.get("s3_key", "")
    if s3_key:
        try:
            result["image_url"] = s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": BUCKET_NAME, "Key": s3_key},
                ExpiresIn=3600,  # 1 hour
            )
        except Exception as e:
            logger.warning(f"Failed to generate presigned GET URL for {s3_key}: {e}")
            result["image_url"] = None
    else:
        result["image_url"] = None

    return result


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


def save_extracted_drugs(conn, prescription_id: str, user_id: str | None, matched_drugs: list[dict],
                         prescription_date_str: str | None = None):
    if not matched_drugs:
        return
    # Determine course_start_date: use prescription_date if available, else today
    from datetime import date, timedelta
    course_start = None
    if prescription_date_str:
        try:
            course_start = datetime.strptime(prescription_date_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            pass
    if not course_start:
        course_start = date.today()

    rows = []
    for d in matched_drugs:
        duration_days = d.get("duration_days")
        course_end = None
        if duration_days and course_start:
            course_end = course_start + timedelta(days=int(duration_days))

        rows.append((
            str(uuid.uuid4()), prescription_id, user_id,
            d["drug_name_raw"], d.get("drug_name_matched"), d.get("match_score", 0.0),
            d.get("brand_name"), d.get("dosage"), d.get("frequency"), d.get("frequency_raw"),
            d.get("morning_dose", 0.0), d.get("afternoon_dose", 0.0), d.get("night_dose", 0.0),
            d.get("duration"), d.get("duration_days"), d.get("instructions"),
            d.get("meal_relation"), json.dumps(d.get("inventory_metadata", d.get("pinecone_metadata", {}))),
            course_start.isoformat() if course_start else None,
            course_end.isoformat() if course_end else None,
            d.get("stock_status"),
            d.get("stock_qty_available"),
            d.get("alternative_drug"),
            d.get("alternative_inv_id"),
        ))
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO prescription_extracted_drugs
                (id, prescription_id, user_id, drug_name_raw, drug_name_matched,
                 match_score, brand_name, dosage, frequency, frequency_raw,
                 morning_dose, afternoon_dose, night_dose,
                 duration, duration_days, instructions, meal_relation, pinecone_metadata,
                 course_start_date, course_end_date,
                 stock_status, stock_qty_available,
                 alternative_drug, alternative_inv_id)
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


def save_prescription_metadata(conn, prescription_id: str, metadata: dict):
    """Save LLM-extracted prescription metadata (hospital, doctor, patient info) to DB."""
    if not metadata:
        return

    fields_map = {
        "hospital_name": metadata.get("hospital_name"),
        "doctor_name": metadata.get("doctor_name"),
        "patient_name_ocr": metadata.get("patient_name"),
        "patient_age_ocr": metadata.get("patient_age"),
        "patient_gender_ocr": metadata.get("patient_gender"),
        "patient_weight_ocr": metadata.get("patient_weight"),
        "patient_height_ocr": metadata.get("patient_height"),
    }

    # Handle prescription_date — validate format
    rx_date = metadata.get("prescription_date")
    if rx_date:
        try:
            datetime.strptime(rx_date, "%Y-%m-%d")
            fields_map["prescription_date"] = rx_date
        except (ValueError, TypeError):
            logger.warning(f"Invalid prescription_date from LLM: {rx_date}")

    # Build SET clause only for non-null values
    set_parts = []
    values = []
    for col, val in fields_map.items():
        if val is not None and str(val).strip():
            set_parts.append(f"{col} = %s")
            values.append(str(val).strip())

    if not set_parts:
        return

    values.append(prescription_id)
    sql = f"UPDATE prescription_uploads SET {', '.join(set_parts)}, updated_at = NOW() WHERE id = %s"
    try:
        with conn.cursor() as cur:
            cur.execute(sql, values)
        conn.commit()
        logger.info(f"Saved prescription metadata for {prescription_id}: {list(fields_map.keys())}")
    except Exception as e:
        logger.error(f"Failed to save prescription metadata: {e}")


def save_drug_form(conn, prescription_id: str, drug_candidates: list[dict], matched_drugs: list[dict]):
    """Update the 'form' column on prescription_extracted_drugs from LLM output."""
    if not drug_candidates or not matched_drugs:
        return

    # Build a map of drug_name_raw -> form from LLM candidates
    form_map = {}
    for c in drug_candidates:
        name = c.get("drug_name", "").strip()
        form = c.get("form")
        if name and form:
            form_map[name.lower()] = form.lower()

    if not form_map:
        return

    try:
        with conn.cursor() as cur:
            for d in matched_drugs:
                raw = d.get("drug_name_raw", "").strip()
                form = form_map.get(raw.lower())
                if form:
                    cur.execute(
                        "UPDATE prescription_extracted_drugs SET form = %s WHERE prescription_id = %s AND drug_name_raw = %s",
                        (form, prescription_id, raw),
                    )
        conn.commit()
    except Exception as e:
        logger.error(f"Failed to save drug forms: {e}")


# ══════════════════════════════════════════════════════════════
# OCR + SARVAM CHAT + NEONDB PROCESSING
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

    # Sarvam Vision only natively accepts PDF/ZIP. Convert images to PDF.
    # Use img2pdf for standards-compliant PDF (embeds JPEG directly without re-encoding).
    if file_type in ("jpg", "jpeg", "png"):
        try:
            import img2pdf
            import io as _io
            from PIL import Image

            # img2pdf works best with JPEG; convert PNG to JPEG first
            if file_type == "png":
                image = Image.open(_io.BytesIO(file_bytes)).convert("RGB")
                logger.info(f"PNG image dimensions: {image.size[0]}x{image.size[1]}")
                jpeg_buf = _io.BytesIO()
                image.save(jpeg_buf, format="JPEG", quality=95)
                jpeg_bytes = jpeg_buf.getvalue()
                logger.info(f"Converted PNG to JPEG ({len(jpeg_bytes)} bytes)")
            else:
                jpeg_bytes = file_bytes
                image = Image.open(_io.BytesIO(file_bytes))
                logger.info(f"JPEG image dimensions: {image.size[0]}x{image.size[1]}")

            # img2pdf creates a proper PDF with the image embedded directly
            pdf_data = img2pdf.convert(jpeg_bytes)
            file_bytes = pdf_data
            file_type = "pdf"
            logger.info(f"Converted image to PDF via img2pdf ({len(file_bytes)} bytes)")
        except Exception as e:
            logger.error(f"Image to PDF conversion failed: {e}")
            raise RuntimeError(f"Failed to convert image to PDF: {e}")

    MAX_RETRIES = 3
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

                if status.job_state not in ("Completed", "PartiallyCompleted", "Failed"):
                    # Still running — should not happen after wait, but just in case
                    pass

                if status.job_state not in ("Completed", "PartiallyCompleted"):
                    # Log ALL available status details for debugging
                    status_details = {attr: getattr(status, attr, None) for attr in dir(status) if not attr.startswith('_')}
                    logger.warning(f"Sarvam job state: {status.job_state} (attempt {attempt}), full status: {status_details}")
                    last_error = RuntimeError(f"Job state: {status.job_state}")
                    if attempt < MAX_RETRIES:
                        import time
                        # Check if circuit breaker error — need longer wait
                        page_errors = []
                        if hasattr(status, 'job_details') and status.job_details:
                            for detail in status.job_details:
                                if hasattr(detail, 'page_errors') and detail.page_errors:
                                    page_errors.extend(detail.page_errors)
                        is_circuit_breaker = any(
                            getattr(pe, 'error_code', '') == 'CIRCUIT_BREAKER_OPEN'
                            for pe in page_errors
                        )
                        wait_time = 65 if is_circuit_breaker else 5
                        logger.info(f"Sarvam retry: waiting {wait_time}s before attempt {attempt+1} "
                                    f"(circuit_breaker={is_circuit_breaker})")
                        time.sleep(wait_time)
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


def _preprocess_ocr_text(ocr_text: str) -> str:
    """Pre-process Sarvam OCR output:
    1. Strip base64 image data (wastes tokens)
    2. Extract drug names from image-block "labeled" descriptions
    3. Remove verbose flowchart/diagram language, keep drug info
    4. Strip misleading parenthetical guesses
    """
    cleaned = ocr_text

    # ── Step 0: Strip inline base64 image data ───────────────
    cleaned = re.sub(
        r'!\[(?:Image|image)?\]\(data:image/[^)]+\)',
        '',
        cleaned,
    )

    # ── Step 1: Extract drug names from "labeled" patterns ───
    # Sarvam describes handwritten drug lists as flowchart nodes:
    #   'A node labeled "T. Azeel 250"'  → T. Azeel 250
    #   'labeled "cp. Migpan DSR"'       → cp. Migpan DSR
    labels = re.findall(
        r'(?:labeled|labelled)\s*["\u201c]([^"\u201d]{3,60})["\u201d]',
        cleaned, re.IGNORECASE,
    )
    drug_labels = []
    for label in labels:
        label = label.strip()
        # Skip purely numeric labels like "10", "3"
        if re.match(r'^\d+$', label):
            continue
        # Keep labels that look like drug names (start with T./Cap./Syp. or contain letters)
        if re.match(r'(?:T\.|Tab|Cap|Cp\.|Syp|Syr|Inj|Cr\.|Crm|Oint|Drp|Susp|Sach|Inh|Gel)',
                     label, re.IGNORECASE) or (len(label) > 3 and re.search(r'[A-Za-z]', label)):
            drug_labels.append(label)

    # ── Step 2: Extract global duration ──
    duration_text = _extract_global_duration(cleaned)

    # ── Step 3: Remove the entire verbose image description block ──
    # Replace it with a clean medicine list we extracted above
    # Pattern: matches from "*The image displays..." to the closing "*" or end of description
    cleaned = re.sub(
        r'\*?The image displays?.*?\*(?:\s|$)',
        '',
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Also catch descriptions without asterisks
    cleaned = re.sub(
        r'The image displays?\s+a\s+(?:handwritten|hand-written|scanned)[^*]*?(?:constraint|relationship|equation|flow)\.\s*',
        '',
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # ── Step 4: Remove remaining boilerplate ──
    cleaned = re.sub(r'\(likely\s+[^)]*\)', '', cleaned, flags=re.IGNORECASE)
    boilerplate_patterns = [
        r'(?:This|The) (?:image|picture|photo|diagram|figure)\s+(?:shows?|displays?|contains?|depicts?|illustrates?|represents?)[^.]*\.\s*',
        r'(?:directed\s+)?(?:graphs?|flowcharts?|diagrams?)\s+(?:arranged|organized|structured)[^.]*\.\s*',
        r'(?:A\s+)?horizontal\s+(?:arrow|line)[^.]*\.\s*',
        r'The blocks? (?:are|is) labeled as follows:?\s*',
        r'Below the node[^.]*\.\s*',
    ]
    for pat in boilerplate_patterns:
        cleaned = re.sub(pat, '', cleaned, flags=re.IGNORECASE)

    # ── Step 5: Append extracted drug list as clean text ──
    if drug_labels:
        drug_list_text = "\n\nMedicines (extracted from prescription):\n"
        for i, dl in enumerate(drug_labels, 1):
            drug_list_text += f"  {i}. {dl}"
            if duration_text:
                drug_list_text += f" — {duration_text}"
            drug_list_text += "\n"
        cleaned += drug_list_text

    # Collapse whitespace
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    cleaned = re.sub(r'  +', ' ', cleaned)

    logger.info(f"Pre-processed OCR: {len(ocr_text)} -> {len(cleaned)} chars, "
                f"extracted {len(drug_labels)} drug labels: {drug_labels}")
    return cleaned.strip()


def _preprocess_ocr_text(ocr_text: str) -> str:
    """Pre-process Sarvam OCR output so the LLM sees clean, useful text.
    Works for ANY prescription format — no hardcoded patterns for specific OCR outputs.
    Steps:
      1. Strip base64 image data (wastes tokens)
      2. Pull drug names out of any kind of descriptive wrapper
      3. Remove verbose non-medical boilerplate
      4. Keep all original plain-text drug lines too
    """
    cleaned = ocr_text

    # ── Step 0: Strip inline base64 image data ───────────────
    cleaned = re.sub(r'!\[(?:Image|image)?\]\(data:image/[^)]+\)', '', cleaned)

    # ── Step 1: Extract quoted/labeled items from image descriptions ──
    # Sarvam may wrap drugs in quotes inside descriptions:
    #   labeled "T. Azeel 250", text reads "Syp. Crocin", etc.
    quoted_items = re.findall(
        r'(?:label(?:ed|led)|reads?|named|titled|written\s+as|called|says?|text\s*[:=])\s*'
        r'["\u201c]([^"\u201d]{3,80})["\u201d]',
        cleaned, re.IGNORECASE,
    )
    drug_items = [q.strip() for q in quoted_items
                  if not re.match(r'^[\d\s.]+$', q.strip()) and len(q.strip()) > 2]

    # ── Step 2: Extract global duration ──
    duration_text = _extract_global_duration(cleaned)

    # ── Step 3: Remove verbose image-description blocks ──
    # Matches "*The image displays..." up to closing "*" or double-newline
    cleaned = re.sub(
        r'\*(?:The|This)\s+image\s+.*?\*(?:\s|$)',
        '', cleaned, flags=re.IGNORECASE | re.DOTALL,
    )
    # Without asterisks
    cleaned = re.sub(
        r'(?:The|This)\s+image\s+(?:displays?|shows?|contains?|depicts?|illustrates?|represents?)\s+.*?(?:\n\n|\Z)',
        '', cleaned, flags=re.IGNORECASE | re.DOTALL,
    )

    # ── Step 4: Remove remaining boilerplate ──
    cleaned = re.sub(r'\(likely\s+[^)]*\)', '', cleaned, flags=re.IGNORECASE)
    boilerplate = [
        r'(?:A\s+)?(?:single\s+)?(?:node|block|box|cell)\s+(?:labeled|labelled)[^.]*\.\s*',
        r'(?:A\s+)?horizontal\s+(?:arrow|line)[^.]*\.\s*',
        r'(?:directed\s+)?(?:graphs?|flowcharts?|diagrams?)\s+(?:arranged|organized|structured)[^.]*\.\s*',
        r'The blocks? (?:are|is)\s+label(?:ed|led)[^.]*\.\s*',
        r'Below the (?:node|block)[^.]*\.\s*',
        r'(?:This|The)\s+(?:likely\s+)?represents?\s+[^.]*\.\s*',
    ]
    for pat in boilerplate:
        cleaned = re.sub(pat, '', cleaned, flags=re.IGNORECASE)

    # ── Step 5: Append extracted drug items as clean text for LLM ──
    if drug_items:
        cleaned += "\n\nMedicines (extracted from prescription):\n"
        for i, item in enumerate(drug_items, 1):
            cleaned += f"  {i}. {item}"
            if duration_text:
                cleaned += f" — {duration_text}"
            cleaned += "\n"

    # Collapse whitespace
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    cleaned = re.sub(r'  +', ' ', cleaned)

    logger.info(f"Pre-processed OCR: {len(ocr_text)} -> {len(cleaned)} chars, "
                f"extracted {len(drug_items)} items from descriptions")
    return cleaned.strip()


def _extract_global_duration(ocr_text: str) -> str | None:
    """Extract a global course duration from OCR text.
    Handles:  x3, x5, ×3, /3, for 3 days, 5 day course,
    'multiplication factor of three', etc.
    """
    # Word form: "multiplication factor of three"
    m = re.search(
        r'(?:multiplication\s+factor\s+of|multiply\s+by|factor\s+of)\s+(\w+)',
        ocr_text, re.IGNORECASE,
    )
    if m:
        wmap = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
        n = wmap.get(m.group(1).lower())
        if n:
            return f"{n} days"

    # "x3", "×5", "/3 days"
    m = re.search(r'[x×/]\s*(\d{1,2})\s*(?:days?)?', ocr_text)
    if m:
        return f"{m.group(1)} days"

    # "for 3 days", "3 day course", "course of 5 days"
    m = re.search(r'(?:for|course\s+(?:of\s+)?)\s*(\d{1,2})\s*days?', ocr_text, re.IGNORECASE)
    if m:
        return f"{m.group(1)} days"

    # "3 days" at end of line (common in handwritten Rx)
    m = re.search(r'(\d{1,2})\s*days?\s*$', ocr_text, re.IGNORECASE | re.MULTILINE)
    if m:
        return f"{m.group(1)} days"

    return None


# ── Drug form prefix regex (reusable) ─────────────────────
DRUG_PREFIX_RE = (
    r'(?:T\.|Tab\.?|Cap\.?|Cp\.|Syp\.?|Syr\.?|Inj\.?|'
    r'Cr\.|Crm\.?|Oint\.?|Drp\.?|Drops?|Susp\.?|Sach\.?|'
    r'Inh\.?|Gel|Ung\.?|Lot\.?|Neb\.?|Sol\.?|Spray)'
)

# Map prefix to form name
_PREFIX_TO_FORM = {
    "t":     "tablet",  "tab":   "tablet",
    "cap":   "capsule", "cp":    "capsule",
    "syp":   "syrup",   "syr":   "syrup",
    "inj":   "injection",
    "cr":    "cream",   "crm":   "cream",
    "oint":  "ointment",
    "drp":   "drops",   "drops": "drops", "drop": "drops",
    "gel":   "gel",
    "susp":  "suspension",
    "sach":  "sachet",
    "inh":   "inhaler",
    "ung":   "ointment",
    "lot":   "lotion",
    "neb":   "nebuliser",
    "sol":   "solution",
    "spray": "spray",
}


def _detect_drug_form(name: str) -> str | None:
    """Detect dosage form from a drug name prefix."""
    m = re.match(r'^([A-Za-z]+)[\s.]', name)
    if m:
        prefix = m.group(1).lower().rstrip('.')
        return _PREFIX_TO_FORM.get(prefix)
    return None


def _extract_dosage(name: str) -> str | None:
    """Extract strength/dosage from a drug name like 'T. Azeel 250' -> '250mg'."""
    m = re.search(r'(\d+)\s*(?:mg|ml|mcg|g|iu|%)?(?:\s|$)', name, re.IGNORECASE)
    if m:
        num = m.group(1)
        unit_m = re.search(r'(\d+)\s*(mg|ml|mcg|g|iu|%)', name, re.IGNORECASE)
        if unit_m:
            return f"{unit_m.group(1)}{unit_m.group(2)}"
        return f"{num}mg"
    return None


def _extract_drugs_direct(ocr_text: str) -> list[dict]:
    """Extract drug names from Sarvam OCR text using multiple generic regex strategies.
    Works for ANY OCR output format — plain text, image descriptions, tables, lists, etc.
    This does NOT depend on any LLM.
    """
    drugs = []
    seen_keys = set()

    global_duration = _extract_global_duration(ocr_text)

    # ═══════════════════════════════════════════════════════════
    # Strategy 1: Quoted text in image descriptions
    #   - labeled "T. Azeel 250"
    #   - text reads "Cap. Migpan DSR"
    #   - named "Syp. Ascoul D"
    # Works for ANY Sarvam image-description style
    # ═══════════════════════════════════════════════════════════
    quoted = re.findall(
        r'(?:label(?:ed|led)|reads?|named|titled|written|called|text\s*[:=]|says?)\s*'
        r'["\u201c]([^"\u201d]{3,80})["\u201d]',
        ocr_text, re.IGNORECASE,
    )

    # ═══════════════════════════════════════════════════════════
    # Strategy 2: Any standalone quoted strings that look medical
    #   - "T. Azeel 250" anywhere in text
    # ═══════════════════════════════════════════════════════════
    all_quoted = re.findall(r'["\u201c]([^"\u201d]{3,80})["\u201d]', ocr_text)
    for q in all_quoted:
        if re.match(DRUG_PREFIX_RE, q.strip(), re.IGNORECASE):
            quoted.append(q)

    # ═══════════════════════════════════════════════════════════
    # Strategy 3: Lines starting with drug-form prefixes
    #   - T. Azeel 250
    #   - Cap. Migpan DSR
    #   (after "Rx" or at start of line)
    # ═══════════════════════════════════════════════════════════
    prefix_lines = re.findall(
        r'(?:^|\n)\s*(' + DRUG_PREFIX_RE + r'\s*[A-Za-z][A-Za-z0-9 /\-\u00bd\u00bc]{1,50})',
        ocr_text, re.IGNORECASE | re.MULTILINE,
    )

    # Also after Rx
    rx_pos = re.search(r'Rx\.?\s*', ocr_text, re.IGNORECASE)
    if rx_pos:
        after_rx = ocr_text[rx_pos.end():]
        after_hits = re.findall(
            r'(?:^|\n)\s*(' + DRUG_PREFIX_RE + r'\s*[A-Za-z][A-Za-z0-9 /\-\u00bd\u00bc]{1,50})',
            after_rx, re.IGNORECASE | re.MULTILINE,
        )
        prefix_lines.extend(after_hits)

    # ═══════════════════════════════════════════════════════════
    # Strategy 4: Numbered/bulleted list items with drug prefixes
    #   - 1. T. Azeel 250
    #   - 1) Cap. Migpan DSR
    #   - • Syp. Crocin
    #   - - Inj. Xylocaine
    # ═══════════════════════════════════════════════════════════
    numbered = re.findall(
        r'(?:\d+[.)]\s*|[-•●]\s*)(' + DRUG_PREFIX_RE + r'\s*[A-Za-z][A-Za-z0-9 /\-]{1,50})',
        ocr_text, re.IGNORECASE,
    )

    # ═══════════════════════════════════════════════════════════
    # Strategy 5: Known Indian drug names (common OTC / prescription)
    # Catch drugs written without a prefix, e.g. "Dolo 650", "Crocin"
    # ═══════════════════════════════════════════════════════════
    common_drugs = [
        "paracetamol", "crocin", "dolo", "calpol",
        "ibuprofen", "brufen", "combiflam",
        "azithromycin", "azithral", "azee", "azicip",
        "amoxicillin", "mox", "amoxyclav", "augmentin",
        "cetirizine", "cetzine", "okacet", "alerid",
        "levocetirizine", "levocet", "xyzal",
        "montelukast", "montair", "montek",
        "pantoprazole", "pan", "pantocid", "pantop",
        "omeprazole", "omez",
        "domperidone", "domstal",
        "ondansetron", "emeset",
        "metformin", "glycomet",
        "amlodipine", "amlopress", "amlokind",
        "atorvastatin", "atorva", "atorlip",
        "prednisolone", "omnacortil", "wysolone",
        "salbutamol", "asthalin", "ventolin",
        "ranitidine", "aciloc", "rantac",
        "cefixime", "taxim", "zifi",
        "ciprofloxacin", "ciplox",
        "ofloxacin", "oflox", "zenflox",
        "levofloxacin",
        "metronidazole", "flagyl",
        "diclofenac", "voveran",
        "aceclofenac",
        "vitamin", "vit", "b-complex", "bcomplex", "becosules",
        "shelcal", "calcimax",
        "migpan", "ascoul", "pacmal", "azeel",
    ]
    common_re = r'\b(' + '|'.join(re.escape(d) for d in common_drugs) + r')\b'
    found_common = re.findall(common_re, ocr_text, re.IGNORECASE)

    # ═══════════════════════════════════════════════════════════
    # De-duplicate and build drug list
    # ═══════════════════════════════════════════════════════════
    def _add_drug(raw_name: str):
        name = raw_name.strip().rstrip('.')
        name = re.sub(r'\s+', ' ', name)
        if len(name) < 2 or re.match(r'^[\d\s.]+$', name):
            return
        key = name.lower()
        if key in seen_keys:
            return
        seen_keys.add(key)

        form = _detect_drug_form(name)
        dosage = _extract_dosage(name)

        drugs.append({
            "drug_name": name,
            "form": form,
            "dosage": dosage,
            "frequency": None,
            "duration": global_duration,
            "instructions": None,
        })

    # Add from all strategies (order matters for dedup)
    for q in quoted:
        _add_drug(q)
    for p in prefix_lines:
        _add_drug(p)
    for n in numbered:
        _add_drug(n)

    # For common drug names found standalone, only add if we have no drugs yet
    # (otherwise we might pick up "pan" from "pantoprazole" description text)
    if not drugs:
        for c in found_common:
            _add_drug(c)

    logger.info(f"Direct extraction found {len(drugs)} drugs: {[d['drug_name'] for d in drugs]}")
    return drugs


def extract_prescription_data_sarvam(ocr_text: str) -> dict:
    """Extract drugs, metadata and observations from OCR text.
    Strategy:
      1. Direct regex extraction for drug names (most reliable for Sarvam OCR)
      2. Sarvam Chat for metadata + observations + any additional drugs
      3. Groq LLM as final fallback
    Merges results: regex-found drugs are always kept, LLM may add more.
    """
    if not ocr_text.strip():
        return {"drugs": [], "observations": [], "metadata": {}}

    # ── Step 1: Direct regex extraction (always works) ──
    direct_drugs = _extract_drugs_direct(ocr_text)

    # ── Step 2: Sarvam Chat for metadata + observations ──
    cleaned_text = _preprocess_ocr_text(ocr_text)
    text_for_llm = cleaned_text[:12000]

    system_prompt = (
        "You are a precise Indian medical prescription parser. "
        "CRITICAL RULES:\n"
        "- 'T.' or 'Tab.' = Tablet, 'Syp.' = Syrup, 'Cap.' or 'cp.' = Capsule\n"
        "- 'Inj.' = Injection, 'Cr.' = Cream, 'Oint.' = Ointment, 'Drp.' = Drops\n"
        "- Numbers after drug names (250, 500, 650) = strengths in mg\n"
        "- DSR, SR, XR, ER = extended release formulations\n"
        "- 'x3' or 'multiplication factor of three' = course duration in days\n"
        "- Everything after 'Rx' is a medication list\n"
        "Output ONLY valid JSON."
    )

    user_prompt = """Extract ALL medicines, metadata, and clinical observations from this Indian prescription OCR text.

Return ONLY this JSON:
{
  "metadata": {
    "hospital_name": "..." or null, "doctor_name": "..." or null,
    "patient_name": "..." or null, "patient_age": "..." or null,
    "patient_gender": "Male"/"Female" or null, "patient_weight": null,
    "patient_height": null, "prescription_date": "YYYY-MM-DD" or null
  },
  "drugs": [
    { "drug_name": "...", "form": "tablet|capsule|syrup|...", "dosage": "250mg",
      "frequency": "1-0-1", "duration": "3 days", "instructions": "after food" }
  ],
  "observations": [
    { "observation_type": "symptom|diagnosis|...", "observation_text": "...",
      "body_part": null, "severity": null }
  ]
}

Prescription OCR:
---
""" + text_for_llm + """
---"""

    llm_result = {"metadata": {}, "drugs": [], "observations": []}
    try:
        response = sarvam_client.chat.completions(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=4000,
        )
        raw = response.choices[0].message.content.strip()
        logger.info(f"Sarvam chat raw response: {raw[:500]}")
        llm_result = _parse_llm_json_response(raw)
    except Exception as e:
        logger.warning(f"Sarvam chat API error: {e}, trying Groq fallback for metadata")
        try:
            llm_result = _extract_prescription_data_groq(ocr_text)
        except Exception as e2:
            logger.error(f"Groq fallback also failed: {e2}")

    # ── Step 3: Merge — regex drugs are primary, LLM can add extras ──
    final_drugs = list(direct_drugs)  # regex-extracted drugs always included

    # Add any LLM-found drugs not already in the direct list
    direct_names_lower = {d["drug_name"].lower().strip() for d in direct_drugs}
    for llm_drug in llm_result.get("drugs", []):
        name = llm_drug.get("drug_name", "").strip()
        if name and name.lower() not in direct_names_lower:
            final_drugs.append(llm_drug)
            direct_names_lower.add(name.lower())

    # Enrich direct-extracted drugs with LLM details (frequency, instructions)
    llm_drug_map = {}
    for ld in llm_result.get("drugs", []):
        key = ld.get("drug_name", "").lower().strip()
        if key:
            llm_drug_map[key] = ld
            # Also try matching without prefix
            short = re.sub(r'^(?:T\.|Tab\.?|Cap\.?|Cp\.|Syp\.?|Syr\.?|Inj\.?)\s*', '', key, flags=re.IGNORECASE).strip()
            if short:
                llm_drug_map[short] = ld

    for drug in final_drugs:
        name_lower = drug["drug_name"].lower().strip()
        short_lower = re.sub(r'^(?:T\.|Tab\.?|Cap\.?|Cp\.|Syp\.?|Syr\.?|Inj\.?)\s*', '', name_lower, flags=re.IGNORECASE).strip()
        enrichment = llm_drug_map.get(name_lower) or llm_drug_map.get(short_lower)
        if enrichment:
            if not drug.get("frequency") and enrichment.get("frequency"):
                drug["frequency"] = enrichment["frequency"]
            if not drug.get("instructions") and enrichment.get("instructions"):
                drug["instructions"] = enrichment["instructions"]
            if not drug.get("dosage") and enrichment.get("dosage"):
                drug["dosage"] = enrichment["dosage"]
            if not drug.get("duration") and enrichment.get("duration"):
                drug["duration"] = enrichment["duration"]

    logger.info(f"Final extraction: {len(final_drugs)} drugs ({len(direct_drugs)} direct + "
                f"{len(final_drugs) - len(direct_drugs)} from LLM)")

    return {
        "metadata": llm_result.get("metadata", {}),
        "drugs": final_drugs,
        "observations": llm_result.get("observations", []),
    }


def _extract_prescription_data_groq(ocr_text: str) -> dict:
    """Fallback: Use Groq LLM to extract drugs + observations from OCR text."""
    if not ocr_text.strip():
        return {"drugs": [], "observations": [], "metadata": {}}

    cleaned_text = _preprocess_ocr_text(ocr_text)

    prompt = """You are an expert Indian medical prescription parser.
Extract ALL medicines, metadata, and observations from this OCR text.

CRITICAL: T. = Tablet, Syp. = Syrup, Cap./cp. = Capsule, Inj. = Injection
Numbers after drug names = strengths in mg. "x3" = 3 days duration.
Everything after "Rx" is a medication list.

Return ONLY a JSON object:
{
  "metadata": { "hospital_name": null, "doctor_name": null, "patient_name": null,
                 "patient_age": null, "patient_gender": null, "patient_weight": null,
                 "patient_height": null, "prescription_date": null },
  "drugs": [
    { "drug_name": "...", "form": "tablet|capsule|syrup|...", "dosage": "500mg",
      "frequency": "1-0-1", "duration": "3 days", "instructions": "after food" }
  ],
  "observations": [
    { "observation_type": "symptom|diagnosis|...", "observation_text": "...",
      "body_part": null, "severity": null }
  ]
}

Prescription Text:
---
""" + cleaned_text[:8000] + """
---"""

    try:
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a precise Indian medical prescription parser. "
                        "T. means Tablet, Syp. means Syrup, Cap./cp. means Capsule. "
                        "Extract ALL drugs with dosage patterns. Output ONLY valid JSON."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=4000,
        )
        raw = response.choices[0].message.content.strip()
        logger.info(f"Groq LLM raw response (fallback): {raw[:500]}")
        return _parse_llm_json_response(raw)
    except Exception as e:
        logger.error(f"Groq LLM fallback error: {e}")
        return {"metadata": {}, "drugs": [], "observations": []}


def _parse_llm_json_response(raw: str) -> dict:
    """Parse JSON response from either Sarvam or Groq."""
    # Try to extract JSON object
    json_obj_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if json_obj_match:
        try:
            data = json.loads(json_obj_match.group())
            return {
                "metadata": data.get("metadata", {}),
                "drugs": data.get("drugs", []),
                "observations": data.get("observations", []),
            }
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")

    json_arr_match = re.search(r'\[.*\]', raw, re.DOTALL)
    if json_arr_match:
        try:
            return {"metadata": {}, "drugs": json.loads(json_arr_match.group()), "observations": []}
        except json.JSONDecodeError:
            pass

    return {"metadata": {}, "drugs": [], "observations": []}


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


# ── NeonDB (PostgreSQL) drug matching ─────────────────────────

def match_drugs_neondb(drug_candidates: list[dict], conn) -> list[dict]:
    """Match extracted drug names against the inventory table in NeonDB (PostgreSQL)
    using trigram similarity search. Also returns stock status and availability."""
    matched = []
    for candidate in drug_candidates:
        drug_name = candidate.get("drug_name", "").strip()
        if not drug_name:
            continue

        try:
            # Clean drug name for search: remove form prefixes like "Tab.", "Cap.", "Syp."
            search_name = re.sub(
                r'^(?:Tab\.?|Cap\.?|Cp\.?|Syp\.?|Syr\.?|Inj\.?|Cr\.?|Crm\.?|Oint\.?|Drp\.?|Susp\.?|Sach\.?|Inh\.?|Gel)\s*',
                '', drug_name, flags=re.IGNORECASE,
            ).strip()
            if not search_name:
                search_name = drug_name

            # Use trigram similarity + ILIKE to find best match in inventory
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, drug_name, brand_name, composition, category, drug_class,
                           form, strength, stock_qty, unit, price_per_unit, is_active,
                           expiry_date, is_otc,
                           GREATEST(
                               similarity(LOWER(drug_name), LOWER(%(search)s)),
                               similarity(LOWER(brand_name), LOWER(%(search)s)),
                               similarity(LOWER(composition), LOWER(%(search)s))
                           ) AS match_score
                    FROM inventory
                    WHERE is_active = TRUE
                      AND (
                          drug_name ILIKE %(like)s
                          OR brand_name ILIKE %(like)s
                          OR composition ILIKE %(like)s
                          OR similarity(LOWER(drug_name), LOWER(%(search)s)) > 0.15
                          OR similarity(LOWER(brand_name), LOWER(%(search)s)) > 0.15
                      )
                    ORDER BY match_score DESC
                    LIMIT 3
                """, {"search": search_name, "like": f"%{search_name}%"})
                rows = cur.fetchall()

            best_match = None
            best_score = 0.0
            best_meta = {}
            stock_status = "not_found"
            stock_qty = None
            inventory_id = None
            alternative_drug = None
            alternative_inv_id = None

            if rows:
                top = rows[0]
                best_score = float(top["match_score"])
                best_match = top["drug_name"]
                inventory_id = str(top["id"])
                best_meta = {
                    "drug_name": top["drug_name"],
                    "brand_name": top["brand_name"],
                    "composition": top["composition"],
                    "category": top["category"],
                    "drug_class": top["drug_class"],
                    "form": top["form"],
                    "strength": top["strength"],
                    "price_per_unit": float(top["price_per_unit"]) if top["price_per_unit"] else None,
                    "is_otc": top["is_otc"],
                    "expiry_date": str(top["expiry_date"]) if top["expiry_date"] else None,
                }

                # Determine stock status
                qty = top["stock_qty"] or 0
                stock_qty = qty
                if qty <= 0:
                    stock_status = "out_of_stock"
                elif qty <= (10):  # low stock threshold
                    stock_status = "low_stock"
                else:
                    stock_status = "in_stock"

                # If out of stock, check if there's an alternative in the same category
                if stock_status == "out_of_stock" and len(rows) > 1:
                    for alt_row in rows[1:]:
                        alt_qty = alt_row["stock_qty"] or 0
                        if alt_qty > 0:
                            alternative_drug = alt_row["drug_name"]
                            if alt_row["brand_name"]:
                                alternative_drug += f" ({alt_row['brand_name']})"
                            alternative_inv_id = str(alt_row["id"])
                            break

                logger.info(f"Drug '{drug_name}' -> '{best_match}' ({top['brand_name']}) "
                            f"score={best_score:.4f} stock={stock_status} qty={stock_qty}")
            else:
                logger.warning(f"Drug '{drug_name}' not found in inventory")

            dosage_parsed = parse_dosage_pattern(candidate.get("frequency"))
            matched.append({
                "drug_name_raw": drug_name,
                "drug_name_matched": best_match if best_score >= 0.1 else None,
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
                "inventory_metadata": best_meta,
                "inventory_id": inventory_id,
                "stock_status": stock_status,
                "stock_qty_available": stock_qty,
                "alternative_drug": alternative_drug,
                "alternative_inv_id": alternative_inv_id,
            })
        except Exception as e:
            logger.error(f"NeonDB error for '{drug_name}': {e}")
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
                "inventory_metadata": {},
                "inventory_id": None,
                "stock_status": "not_found",
                "stock_qty_available": None,
                "alternative_drug": None,
                "alternative_inv_id": None,
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
    Background task: S3 download -> Sarvam OCR -> Sarvam Chat extraction -> NeonDB matching -> DB.
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

        # Stage 3: Save raw OCR text immediately (even if extraction fails later)
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), sarvam_job_id, "extracting", extracted_text,
        )

        # Stage 4: Sarvam Chat extraction (with Groq LLM fallback)
        _update_ocr_status(conn, prescription_id, "extracting")
        prescription_data = extract_prescription_data_sarvam(extracted_text)
        drug_candidates = prescription_data["drugs"]
        observations = prescription_data["observations"]
        metadata = prescription_data.get("metadata", {})
        logger.info(f"[{prescription_id}] Extraction found {len(drug_candidates)} drugs, {len(observations)} observations, metadata keys: {list(metadata.keys())}")

        # Stage 4b: Save prescription metadata (hospital, doctor, patient info)
        if metadata:
            save_prescription_metadata(conn, prescription_id, metadata)

        # Stage 5: NeonDB inventory matching (replaces Pinecone)
        _update_ocr_status(conn, prescription_id, "matching")
        matched_drugs = match_drugs_neondb(drug_candidates, conn)
        logger.info(f"[{prescription_id}] NeonDB matched {len(matched_drugs)} drugs")

        # Stage 6: Final — mark completed
        save_prescription_upload(
            conn, prescription_id, user_id, BUCKET_NAME, s3_key,
            file_type, len(file_bytes), sarvam_job_id, "completed", extracted_text,
        )

        # Stage 7: Save drugs + observations (with course dates and stock info)
        prescription_date_str = metadata.get("prescription_date")
        save_extracted_drugs(conn, prescription_id, user_id, matched_drugs, prescription_date_str)
        save_observations(conn, prescription_id, user_id, observations)

        # Stage 7b: Save drug forms from LLM output
        save_drug_form(conn, prescription_id, drug_candidates, matched_drugs)

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


# ══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ══════════════════════════════════════════════════════════════

@router.post("/upload", response_model=UploadResponse)
async def get_upload_url(req: UploadRequest):
    """
    **Step 1** — Get a presigned S3 URL for uploading prescription file.
    Returns upload_url (PUT the file here from frontend), s3_key, and prescription_id.
    After uploading to S3, call POST /prescriptions/process to start OCR.
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
    """
    **Step 2** — Call AFTER the file has been uploaded to S3.
    Triggers background processing: S3 -> Sarvam OCR -> Sarvam Chat -> NeonDB inventory -> DB.
    Then poll GET /prescriptions/status/{prescription_id} to check results.
    """
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
