CREATE TABLE IF NOT EXISTS "invoice_notes" (
  "id" serial PRIMARY KEY,
  "invoice_id" integer NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "invoice_notes_invoice_idx"
  ON "invoice_notes" ("invoice_id", "created_at");

CREATE TABLE IF NOT EXISTS "invoice_chargeback_events" (
  "id" serial PRIMARY KEY,
  "invoice_id" integer NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "event_type" varchar NOT NULL,
  "extension_date" timestamp,
  "reason" text,
  "actor_id" varchar REFERENCES "users"("id"),
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "invoice_chargeback_events_invoice_idx"
  ON "invoice_chargeback_events" ("invoice_id", "created_at");

CREATE TABLE IF NOT EXISTS "invoice_refunds" (
  "id" serial PRIMARY KEY,
  "invoice_id" integer NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "amount" numeric(12, 2) NOT NULL,
  "refund_date" timestamp NOT NULL DEFAULT now(),
  "method" varchar NOT NULL,
  "reference" varchar,
  "notes" text,
  "created_by" varchar NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "invoice_refunds_invoice_idx"
  ON "invoice_refunds" ("invoice_id", "refund_date");

ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "advance_paid_by" varchar REFERENCES "users"("id");