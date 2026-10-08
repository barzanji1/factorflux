BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS parent_message_id integer;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_parent_message_id_chat_messages_id_fk'
      AND conrelid = 'chat_messages'::regclass
  ) THEN
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_parent_message_id_chat_messages_id_fk
      FOREIGN KEY (parent_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(channel_id, parent_message_id, id);
COMMIT;
