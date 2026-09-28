-- Report duplicate keys before enforcing carrier-scoped uniqueness. This
-- migration never deletes or rewrites invoice rows; if violations exist the
-- following unique-index statements fail safely and require operator review.
DO $$
DECLARE
  invoice_duplicates text;
  load_duplicates text;
BEGIN
  SELECT string_agg(format('%s (client_id=%s, invoice_number=%L, rows=%s)',
                           grouped.ids, grouped.client_id, grouped.invoice_number, grouped.row_count),
                    E'\n')
    INTO invoice_duplicates
    FROM (
      SELECT string_agg(id::text, ',' ORDER BY id) AS ids,
             client_id, invoice_number, count(*) AS row_count
        FROM invoices
       WHERE invoice_number IS NOT NULL
       GROUP BY client_id, invoice_number
      HAVING count(*) > 1
    ) AS grouped;

  SELECT string_agg(format('%s (client_id=%s, load_number=%L, rows=%s)',
                           grouped.ids, grouped.client_id, grouped.load_number, grouped.row_count),
                    E'\n')
    INTO load_duplicates
    FROM (
      SELECT string_agg(id::text, ',' ORDER BY id) AS ids,
             client_id, load_number, count(*) AS row_count
        FROM invoices
       WHERE load_number IS NOT NULL
       GROUP BY client_id, load_number
      HAVING count(*) > 1
    ) AS grouped;

  IF invoice_duplicates IS NOT NULL THEN
    RAISE NOTICE 'Existing duplicate invoice numbers (no rows deleted): %', invoice_duplicates;
  END IF;
  IF load_duplicates IS NOT NULL THEN
    RAISE NOTICE 'Existing duplicate load numbers (no rows deleted): %', load_duplicates;
  END IF;
END $$;

-- Keep the legacy global invoice-number constraint intact. These additional
-- carrier/client-scoped indexes also enforce the requested natural keys.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_invoice_number_unique
  ON invoices (client_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_load_number_unique
  ON invoices (client_id, load_number)
  WHERE load_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS carrier_alerts (
  id serial PRIMARY KEY,
  entity_type varchar NOT NULL CHECK (entity_type IN ('carrier', 'broker')),
  entity_id integer NOT NULL,
  severity varchar NOT NULL CHECK (severity IN ('block', 'ack', 'info')),
  title varchar NOT NULL,
  message text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp
);
CREATE INDEX IF NOT EXISTS carrier_alerts_entity_active_idx
  ON carrier_alerts (entity_type, entity_id, active);

CREATE TABLE IF NOT EXISTS invoice_alert_acks (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  alert_code varchar NOT NULL,
  user_id varchar NOT NULL REFERENCES users(id),
  reason text,
  acked_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_alert_acks_invoice_code_idx
  ON invoice_alert_acks (invoice_id, alert_code);

CREATE TABLE IF NOT EXISTS invoice_preflight_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rules jsonb NOT NULL DEFAULT '{
    "DUPLICATE_EXACT": true,
    "DUPLICATE_NEAR": true,
    "CARRIER_DORMANT": true,
    "CARRIER_MANUAL_ALERT": true,
    "BROKER_MANUAL_ALERT": true,
    "BROKER_GRADE_LOW": true,
    "BROKER_CHARGEBACKS": true,
    "AUTHORITY_INACTIVE": true,
    "DOCS_EXPIRED": true,
    "CARRIER_OPEN_CHARGEBACK": true
  }'::jsonb,
  dormant_days integer NOT NULL DEFAULT 45,
  near_amount_tolerance numeric(12,2) NOT NULL DEFAULT 1.00,
  near_service_date_days integer NOT NULL DEFAULT 3,
  updated_by varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Portal submissions do not yet have invoice ids or internal users, so retain
-- their acknowledgements and preflight snapshots against the submission.
CREATE TABLE IF NOT EXISTS carrier_submission_alert_acks (
  id serial PRIMARY KEY,
  submission_id integer NOT NULL REFERENCES carrier_submissions(id) ON DELETE CASCADE,
  portal_user_id integer NOT NULL REFERENCES carrier_portal_users(id),
  alert_code varchar NOT NULL,
  reason text,
  acked_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_submission_alert_acks_submission_code_idx
  ON carrier_submission_alert_acks (submission_id, alert_code);
CREATE INDEX IF NOT EXISTS carrier_submission_alert_acks_portal_user_idx
  ON carrier_submission_alert_acks (portal_user_id);

CREATE TABLE IF NOT EXISTS carrier_submission_preflight_events (
  id serial PRIMARY KEY,
  submission_id integer NOT NULL REFERENCES carrier_submissions(id) ON DELETE CASCADE,
  event_type varchar NOT NULL DEFAULT 'invoice_preflight',
  alerts jsonb NOT NULL,
  acknowledgements jsonb NOT NULL,
  portal_user_id integer REFERENCES carrier_portal_users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_submission_preflight_events_submission_created_idx
  ON carrier_submission_preflight_events (submission_id, created_at);
CREATE INDEX IF NOT EXISTS carrier_submission_preflight_events_portal_user_idx
  ON carrier_submission_preflight_events (portal_user_id);