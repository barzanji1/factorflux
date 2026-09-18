ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "assigned_processor" varchar;

ALTER TABLE "brokers"
  ADD COLUMN IF NOT EXISTS "assigned_processor" varchar;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_assigned_processor_users_id_fk'
  ) THEN
    ALTER TABLE "clients"
      ADD CONSTRAINT "clients_assigned_processor_users_id_fk"
      FOREIGN KEY ("assigned_processor") REFERENCES "users"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brokers_assigned_processor_users_id_fk'
  ) THEN
    ALTER TABLE "brokers"
      ADD CONSTRAINT "brokers_assigned_processor_users_id_fk"
      FOREIGN KEY ("assigned_processor") REFERENCES "users"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "clients_assigned_processor_idx"
  ON "clients" ("assigned_processor");

CREATE INDEX IF NOT EXISTS "brokers_assigned_processor_idx"
  ON "brokers" ("assigned_processor");