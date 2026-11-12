ALTER TABLE orders ADD COLUMN expected_deposit numeric(12, 2);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_expected_deposit_nonnegative CHECK (expected_deposit IS NULL OR expected_deposit >= 0);
--> statement-breakpoint
ALTER TABLE channels ADD COLUMN settlement_mode text NOT NULL DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE channels ADD CONSTRAINT channels_settlement_mode_valid CHECK (settlement_mode IN ('standard', 'weekly'));
