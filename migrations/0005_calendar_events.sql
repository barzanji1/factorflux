-- Additive calendar storage. IF NOT EXISTS makes this migration replay-safe.
CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" serial PRIMARY KEY,
  "title" varchar NOT NULL,
  "description" text,
  "event_type" varchar NOT NULL DEFAULT 'meeting',
  "status" varchar NOT NULL DEFAULT 'scheduled',
  "color" varchar,
  "start_at" timestamp NOT NULL,
  "end_at" timestamp NOT NULL,
  "all_day" boolean NOT NULL DEFAULT false,
  "recurrence" varchar NOT NULL DEFAULT 'none',
  "recurrence_end_at" timestamp,
  "created_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "assigned_to" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "carrier_id" integer REFERENCES "clients"("id") ON DELETE SET NULL,
  "client_id" integer REFERENCES "clients"("id") ON DELETE SET NULL,
  "broker_id" integer REFERENCES "brokers"("id") ON DELETE SET NULL,
  "invoice_id" integer REFERENCES "invoices"("id") ON DELETE SET NULL,
  "reminder_sent_at" timestamp,
  "last_digest_date" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "calendar_events_assigned_start_idx" ON "calendar_events" ("assigned_to", "start_at");
CREATE INDEX IF NOT EXISTS "calendar_events_range_idx" ON "calendar_events" ("start_at", "recurrence_end_at");
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "event_type" varchar NOT NULL DEFAULT 'meeting';
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "status" varchar NOT NULL DEFAULT 'scheduled';
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "color" varchar;
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "created_by" varchar;
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "carrier_id" integer;
ALTER TABLE "calendar_events" ALTER COLUMN "assigned_to" DROP NOT NULL;
UPDATE "calendar_events" SET "created_by" = "user_id" WHERE "created_by" IS NULL;
ALTER TABLE "calendar_events" ALTER COLUMN "created_by" SET NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_created_by_users_id_fk') THEN
   ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_carrier_id_clients_id_fk') THEN
   ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_carrier_id_clients_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "clients"("id") ON DELETE SET NULL;
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_calendar_digest_unique"
  ON "notifications" ("user_id", "entity_type", "action_url")
  WHERE "entity_type" = 'calendar_digest';
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_calendar_event_occurrence_unique"
  ON "notifications" ("user_id", "entity_type", "action_url")
  WHERE "entity_type" = 'calendar_event';
CREATE SEQUENCE IF NOT EXISTS "notifications_id_seq";
SELECT setval(
  'notifications_id_seq',
  GREATEST(COALESCE((SELECT MAX("id") FROM "notifications"), 0) + 1, 1),
  false
);
ALTER SEQUENCE "notifications_id_seq" OWNED BY "notifications"."id";
ALTER TABLE "notifications" ALTER COLUMN "id" SET DEFAULT nextval('notifications_id_seq');