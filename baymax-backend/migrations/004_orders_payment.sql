-- Migration 004: Add Razorpay payment columns to orders table
-- Run this on your Neon DB

ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status      TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'created', 'paid', 'failed', 'refunded'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_amount      NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency            TEXT DEFAULT 'INR';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prescription_id     UUID REFERENCES prescription_uploads(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_sent          BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_sent            BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_razorpay ON orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment  ON orders(payment_status);
