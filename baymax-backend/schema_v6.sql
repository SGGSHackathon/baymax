-- ============================================================
-- MEDICAL AI — Complete Neon PostgreSQL Schema
-- ============================================================
-- Run this file once against your Neon DB to set up all tables.
-- Enable pgvector if needed: CREATE EXTENSION IF NOT EXISTS vector;
-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fuzzy text search for drug names
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid in later tables
-- ============================================================
-- HELPER: auto-update updated_at on all tables
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$ BEGIN
  NEW.updated_at = NOW(); RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- ============================================================
-- TABLE 1: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone               TEXT UNIQUE NOT NULL,
    email               TEXT,
    password       TEXT, -- hashed password
    name                TEXT,
    age                 INTEGER CHECK (age > 0 AND age < 150),
    gender              TEXT CHECK (gender IN ('male','female','other')),
    is_pregnant         BOOLEAN,              -- NULL = unknown
    blood_group         TEXT,
    weight_kg           NUMERIC(5,1),
    height_cm           NUMERIC(5,1),
    allergies           TEXT[],                -- NULL = not yet collected
    chronic_conditions  TEXT[],                -- NULL = not yet collected
    onboarded           BOOLEAN DEFAULT FALSE,
    onboarding_step     TEXT DEFAULT 'name',
    preferred_language  TEXT DEFAULT 'en-IN',
    overall_adherence   NUMERIC(5,2),                 -- NULL until computed from real data
    health_risk_score   INTEGER,                       -- NULL until computed from real data
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE TRIGGER set_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
-- ============================================================
-- TABLE 2: families
-- ============================================================
CREATE TABLE IF NOT EXISTS families (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================================
-- TABLE 3: family_members
-- ============================================================
CREATE TABLE IF NOT EXISTS family_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('admin','caregiver','dependent')),
    relation    TEXT,                       -- e.g. 'sister', 'brother', 'mother'
    can_order_for UUID[],
    added_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_fm_user   ON family_members(user_id);
