CREATE TABLE "customer_links" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL REFERENCES "orders"("id"),
  "token_hash" text NOT NULL,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_links_token_idx" ON "customer_links" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_links_active_order_idx" ON "customer_links" ("order_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "customer_links_order_idx" ON "customer_links" ("order_id");
--> statement-breakpoint
CREATE TABLE "customer_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL REFERENCES "orders"("id"),
  "link_id" text NOT NULL REFERENCES "customer_links"("id"),
  "client_id" text NOT NULL,
  "request_id" text NOT NULL,
  "payload_hash" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('nudge', 'requirement')),
  "name" text DEFAULT '' NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "shots" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'handled')),
  "reply" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "handled_at" timestamp with time zone,
  "handled_by" text REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_requests_idempotency_idx" ON "customer_requests" ("order_id", "client_id", "request_id");
--> statement-breakpoint
CREATE INDEX "customer_requests_order_at_idx" ON "customer_requests" ("order_id", "created_at");
--> statement-breakpoint
CREATE INDEX "customer_requests_inbox_idx" ON "customer_requests" ("order_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "customer_requests_client_idx" ON "customer_requests" ("order_id", "client_id", "created_at");
