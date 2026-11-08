ALTER TABLE quality_reviews ALTER COLUMN image_hash DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN extra_image_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE settlements ADD COLUMN confirmed_date date;
--> statement-breakpoint
ALTER TABLE settle_batches ADD COLUMN confirmed_date date;
