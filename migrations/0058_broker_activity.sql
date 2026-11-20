BEGIN;
CREATE TABLE IF NOT EXISTS broker_notification_preferences (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS broker_activity_actions (
  event_id integer PRIMARY KEY REFERENCES broker_confirmation_events(id) ON DELETE CASCADE,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  broker_id integer REFERENCES brokers(id) ON DELETE SET NULL,
  broker_name varchar NOT NULL,
  client_name varchar NOT NULL,
  invoice_number varchar NOT NULL,
  invoice_amount numeric(12,2) NOT NULL,
  approved_amount numeric(12,2),
  status varchar NOT NULL CHECK(status IN ('confirmed','disputed')),
  method varchar CHECK(method IN ('email','portal')),
  actor varchar NOT NULL,
  sent_at timestamptz,
  acted_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  historical_amount boolean NOT NULL DEFAULT false,
  is_test boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS broker_activity_invoice_event_idx ON broker_activity_actions(invoice_id,event_id DESC);
CREATE INDEX IF NOT EXISTS broker_activity_broker_date_idx ON broker_activity_actions(broker_id,acted_at DESC);
CREATE INDEX IF NOT EXISTS broker_activity_date_idx ON broker_activity_actions(acted_at DESC);
CREATE INDEX IF NOT EXISTS broker_activity_uncaptured_idx ON broker_confirmation_events(id)
 WHERE event IN ('confirmed','disputed');
CREATE TABLE IF NOT EXISTS broker_activity_deliveries (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES broker_activity_actions(event_id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id integer REFERENCES notifications(id) ON DELETE SET NULL,
  email_state varchar NOT NULL DEFAULT 'skipped' CHECK(email_state IN ('queued','sending','sent','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  lease_token uuid,
  last_error_code varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS broker_activity_delivery_queue_idx ON broker_activity_deliveries(email_state,next_attempt_at);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(user_id,read,created_at DESC);
-- Existing history is useful for reports, but cannot reconstruct the original
-- approved amount after a later edit. Label it explicitly; NEVER notify/backfill
-- email or notification deliveries for historical responses.
INSERT INTO broker_activity_actions(event_id,invoice_id,broker_id,broker_name,client_name,invoice_number,
 invoice_amount,approved_amount,status,method,actor,sent_at,acted_at,historical_amount,is_test)
SELECT e.id,i.id,i.broker_id,COALESCE(b.name,'Unknown broker'),COALESCE(c.name,'Unknown client'),i.invoice_number,
 i.amount,CASE WHEN e.event='confirmed' THEN i.amount END,e.event::text,
 CASE WHEN e.actor ~ '\[portal:[0-9]+; broker:[0-9]+\]$' THEN 'portal'
      WHEN e.actor LIKE 'agent:%' OR e.actor IN ('system','scheduler') THEN NULL ELSE 'email' END,
 e.actor,i.confirmation_sent_at AT TIME ZONE 'UTC',e.created_at AT TIME ZONE 'UTC',true,COALESCE(u.is_test_account,false)
FROM broker_confirmation_events e JOIN invoices i ON i.id=e.invoice_id
LEFT JOIN brokers b ON b.id=i.broker_id LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN users u ON u.id=i.submitted_by
WHERE e.event IN ('confirmed','disputed')
ON CONFLICT(event_id) DO NOTHING;
COMMIT;
