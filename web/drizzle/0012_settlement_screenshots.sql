ALTER TABLE settle_batches ADD COLUMN shots jsonb NOT NULL DEFAULT '[]'::jsonb;
