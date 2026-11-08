ALTER TABLE users ADD COLUMN avatar_frame text;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_avatar_frame_check CHECK (avatar_frame IS NULL OR avatar_frame IN ('', 'none', 'gold', 'jade', 'double', 'aurora', 'galaxy', 'flower', 'brush', 'crown', 'nib', 'star', 'knight', 'bow'));
