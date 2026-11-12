ALTER TABLE users ADD COLUMN paused_at timestamptz;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN proxy_id text REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN proxy_rate double precision NOT NULL DEFAULT 0.05;
--> statement-breakpoint
ALTER TABLE quality_reviews ALTER COLUMN order_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN kind text NOT NULL DEFAULT 'penalty';
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN category text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN amount numeric(12,2);
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN revoked_at timestamptz;
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN revoked_by text;
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN revoke_reason text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN settled_at timestamptz;
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN settled_by text;
