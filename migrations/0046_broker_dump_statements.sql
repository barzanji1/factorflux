ALTER TABLE broker_confirmation_settings
  ADD COLUMN IF NOT EXISTS dump_statement_interval_days integer NOT NULL DEFAULT 10;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='broker_confirmation_settings'::regclass
    AND conname='broker_dump_statement_interval_check') THEN
    ALTER TABLE broker_confirmation_settings ADD CONSTRAINT broker_dump_statement_interval_check
      CHECK (dump_statement_interval_days BETWEEN 1 AND 365);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS broker_dump_statements (
  id varchar PRIMARY KEY,
  broker_id integer NOT NULL REFERENCES brokers(id),
  broker_name text NOT NULL,
  recipient text NOT NULL,
  interval_days integer NOT NULL,
  statement_at timestamp NOT NULL,
  total_balance numeric(14,2) NOT NULL,
  invoice_snapshot jsonb NOT NULL,
  triggers jsonb NOT NULL,
  s3_key text NOT NULL,
  pdf_stored_at timestamp,
  status varchar NOT NULL CHECK (status IN ('sending','sent','failed','uncertain','skipped')),
  attempt_started_at timestamp NOT NULL,
  message_id text,
  error text,
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broker_dump_statements_history_idx ON broker_dump_statements(broker_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS broker_dump_statements_active_idx ON broker_dump_statements(broker_id)
  WHERE status IN ('sending','failed','uncertain');
CREATE TABLE IF NOT EXISTS broker_dump_statement_cursors (
  invoice_id integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  funded_at timestamp NOT NULL,
  last_statement_at timestamp,
  active_statement_id varchar REFERENCES broker_dump_statements(id)
);