CREATE INDEX IF NOT EXISTS idx_fm_family ON family_members(family_id);
-- ============================================================
-- TABLE 4: drug_classes  (V3 — Drug Class Awareness)
-- Maps drug names → class names for cross-class allergy detection
-- ============================================================
CREATE TABLE IF NOT EXISTS drug_classes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_name   TEXT NOT NULL,   -- e.g. "amoxicillin"
    class_name  TEXT NOT NULL,   -- e.g. "penicillin"
    UNIQUE(drug_name, class_name)
);
CREATE INDEX IF NOT EXISTS idx_drug_class_name ON drug_classes(drug_name);
CREATE INDEX IF NOT EXISTS idx_class_name       ON drug_classes(class_name);
-- Seed drug class data
INSERT INTO drug_classes (drug_name, class_name) VALUES
-- Penicillins
('amoxicillin','penicillin'),('ampicillin','penicillin'),('piperacillin','penicillin'),
('flucloxacillin','penicillin'),('co-amoxiclav','penicillin'),('augmentin','penicillin'),
-- Cephalosporins (cross-react with penicillin ~1-2%)
('cefalexin','cephalosporin'),('cefazolin','cephalosporin'),('cefuroxime','cephalosporin'),
('ceftriaxone','cephalosporin'),('cefixime','cephalosporin'),
-- Macrolides
('azithromycin','macrolide'),('clarithromycin','macrolide'),('erythromycin','macrolide'),
-- Fluoroquinolones
('ciprofloxacin','fluoroquinolone'),('levofloxacin','fluoroquinolone'),
('moxifloxacin','fluoroquinolone'),('ofloxacin','fluoroquinolone'),
-- Sulfonamides
('sulfamethoxazole','sulfonamide'),('trimethoprim-sulfamethoxazole','sulfonamide'),
('furosemide','sulfonamide'),('hydrochlorothiazide','sulfonamide'),
-- NSAIDs
('ibuprofen','nsaid'),('diclofenac','nsaid'),('naproxen','nsaid'),
('ketorolac','nsaid'),('aspirin','nsaid'),('celecoxib','nsaid'),
-- Statins
('atorvastatin','statin'),('rosuvastatin','statin'),('simvastatin','statin'),
('lovastatin','statin'),('pravastatin','statin'),
-- Beta-blockers
('metoprolol','beta_blocker'),('atenolol','beta_blocker'),('propranolol','beta_blocker'),
('bisoprolol','beta_blocker'),('carvedilol','beta_blocker'),
-- ACE Inhibitors
('enalapril','ace_inhibitor'),('ramipril','ace_inhibitor'),('lisinopril','ace_inhibitor'),
-- ARBs
('losartan','arb'),('valsartan','arb'),('telmisartan','arb'),('olmesartan','arb'),
-- Benzodiazepines
('clonazepam','benzodiazepine'),('diazepam','benzodiazepine'),
('alprazolam','benzodiazepine'),('lorazepam','benzodiazepine'),
-- PPIs
('omeprazole','ppi'),('pantoprazole','ppi'),('esomeprazole','ppi'),
('rabeprazole','ppi'),('lansoprazole','ppi'),
-- Tetracyclines
('doxycycline','tetracycline'),('tetracycline','tetracycline'),('minocycline','tetracycline'),
-- Aminoglycosides
('gentamicin','aminoglycoside'),('tobramycin','aminoglycoside'),('amikacin','aminoglycoside')
ON CONFLICT DO NOTHING;
-- ============================================================
-- TABLE 5: dosage_safety_caps  (V3 — Dosage Guardrails)
-- ============================================================
CREATE TABLE IF NOT EXISTS dosage_safety_caps (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_name               TEXT UNIQUE NOT NULL,
    adult_max_daily_mg      NUMERIC(8,2) NOT NULL,
    pediatric_max_mg_per_kg NUMERIC(8,2),
    single_dose_max_mg      NUMERIC(8,2),
    notes                   TEXT
);
INSERT INTO dosage_safety_caps (drug_name, adult_max_daily_mg, pediatric_max_mg_per_kg, single_dose_max_mg, notes) VALUES
('paracetamol',  4000,  60,  1000, 'Hepatotoxic above 4g/day; reduce if liver disease'),
('ibuprofen',    2400,  40,   800, 'GI risk; avoid if kidney disease'),
('aspirin',      4000,  NULL, 1000, 'Never give to children under 16'),
('diclofenac',    150,  NULL,  75, 'Max 75mg twice daily'),
('cetirizine',    20,   0.25,  10, 'Drowsiness above therapeutic dose'),
('metformin',    2000,  NULL, 1000, 'Reduce if eGFR < 45'),
('amoxicillin',  3000,  90,  1000, 'Standard 500mg TDS = 1500mg/day'),
('azithromycin',  500,  12,   500, 'Single daily dose only'),
('ciprofloxacin', 1500, NULL,  750, 'Avoid in children — cartilage risk'),
('omeprazole',    80,   NULL,  40, 'Standard 20-40mg/day'),
('amlodipine',    10,   NULL,  10, 'Titrate; max 10mg/day'),
('atorvastatin',  80,   NULL,  80, 'Rhabdomyolysis risk at high dose'),
('metoprolol',   400,   NULL, 200, 'Adjust for renal/hepatic impairment'),
('prednisolone', 100,   2,    60, 'Taper; never abruptly stop'),
('clonazepam',    20,   0.05,  10, 'Controlled; CNS depression risk'),
('domperidone',   80,   1.25,  20, 'QT risk; max 3 days recommended'),
('montelukast',   10,   NULL,  10, 'Once daily, generally safe')
ON CONFLICT DO NOTHING;
-- ============================================================
-- TABLE 6: inventory  (FEFO-aware, drug_class column added)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_name       TEXT NOT NULL,
    brand_name      TEXT,
    composition     TEXT,
    category        TEXT,
    drug_class      TEXT,                              -- V3: drug class for cross-allergy check
    form            TEXT,
    strength        TEXT,
    stock_qty       INTEGER NOT NULL DEFAULT 0,
    unit            TEXT DEFAULT 'tablet',
    price_per_unit  NUMERIC(8,2),
    reorder_level   INTEGER DEFAULT 10,
    is_otc          BOOLEAN DEFAULT TRUE,
    is_active       BOOLEAN DEFAULT TRUE,
    expiry_date     DATE,                              -- Used for FEFO ordering
    supplier        TEXT,
    times_ordered   INTEGER DEFAULT 0,                 -- Demand tracking
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(drug_name, brand_name, strength)
);
CREATE INDEX IF NOT EXISTS idx_inv_drug   ON inventory USING gin(drug_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inv_brand  ON inventory USING gin(brand_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inv_active ON inventory(is_active, stock_qty) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_inv_expiry ON inventory(expiry_date) WHERE is_active = TRUE;
CREATE TRIGGER set_inv_updated BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
-- Seed inventory
INSERT INTO inventory (drug_name,brand_name,composition,category,drug_class,form,strength,stock_qty,unit,price_per_unit,reorder_level,is_otc,expiry_date)
VALUES
('paracetamol','Crocin',   'Paracetamol 500mg', 'analgesic','nsaid','tablet','500mg',200,'tablet',2.50,20,TRUE,'2026-12-01'),
('paracetamol','Dolo 650', 'Paracetamol 650mg', 'analgesic','nsaid','tablet','650mg',150,'tablet',3.00,20,TRUE,'2026-10-01'),
('ibuprofen',  'Brufen',   'Ibuprofen 400mg',   'nsaid','nsaid',   'tablet','400mg',100,'tablet',4.50,15,TRUE,'2026-11-01'),
('cetirizine', 'Cetzine',  'Cetirizine 10mg',   'antihistamine',NULL,'tablet','10mg',120,'tablet',3.50,15,TRUE,'2027-01-01'),
('loratadine', 'Lorfast',  'Loratadine 10mg',   'antihistamine',NULL,'tablet','10mg', 80,'tablet',4.00,10,TRUE,'2027-02-01'),
('omeprazole', 'Omez',     'Omeprazole 20mg',   'ppi','ppi',       'capsule','20mg',100,'capsule',5.00,15,TRUE,'2026-09-01'),
('pantoprazole','Pan 40',  'Pantoprazole 40mg', 'ppi','ppi',       'tablet','40mg', 90,'tablet',6.50,15,FALSE,'2027-03-01'),
('domperidone','Domstal',  'Domperidone 10mg',  'antiemetic',NULL, 'tablet','10mg', 80,'tablet',3.00,10,TRUE,'2026-08-01'),
('amoxicillin','Mox 500',  'Amoxicillin 500mg', 'antibiotic','penicillin','capsule','500mg',60,'capsule',8.00,10,FALSE,'2026-07-01'),
('azithromycin','Azithral','Azithromycin 500mg','antibiotic','macrolide','tablet','500mg',50,'tablet',18.00,8,FALSE,'2026-06-01'),
('metformin',  'Glycomet', 'Metformin 500mg',   'antidiabetic',NULL,'tablet','500mg',200,'tablet',3.50,20,FALSE,'2027-01-01'),
('amlodipine', 'Amlopress','Amlodipine 5mg',    'antihypertensive','calcium_channel_blocker','tablet','5mg',150,'tablet',4.00,20,FALSE,'2027-04-01'),
('atorvastatin','Atorva',  'Atorvastatin 10mg', 'statin','statin',   'tablet','10mg',120,'tablet',6.00,15,FALSE,'2027-05-01'),
('montelukast','Montair',  'Montelukast 10mg',  'leukotriene_antagonist',NULL,'tablet','10mg',70,'tablet',7.50,10,FALSE,'2027-06-01'),
('vitamin_d3', 'D-Rise',   'Cholecalciferol 60000IU','supplement',NULL,'capsule','60000IU',80,'capsule',15.00,10,TRUE,'2027-07-01'),
('zinc_sulphate','Zincovit','Zinc Sulphate 20mg','supplement',NULL,'tablet','20mg',100,'tablet',2.00,15,TRUE,'2027-08-01'),
('ors',        'Electral', 'ORS WHO formula',   'rehydration',NULL,'sachet','21.8g',200,'sachet',5.00,30,TRUE,'2027-09-01'),
('salbutamol', 'Asthalin', 'Salbutamol 100mcg', 'bronchodilator',NULL,'inhaler','100mcg',40,'inhaler',85.00,5,FALSE,'2026-12-01'),
('prednisolone','Omnacortil','Prednisolone 5mg','corticosteroid',NULL,'tablet','5mg',60,'tablet',4.50,10,FALSE,'2027-01-01'),
('clonazepam', 'Rivotril', 'Clonazepam 0.5mg', 'benzodiazepine','benzodiazepine','tablet','0.5mg',30,'tablet',5.00,5,FALSE,'2026-11-01')
ON CONFLICT DO NOTHING;
-- ============================================================
-- TABLE 7: active_medications
-- ============================================================
CREATE TABLE IF NOT EXISTS active_medications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drug_name       TEXT NOT NULL,
    brand_name      TEXT,
    dosage          TEXT, -- e.g. 500mg twice daily
    dose_per_intake TEXT, -- e.g. 1 tablet
    frequency       TEXT, -- e.g. twice_daily, once_daily
    frequency_times TEXT[], -- e.g. ['08:00','20:00']
    meal_instruction TEXT CHECK (meal_instruction IN ('before_meal','after_meal','with_meal','empty_stomach','before_sleep','any')),
    prescribed_by TEXT, -- doctor name if available
    start_date      DATE DEFAULT CURRENT_DATE,
    end_date        DATE, -- NULL = ongoing/chronic
    is_active       BOOLEAN DEFAULT TRUE,
    source          TEXT DEFAULT 'user_reported', -- user_reported | ordered | prescribed
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_actmeds_user ON active_medications(user_id) WHERE is_active = TRUE;
-- ============================================================
-- TABLE 8: orders
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number    TEXT UNIQUE DEFAULT 'ORD-' || UPPER(SUBSTRING(uuid_generate_v4()::TEXT,1,8)),
    user_id         UUID NOT NULL REFERENCES users(id),
    patient_id      UUID NOT NULL REFERENCES users(id),
    placed_by_role  TEXT, -- 'self' | 'family_admin' | 'caregiver'
    inventory_id    UUID REFERENCES inventory(id),
    drug_name       TEXT NOT NULL,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(8,2),
    total_price     NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    requires_rx     BOOLEAN DEFAULT FALSE,
    rx_image_url    TEXT, -- uploaded prescription photo URL
    rx_verified     BOOLEAN DEFAULT FALSE,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dispensed','delivered','cancelled')),
    delivery_address TEXT,
    notes           TEXT,
    ordered_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_patient ON orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE TRIGGER set_orders_updated BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
-- ============================================================
-- TABLE 9: reminders
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES users(id),
    order_id        UUID REFERENCES orders(id),
    drug_name       TEXT NOT NULL,
    dose            TEXT, -- e.g. "1 tablet"
    meal_instruction TEXT,
    remind_times    TEXT[] NOT NULL, -- e.g. ['08:00','20:00']
    start_date      DATE DEFAULT CURRENT_DATE,
    end_date        DATE,
    is_active       BOOLEAN DEFAULT TRUE,
    total_qty       INTEGER, -- total tablets ordered
    qty_remaining   INTEGER, -- decremented on acknowledgement
    refill_alert_at INTEGER DEFAULT 3, -- alert when qty_remaining <= this
    bullmq_job_ids  TEXT[], -- scheduled job IDs
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reminders_user    ON reminders(user_id)    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_reminders_patient ON reminders(patient_id) WHERE is_active = TRUE;
CREATE TRIGGER set_reminders_updated BEFORE UPDATE ON reminders
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
-- ============================================================
-- TABLE 10: reminder_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS reminder_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reminder_id     UUID NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    patient_id      UUID NOT NULL REFERENCES users(id),
    drug_name       TEXT NOT NULL,
    dose            TEXT,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    sent_at         TIMESTAMPTZ,
    ack_status      TEXT DEFAULT 'pending' CHECK (ack_status IN ('pending','taken','skipped','escalated')),
    ack_received_at TIMESTAMPTZ,
    escalated       BOOLEAN DEFAULT FALSE,
    escalated_at    TIMESTAMPTZ,
    call_job_id     TEXT,
    call_completed  BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rlogs_reminder ON reminder_logs(reminder_id);
CREATE INDEX IF NOT EXISTS idx_rlogs_pending  ON reminder_logs(ack_status) WHERE ack_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_rlogs_patient  ON reminder_logs(patient_id);
-- ============================================================
-- TABLE 11: adherence_scores  (V3 — Adherence Engine)
-- ============================================================
CREATE TABLE IF NOT EXISTS adherence_scores (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drug_name        TEXT NOT NULL,
    week_start       DATE NOT NULL,
    total_scheduled  INTEGER DEFAULT 0,
    total_taken      INTEGER DEFAULT 0,
    total_skipped    INTEGER DEFAULT 0,
    score            NUMERIC(5,2) GENERATED ALWAYS AS (
                         CASE WHEN total_scheduled = 0 THEN 100
                              ELSE ROUND((total_taken::NUMERIC / total_scheduled) * 100, 2) END
                     ) STORED,
    risk_flag        TEXT DEFAULT 'high' CHECK (risk_flag IN ('low','medium','high')),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, drug_name, week_start)
);
CREATE INDEX IF NOT EXISTS idx_adherence_user ON adherence_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_adherence_risk ON adherence_scores(risk_flag) WHERE risk_flag != 'high';
-- ============================================================
-- TABLE 12: conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id    TEXT UNIQUE NOT NULL,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel       TEXT DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','web','api')),
    started_at    TIMESTAMPTZ DEFAULT NOW(),
    last_active   TIMESTAMPTZ DEFAULT NOW(),
    message_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conv_user    ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
-- ============================================================
-- TABLE 13: conversation_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_messages (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id        TEXT NOT NULL REFERENCES conversations(session_id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id),
    role              TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content           TEXT NOT NULL,
    agent_used        TEXT,
    intent            TEXT,
    intent_confidence NUMERIC(3,2),
    drugs_mentioned   TEXT[],
    safety_flags      TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msgs_session ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_msgs_created ON conversation_messages(created_at DESC);
-- ============================================================
-- TABLE 14: conversation_summaries  (V3 — Compressed Memory)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id          TEXT,
    summary_text        TEXT NOT NULL,
    key_points          TEXT[],
    allergies_detected  TEXT[],
    conditions_detected TEXT[],
    drugs_mentioned     TEXT[],
    symptoms_detected   TEXT[],
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_summaries_user ON conversation_summaries(user_id);
-- ============================================================
-- TABLE 15: extracted_medical_facts  (V3 — Auto Fact Extractor)
-- ============================================================
CREATE TABLE IF NOT EXISTS extracted_medical_facts (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fact_type    TEXT NOT NULL,      -- allergy|condition|adverse_reaction|pregnancy|weight
    value        TEXT NOT NULL,
    confidence   NUMERIC(3,2),
    auto_applied BOOLEAN DEFAULT FALSE,
    source_msg   TEXT,
    session_id   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facts_user ON extracted_medical_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_facts_type ON extracted_medical_facts(fact_type);
-- ============================================================
-- TABLE 16: adverse_reactions  (V3 — Adverse Reaction Tracker)
-- ============================================================
CREATE TABLE IF NOT EXISTS adverse_reactions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drug_name     TEXT NOT NULL,
    reaction      TEXT NOT NULL,
    severity      TEXT CHECK (severity IN ('mild','moderate','severe')),
    auto_detected BOOLEAN DEFAULT FALSE,
    reported_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adv_user ON adverse_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_adv_drug ON adverse_reactions(drug_name);
-- ============================================================
-- TABLE 17: health_events  (V3 — Health Timeline)
-- ============================================================
CREATE TABLE IF NOT EXISTS health_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,   -- allergy_added|adverse_reaction|new_condition|missed_dose_cluster|escalated|vital_recorded
    title       TEXT NOT NULL,
    description TEXT,
    drug_name   TEXT,
    metadata    JSONB DEFAULT '{}',
    occurred_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON health_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON health_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_time ON health_events(occurred_at DESC);
-- ============================================================
-- TABLE 18: symptom_followups  (V3 — 24hr Delayed Follow-up)
-- ============================================================
CREATE TABLE IF NOT EXISTS symptom_followups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symptom         TEXT NOT NULL,
    followup_at     TIMESTAMPTZ NOT NULL,
    followup_sent   BOOLEAN DEFAULT FALSE,
    response        TEXT,                        -- 'better'|'same'|'worse'
    responded_at    TIMESTAMPTZ,
    bullmq_job_id   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_followups_user ON symptom_followups(user_id);
CREATE INDEX IF NOT EXISTS idx_followups_sent ON symptom_followups(followup_sent) WHERE followup_sent = FALSE;
-- ============================================================
-- TABLE 19: vitals  (V3 — Real-Time Vital Monitoring)
-- ============================================================
CREATE TABLE IF NOT EXISTS vitals (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bp_systolic    INTEGER,          -- mmHg
    bp_diastolic   INTEGER,          -- mmHg
    blood_sugar    NUMERIC(6,1),     -- mg/dL
    spo2_pct       NUMERIC(4,1),     -- %
    temp_celsius   NUMERIC(4,1),     -- °C
    heart_rate     INTEGER,          -- bpm
    weight_kg      NUMERIC(5,1),
    recorded_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vitals_user ON vitals(user_id);
CREATE INDEX IF NOT EXISTS idx_vitals_time ON vitals(recorded_at DESC);
-- ============================================================
-- TABLE 20: audit_log  (V3 — Immutable Audit Trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID,
    action       TEXT NOT NULL,       -- e.g. allergy_auto_added, order_created, stock_decremented
    entity_type  TEXT,                -- users|orders|reminders|inventory
    entity_id    TEXT,
    old_value    JSONB,
    new_value    JSONB,
    performed_by TEXT DEFAULT 'system',
    ip_address   TEXT,
    occurred_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
-- ============================================================
-- TABLE 21: medical_history
-- ============================================================
CREATE TABLE IF NOT EXISTS medical_history (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    condition      TEXT NOT NULL,
    diagnosed_date DATE,
    status         TEXT DEFAULT 'active' CHECK (status IN ('active','resolved','chronic')),
    notes          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_med_history_user ON medical_history(user_id);
-- ============================================================
-- VIEWS — Useful for agent queries
-- ============================================================
-- Active medications with interaction-ready format
CREATE OR REPLACE VIEW user_active_meds_view AS
SELECT
    u.phone,
    u.id AS user_id,
    u.name,
    u.allergies,
    u.is_pregnant,
    u.age,
    ARRAY_AGG(am.drug_name) FILTER (WHERE am.is_active) AS current_meds,
    ARRAY_AGG(am.dose_per_intake) FILTER (WHERE am.is_active) AS current_doses
FROM users u
LEFT JOIN active_medications am ON u.id = am.user_id AND am.is_active = TRUE
GROUP BY u.id, u.phone, u.name, u.allergies, u.is_pregnant, u.age;
-- Refill alerts
CREATE OR REPLACE VIEW refill_due_view AS
SELECT r.id AS reminder_id, r.user_id, u.phone, u.name,
       r.drug_name, r.qty_remaining, r.refill_alert_at, r.end_date
FROM reminders r
JOIN users u ON r.patient_id = u.id
WHERE r.is_active = TRUE
  AND r.qty_remaining IS NOT NULL
  AND r.qty_remaining <= r.refill_alert_at;
-- Low stock alerts
CREATE OR REPLACE VIEW low_stock_view AS
SELECT id, drug_name, brand_name, stock_qty, reorder_level, unit, expiry_date
FROM inventory
WHERE is_active = TRUE AND stock_qty <= reorder_level
ORDER BY stock_qty ASC;
-- Expiring stock (next 30 days)
CREATE OR REPLACE VIEW expiring_soon_view AS
SELECT id, drug_name, brand_name, stock_qty, expiry_date
FROM inventory
WHERE is_active = TRUE AND expiry_date <= NOW() + INTERVAL '30 days'
ORDER BY expiry_date ASC;
-- User full profile with active meds
CREATE OR REPLACE VIEW user_full_profile AS
SELECT u.*,
       ARRAY_AGG(DISTINCT am.drug_name) FILTER (WHERE am.is_active) AS current_meds
FROM users u
LEFT JOIN active_medications am ON u.id = am.user_id AND am.is_active = TRUE
GROUP BY u.id;
-- ============================================================
-- MEDICAL AI V5 — Schema Additions
-- Run AFTER schema_v3.sql (additive only, no breaking changes)
-- Command: psql $DATABASE_URL < schema_v5_additions.sql
-- ============================================================
-- ============================================================
-- V5 TABLE 1: drug_contraindications
-- Rule-based CDSS contraindication table
-- ============================================================
CREATE TABLE IF NOT EXISTS drug_contraindications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_name TEXT NOT NULL,
    condition TEXT NOT NULL, -- e.g. 'asthma', 'renal_failure', 'pregnancy'
    severity TEXT NOT NULL CHECK (severity IN ('moderate','high','critical')),
    rationale TEXT NOT NULL, -- human-readable clinical reason
    source TEXT DEFAULT 'clinical_guidelines',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(drug_name, condition)
);
CREATE INDEX IF NOT EXISTS idx_contraind_drug ON drug_contraindications(drug_name);
CREATE INDEX IF NOT EXISTS idx_contraind_cond ON drug_contraindications(condition);
INSERT INTO drug_contraindications (drug_name, condition, severity, rationale) VALUES
-- Beta-blockers
('metoprolol', 'asthma', 'critical', 'Beta-blockers cause bronchoconstriction in asthma. Can trigger fatal bronchospasm.'),
('atenolol', 'asthma', 'critical', 'Beta-blockers contraindicated in asthma — cause bronchospasm.'),
('propranolol', 'asthma', 'critical', 'Non-selective beta-blocker. Severe bronchospasm risk in asthma.'),
('metoprolol', 'copd', 'high', 'Beta-blockers worsen airflow obstruction in COPD.'),
-- NSAIDs
('ibuprofen', 'gastric_ulcer', 'high', 'NSAIDs worsen gastric ulcers by inhibiting prostaglandins.'),
('diclofenac', 'gastric_ulcer', 'high', 'NSAID — avoid in peptic ulcer disease.'),
('ibuprofen', 'renal_failure', 'critical', 'NSAIDs reduce renal perfusion. Dangerous in renal failure.'),
('aspirin', 'renal_failure', 'high', 'Aspirin can worsen renal function.'),
('ibuprofen', 'heart_failure', 'high', 'NSAIDs cause fluid retention, worsening heart failure.'),
('diclofenac', 'heart_failure', 'high', 'NSAIDs increase cardiovascular events in heart failure.'),
-- Metformin
('metformin', 'renal_failure', 'critical', 'Metformin causes lactic acidosis in renal failure (eGFR<30). CONTRAINDICATED.'),
('metformin', 'liver_disease', 'high', 'Risk of lactic acidosis with hepatic impairment.'),
-- Statins
('atorvastatin', 'liver_disease', 'critical', 'Statins are hepatotoxic — contraindicated in active liver disease.'),
('simvastatin', 'liver_disease', 'critical', 'Active liver disease is absolute contraindication for statins.'),
-- ACE inhibitors / ARBs
('enalapril', 'pregnancy', 'critical', 'ACE inhibitors cause fetal renal failure and oligohydramnios. CONTRAINDICATED in pregnancy.'),
('losartan', 'pregnancy', 'critical', 'ARBs cause fetal harm. Contraindicated in 2nd and 3rd trimester.'),
('ramipril', 'pregnancy', 'critical', 'ACE inhibitor — CONTRAINDICATED in pregnancy.'),
-- Isotretinoin
('isotretinoin', 'pregnancy', 'critical', 'Severe teratogen. Absolute contraindication in pregnancy.'),
-- Fluoroquinolones
('ciprofloxacin','epilepsy', 'high', 'Fluoroquinolones lower seizure threshold. Caution in epilepsy.'),
('levofloxacin', 'epilepsy', 'high', 'CNS stimulation risk — caution in seizure disorders.'),
-- Benzodiazepines
('clonazepam', 'copd', 'high', 'Benzodiazepines cause respiratory depression. Caution in COPD.'),
('diazepam', 'sleep_apnea', 'high', 'Benzodiazepines worsen sleep apnea by relaxing airway muscles.'),
-- Corticosteroids
('prednisolone', 'diabetes', 'high', 'Steroids raise blood sugar — monitor closely in diabetics.'),
('dexamethasone','diabetes', 'high', 'Corticosteroids cause hyperglycemia. Dose adjustment required.'),
('prednisolone', 'osteoporosis', 'high', 'Long-term steroids cause bone loss. Supplement calcium/Vit D.'),
-- Warfarin
('warfarin', 'liver_disease', 'high', 'Liver disease alters warfarin metabolism — INR monitoring critical.'),
-- Misoprostol
('misoprostol', 'pregnancy', 'critical', 'Misoprostol causes uterine contractions. NEVER use in pregnancy without medical supervision.'),
-- Domperidone
('domperidone', 'cardiac_arrhythmia','critical','Domperidone prolongs QT interval. Contraindicated with arrhythmia.'),
-- PPIs (general note)
('omeprazole', 'osteoporosis', 'moderate', 'Long-term PPI use linked to reduced calcium absorption — monitor bone density.'),
-- Aspirin in children
('aspirin', 'viral_illness_child','critical','Aspirin in children <16 with viral illness → Reye syndrome (fatal). CONTRAINDICATED.'),
-- Tetracyclines
('doxycycline', 'pregnancy', 'high', 'Tetracyclines cause fetal bone/tooth abnormalities. Avoid in pregnancy.'),
('doxycycline', 'age_under_8', 'high', 'Tetracyclines deposit in growing bones/teeth in children <8.')
ON CONFLICT DO NOTHING;
-- ============================================================
-- V5 TABLE 2: duplicate_therapy_rules
-- Class-level therapeutic duplication detection
-- ============================================================
CREATE TABLE IF NOT EXISTS duplicate_therapy_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_class TEXT NOT NULL UNIQUE,
    warning TEXT NOT NULL,
    severity TEXT DEFAULT 'high'
);
INSERT INTO duplicate_therapy_rules (drug_class, warning, severity) VALUES
('nsaid', 'Taking two NSAIDs simultaneously increases GI bleed and renal toxicity risk significantly.', 'high'),
('statin', 'Two statins together dramatically increase myopathy and rhabdomyolysis risk.', 'critical'),
('benzodiazepine', 'Combining benzodiazepines causes excessive CNS/respiratory depression.', 'critical'),
('ppi', 'Two PPIs together provide no benefit and increase side effect risk.', 'moderate'),
('beta_blocker', 'Dual beta-blocker therapy causes excessive bradycardia and hypotension.', 'high'),
('ace_inhibitor', 'Two ACE inhibitors together — no evidence of benefit, increased renal risk.', 'high'),
('arb', 'Combining ARBs increases risk of hypotension, hyperkalemia, renal failure.', 'high'),
('macrolide', 'Dual macrolide therapy — no benefit, increased QT prolongation risk.', 'high'),
('fluoroquinolone', 'Two fluoroquinolones together — increased CNS toxicity and QT prolongation.', 'high'),
('antihistamine', 'Dual antihistamine use causes excessive sedation.', 'moderate')
ON CONFLICT DO NOTHING;
-- ============================================================
-- V5 TABLE 3: health_episodes
-- Episode clustering for longitudinal tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS health_episodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    episode_type TEXT NOT NULL, -- respiratory|gi|cardiac|neurological|musculoskeletal|other
    status TEXT DEFAULT 'active' CHECK (status IN ('active','resolved','monitoring')),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    symptoms TEXT[] DEFAULT '{}',
    drugs_given TEXT[] DEFAULT '{}',
    severity_peak TEXT DEFAULT 'low',
    notes TEXT,
    followup_count INTEGER DEFAULT 0,
    worsened BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_episodes_user ON health_episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_active ON health_episodes(status) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_episodes_type ON health_episodes(episode_type);
-- ============================================================
-- V5 TABLE 4: vital_trends
-- Computed trend analysis per vital type
-- ============================================================
CREATE TABLE IF NOT EXISTS vital_trends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vital_type TEXT NOT NULL, -- bp_systolic|blood_sugar|spo2|temp|heart_rate
    trend TEXT NOT NULL, -- rising|falling|stable|critical
    readings_count INTEGER DEFAULT 0,
    last_value NUMERIC(8,2),
    avg_value NUMERIC(8,2),
    change_pct NUMERIC(6,2), -- % change vs baseline
    alert_sent BOOLEAN DEFAULT FALSE,
    computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trends_user ON vital_trends(user_id);
CREATE INDEX IF NOT EXISTS idx_trends_type ON vital_trends(vital_type);
CREATE INDEX IF NOT EXISTS idx_trends_alert ON vital_trends(alert_sent) WHERE alert_sent=FALSE;
-- ============================================================
-- V5 TABLE 5: abuse_scores
-- Persistent cumulative abuse risk tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS abuse_scores (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER DEFAULT 0,
    flags TEXT[] DEFAULT '{}',
    blocked BOOLEAN DEFAULT FALSE,
    review_required BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);
-- ============================================================
-- V5 TABLE 6: user_consents
-- Consent + liability tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS user_consents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL, -- medical_disclaimer|data_usage|clinical_ai_use
    version TEXT DEFAULT '1.0',
    accepted BOOLEAN DEFAULT TRUE,
    accepted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, consent_type, version)
);
CREATE INDEX IF NOT EXISTS idx_consents_user ON user_consents(user_id);
-- ============================================================
-- V5 TABLE 7: clinical_decision_log
-- Every CDE evaluation logged for audit
-- ============================================================
CREATE TABLE IF NOT EXISTS clinical_decision_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    drug_name TEXT,
    risk_tier INTEGER,
    block BOOLEAN DEFAULT FALSE,
    warnings JSONB DEFAULT '[]',
    requires_doctor BOOLEAN DEFAULT FALSE,
    escalate BOOLEAN DEFAULT FALSE,
    dose_adjustment JSONB,
    evaluation_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cdlog_user ON clinical_decision_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cdlog_block ON clinical_decision_log(block) WHERE block=TRUE;
-- ============================================================
-- V5 TABLE 8: renal_dose_rules
-- Dose adjustment rules based on kidney function
-- ============================================================
CREATE TABLE IF NOT EXISTS renal_dose_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_name TEXT NOT NULL,
    egfr_min INTEGER, -- minimum eGFR for this rule (ml/min)
    egfr_max INTEGER, -- maximum eGFR
    action TEXT NOT NULL CHECK (action IN ('normal','reduce_50','reduce_75','avoid','monitor')),
    note TEXT,
    UNIQUE(drug_name, egfr_min, egfr_max)
);
INSERT INTO renal_dose_rules (drug_name, egfr_min, egfr_max, action, note) VALUES
('metformin', 45, 999, 'normal', 'Normal dose if eGFR > 45'),
('metformin', 30, 44, 'reduce_50', 'Halve dose if eGFR 30-44. Monitor carefully.'),
('metformin', 0, 29, 'avoid', 'Contraindicated if eGFR < 30. Lactic acidosis risk.'),
('metoprolol', 30, 999, 'normal', 'No adjustment needed above eGFR 30'),
('metoprolol', 0, 29, 'monitor', 'Monitor HR and BP. Reduce if bradycardia.'),
('ciprofloxacin',30, 999, 'normal', 'Normal dose'),
('ciprofloxacin',0, 29, 'reduce_50', 'Halve dose in severe renal impairment'),
('lisinopril', 30, 999, 'normal', 'Start low 2.5-5mg, titrate carefully'),
('lisinopril', 0, 29, 'reduce_50', 'Start 2.5mg. Monitor potassium and creatinine'),
('atorvastatin', 0, 999, 'normal', 'No renal dose adjustment required for statins')
ON CONFLICT DO NOTHING;
-- ============================================================
-- V5 VIEWS
-- ============================================================
-- Active health episodes with user info
CREATE OR REPLACE VIEW active_episodes_view AS
SELECT he.*, u.phone, u.name, u.age
FROM health_episodes he
JOIN users u ON he.user_id = u.id
WHERE he.status = 'active';
-- Users with high abuse risk
CREATE OR REPLACE VIEW high_risk_abuse_view AS
SELECT u.phone, u.name, u.age, ab.score, ab.flags, ab.review_required
FROM abuse_scores ab
JOIN users u ON ab.user_id = u.id
WHERE ab.score >= 4 OR ab.review_required = TRUE
ORDER BY ab.score DESC;
-- Vital trend alerts needing attention
CREATE OR REPLACE VIEW vital_trend_alerts_view AS
SELECT vt.*, u.phone, u.name
FROM vital_trends vt
JOIN users u ON vt.user_id = u.id
WHERE vt.trend IN ('rising','critical') AND vt.alert_sent = FALSE;
-- ============================================================
-- V5: Add columns to existing tables (safe ALTER)
-- ============================================================
-- Add risk_tier to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_tier INTEGER DEFAULT 1 CHECK (risk_tier BETWEEN 1 AND 5);
ALTER TABLE users ADD COLUMN IF NOT EXISTS egfr NUMERIC(5,1); -- kidney function
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_accepted BOOLEAN DEFAULT FALSE;
-- Add episode_id to health_events
ALTER TABLE health_events ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES health_episodes(id);
-- Add duplicate_therapy_checked to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dup_therapy_checked BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cde_risk_tier INTEGER;
-- ══════════════════════════════════════════════════════════════
-- SCHEMA V6 ADDITIONS — Run after schema_v5_additions.sql
-- ══════════════════════════════════════════════════════════════
-- ── DFE Question Log ─────────────────────────────────────────
-- Records every follow-up question the Dynamic Follow-Up Engine generates.
-- Enables analytics: which fields are most often missing, per symptom/age group.
CREATE TABLE IF NOT EXISTS dfe_question_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    session_id TEXT NOT NULL,
    symptom_context TEXT, -- e.g. "fever_child"
    missing_field TEXT, -- e.g. "temperature_value"
    question_generated TEXT, -- The LLM-generated question
    tier INT DEFAULT 1,
    age_group TEXT, -- child | adult | elderly | unknown
    caregiver_ctx TEXT, -- child | parent | spouse | NULL
    channel TEXT DEFAULT 'whatsapp',
    user_answered BOOLEAN DEFAULT FALSE, -- Did user provide the info?
    answer_text TEXT, -- What they answered
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dfe_log_user ON dfe_question_log(user_id);
CREATE INDEX IF NOT EXISTS idx_dfe_log_session ON dfe_question_log(session_id);
CREATE INDEX IF NOT EXISTS idx_dfe_log_field ON dfe_question_log(missing_field);
-- ── Web Search Cache Log ──────────────────────────────────────
-- Tracks what triggered web search, which domain responded, and outcome.
-- Enables audit: was web search ever used for dosage/contraindications? (it should not be)
CREATE TABLE IF NOT EXISTS web_search_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    query TEXT NOT NULL,
    trigger_type TEXT, -- 'fallback' | 'recall_keyword' | 'outbreak_keyword'
    domain_used TEXT,
    result_found BOOLEAN DEFAULT FALSE,
    cached BOOLEAN DEFAULT FALSE,
    recall_alert BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_search_user ON web_search_log(user_id);
CREATE INDEX IF NOT EXISTS idx_web_search_recall ON web_search_log(recall_alert) WHERE recall_alert = TRUE;
-- ── Behavioral Profiles (for DFE adaptation) ─────────────────
-- Persistent per-user behavioral signals (short replies, ignores, anxiety).
-- Session-level signals stored in Redis; long-term patterns here.
CREATE TABLE IF NOT EXISTS user_behavioral_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    ignored_questions INT DEFAULT 0,
    short_reply_count INT DEFAULT 0,
    anxiety_signals INT DEFAULT 0,
    dfe_questions_asked INT DEFAULT 0,
    dfe_questions_answered INT DEFAULT 0,
    preferred_channel TEXT DEFAULT 'whatsapp',
    last_updated TIMESTAMPTZ DEFAULT NOW()
);
-- ── Columns added to existing tables ─────────────────────────
-- users: preferred channel for dual-channel routing
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_channel TEXT DEFAULT 'whatsapp';
-- clinical_decision_log: track if web recall data was consulted before order
ALTER TABLE clinical_decision_log ADD COLUMN IF NOT EXISTS recall_checked BOOLEAN DEFAULT FALSE;
-- conversation_messages: track which channel each message came from
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS dfe_triggered BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS web_search_used BOOLEAN DEFAULT FALSE;
-- ── Analytics Views ───────────────────────────────────────────
-- DFE effectiveness: how often users answer DFE questions
CREATE OR REPLACE VIEW dfe_effectiveness_view AS
SELECT
    missing_field,
    symptom_context,
    age_group,
    COUNT(*) AS total_asked,
    SUM(CASE WHEN user_answered THEN 1 ELSE 0 END) AS answered,
    ROUND(AVG(CASE WHEN user_answered THEN 1.0 ELSE 0.0 END) * 100, 1) AS answer_rate_pct
