ALTER TABLE orders ADD COLUMN allocation_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_allocation_policy_check CHECK (allocation_policy IN ('legacy', 'fixed_60_20_20_v1'));
