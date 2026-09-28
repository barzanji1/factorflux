-- Remove global invoice-number uniqueness only after the scoped constraints
-- introduced by 0024 have been verified.
DO $$
BEGIN
  IF to_regclass('invoices_client_invoice_number_unique') IS NULL THEN
    RAISE EXCEPTION 'Required index invoices_client_invoice_number_unique is missing; apply 0024_invoice_preflight.sql first';
  END IF;
  IF to_regclass('invoices_client_load_number_unique') IS NULL THEN
    RAISE EXCEPTION 'Required index invoices_client_load_number_unique is missing; apply 0024_invoice_preflight.sql first';
  END IF;
END $$;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_number_unique;

CREATE TABLE IF NOT EXISTS carrier_authority_checks (
  id serial PRIMARY KEY,
  carrier_id integer NOT NULL REFERENCES clients(id),
  mc_number varchar,
  dot_number varchar,
  authority_status varchar CHECK (
    authority_status IS NULL OR authority_status IN ('ACTIVE', 'INACTIVE', 'NOT_AUTHORIZED', 'UNKNOWN')
  ),
  operating_status varchar,
  check_status varchar NOT NULL DEFAULT 'ok' CHECK (check_status IN ('ok', 'error', 'skipped')),
  check_error text,
  checked_at timestamp NOT NULL DEFAULT now(),
  checked_by varchar,
  integration_run_id integer REFERENCES compliance_integration_runs(id),
  raw_response jsonb
);

CREATE INDEX IF NOT EXISTS cac_carrier_id_idx
  ON carrier_authority_checks (carrier_id);
CREATE INDEX IF NOT EXISTS cac_mc_number_idx
  ON carrier_authority_checks (mc_number);
CREATE INDEX IF NOT EXISTS cac_dot_number_idx
  ON carrier_authority_checks (dot_number);
CREATE INDEX IF NOT EXISTS cac_authority_status_idx
  ON carrier_authority_checks (authority_status);
CREATE INDEX IF NOT EXISTS cac_check_status_idx
  ON carrier_authority_checks (check_status);
CREATE INDEX IF NOT EXISTS cac_checked_at_idx
  ON carrier_authority_checks (checked_at);
CREATE INDEX IF NOT EXISTS cac_integration_run_id_idx
  ON carrier_authority_checks (integration_run_id);