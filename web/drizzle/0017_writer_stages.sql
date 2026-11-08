ALTER TABLE orders ADD COLUMN writer_pay_plan text NOT NULL DEFAULT 'full';
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN graduated_at timestamptz;
--> statement-breakpoint
CREATE TABLE writer_progress (
  order_id text NOT NULL REFERENCES orders(id),
  user_id text NOT NULL REFERENCES users(id),
  completed_at timestamptz,
  completed_proof_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  group_sent_at timestamptz,
  group_proof_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (order_id, user_id)
);
