-- Additive, replay-safe task assignment and progress metadata.
ALTER TABLE "tasks" ALTER COLUMN "assigned_to" DROP NOT NULL;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "created_by" varchar;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "progress" integer NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "progress_updated_at" timestamp;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "progress_updated_by" varchar;
--> statement-breakpoint
UPDATE "tasks" SET "created_by" = "assigned_to" WHERE "created_by" IS NULL AND "assigned_to" IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_progress_updated_by_users_fk"
    FOREIGN KEY ("progress_updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_progress_range_check"
    CHECK ("progress" BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assigned_to_idx" ON "tasks" ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_created_by_idx" ON "tasks" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_progress_updated_by_idx" ON "tasks" ("progress_updated_by");