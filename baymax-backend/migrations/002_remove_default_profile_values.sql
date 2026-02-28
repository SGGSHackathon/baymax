-- Migration 002: Remove default profile values
-- Sets fabricated defaults back to NULL so only user-provided data is stored.
-- Safe to run multiple times (idempotent).

-- 1. Users who never reported pregnancy status (FALSE was the schema default)
UPDATE users SET is_pregnant = NULL WHERE is_pregnant = FALSE;

-- 2. Empty arrays mean "not yet collected", not "confirmed none"
UPDATE users SET allergies = NULL WHERE allergies = '{}';
UPDATE users SET chronic_conditions = NULL WHERE chronic_conditions = '{}';

-- 3. overall_adherence = 100 is the schema default; NULL means "not yet computed"
--    Only reset if the user has zero adherence_scores records (never actually tracked)
UPDATE users SET overall_adherence = NULL
WHERE overall_adherence = 100.0
  AND id NOT IN (SELECT DISTINCT user_id FROM adherence_scores);

-- 4. health_risk_score = 0 is the schema default
UPDATE users SET health_risk_score = NULL WHERE health_risk_score = 0;

-- 5. Drop column defaults so future INSERTs also get NULL
ALTER TABLE users ALTER COLUMN is_pregnant DROP DEFAULT;
ALTER TABLE users ALTER COLUMN allergies DROP DEFAULT;
ALTER TABLE users ALTER COLUMN chronic_conditions DROP DEFAULT;
ALTER TABLE users ALTER COLUMN overall_adherence DROP DEFAULT;
ALTER TABLE users ALTER COLUMN health_risk_score DROP DEFAULT;
