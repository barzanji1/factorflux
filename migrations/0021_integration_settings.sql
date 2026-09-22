CREATE TABLE IF NOT EXISTS "integration_settings" (
  "key" varchar PRIMARY KEY NOT NULL,
  "encrypted_value" text NOT NULL,
  "updated_by" varchar,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "integration_settings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null
);