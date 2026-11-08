CREATE INDEX "after_sales_pending_due_idx" ON "after_sales" USING btree ("due") WHERE "after_sales"."done_at" is null and "after_sales"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "audit_object_at_idx" ON "audit" USING btree ("object_id","at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");