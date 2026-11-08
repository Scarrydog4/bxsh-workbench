CREATE TABLE "rewrite_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_ids" jsonb NOT NULL,
	"unit_points" integer NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"reused_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rewrite_jobs" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "rewrite_batches" ADD CONSTRAINT "rewrite_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;