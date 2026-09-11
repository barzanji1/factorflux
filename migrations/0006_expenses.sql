CREATE TABLE IF NOT EXISTS "expenses" (
  "id" serial PRIMARY KEY NOT NULL,
  "submitted_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "title" varchar NOT NULL,
  "category" varchar NOT NULL,
  "merchant" varchar,
  "description" text,
  "payment_method" varchar,
  "notes" text,
  "expense_date" timestamp NOT NULL,
  "status" varchar DEFAULT 'draft' NOT NULL,
  "rejection_reason" text,
  "receipt_key" text,
  "receipt_name" varchar,
  "receipt_mime_type" varchar,
  "receipt_size" integer,
  "approved_by" varchar REFERENCES "users"("id"),
  "approved_at" timestamp,
  "rejected_by" varchar REFERENCES "users"("id"),
  "rejected_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_submitted_by_idx" ON "expenses" ("submitted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_status_idx" ON "expenses" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_date_idx" ON "expenses" ("expense_date");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_status_check"
    CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected', 'reimbursed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive_check"
    CHECK ("amount_cents" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_check"
    CHECK ("category" IN ('fuel', 'office', 'travel', 'meals', 'equipment', 'software', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;