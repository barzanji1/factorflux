-- Additive, replay-safe broker branch management and invoice broker references.
CREATE TABLE IF NOT EXISTS "broker_branches" (
  "id" serial PRIMARY KEY,
  "broker_id" integer NOT NULL,
  "branch_name" varchar NOT NULL,
  "address" varchar,
  "city" varchar,
  "state" varchar,
  "zip" varchar,
  "phone" varchar,
  "email" varchar,
  "contact_name" varchar,
  "status" varchar NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "broker_branches" ADD CONSTRAINT "broker_branches_broker_id_fk"
    FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "broker_branches" ADD CONSTRAINT "broker_branches_status_check"
    CHECK ("status" IN ('active', 'inactive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "broker_id" integer;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "branch_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_broker_id_fk"
    FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "broker_branches"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broker_branches_broker_id_idx" ON "broker_branches" ("broker_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broker_branches_status_idx" ON "broker_branches" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_broker_id_idx" ON "invoices" ("broker_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_branch_id_idx" ON "invoices" ("branch_id");