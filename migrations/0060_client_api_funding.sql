BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='client_funding_status') THEN
    CREATE TYPE client_funding_status AS ENUM ('received','under_review','funded');
  END IF;
END $$;
ALTER TABLE carrier_portal_users ADD COLUMN IF NOT EXISTS client_contact_name varchar;
ALTER TABLE carrier_portal_users ADD COLUMN IF NOT EXISTS client_email_verified_at timestamptz;
ALTER TABLE carrier_submissions ADD COLUMN IF NOT EXISTS funding_status client_funding_status NOT NULL DEFAULT 'received';
ALTER TABLE carrier_submissions ADD COLUMN IF NOT EXISTS step_1_received_at timestamptz;
-- Preserve original intake time; never manufacture reviewed/funded evidence
-- from the old, manually editable portal status.
UPDATE carrier_submissions SET step_1_received_at=COALESCE(submitted_at,created_at,now()) AT TIME ZONE 'UTC'
 WHERE step_1_received_at IS NULL;
ALTER TABLE carrier_submissions ALTER COLUMN step_1_received_at SET DEFAULT now();
ALTER TABLE carrier_submissions ALTER COLUMN step_1_received_at SET NOT NULL;
ALTER TABLE carrier_submissions ADD COLUMN IF NOT EXISTS step_2_reviewed_at timestamptz;
ALTER TABLE carrier_submissions ADD COLUMN IF NOT EXISTS step_3_funded_at timestamptz;
ALTER TABLE carrier_submissions ADD COLUMN IF NOT EXISTS step_changed_by varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE carrier_submissions ADD COLUMN IF NOT EXISTS funding_invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS carrier_submissions_client_funding_idx ON carrier_submissions(portal_user_id,funding_status,id DESC);
CREATE INDEX IF NOT EXISTS carrier_submissions_funding_invoice_idx ON carrier_submissions(funding_invoice_id);
CREATE TABLE IF NOT EXISTS client_email_verifications (
 token_hash varchar(64) PRIMARY KEY,portal_user_id integer NOT NULL REFERENCES carrier_portal_users(id) ON DELETE CASCADE,
 email varchar NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS client_verifications_user_idx ON client_email_verifications(portal_user_id,created_at);
CREATE TABLE IF NOT EXISTS client_registration_attempts (
 id serial PRIMARY KEY,ip_hash varchar(64) NOT NULL,attempted_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS client_registration_ip_time_idx ON client_registration_attempts(ip_hash,attempted_at);
CREATE TABLE IF NOT EXISTS client_funding_events (
 id serial PRIMARY KEY,submission_id integer NOT NULL REFERENCES carrier_submissions(id) ON DELETE CASCADE,
 from_status client_funding_status NOT NULL,to_status client_funding_status NOT NULL,reason text,
 actor_id varchar REFERENCES users(id) ON DELETE SET NULL,actor_name varchar NOT NULL,changed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS client_funding_events_submission_idx ON client_funding_events(submission_id,id);
CREATE TABLE IF NOT EXISTS client_submission_notes (
 id serial PRIMARY KEY,submission_id integer NOT NULL REFERENCES carrier_submissions(id) ON DELETE CASCADE,
 sender_type varchar NOT NULL CHECK(sender_type IN ('client','staff')),
 portal_user_id integer REFERENCES carrier_portal_users(id) ON DELETE SET NULL,
 staff_user_id varchar REFERENCES users(id) ON DELETE SET NULL,author_name varchar NOT NULL,
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((sender_type='client' AND staff_user_id IS NULL) OR (sender_type='staff' AND portal_user_id IS NULL)));
CREATE INDEX IF NOT EXISTS client_submission_notes_submission_idx ON client_submission_notes(submission_id,id);
CREATE TABLE IF NOT EXISTS client_push_tokens (
 id serial PRIMARY KEY,portal_user_id integer NOT NULL REFERENCES carrier_portal_users(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE,platform varchar NOT NULL CHECK(platform IN ('ios','android','web')),
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS client_push_tokens_user_idx ON client_push_tokens(portal_user_id,active);
CREATE TABLE IF NOT EXISTS client_push_deliveries (
 id serial PRIMARY KEY,dedupe_key varchar NOT NULL UNIQUE,portal_user_id integer NOT NULL REFERENCES carrier_portal_users(id) ON DELETE CASCADE,
 submission_id integer NOT NULL REFERENCES carrier_submissions(id) ON DELETE CASCADE,
 token_id integer NOT NULL REFERENCES client_push_tokens(id) ON DELETE CASCADE,title varchar NOT NULL,body text NOT NULL,
 state varchar NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz,lease_token uuid,last_error_code varchar,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS client_push_delivery_queue_idx ON client_push_deliveries(state,next_attempt_at);
CREATE TABLE IF NOT EXISTS client_upload_intents(
 s3_key text PRIMARY KEY,portal_user_id integer REFERENCES carrier_portal_users(id) ON DELETE SET NULL,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS client_upload_intents_expiry_idx ON client_upload_intents(expires_at);
COMMIT;
