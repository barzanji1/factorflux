-- Additive contractor payroll. Existing payroll_entries/deductions are retained.
BEGIN;
CREATE TABLE IF NOT EXISTS contractor_payroll_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  cadence text NOT NULL DEFAULT 'biweekly' CHECK (cadence IN ('weekly','biweekly','monthly','custom')),
  timezone text NOT NULL DEFAULT 'UTC'
);
INSERT INTO contractor_payroll_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS contractor_payroll_rates (
  contractor_id varchar PRIMARY KEY REFERENCES users(id),
  rate_cents integer NOT NULL CHECK (rate_cents > 0 AND rate_cents <= 10000000),
  updated_by varchar NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contractor_payroll_periods (
  id serial PRIMARY KEY,
  start_date date NOT NULL, end_date date NOT NULL,
  timezone text NOT NULL, cadence text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
  created_by varchar NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  locked_by varchar REFERENCES users(id), locked_at timestamptz,
  CHECK (end_date >= start_date AND end_date - start_date < 62),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS contractor_payroll_approvals (
  period_id integer NOT NULL REFERENCES contractor_payroll_periods(id),
  contractor_id varchar NOT NULL REFERENCES users(id),
  minutes integer NOT NULL CHECK (minutes > 0),
  snapshot jsonb NOT NULL,
  approved_by varchar NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, contractor_id)
);
CREATE TABLE IF NOT EXISTS contractor_payroll_statements (
  id serial PRIMARY KEY, statement_number text NOT NULL UNIQUE,
  period_id integer NOT NULL REFERENCES contractor_payroll_periods(id),
  contractor_id varchar NOT NULL REFERENCES users(id), contractor_name text NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL, pay_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0), rate_cents integer NOT NULL CHECK (rate_cents > 0),
  gross_cents bigint NOT NULL CHECK (gross_cents >= 0), ytd_gross_cents bigint NOT NULL CHECK (ytd_gross_cents >= gross_cents),
  snapshot jsonb NOT NULL, pdf_base64 text NOT NULL, pdf_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void')),
  issued_by varchar NOT NULL REFERENCES users(id), issued_at timestamptz NOT NULL DEFAULT now(),
  voided_by varchar REFERENCES users(id), voided_at timestamptz, void_reason text,
  replaces_statement_id integer REFERENCES contractor_payroll_statements(id),
  CHECK ((status='issued' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
      OR (status='void' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(trim(void_reason))>0))
);
CREATE UNIQUE INDEX IF NOT EXISTS contractor_payroll_one_issued_idx
  ON contractor_payroll_statements(period_id,contractor_id) WHERE status='issued';
CREATE INDEX IF NOT EXISTS contractor_payroll_annual_idx ON contractor_payroll_statements(contractor_id,pay_date) WHERE status='issued';
CREATE TABLE IF NOT EXISTS contractor_payroll_audit (
  id serial PRIMARY KEY, action text NOT NULL,
  actor_id varchar NOT NULL REFERENCES users(id), actor_name text NOT NULL,
  details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contractor_payroll_audit_created_idx ON contractor_payroll_audit(created_at,id);
-- Serialize payroll review/locks with ALL time mutations, including old clock routes.
-- Time columns are legacy UTC timestamps without time zone.
CREATE OR REPLACE FUNCTION contractor_payroll_guard_time() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; old_start timestamp; old_end timestamp; new_start timestamp; new_end timestamp;
BEGIN
  PERFORM pg_advisory_xact_lock(710991);
  IF TG_OP <> 'INSERT' THEN
    old_start := OLD.clock_in_time; old_end := COALESCE(OLD.clock_out_time, 'infinity'::timestamp);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_start := NEW.clock_in_time; new_end := COALESCE(NEW.clock_out_time, 'infinity'::timestamp);
  END IF;
  FOR p IN SELECT * FROM contractor_payroll_periods
    WHERE (old_start < ends_at AT TIME ZONE 'UTC'
      AND (old_end > starts_at AT TIME ZONE 'UTC' OR old_end=old_start AND old_start>=starts_at AT TIME ZONE 'UTC'))
       OR (new_start < ends_at AT TIME ZONE 'UTC'
      AND (new_end > starts_at AT TIME ZONE 'UTC' OR new_end=new_start AND new_start>=starts_at AT TIME ZONE 'UTC'))
  LOOP
    IF p.status = 'locked' THEN RAISE EXCEPTION 'Payroll period is locked. An admin must explicitly unlock it before time entries can change.' USING ERRCODE='23514'; END IF;
    DELETE FROM contractor_payroll_approvals WHERE period_id=p.id AND
      (contractor_id=CASE WHEN TG_OP<>'INSERT' THEN OLD.user_id END
       OR contractor_id=CASE WHEN TG_OP<>'DELETE' THEN NEW.user_id END);
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contractor_payroll_time_lock ON time_entries;
CREATE TRIGGER contractor_payroll_time_lock BEFORE INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION contractor_payroll_guard_time();
CREATE OR REPLACE FUNCTION contractor_payroll_immutable_statement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued pay statements cannot be deleted'; END IF;
  IF OLD.status<>'issued' OR NEW.status<>'void'
    OR (to_jsonb(OLD)-ARRAY['status','voided_by','voided_at','void_reason'])
      IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','voided_by','voided_at','void_reason'])
  THEN RAISE EXCEPTION 'Issued pay statements are immutable; void and reissue instead'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contractor_payroll_statement_immutable ON contractor_payroll_statements;
CREATE TRIGGER contractor_payroll_statement_immutable BEFORE UPDATE OR DELETE ON contractor_payroll_statements
  FOR EACH ROW EXECUTE FUNCTION contractor_payroll_immutable_statement();
CREATE OR REPLACE FUNCTION contractor_payroll_immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payroll audit history is append-only'; END $$;
DROP TRIGGER IF EXISTS contractor_payroll_audit_immutable ON contractor_payroll_audit;
CREATE TRIGGER contractor_payroll_audit_immutable BEFORE UPDATE OR DELETE ON contractor_payroll_audit
  FOR EACH ROW EXECUTE FUNCTION contractor_payroll_immutable_audit();
COMMIT;
