BEGIN;
ALTER TABLE email_broadcasts
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_time_zone varchar(80) NOT NULL DEFAULT 'America/Denver',
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS error text;
CREATE INDEX IF NOT EXISTS email_broadcasts_scheduled_idx ON email_broadcasts(status, scheduled_at);
COMMIT;
