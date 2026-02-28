-- Migration: Expand ocr_status CHECK constraint to support granular processing stages
-- These stages let the frontend show real progress: downloading → ocr_running → extracting → matching → completed

-- Drop the old constraint
ALTER TABLE prescription_uploads DROP CONSTRAINT IF EXISTS prescription_uploads_ocr_status_check;

-- Add the new constraint with additional stages
ALTER TABLE prescription_uploads
  ADD CONSTRAINT prescription_uploads_ocr_status_check
  CHECK (ocr_status IN ('pending','processing','downloading','ocr_running','extracting','matching','completed','failed'));
