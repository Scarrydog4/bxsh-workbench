CREATE TABLE forum_posts (
 id text PRIMARY KEY, no text NOT NULL UNIQUE, category text NOT NULL CHECK (category IN ('announcement','feedback','skill','document','showcase')),
 author_id text NOT NULL REFERENCES users(id), title text NOT NULL, body text NOT NULL DEFAULT '' CHECK (char_length(body)<=20000),
 feedback_kind text CHECK (feedback_kind IN ('问题','建议')), status text CHECK (status IN ('待处理','处理中','已解决','暂不处理')),
 private boolean NOT NULL DEFAULT false, pinned boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_activity_at timestamptz NOT NULL DEFAULT now(),
 edited_at timestamptz, deleted_at timestamptz, legacy_feedback_id text UNIQUE,
 CHECK (NOT private OR category='feedback')
);
CREATE INDEX forum_posts_activity_idx ON forum_posts(pinned,last_activity_at,id);
CREATE INDEX forum_posts_author_idx ON forum_posts(author_id);
CREATE TABLE forum_replies (
 id text PRIMARY KEY, post_id text NOT NULL REFERENCES forum_posts(id), author_id text NOT NULL REFERENCES users(id),
 body text NOT NULL DEFAULT '' CHECK (char_length(body)<=20000), created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz, deleted_at timestamptz
);
CREATE INDEX forum_replies_post_idx ON forum_replies(post_id,created_at);
CREATE TABLE forum_reads (post_id text NOT NULL REFERENCES forum_posts(id), user_id text NOT NULL REFERENCES users(id), read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(post_id,user_id));
CREATE TABLE forum_likes (post_id text NOT NULL REFERENCES forum_posts(id), user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(post_id,user_id));
CREATE TABLE dm_threads (
 id text PRIMARY KEY, participant_a text NOT NULL REFERENCES users(id), participant_b text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(participant_a < participant_b), UNIQUE(participant_a,participant_b)
);
CREATE TABLE dm_messages (
 id text PRIMARY KEY, thread_id text NOT NULL REFERENCES dm_threads(id), sender_id text NOT NULL REFERENCES users(id), body text NOT NULL DEFAULT '' CHECK(char_length(body)<=5000),
 created_at timestamptz NOT NULL DEFAULT now(), retracted_at timestamptz
);
CREATE INDEX dm_messages_thread_idx ON dm_messages(thread_id,created_at,id);
CREATE TABLE dm_reads (thread_id text NOT NULL REFERENCES dm_threads(id), user_id text NOT NULL REFERENCES users(id), read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(thread_id,user_id));
CREATE TABLE forum_attachments (
 id text PRIMARY KEY, owner_kind text CHECK(owner_kind IN ('post','reply','dm')), owner_id text,
 uploaded_by text NOT NULL REFERENCES users(id), name text NOT NULL, size bigint NOT NULL CHECK(size>=0 AND size<=524288000), mime text NOT NULL, path text NOT NULL, thumb_path text,
 version text, downloads integer NOT NULL DEFAULT 0, legacy_url text,
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, CHECK((owner_kind IS NULL)=(owner_id IS NULL))
);
CREATE INDEX forum_attachments_owner_idx ON forum_attachments(owner_kind,owner_id);
CREATE TABLE forum_uploads (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), request_id text NOT NULL,
 name text NOT NULL, size bigint NOT NULL CHECK(size>=0 AND size<=524288000), mime text NOT NULL, version text,
 received bigint NOT NULL DEFAULT 0 CHECK(received>=0 AND received<=size), path text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), done_at timestamptz, attachment_id text REFERENCES forum_attachments(id), UNIQUE(user_id,request_id)
);
CREATE TABLE forum_requests (
 actor_id text NOT NULL REFERENCES users(id), request_id text NOT NULL, action text NOT NULL, hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,request_id)
);
-- New permissions belong only to locked administrator roles; stale grants on custom roles are removed.
UPDATE roles SET perms = (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(perms || '["forum.announce","forum.manage","dm.viewAll"]'::jsonb)) WHERE locked;
UPDATE roles SET perms = perms - 'forum.announce' - 'forum.manage' - 'dm.viewAll' WHERE NOT locked;
