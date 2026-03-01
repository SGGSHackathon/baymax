-- ══════════════════════════════════════════════════════════════
-- Migration 003: Enhanced Prescription OCR fields
-- Adds hospital/patient/doctor info, name similarity, course dates
-- ══════════════════════════════════════════════════════════════

-- ── New columns on prescription_uploads ─────────────────────
ALTER TABLE prescription_uploads
  ADD COLUMN IF NOT EXISTS hospital_name       TEXT,
  ADD COLUMN IF NOT EXISTS doctor_name         TEXT,
  ADD COLUMN IF NOT EXISTS patient_name_ocr    TEXT,          -- name found on prescription
  ADD COLUMN IF NOT EXISTS patient_age_ocr     TEXT,
  ADD COLUMN IF NOT EXISTS patient_gender_ocr  TEXT,
  ADD COLUMN IF NOT EXISTS patient_weight_ocr  TEXT,
  ADD COLUMN IF NOT EXISTS patient_height_ocr  TEXT,
  ADD COLUMN IF NOT EXISTS prescription_date   DATE,          -- date printed on prescription
  ADD COLUMN IF NOT EXISTS name_match_score    NUMERIC(5,4),  -- similarity to logged-in user
  ADD COLUMN IF NOT EXISTS name_match_warning  TEXT;           -- warning if names don't match

-- ── New columns on prescription_extracted_drugs ─────────────
ALTER TABLE prescription_extracted_drugs
  ADD COLUMN IF NOT EXISTS course_start_date   DATE,          -- prescription_date or today
  ADD COLUMN IF NOT EXISTS course_end_date     DATE,          -- start + duration_days
  ADD COLUMN IF NOT EXISTS stock_status        TEXT CHECK (stock_status IN ('in_stock','low_stock','out_of_stock','not_found')),
  ADD COLUMN IF NOT EXISTS stock_qty_available INTEGER,
  ADD COLUMN IF NOT EXISTS alternative_drug    TEXT,           -- if out of stock, suggest alternative
  ADD COLUMN IF NOT EXISTS alternative_inv_id  UUID REFERENCES inventory(id),
  ADD COLUMN IF NOT EXISTS form                TEXT;           -- tablet/syrup/capsule/injection/etc
