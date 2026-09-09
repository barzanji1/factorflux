-- Additive Fuel Advance rebuild.  Every statement is safe to replay and
-- deliberately leaves the original legacy columns untouched.
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "type" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "load_number" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "carrier_id" integer;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "broker_id" integer;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "rate" numeric(12,2);
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "fa_percent" numeric(7,4);
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "fees" numeric(12,2);
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "owed" numeric(12,2);
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "payment_method" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "delivery_date" timestamp;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "code" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "reference_number" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "authorized_agent" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "rate_con_s3_key" text;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "rate_con_name" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "rate_con_type" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "delivery_verified" boolean DEFAULT false;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "paid" boolean DEFAULT false;
UPDATE "fuel_advances"
SET "paid" = true
WHERE "status" = 'paid' AND "paid" IS DISTINCT FROM true;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "account" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "deposit_slip_s3_key" text;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "deposit_slip_name" varchar;
ALTER TABLE "fuel_advances" ADD COLUMN IF NOT EXISTS "deposit_slip_type" varchar;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_advances_carrier_id_clients_id_fk') THEN
    ALTER TABLE "fuel_advances" ADD CONSTRAINT "fuel_advances_carrier_id_clients_id_fk"
      FOREIGN KEY ("carrier_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_advances_broker_id_brokers_id_fk') THEN
    ALTER TABLE "fuel_advances" ADD CONSTRAINT "fuel_advances_broker_id_brokers_id_fk"
      FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_advances_authorized_agent_users_id_fk') THEN
    ALTER TABLE "fuel_advances" ADD CONSTRAINT "fuel_advances_authorized_agent_users_id_fk"
      FOREIGN KEY ("authorized_agent") REFERENCES "public"."users"("id") ON DELETE SET NULL;
  END IF;
END $$;