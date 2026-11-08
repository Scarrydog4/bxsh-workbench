DROP INDEX "after_sales_open_idx";--> statement-breakpoint
ALTER TABLE "after_sales" ADD COLUMN "chosen_hours" integer;--> statement-breakpoint
ALTER TABLE "after_sales" ADD COLUMN "late_confirm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "after_sales" ADD COLUMN "overdue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "after_sales" ADD COLUMN "delivered_late_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "after_sales" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "thumb_path" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "purpose" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "after_sales_open_idx" ON "after_sales" USING btree ("order_id") WHERE "after_sales"."done_at" is null and "after_sales"."cancelled_at" is null;