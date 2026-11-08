ALTER TABLE work_materials ADD COLUMN extra_image_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;
