-- Apply 0058 first, then this migration to the app's external PostgreSQL
-- database BEFORE publishing. Publish does not install functions or triggers.
-- No email is sent here. Notifications and email jobs commit with the response.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Wait for existing response transactions and prevent a gap between the
-- historical catch-up and installation. This does not change their handlers.
LOCK TABLE public.broker_confirmation_events IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.broker_confirmation_events'::regclass
      AND tgname = 'broker_activity_atomic_capture' AND NOT tgisinternal
  ) THEN
    -- Pre-trigger snapshots were reconstructed or captured by an observer.
    -- Do not misrepresent them as guaranteed action-time amounts.
    UPDATE public.broker_activity_actions SET historical_amount = true
    WHERE NOT historical_amount;
  END IF;
END;
$migration$;

-- Catch responses committed since 0058 without replaying historical alerts.
INSERT INTO public.broker_activity_actions(event_id,invoice_id,broker_id,broker_name,client_name,invoice_number,
 invoice_amount,approved_amount,status,method,actor,sent_at,acted_at,historical_amount,is_test)
SELECT e.id,i.id,i.broker_id,COALESCE(b.name,'Unknown broker'),COALESCE(c.name,'Unknown client'),i.invoice_number,
 i.amount,CASE WHEN e.event='confirmed' THEN i.amount END,e.event::text,
 CASE WHEN e.actor ~ '\[portal:[0-9]+; broker:[0-9]+\]$' THEN 'portal'
      WHEN e.actor LIKE 'agent:%' OR e.actor IN ('system','scheduler') THEN NULL ELSE 'email' END,
 e.actor,i.confirmation_sent_at AT TIME ZONE 'UTC',e.created_at AT TIME ZONE 'UTC',true,COALESCE(u.is_test_account,false)
FROM public.broker_confirmation_events e JOIN public.invoices i ON i.id=e.invoice_id
LEFT JOIN public.brokers b ON b.id=i.broker_id LEFT JOIN public.clients c ON c.id=i.client_id
LEFT JOIN public.users u ON u.id=i.submitted_by
WHERE e.event IN ('confirmed','disputed')
ON CONFLICT(event_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.capture_broker_activity_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  action public.broker_activity_actions%ROWTYPE;
  recipient record;
  alert_id integer;
  formatted_amount text;
BEGIN
  -- Serialize the snapshot against edits even for a caller that inserted the
  -- event directly. Normal confirmation handlers already hold this row lock.
  PERFORM 1 FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;

  INSERT INTO public.broker_activity_actions(event_id,invoice_id,broker_id,broker_name,client_name,
    invoice_number,invoice_amount,approved_amount,status,method,actor,sent_at,acted_at,is_test)
  SELECT NEW.id,i.id,i.broker_id,COALESCE(b.name,'Unknown broker'),COALESCE(c.name,'Unknown client'),
    i.invoice_number,i.amount,CASE WHEN NEW.event='confirmed' THEN i.amount END,NEW.event::text,
    CASE WHEN NEW.actor ~ '\[portal:[0-9]+; broker:[0-9]+\]$' THEN 'portal'
         WHEN NEW.actor LIKE 'agent:%' OR NEW.actor IN ('system','scheduler') THEN NULL ELSE 'email' END,
    NEW.actor,i.confirmation_sent_at AT TIME ZONE 'UTC',NEW.created_at AT TIME ZONE 'UTC',
    COALESCE(owner.is_test_account,false)
  FROM public.invoices i LEFT JOIN public.brokers b ON b.id=i.broker_id
    LEFT JOIN public.clients c ON c.id=i.client_id LEFT JOIN public.users owner ON owner.id=i.submitted_by
  WHERE i.id=NEW.invoice_id
  ON CONFLICT(event_id) DO NOTHING
  RETURNING * INTO action;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Retain staff-entered history without claiming it was an Email/Portal
  -- response or sending a false broker-action alert.
  IF action.method IS NULL THEN RETURN NEW; END IF;

  formatted_amount := CASE WHEN action.invoice_amount < 0 THEN '-$' ELSE '$' END
    || to_char(abs(action.invoice_amount), 'FM999,999,999,990.00');
  FOR recipient IN
    INSERT INTO public.broker_activity_deliveries(event_id,user_id,email_state)
    SELECT NEW.id,u.id,CASE WHEN COALESCE(p.email,false) THEN 'queued' ELSE 'skipped' END
    FROM public.users u LEFT JOIN public.broker_notification_preferences p ON p.user_id=u.id
    WHERE u.role IN ('admin','manager') AND u.status='active'
      AND COALESCE(u.is_test_account,false)=action.is_test
    ORDER BY u.id
    ON CONFLICT(event_id,user_id) DO NOTHING
    RETURNING id,user_id
  LOOP
    INSERT INTO public.notifications(user_id,title,message,type,entity_type,entity_id,action_url,metadata)
    SELECT recipient.user_id,'Broker invoice ' || action.status,
      action.broker_name || ' ' || action.status || ' Invoice #' || action.invoice_number || ' for ' || formatted_amount,
      CASE WHEN action.status='confirmed' THEN 'success' ELSE 'warning' END,
      'broker_response',action.invoice_id,'/invoices/' || action.invoice_id,
      json_build_object('brokerActivityEventId',NEW.id,'method',action.method)::text
    WHERE COALESCE((SELECT in_app FROM public.broker_notification_preferences WHERE user_id=recipient.user_id),true)
    RETURNING id INTO alert_id;
    IF FOUND THEN
      UPDATE public.broker_activity_deliveries SET notification_id=alert_id WHERE id=recipient.id;
    END IF;
  END LOOP;
  -- Do not swallow errors: a failed audit/alert write aborts the response too.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER broker_activity_atomic_capture
AFTER INSERT ON public.broker_confirmation_events
FOR EACH ROW WHEN (NEW.event IN ('confirmed','disputed'))
EXECUTE FUNCTION public.capture_broker_activity_response();
COMMIT;
