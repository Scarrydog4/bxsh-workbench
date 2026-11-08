ALTER TABLE "orders" ADD COLUMN "importance" jsonb;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "progress_note" text DEFAULT '' NOT NULL;
