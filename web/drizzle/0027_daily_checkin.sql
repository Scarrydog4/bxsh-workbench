CREATE TABLE "daily_checkins" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "day" date NOT NULL,
  "clock_in_at" timestamp with time zone DEFAULT now() NOT NULL,
  "clock_out_at" timestamp with time zone,
  "clock_in_photo" text NOT NULL,
  "clock_out_photo" text,
  "break_start_at" timestamp with time zone,
  "break_end_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_checkins_user_day_idx" ON "daily_checkins" ("user_id", "day");
--> statement-breakpoint
CREATE INDEX "daily_checkins_day_idx" ON "daily_checkins" ("day");
--> statement-breakpoint
CREATE TABLE "checkin_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "request_id" text NOT NULL,
  "kind" text NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decision_reason" text,
  "decided_at" timestamp with time zone,
  "decided_by" text REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_requests_user_request_idx" ON "checkin_requests" ("user_id", "request_id");
--> statement-breakpoint
CREATE INDEX "checkin_requests_user_start_idx" ON "checkin_requests" ("user_id", "start_at");
