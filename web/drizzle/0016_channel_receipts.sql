CREATE TABLE "channel_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "no" text NOT NULL UNIQUE,
  "channel_id" text NOT NULL REFERENCES "channels"("id"),
  "owner_id" text NOT NULL REFERENCES "users"("id"),
  "amount" numeric(12,2) NOT NULL CHECK (amount > 0),
  "date" date NOT NULL,
  "tag" text NOT NULL CHECK (tag IN ('定金','尾款','全款')),
  "note" text DEFAULT '' NOT NULL,
  "proof" text,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "revoke_reason" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "requests" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_id" text REFERENCES "channel_receipts"("id");
--> statement-breakpoint
CREATE INDEX "channel_receipts_channel_idx" ON "channel_receipts" ("channel_id");
--> statement-breakpoint
CREATE INDEX "payments_receipt_idx" ON "payments" ("receipt_id");
