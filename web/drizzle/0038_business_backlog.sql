CREATE TABLE contractors (
 id text PRIMARY KEY, name text NOT NULL UNIQUE, aliases jsonb NOT NULL DEFAULT '[]', avatar text,
 note text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE contractor_payments (
 id text PRIMARY KEY, contractor_id text NOT NULL REFERENCES contractors(id), amount numeric(12,2) NOT NULL CHECK(amount > 0),
 date date NOT NULL, note text NOT NULL, by text NOT NULL REFERENCES users(id), at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, revoke_reason text
);
--> statement-breakpoint
ALTER TABLE order_costs ADD COLUMN contractor_id text REFERENCES contractors(id);
--> statement-breakpoint
CREATE INDEX contractor_payments_contractor_idx ON contractor_payments(contractor_id);
--> statement-breakpoint
CREATE TABLE inquiries (
 id text PRIMARY KEY, title text NOT NULL, owner_id text NOT NULL REFERENCES users(id), channel_id text REFERENCES channels(id),
 quote numeric(12,2) CHECK(quote >= 0), note text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','converted')),
 order_id text REFERENCES orders(id), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX inquiries_owner_idx ON inquiries(owner_id);
--> statement-breakpoint
CREATE TABLE agent_tokens (
 id text PRIMARY KEY, hash text NOT NULL UNIQUE, user_id text NOT NULL REFERENCES users(id), name text NOT NULL, scopes jsonb NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
