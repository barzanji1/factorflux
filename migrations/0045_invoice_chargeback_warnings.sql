ALTER TABLE broker_confirmation_settings
  ADD COLUMN IF NOT EXISTS chargeback_warning_days integer NOT NULL DEFAULT 80;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'broker_confirmation_settings'::regclass
      AND conname = 'broker_confirmation_warning_days_check') THEN
    ALTER TABLE broker_confirmation_settings
      ADD CONSTRAINT broker_confirmation_warning_days_check
      CHECK (chargeback_warning_days BETWEEN 1 AND 89);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_chargeback_warnings (
  invoice_id integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  threshold_days integer NOT NULL,
  aged_days integer NOT NULL,
  amount_due numeric(12,2) NOT NULL,
  recipient text,
  subject text NOT NULL,
  body text NOT NULL,
  status varchar NOT NULL CHECK (status IN ('sending','sent','failed','uncertain','skipped')),
  message_id text,
  error text,
  task_id integer REFERENCES tasks(id) ON DELETE SET NULL,
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
