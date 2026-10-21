BEGIN;
CREATE TABLE IF NOT EXISTS broker_collection_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  mode varchar NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run','live')),
  next_send_at timestamp NOT NULL DEFAULT now(),
  updated_by varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO broker_collection_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS broker_collection_states (
  invoice_id integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1,
  phase varchar NOT NULL DEFAULT 'vp' CHECK (phase IN ('vp','rps','paid','stopped')),
  mode varchar NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run','live')),
  paused boolean NOT NULL DEFAULT false,
  funded_at timestamp NOT NULL, vp_confirmed_at timestamp, paid_at timestamp,
  vp_attempts integer NOT NULL DEFAULT 0, rps_attempts integer NOT NULL DEFAULT 0,
  last_sent_at timestamp, next_action_at timestamp,
  escalated_phase varchar CHECK (escalated_phase IN ('vp','rps')),
  last_error text, updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broker_collection_due_idx ON broker_collection_states(next_action_at);
CREATE TABLE IF NOT EXISTS broker_collection_events (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  generation integer NOT NULL, step varchar NOT NULL, phase varchar NOT NULL, mode varchar NOT NULL,
  outcome varchar NOT NULL, scheduled_at timestamp, occurred_at timestamp NOT NULL DEFAULT now(),
  recipient text, provider_message_id varchar, error text, details jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS broker_collection_event_step_unique ON broker_collection_events(invoice_id,generation,step);
CREATE INDEX IF NOT EXISTS broker_collection_event_invoice_idx ON broker_collection_events(invoice_id,occurred_at);
COMMIT;
