ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "payment_reference" varchar;

CREATE SEQUENCE IF NOT EXISTS "funding_receipt_no_seq"
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS "funding_receipts" (
  "id" serial PRIMARY KEY,
  "receipt_no" varchar NOT NULL,
  "invoice_id" integer NOT NULL REFERENCES "invoices"("id"),
  "version" integer NOT NULL,
  "carrier_id" integer NOT NULL REFERENCES "clients"("id"),
  "broker_id" integer REFERENCES "brokers"("id"),
  "invoice_amount" numeric(12, 2) NOT NULL,
  "advance_pct" numeric(7, 2) NOT NULL,
  "fee_amount" numeric(12, 2) NOT NULL,
  "reserve_amount" numeric(12, 2) NOT NULL,
  "net_funded" numeric(12, 2) NOT NULL,
  "payment_method" varchar NOT NULL CHECK ("payment_method" IN ('ach', 'wire', 'check')),
  "payment_reference" varchar,
  "funded_at" timestamp NOT NULL,
  "funded_by_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "s3_key" text NOT NULL,
  "audit_hash" varchar(64) NOT NULL,
  "created_at" timestamp NOT NULL,
  CONSTRAINT "funding_receipts_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "funding_receipts_receipt_no_version_uq"
  ON "funding_receipts" ("receipt_no", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "funding_receipts_invoice_version_uq"
  ON "funding_receipts" ("invoice_id", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "funding_receipts_invoice_initial_uq"
  ON "funding_receipts" ("invoice_id") WHERE "version" = 1;
CREATE INDEX IF NOT EXISTS "funding_receipts_invoice_idx"
  ON "funding_receipts" ("invoice_id", "created_at");
CREATE INDEX IF NOT EXISTS "funding_receipts_receipt_no_idx"
  ON "funding_receipts" ("receipt_no");

CREATE OR REPLACE FUNCTION reject_funding_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'funding_receipts is append-only; % is not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS funding_receipts_immutable_trigger ON "funding_receipts";
CREATE TRIGGER funding_receipts_immutable_trigger
BEFORE UPDATE OR DELETE ON "funding_receipts"
FOR EACH ROW EXECUTE FUNCTION reject_funding_receipt_mutation();