FROM dfe_question_log
GROUP BY missing_field, symptom_context, age_group
ORDER BY answer_rate_pct DESC;
-- Web search usage summary
CREATE OR REPLACE VIEW web_search_summary_view AS
SELECT
    trigger_type,
    domain_used,
    COUNT(*) AS total_searches,
    SUM(CASE WHEN result_found THEN 1 ELSE 0 END) AS results_found,
    SUM(CASE WHEN recall_alert THEN 1 ELSE 0 END) AS recall_alerts,
    DATE_TRUNC('day', created_at) AS search_date
FROM web_search_log
GROUP BY trigger_type, domain_used, DATE_TRUNC('day', created_at)
ORDER BY search_date DESC;
-- ── Seed: DFE field priority reference (for dashboard) ───────
CREATE TABLE IF NOT EXISTS dfe_field_registry (
    field_name TEXT PRIMARY KEY,
    priority_cat TEXT, -- red_flag_screen | triage_affecting | safety_affecting | etc.
    weight INT,
    description TEXT
);
INSERT INTO dfe_field_registry(field_name, priority_cat, weight, description) VALUES
    ('chest_pain_yn', 'red_flag_screen', 5, 'Chest pain yes/no — stroke/MI screening'),
    ('vision_change_yn', 'red_flag_screen', 5, 'Vision changes — stroke/TIA screening'),
    ('weakness_yn', 'red_flag_screen', 5, 'One-sided weakness — stroke screening'),
    ('breathing_difficulty_yn', 'red_flag_screen', 5, 'Breathing difficulty screening'),
    ('temperature_value', 'triage_affecting', 4, 'Exact temperature for fever triage'),
    ('fever_yn', 'triage_affecting', 4, 'Fever presence for triage'),
    ('severity_1_10', 'triage_affecting', 4, 'Pain severity score'),
    ('age', 'safety_affecting', 3, 'Patient age for dosage/safety'),
    ('weight_kg', 'dosing_affecting', 2, 'Weight for pediatric dosing'),
    ('duration', 'context_adding', 1, 'Duration of symptoms'),
    ('location', 'context_adding', 1, 'Pain location'),
    ('vomiting_yn', 'context_adding', 1, 'Vomiting presence'),
    ('position_related_yn', 'context_adding', 1, 'Positional dizziness screening')
