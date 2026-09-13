-- Additive invoice/carrier load type support. This migration intentionally does
-- not rewrite existing invoice values; unknown legacy values must be reviewed.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "cargo_type" varchar;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invoices"
    WHERE "load_type" IS NOT NULL
      AND "load_type" NOT IN ('otr_load', 'dump_truck_ticket', 'hotshot', 'other')
  ) THEN
    RAISE EXCEPTION 'Cannot add invoice load type constraint: unknown legacy invoices.load_type values exist';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "clients"
    WHERE "cargo_type" IS NOT NULL
      AND "cargo_type" NOT IN ('otr_load', 'dump_truck_ticket', 'hotshot', 'other')
  ) THEN
    RAISE EXCEPTION 'Cannot add cargo type constraint: unknown clients.cargo_type values exist';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_cargo_type_check"
    CHECK ("cargo_type" IS NULL OR "cargo_type" IN ('otr_load', 'dump_truck_ticket', 'hotshot', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_load_type_check"
    CHECK ("load_type" IS NULL OR "load_type" IN ('otr_load', 'dump_truck_ticket', 'hotshot', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;