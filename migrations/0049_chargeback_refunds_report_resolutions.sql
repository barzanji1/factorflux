BEGIN;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS chargeback_resolution_status varchar;
ALTER TABLE invoices ADD CONSTRAINT invoices_chargeback_resolution_status_check
  CHECK (chargeback_resolution_status IS NULL OR chargeback_resolution_status IN ('open','collected','refunded','written_off'));
ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS approved_by varchar REFERENCES users(id);
ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS idempotency_key uuid UNIQUE;
ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS reserve_credit_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS email_status varchar NOT NULL DEFAULT 'pending';
ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS email_error text;
ALTER TABLE invoice_refunds ADD CONSTRAINT invoice_refunds_reserve_credit_check
  CHECK (reserve_credit_amount >= 0 AND reserve_credit_amount <= amount);
CREATE TABLE IF NOT EXISTS short_pay_resolutions (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  original_short_pay numeric(12,2) NOT NULL CHECK (original_short_pay > 0),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  resolution_date timestamp NOT NULL,
  reference varchar NOT NULL,
  kind varchar NOT NULL CHECK (kind IN ('recovered','written_off')),
  cash_application_id integer REFERENCES cash_applications(id),
  created_by varchar NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS short_pay_resolutions_invoice_idx ON short_pay_resolutions(invoice_id, resolution_date);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_refunds_payment_reference_unique
  ON invoice_refunds(invoice_id,reference) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS short_pay_resolutions_payment_reference_unique
  ON short_pay_resolutions(invoice_id,reference,kind);
COMMIT;
