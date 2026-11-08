ALTER TABLE work_materials ADD COLUMN original_formats jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE quality_reviews ADD COLUMN history jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
UPDATE quality_reviews AS r SET history = jsonb_build_array(jsonb_build_object(
  'type','reply','text',r.reply,'actorId',r.writer_id,'actorName',u.name,'at',COALESCE(r.replied_at,r.created_at)
)) FROM users AS u WHERE u.id = r.writer_id AND r.reply <> '';
