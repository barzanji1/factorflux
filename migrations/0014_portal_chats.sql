CREATE TABLE IF NOT EXISTS "portal_chats" (
  "id" serial PRIMARY KEY NOT NULL,
  "carrier_id" integer NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "portal_user_id" integer NOT NULL REFERENCES "carrier_portal_users"("id") ON DELETE CASCADE,
  "agent_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "carrier_last_read_at" timestamp,
  "agent_last_read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_chats_carrier_portal_user_uidx"
  ON "portal_chats" ("carrier_id", "portal_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_chats_carrier_idx" ON "portal_chats" ("carrier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_chats_portal_user_idx" ON "portal_chats" ("portal_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_chats_agent_idx" ON "portal_chats" ("agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_chat_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "chat_id" integer NOT NULL REFERENCES "portal_chats"("id") ON DELETE CASCADE,
  "sender_type" varchar NOT NULL,
  "sender_id" varchar NOT NULL,
  "message" text,
  "attachment_s3_key" text,
  "attachment_name" varchar,
  "attachment_mime_type" varchar,
  "attachment_size" integer,
  "read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_chat_messages_chat_created_idx"
  ON "portal_chat_messages" ("chat_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_chat_messages_chat_read_idx"
  ON "portal_chat_messages" ("chat_id", "read");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_chat_messages_sender_idx"
  ON "portal_chat_messages" ("sender_type", "sender_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "portal_chat_messages" ADD CONSTRAINT "portal_chat_messages_sender_type_check"
    CHECK ("sender_type" IN ('agent', 'carrier'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "portal_chat_messages" ADD CONSTRAINT "portal_chat_messages_content_check"
    CHECK (length(coalesce(btrim("message"), '')) > 0 OR "attachment_s3_key" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;