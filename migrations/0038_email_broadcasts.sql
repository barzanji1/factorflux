BEGIN;
CREATE TABLE IF NOT EXISTS email_broadcasts (
  id varchar PRIMARY KEY,
  request_id varchar NOT NULL UNIQUE,
  fingerprint varchar NOT NULL,
  recipient_fingerprint varchar NOT NULL,
  subject varchar(200) NOT NULL,
  body text NOT NULL,
  template_name varchar,
  filters jsonb NOT NULL,
  client_ids jsonb,
  created_by varchar NOT NULL,
  created_by_name varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'draft',
  created_at timestamp NOT NULL DEFAULT now(),
  confirmed_at timestamp,
  completed_at timestamp
);
CREATE INDEX IF NOT EXISTS email_broadcasts_queue_idx ON email_broadcasts(status, confirmed_at);
CREATE TABLE IF NOT EXISTS email_broadcast_recipients (
  id serial PRIMARY KEY,
  broadcast_id varchar NOT NULL REFERENCES email_broadcasts(id),
  client_id integer REFERENCES clients(id) ON DELETE SET NULL,
  client_name varchar NOT NULL,
  email varchar,
  status varchar NOT NULL,
  error text,
  provider_message_id varchar,
  sent_at timestamp
);
CREATE INDEX IF NOT EXISTS email_broadcast_recipients_queue_idx ON email_broadcast_recipients(broadcast_id, status, id);
CREATE TABLE IF NOT EXISTS email_broadcast_dispatch (
  id integer PRIMARY KEY CHECK (id = 1),
  next_send_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO email_broadcast_dispatch(id) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
