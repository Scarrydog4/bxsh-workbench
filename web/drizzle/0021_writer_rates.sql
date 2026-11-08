ALTER TABLE users ADD COLUMN writer_rate double precision NOT NULL DEFAULT 0.2;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN writer_rates_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE order_writers ADD COLUMN rate double precision;
