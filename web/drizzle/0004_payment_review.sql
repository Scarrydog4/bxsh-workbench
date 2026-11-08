ALTER TABLE orders ADD COLUMN payment_checked_at timestamptz;
ALTER TABLE orders ADD COLUMN payment_checked_by text;
ALTER TABLE orders ADD COLUMN payment_checked_snapshot text;
