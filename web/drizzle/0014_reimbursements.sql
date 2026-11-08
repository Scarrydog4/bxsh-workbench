CREATE TABLE "reimbursements" (
  "id" text PRIMARY KEY NOT NULL,
  "no" text NOT NULL,
  "applicant_id" text NOT NULL REFERENCES "users"("id"),
  "version" integer DEFAULT 1 NOT NULL,
  "category" text NOT NULL CHECK ("category" IN ('图纸', '投流', '其他')),
  "amount" numeric(12, 2) NOT NULL CHECK ("amount" > 0 AND "amount" <= 1000000),
  "expense_date" date NOT NULL,
  "note" text NOT NULL,
  "proofs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "order_id" text REFERENCES "orders"("id") ON DELETE SET NULL,
  "status" text DEFAULT '待处理' NOT NULL CHECK ("status" IN ('待处理', '已报销', '已退回', '已撤回')),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_date" date,
  "paid_at" timestamp with time zone,
  "paid_by" text REFERENCES "users"("id"),
  "payment_note" text DEFAULT '' NOT NULL,
  "payment_proofs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "requests" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reimbursements_no_idx" ON "reimbursements" ("no");
--> statement-breakpoint
CREATE INDEX "reimbursements_applicant_idx" ON "reimbursements" ("applicant_id", "created_at");
--> statement-breakpoint
CREATE INDEX "reimbursements_status_idx" ON "reimbursements" ("status", "created_at");
