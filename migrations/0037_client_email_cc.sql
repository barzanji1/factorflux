ALTER TABLE client_email_logs
  ADD COLUMN IF NOT EXISTS cc_emails text[] NOT NULL DEFAULT '{}'::text[];
