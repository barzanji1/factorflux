BEGIN;
DO $$ BEGIN
  CREATE TYPE email_log_direction AS ENUM ('outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE email_log_status AS ENUM ('sent', 'delivered', 'bounced', 'complained', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS email_log (
  id serial PRIMARY KEY,
  direction email_log_direction NOT NULL DEFAULT 'outbound',
  resend_message_id varchar,
  from_address varchar NOT NULL,
  to_addresses text[] NOT NULL,
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_preview varchar(200) NOT NULL,
  template_name varchar,
  entity_type varchar CHECK (entity_type IN ('invoice','carrier','broker','chargeback','followup')),
  entity_id varchar,
  attachments jsonb NOT NULL DEFAULT '[]',
  status email_log_status NOT NULL DEFAULT 'failed',
  status_updated_at timestamp NOT NULL DEFAULT now(),
  error text,
  sent_by_user_id varchar,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log(created_at,id);
CREATE INDEX IF NOT EXISTS email_log_provider_idx ON email_log(resend_message_id);
CREATE INDEX IF NOT EXISTS email_log_entity_idx ON email_log(entity_type,entity_id);
CREATE INDEX IF NOT EXISTS email_log_sender_idx ON email_log(sent_by_user_id);
CREATE TABLE IF NOT EXISTS email_log_events (
  id serial PRIMARY KEY,
  email_log_id integer REFERENCES email_log(id),
  resend_message_id varchar,
  provider_event_id varchar UNIQUE,
  type varchar NOT NULL,
  status email_log_status,
  notes text,
  occurred_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_events_log_idx ON email_log_events(email_log_id,occurred_at);
CREATE INDEX IF NOT EXISTS email_log_events_provider_idx ON email_log_events(resend_message_id);
CREATE TABLE IF NOT EXISTS email_retry_payloads (
  email_log_id integer PRIMARY KEY REFERENCES email_log(id),
  encrypted_payload text,
  idempotency_key varchar NOT NULL,
  correlation_key varchar(64),
  delivery_context jsonb,
  state varchar NOT NULL CHECK (state IN ('sending','failed','accepted')),
  uncertain boolean NOT NULL DEFAULT true,
  lock_until timestamp,
  retry_of_id integer REFERENCES email_log(id),
  resolved_by_id integer REFERENCES email_log(id),
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE email_retry_payloads ADD COLUMN IF NOT EXISTS correlation_key varchar(64);
ALTER TABLE email_retry_payloads ADD COLUMN IF NOT EXISTS delivery_context jsonb;
CREATE INDEX IF NOT EXISTS email_retry_correlation_idx ON email_retry_payloads(correlation_key);
COMMIT;
