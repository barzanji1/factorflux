-- Durable compensation queue for invoice paperwork cleanup.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "s3_cleanup_queue" (
  "id" serial PRIMARY KEY NOT NULL,
  "s3_key" text NOT NULL,
  "reason" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "s3_cleanup_queue_s3_key_unique" ON "s3_cleanup_queue" ("s3_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "s3_cleanup_queue_unresolved_created_idx"
  ON "s3_cleanup_queue" ("resolved_at", "created_at");
--> statement-breakpoint
DROP INDEX IF EXISTS "invoices_search_trgm_idx";
--> statement-breakpoint
CREATE INDEX "invoices_search_trgm_idx" ON "invoices" USING gin ((
  coalesce("invoice_number", '') || ' ' ||
  coalesce("load_number", '') || ' ' ||
  coalesce("code", '') || ' ' ||
  coalesce("branch_name", '') || ' ' ||
  coalesce("bol_number", '') || ' ' ||
  coalesce("status", '')
) gin_trgm_ops);