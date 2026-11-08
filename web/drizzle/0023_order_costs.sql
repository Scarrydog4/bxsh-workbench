CREATE TABLE order_costs (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  name text NOT NULL,
  contractor text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  date date NOT NULL,
  note text NOT NULL DEFAULT '',
  proof text,
  at timestamptz NOT NULL DEFAULT now(),
  by text NOT NULL REFERENCES users(id),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);
CREATE INDEX order_costs_order_idx ON order_costs(order_id);
