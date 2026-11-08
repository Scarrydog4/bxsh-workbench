ALTER TABLE "audit" ADD COLUMN "note" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "audit" ADD COLUMN "proof" text;
