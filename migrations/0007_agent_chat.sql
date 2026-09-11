CREATE TABLE IF NOT EXISTS "chat_channels" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar,
  "type" varchar NOT NULL,
  "direct_key" varchar UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_channels_type_idx" ON "chat_channels" ("type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_channels_public_name_idx"
  ON "chat_channels" ("type", "name") WHERE "type" = 'channel';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_members" (
  "channel_id" integer NOT NULL REFERENCES "chat_channels"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "joined_at" timestamp DEFAULT now() NOT NULL,
  "last_read_at" timestamp,
  CONSTRAINT "chat_members_pkey" PRIMARY KEY ("channel_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_members_user_idx" ON "chat_members" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "channel_id" integer NOT NULL REFERENCES "chat_channels"("id") ON DELETE CASCADE,
  "sender_id" varchar NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "edited_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_channel_created_idx" ON "chat_messages" ("channel_id", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_type_check"
    CHECK ("type" IN ('channel', 'direct'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_nonempty_check"
    CHECK (length(btrim("body")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
INSERT INTO "chat_channels" ("name", "type")
SELECT seed.name, 'channel'
FROM (VALUES ('general'), ('funding'), ('collections'), ('operations')) AS seed(name)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_channels" c
  WHERE c.type = 'channel' AND c.name = seed.name
);
--> statement-breakpoint
INSERT INTO "user_permissions" ("user_id", "permission", "granted", "updated_by")
SELECT u."id", 'chat', true, 'system'
FROM "users" u
WHERE EXISTS (
  SELECT 1 FROM "user_permissions" existing
  WHERE existing."user_id" = u."id"
)
AND NOT EXISTS (
  SELECT 1 FROM "user_permissions" chat_permission
  WHERE chat_permission."user_id" = u."id"
    AND chat_permission."permission" = 'chat'
);