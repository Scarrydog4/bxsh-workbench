ALTER TABLE "rewrite_jobs" ADD COLUMN "rewrite_options" jsonb;
--> statement-breakpoint
ALTER TABLE "rewrite_jobs" ADD COLUMN "provider_state" jsonb DEFAULT '{}'::jsonb NOT NULL;
