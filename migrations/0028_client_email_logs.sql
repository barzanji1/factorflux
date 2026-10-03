BEGIN;
CREATE TABLE IF NOT EXISTS client_email_logs (
  id serial PRIMARY KEY,
  request_id varchar NOT NULL UNIQUE,
  client_id integer NOT NULL REFERENCES clients(id),
  agent_id varchar REFERENCES users(id) ON DELETE SET NULL,
  agent_name varchar NOT NULL,
  to_email varchar NOT NULL,
  from_email varchar NOT NULL,
  reply_to varchar NOT NULL,
  subject varchar NOT NULL,
  body text NOT NULL,
  status varchar NOT NULL DEFAULT 'pending',
  provider_message_id varchar,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  sent_at timestamp
);
CREATE INDEX IF NOT EXISTS client_email_logs_client_created_idx ON client_email_logs(client_id, created_at);
COMMIT;