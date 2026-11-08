CREATE TABLE "point_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"delta" integer DEFAULT 0 NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"job_id" text,
	"note" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"points" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rewrite_jobs" ADD COLUMN "points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rewrite_jobs" ADD COLUMN "point_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "point_accounts" ADD CONSTRAINT "point_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "point_entries_user_idx" ON "point_entries" USING btree ("user_id","at");
--> statement-breakpoint
ALTER TABLE "point_accounts" ADD CONSTRAINT "point_accounts_nonnegative" CHECK (balance >= reserved AND reserved >= 0);
--> statement-breakpoint
ALTER TABLE "tool_prices" ADD CONSTRAINT "tool_prices_positive" CHECK (points > 0);
