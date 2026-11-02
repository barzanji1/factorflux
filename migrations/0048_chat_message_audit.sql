-- Threads and edited_at already exist. Only add missing audit/soft-delete fields.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS original_text text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_by varchar REFERENCES users(id);
