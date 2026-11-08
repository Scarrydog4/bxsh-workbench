CREATE TABLE work_materials (
  id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('case','talk')), title text NOT NULL,
  content text NOT NULL, category text NOT NULL, major text NOT NULL DEFAULT '', image_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE work_material_favorites (
  user_id text NOT NULL REFERENCES users(id), material_id text NOT NULL REFERENCES work_materials(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, material_id)
);
--> statement-breakpoint
CREATE TABLE quality_reviews (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), writer_id text NOT NULL REFERENCES users(id),
  creator_id text NOT NULL REFERENCES users(id), title text NOT NULL, issue text NOT NULL, image_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','waiting','done')), reply text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), replied_at timestamptz, confirmed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX quality_reviews_writer_status ON quality_reviews(writer_id, status);
--> statement-breakpoint
INSERT INTO work_materials (id,kind,title,content,category) VALUES
('sales-cases','talk','客户想看类似案例','你更关注功能还是呈现效果？我挑一两个方向相近的案例发你。','销售话术'),
('sales-time','talk','客户问多久能完成','你希望哪天看到第一版？把具体要求和已有材料发我，我和负责的写手确认后给你时间。','销售话术'),
('sales-price','talk','客户想了解报价','你把任务要求和已有材料发我一下，我先确认工作量，再给你对应的报价和交付范围。','销售话术'),
('writer-scope','talk','群里修改意见不明确','我理解这次要调整的是第二部分。你希望补充内容，还是调整现有表达？有标注截图的话，可以发群里，我逐项确认。','写手话术'),
('writer-changes','talk','收到多条修改意见','我先把这次修改逐项列出来。你确认后我开始改，交付时会标明每一项对应的位置。','写手话术'),
('writer-files','talk','发现交付材料遗漏','我重新核对时发现少发了一份附件。我现在补齐，并把本次交付的文件名列在群里，方便你核对。','写手话术');