ON CONFLICT(field_name) DO NOTHING;

-- ── Reminder system: late ACK + idempotency ──────────────────
ALTER TABLE reminder_logs
  ADD COLUMN IF NOT EXISTS late_ack BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rlogs_idempotency
  ON reminder_logs(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- END OF SCHEMA V6 ADDITIONS

-- ══════════════════════════════════════════════════════════════
-- V7: Sarvam.ai Multilingual Support — Migration
-- ══════════════════════════════════════════════════════════════
-- Rename preferred_lang → preferred_language if old column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='users' AND column_name='preferred_lang')
    THEN
        ALTER TABLE users RENAME COLUMN preferred_lang TO preferred_language;
    END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- V8: Prescription OCR — Drug Extraction Tables
-- ══════════════════════════════════════════════════════════════

-- ── Prescription Uploads ─────────────────────────────────────
-- Tracks every prescription image/PDF uploaded to S3
CREATE TABLE IF NOT EXISTS prescription_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    s3_bucket       TEXT NOT NULL,
    s3_key          TEXT NOT NULL,
    file_type       TEXT CHECK (file_type IN ('pdf','png','jpg','jpeg')),
    file_size_bytes BIGINT,
    sarvam_job_id   TEXT,                -- Sarvam Vision job ID
    ocr_status      TEXT DEFAULT 'pending'
                    CHECK (ocr_status IN ('pending','processing','downloading','ocr_running','extracting','matching','completed','failed')),
    raw_extracted_text TEXT,              -- full OCR text from Sarvam Vision
    error_message   TEXT,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(s3_bucket, s3_key)
);
CREATE INDEX IF NOT EXISTS idx_prescription_uploads_user   ON prescription_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_prescription_uploads_status ON prescription_uploads(ocr_status);
CREATE TRIGGER set_prescription_uploads_updated BEFORE UPDATE ON prescription_uploads
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ── Extracted Drugs ──────────────────────────────────────────
-- Each drug found by matching OCR text against the Pinecone drug_database namespace
CREATE TABLE IF NOT EXISTS prescription_extracted_drugs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id     UUID NOT NULL REFERENCES prescription_uploads(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    drug_name_raw       TEXT NOT NULL,           -- exact string from OCR
    drug_name_matched   TEXT,                    -- canonical name from Pinecone match
    match_score         NUMERIC(5,4),            -- cosine similarity score (0-1)
    brand_name          TEXT,
    dosage              TEXT,                    -- e.g. "500mg"
    frequency           TEXT,                    -- e.g. "twice daily" or "1-0-1"
    frequency_raw       TEXT,                    -- original pattern e.g. "1-0-1", "2-0-1"
    morning_dose        NUMERIC(4,1) DEFAULT 0,  -- parsed from X-Y-Z → X
    afternoon_dose      NUMERIC(4,1) DEFAULT 0,  -- parsed from X-Y-Z → Y
    night_dose          NUMERIC(4,1) DEFAULT 0,  -- parsed from X-Y-Z → Z
    duration            TEXT,                    -- e.g. "5 days"
    duration_days       INTEGER,                 -- computed: 5, 7, 14 etc.
    instructions        TEXT,                    -- e.g. "after meal"
    meal_relation       TEXT CHECK (meal_relation IN
                            ('before_meal','after_meal','with_meal','empty_stomach','before_sleep','any')),
    matched_inventory_id UUID REFERENCES inventory(id),
    pinecone_metadata   JSONB DEFAULT '{}',      -- full Pinecone match metadata
    is_verified         BOOLEAN DEFAULT FALSE,   -- pharmacist verification flag
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_extracted_drugs_prescription ON prescription_extracted_drugs(prescription_id);
CREATE INDEX IF NOT EXISTS idx_extracted_drugs_user         ON prescription_extracted_drugs(user_id);
CREATE INDEX IF NOT EXISTS idx_extracted_drugs_matched      ON prescription_extracted_drugs(drug_name_matched);

-- ── Prescription Observations ────────────────────────────────
-- Additional clinical observations extracted from the prescription
-- e.g. "difficulty climbing stairs", "swelling in ankles", doctor notes
CREATE TABLE IF NOT EXISTS prescription_observations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id     UUID NOT NULL REFERENCES prescription_uploads(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    observation_type    TEXT NOT NULL CHECK (observation_type IN
                            ('symptom','diagnosis','vital_sign','lifestyle','investigation','doctor_note','other')),
    observation_text    TEXT NOT NULL,           -- e.g. "difficulty in climbing stairs"
    body_part           TEXT,                    -- e.g. "knees", "chest", "left leg"
    severity            TEXT CHECK (severity IN ('mild','moderate','severe')),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_observations_prescription ON prescription_observations(prescription_id);
CREATE INDEX IF NOT EXISTS idx_observations_user         ON prescription_observations(user_id);
CREATE INDEX IF NOT EXISTS idx_observations_type         ON prescription_observations(observation_type);

-- View: Prescription summary with extracted drugs
CREATE OR REPLACE VIEW prescription_summary_view AS
SELECT
    pu.id AS prescription_id,
    pu.user_id,
    u.phone,
    u.name AS user_name,
    pu.s3_key,
    pu.ocr_status,
    pu.created_at AS uploaded_at,
    pu.processed_at,
    ARRAY_AGG(ped.drug_name_matched ORDER BY ped.match_score DESC)
        FILTER (WHERE ped.drug_name_matched IS NOT NULL) AS matched_drugs,
    ARRAY_AGG(ped.drug_name_raw)
        FILTER (WHERE ped.drug_name_raw IS NOT NULL) AS raw_drug_names,
    COUNT(ped.id) AS total_drugs_found
FROM prescription_uploads pu
LEFT JOIN users u ON pu.user_id = u.id
LEFT JOIN prescription_extracted_drugs ped ON pu.id = ped.prescription_id
GROUP BY pu.id, pu.user_id, u.phone, u.name, pu.s3_key, pu.ocr_status,
         pu.created_at, pu.processed_at;

-- View: Drug schedule detail (morning/afternoon/night breakdown)
CREATE OR REPLACE VIEW prescription_drug_schedule_view AS
SELECT
    ped.id AS drug_id,
    ped.prescription_id,
    ped.user_id,
    u.name AS user_name,
    ped.drug_name_matched AS drug_name,
    ped.brand_name,
    ped.dosage,
    ped.frequency_raw,
    ped.morning_dose,
    ped.afternoon_dose,
    ped.night_dose,
    ped.duration,
    ped.duration_days,
    ped.meal_relation,
    ped.instructions,
    ped.match_score
FROM prescription_extracted_drugs ped
LEFT JOIN users u ON ped.user_id = u.id
ORDER BY ped.prescription_id, ped.created_at;

-- ══════════════════════════════════════════════════════════════
-- END OF V8 ADDITIONS
-- ══════════════════════════════════════════════════════════════

-- Ensure preferred_language column exists with BCP-47 format default
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en-IN';

-- Update existing 'en' values to 'en-IN' BCP-47 format
UPDATE users SET preferred_language = 'en-IN'
  WHERE preferred_language = 'en' OR preferred_language IS NULL;

-- Add consent_accepted, egfr, address if missing (used by get_user_by_phone)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS consent_accepted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS egfr NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS address TEXT;
-- ══════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India';
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ══════════════════════════════════════════════════════════════
-- Medicine Courses — tracks a user's active medicine course
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS medicine_courses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reminder_id     UUID REFERENCES reminders(id) ON DELETE SET NULL,
    order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
    drug_name       TEXT NOT NULL,
    dose            TEXT,
    frequency       INTEGER DEFAULT 1,
    times           TEXT[],
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
CREATE TRIGGER IF NOT EXISTS set_courses_updated BEFORE UPDATE ON medicine_courses
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();