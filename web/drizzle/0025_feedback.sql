CREATE TABLE "feedback" (
  "id" text PRIMARY KEY NOT NULL,
  "no" text NOT NULL,
  "author_id" text NOT NULL REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "shots" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT '待处理' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "requests" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_no_idx" ON "feedback" ("no");
--> statement-breakpoint
CREATE INDEX "feedback_author_idx" ON "feedback" ("author_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" ("status", "updated_at");
