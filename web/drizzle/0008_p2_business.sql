CREATE TABLE "card_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"by" text NOT NULL,
	"body" text NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "node_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"nodes" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"order_id" text,
	"tab" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"actor_id" text,
	"key" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT '待做' NOT NULL,
	"plan_date" date,
	"done_date" date,
	"owner_id" text,
	"note" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"due_date" date NOT NULL,
	"tag" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_id" text,
	"done_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settle_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"kind" text NOT NULL,
	"payee_id" text NOT NULL,
	"period" date,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"received_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" text
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"channel_id" text NOT NULL,
	"month" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "node_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "req" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "node_id" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_nodes" ADD CONSTRAINT "order_nodes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settle_batches" ADD CONSTRAINT "settle_batches_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_order_idx" ON "comments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_key_idx" ON "notifications" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "order_nodes_order_idx" ON "order_nodes" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settle_batches_no_idx" ON "settle_batches" USING btree ("no");--> statement-breakpoint
CREATE UNIQUE INDEX "settle_batches_period_idx" ON "settle_batches" USING btree ("kind","payee_id","period") WHERE "settle_batches"."period" is not null and "settle_batches"."voided_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_idx" ON "share_links" USING btree ("token_hash");