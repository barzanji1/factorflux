-- Additive only. No funding, payout or aging dates are modified.
BEGIN;
DO $$ BEGIN
  CREATE TYPE broker_confirmation_status AS ENUM ('pending', 'sent', 'confirmed', 'disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE broker_confirmation_event_type AS ENUM ('sent', 'opened', 'confirmed', 'disputed', 'reminder_sent', 'escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS broker_confirmation_status broker_confirmation_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS broker_confirmed_at timestamp,
  ADD COLUMN IF NOT EXISTS broker_confirmation_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamp,
  ADD COLUMN IF NOT EXISTS confirmation_reminded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_followup_agent_id varchar REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_broker_confirmation_token_unique ON invoices(broker_confirmation_token);
CREATE INDEX IF NOT EXISTS invoices_confirmation_due_idx ON invoices(funded_at, confirmation_sent_at)
  WHERE broker_confirmation_status IN ('pending', 'sent');

CREATE TABLE IF NOT EXISTS broker_confirmation_events (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  event broker_confirmation_event_type NOT NULL,
  actor varchar NOT NULL,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broker_confirmation_events_invoice_idx
  ON broker_confirmation_events(invoice_id, created_at);
CREATE TABLE IF NOT EXISTS broker_confirmation_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_reminders integer NOT NULL DEFAULT 3 CONSTRAINT broker_confirmation_max_reminders_check CHECK (max_reminders BETWEEN 0 AND 3),
  reminder_days jsonb NOT NULL DEFAULT '[3,7,14]',
  public_base_url varchar NOT NULL,
  updated_by varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
-- URL checked against deployment metadata, never a workspace preview URL.
INSERT INTO broker_confirmation_settings(id, public_base_url)
  VALUES (1, 'https://factorflux.co') ON CONFLICT (id) DO NOTHING;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS confirmation_invoice_id integer REFERENCES invoices(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS confirmation_kind varchar;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_confirmation_invoice_kind_unique
  ON tasks(confirmation_invoice_id, confirmation_kind);

-- Assign existing funded invoices to their processor, never to the funding manager.
UPDATE invoices i SET assigned_followup_agent_id =
  COALESCE(i.assigned_to, i.submitted_by, (SELECT c.assigned_processor FROM clients c WHERE c.id = i.client_id))
WHERE i.funded_at IS NOT NULL AND i.assigned_followup_agent_id IS NULL;
COMMIT;
