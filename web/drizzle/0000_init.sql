CREATE TABLE "adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"at" date NOT NULL,
	"by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "after_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"round" integer NOT NULL,
	"reason" text NOT NULL,
	"req" jsonb NOT NULL,
	"shots" jsonb NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"writer_id" text NOT NULL,
	"by" text NOT NULL,
	"done_at" timestamp with time zone,
	"extra" numeric(12, 2) DEFAULT 0 NOT NULL,
	"nudges" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"after_sale_id" text,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text DEFAULT 'application/octet-stream' NOT NULL,
	"path" text NOT NULL,
	"preview" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" text NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text,
	"object_label" text,
	"field" text,
	"from_value" text,
	"to_value" text,
	"field_group" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"name" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"account" text NOT NULL,
	"ok" boolean NOT NULL,
	"reason" text,
	"ip" text,
	"ua" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes_read" (
	"user_id" text NOT NULL,
	"note_id" text NOT NULL,
	CONSTRAINT "notes_read_user_id_note_id_pk" PRIMARY KEY("user_id","note_id")
);
--> statement-breakpoint
CREATE TABLE "options" (
	"key" text PRIMARY KEY NOT NULL,
	"values" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_writers" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pay" numeric(12, 2),
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"title" text NOT NULL,
	"order_date" date NOT NULL,
	"due_date" date,
	"owner_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_no" text DEFAULT '' NOT NULL,
	"wechat_group" text DEFAULT '' NOT NULL,
	"draft_at" timestamp with time zone,
	"type" text DEFAULT '' NOT NULL,
	"base_price" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"commission_rate" double precision NOT NULL,
	"review_flag" text,
	"feishu_record_id" text,
	"feishu_sys_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"date" date NOT NULL,
	"tag" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"by" text NOT NULL,
	"proof" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"preset" boolean DEFAULT false NOT NULL,
	"perms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb NOT NULL,
	"row_scope" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"ua" text
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payee_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"migrated" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"order_id" text NOT NULL,
	"after_sale_id" text,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"received" bigint DEFAULT 0 NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_prefs" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	CONSTRAINT "user_prefs_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"name" text NOT NULL,
	"role_id" text NOT NULL,
	"hue" integer DEFAULT 166 NOT NULL,
	"commission_rate" double precision DEFAULT 0.5 NOT NULL,
	"avatar" text,
	"can_write" boolean DEFAULT false NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sales" ADD CONSTRAINT "after_sales_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sales" ADD CONSTRAINT "after_sales_writer_id_users_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "after_sales" ADD CONSTRAINT "after_sales_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_writers" ADD CONSTRAINT "order_writers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_writers" ADD CONSTRAINT "order_writers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_object_idx" ON "audit" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_name_idx" ON "channels" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_no_idx" ON "orders" USING btree ("no");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_feishu_idx" ON "orders" USING btree ("feishu_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_feishu_sys_idx" ON "orders" USING btree ("feishu_sys_no");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_idx" ON "users" USING btree ("account");