BEGIN;
CREATE TABLE IF NOT EXISTS broker_portal_users (
  id serial PRIMARY KEY,
  broker_id integer NOT NULL REFERENCES brokers(id),
  company_name varchar(200) NOT NULL,
  contact_name varchar(150) NOT NULL,
  email varchar(254) NOT NULL UNIQUE CHECK (email=lower(btrim(email))),
  phone varchar(40) NOT NULL,
  password_hash text,
  verified_at timestamptz,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS broker_portal_tokens (
  token_hash varchar(64) PRIMARY KEY,
  portal_user_id integer NOT NULL REFERENCES broker_portal_users(id) ON DELETE CASCADE,
  purpose varchar(20) NOT NULL CHECK (purpose IN ('verify','magic')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broker_portal_tokens_user_idx ON broker_portal_tokens(portal_user_id, purpose);
CREATE TABLE IF NOT EXISTS broker_portal_sessions (
  token_hash varchar(64) PRIMARY KEY,
  portal_user_id integer NOT NULL REFERENCES broker_portal_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broker_portal_sessions_expiry_idx ON broker_portal_sessions(expires_at);
CREATE TABLE IF NOT EXISTS broker_portal_rate_limits (
  id serial PRIMARY KEY,
  bucket varchar(64) NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broker_portal_rate_window_idx ON broker_portal_rate_limits(bucket,requested_at);
CREATE TABLE IF NOT EXISTS broker_portal_notes (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  parent_id integer REFERENCES broker_portal_notes(id),
  portal_user_id integer REFERENCES broker_portal_users(id),
  staff_user_id varchar REFERENCES users(id),
  author_name varchar(200) NOT NULL,
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((portal_user_id IS NOT NULL AND staff_user_id IS NULL)
    OR (portal_user_id IS NULL AND staff_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS broker_portal_notes_invoice_idx ON broker_portal_notes(invoice_id,created_at,id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by_broker_portal_user_id integer
  REFERENCES broker_portal_users(id);
ALTER TABLE documents ALTER COLUMN uploaded_by DROP NOT NULL;
-- Existing staff-uploaded documents remain unchanged. A broker document has a
-- dedicated external author, never an impersonated staff account.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='documents'::regclass
      AND conname='documents_portal_author_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_portal_author_check CHECK (
      uploaded_by IS NOT NULL OR uploaded_by_broker_portal_user_id IS NOT NULL
    );
  END IF;
END $$;
COMMIT;
