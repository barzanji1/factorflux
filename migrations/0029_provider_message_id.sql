-- Provider-neutral acceptance IDs for new mail. Historical tracking data is retained.
ALTER TABLE broker_follow_up_reminders
  ADD COLUMN IF NOT EXISTS provider_message_id text;
