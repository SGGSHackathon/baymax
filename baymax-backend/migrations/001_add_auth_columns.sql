-- ============================================================
-- Migration: Add auth + address columns to users table
-- Run once against your Neon DB.
-- ============================================================

-- Auth columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS email         TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Address columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
