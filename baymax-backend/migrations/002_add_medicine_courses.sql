-- ============================================================
-- Migration 002: medicine_courses table
-- Tracks a user's active medicine course linked to reminders
-- ============================================================

CREATE TABLE IF NOT EXISTS medicine_courses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reminder_id     UUID REFERENCES reminders(id) ON DELETE SET NULL,
    order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
    drug_name       TEXT NOT NULL,
    dose            TEXT,                 -- e.g. "1 tablet", "500mg"
    frequency       INTEGER DEFAULT 1,    -- times per day (1-4)
    times           TEXT[],               -- e.g. ['08:00','20:00']
    meal_instruction TEXT,
    duration_days   INTEGER,
    start_date      DATE DEFAULT CURRENT_DATE,
    end_date        DATE,
    total_qty       INTEGER,
    qty_remaining   INTEGER,
    doses_taken     INTEGER DEFAULT 0,
    doses_skipped   INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_user ON medicine_courses(user_id) WHERE status = 'active';

CREATE TRIGGER set_courses_updated BEFORE UPDATE ON medicine_courses
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
