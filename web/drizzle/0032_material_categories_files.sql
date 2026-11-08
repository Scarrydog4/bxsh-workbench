CREATE TABLE work_material_categories (
  kind text NOT NULL CHECK(kind IN ('case','talk')), name text NOT NULL,
  PRIMARY KEY(kind, name)
);
--> statement-breakpoint
INSERT INTO work_material_categories(kind, name)
SELECT DISTINCT kind, category FROM work_materials WHERE category <> '' AND category <> '未分类';
--> statement-breakpoint
ALTER TABLE work_materials ADD COLUMN file_path text, ADD COLUMN file_name text;
