-- Additive invoice intake fields. This migration is replay-safe and preserves
-- all existing invoice records.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "driver_id" integer;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "code" varchar;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "lumper" boolean;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "instructions_subject" varchar;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "instructions_details" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_driver_id_drivers_id_fk"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_driver_id_idx" ON "invoices" ("driver_id");