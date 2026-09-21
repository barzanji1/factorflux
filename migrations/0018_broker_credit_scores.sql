ALTER TABLE "brokers"
  ADD COLUMN IF NOT EXISTS "credit_grade" varchar,
  ADD COLUMN IF NOT EXISTS "credit_score" integer;

CREATE TABLE IF NOT EXISTS "broker_credit_scores" (
  "id" serial PRIMARY KEY,
  "broker_id" integer NOT NULL REFERENCES "brokers"("id") ON DELETE RESTRICT,
  "grade" varchar NOT NULL,
  "score" integer NOT NULL,
  "payment_speed_score" integer NOT NULL,
  "payment_reliability_score" integer NOT NULL,
  "chargeback_score" integer NOT NULL,
  "short_pay_score" integer NOT NULL,
  "avg_days_to_payment" integer,
  "total_invoices" integer NOT NULL DEFAULT 0,
  "total_paid" numeric(14,2) NOT NULL DEFAULT 0,
  "total_outstanding" numeric(14,2) NOT NULL DEFAULT 0,
  "total_chargebacks" integer NOT NULL DEFAULT 0,
  "total_short_pays" integer NOT NULL DEFAULT 0,
  "total_disputes" integer NOT NULL DEFAULT 0,
  "late_invoice_count" integer NOT NULL DEFAULT 0,
  "paid_invoice_count" integer NOT NULL DEFAULT 0,
  "last_calculated_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "broker_credit_scores_grade_check" CHECK ("grade" IN ('A', 'B', 'C', 'D', 'F')),
  CONSTRAINT "broker_credit_scores_score_check" CHECK ("score" BETWEEN 0 AND 100),
  CONSTRAINT "broker_credit_scores_payment_speed_check" CHECK ("payment_speed_score" BETWEEN 0 AND 40),
  CONSTRAINT "broker_credit_scores_payment_reliability_check" CHECK ("payment_reliability_score" BETWEEN 0 AND 30),
  CONSTRAINT "broker_credit_scores_chargeback_check" CHECK ("chargeback_score" BETWEEN 0 AND 20),
  CONSTRAINT "broker_credit_scores_short_pay_check" CHECK ("short_pay_score" BETWEEN 0 AND 10)
);
CREATE INDEX IF NOT EXISTS "broker_credit_scores_broker_idx"
  ON "broker_credit_scores" ("broker_id", "last_calculated_at");