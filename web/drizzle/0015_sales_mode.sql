ALTER TABLE "users" ADD COLUMN "sales_mode" text NOT NULL DEFAULT 'commission';
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sales_mode" text NOT NULL DEFAULT 'commission';
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "channel_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sales_mode_check" CHECK ("sales_mode" IN ('commission', 'cost'));
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_mode_check" CHECK ("sales_mode" IN ('commission', 'cost'));
