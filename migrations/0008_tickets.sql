CREATE TABLE IF NOT EXISTS "tickets" (
  "id" serial PRIMARY KEY NOT NULL,
  "ticket_number" varchar NOT NULL UNIQUE,
  "title" varchar NOT NULL,
  "description" text NOT NULL,
  "category" varchar NOT NULL,
  "priority" varchar NOT NULL DEFAULT 'medium',
  "status" varchar NOT NULL DEFAULT 'open',
  "submitted_by" varchar NOT NULL REFERENCES "users"("id"),
  "assigned_to" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "carrier_id" integer REFERENCES "clients"("id") ON DELETE SET NULL,
  "broker_id" integer REFERENCES "brokers"("id") ON DELETE SET NULL,
  "invoice_id" integer REFERENCES "invoices"("id") ON DELETE SET NULL,
  "resolution" text,
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "ticket_id" integer NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "comment" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_status_idx" ON "tickets" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_assigned_to_idx" ON "tickets" ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_submitted_by_idx" ON "tickets" ("submitted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_created_at_idx" ON "tickets" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_comments_ticket_created_idx" ON "ticket_comments" ("ticket_id", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_check"
    CHECK ("category" IN ('billing','technical','carrier','broker','document','payroll','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priority_check"
    CHECK ("priority" IN ('low','medium','high','urgent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_check"
    CHECK ("status" IN ('open','in-progress','pending','resolved','closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_number_check"
    CHECK ("ticket_number" ~ '^TKT-[0-9]{4,}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_resolution_required_check"
    CHECK ("status" NOT IN ('resolved','closed') OR length(btrim(coalesce("resolution", ''))) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_comment_check"
    CHECK (length(btrim("comment")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;