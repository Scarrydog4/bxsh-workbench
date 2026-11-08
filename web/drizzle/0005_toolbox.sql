CREATE TABLE "rewrite_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"order_id" text,
	"source_attachment_id" text,
	"name" text NOT NULL,
	"source_path" text NOT NULL,
	"size" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"platform_id" text NOT NULL,
	"platform_name" text NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"message" text,
	"submit_started_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_path" text,
	"result_name" text,
	"result_size" bigint,
	"result_attachment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rewrite_jobs" ADD CONSTRAINT "rewrite_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewrite_jobs" ADD CONSTRAINT "rewrite_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rewrite_jobs_dedupe_idx" ON "rewrite_jobs" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "rewrite_jobs_poll_idx" ON "rewrite_jobs" USING btree ("status","next_poll_at");--> statement-breakpoint
UPDATE "roles" SET "perms" = "perms" || '["toolbox.use"]'::jsonb WHERE "id" IN ('r-sales', 'r-writer') AND NOT "perms" @> '["toolbox.use"]'::jsonb;
