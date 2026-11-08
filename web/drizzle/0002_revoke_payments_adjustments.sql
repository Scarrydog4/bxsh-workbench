ALTER TABLE "adjustments" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "revoked_by" text;--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "revoked_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "revoke_reason" text;