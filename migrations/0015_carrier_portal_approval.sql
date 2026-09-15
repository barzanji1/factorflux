ALTER TABLE "carrier_portal_users"
  ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "carrier_portal_users"
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "carrier_portal_users"
  ADD COLUMN IF NOT EXISTS "reviewed_by" varchar;
--> statement-breakpoint
ALTER TABLE "carrier_portal_users"
  ADD COLUMN IF NOT EXISTS "phone" varchar;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carrier_portal_users" ADD CONSTRAINT "carrier_portal_users_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;