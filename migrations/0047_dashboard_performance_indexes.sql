-- Additive only: narrow indexes for dashboard lookups; no row changes.
CREATE INDEX IF NOT EXISTS invoices_dashboard_open_owner_idx ON invoices(assigned_to,created_at,id) WHERE status NOT IN ('paid','settled');
CREATE INDEX IF NOT EXISTS invoices_dashboard_last_processed_idx ON invoices(client_id,(coalesce(approved_at,funded_at,submitted_at,created_at))) WHERE status IN ('approved','funded','settled','paid');
CREATE INDEX IF NOT EXISTS clients_dashboard_new_idx ON clients(created_at,id) WHERE status='new_client';
CREATE INDEX IF NOT EXISTS email_log_dashboard_bounced_idx ON email_log(status_updated_at,id) WHERE status='bounced';
CREATE INDEX IF NOT EXISTS event_ledger_dashboard_activity_idx ON event_ledger(created_at,id) WHERE actor_type='user' AND actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_ledger_dashboard_preflight_idx ON event_ledger(entity_id,created_at,id) WHERE entity_type='invoice' AND event_type='invoice_preflight';
CREATE INDEX IF NOT EXISTS documents_dashboard_invoice_idx ON documents(invoice_id);
CREATE INDEX IF NOT EXISTS notifications_dashboard_entity_idx ON notifications(entity_type,entity_id);
CREATE INDEX IF NOT EXISTS tasks_dashboard_due_idx ON tasks(assigned_to,due_date,id) WHERE status<>'completed';
CREATE INDEX IF NOT EXISTS follow_ups_dashboard_due_idx ON follow_ups(client_id,due_date,id) WHERE status<>'completed';
CREATE INDEX IF NOT EXISTS broker_follow_ups_dashboard_invoice_idx ON broker_follow_ups(invoice_id,created_at) WHERE status<>'acknowledged';
CREATE INDEX IF NOT EXISTS broker_follow_up_reminders_dashboard_due_idx ON broker_follow_up_reminders(follow_up_id,scheduled_send_at) WHERE status IN ('scheduled','sending');
CREATE INDEX IF NOT EXISTS doc_extraction_jobs_dashboard_latest_idx ON doc_extraction_jobs(document_id,id);
CREATE INDEX IF NOT EXISTS payment_application_lines_dashboard_invoice_idx ON payment_application_lines(invoice_id);
CREATE INDEX IF NOT EXISTS compliance_runs_dashboard_latest_idx ON compliance_integration_runs(started_at,id) WHERE status IN ('completed','failed');
CREATE INDEX IF NOT EXISTS broker_authority_checks_dashboard_latest_idx ON broker_authority_checks(entity_type,entity_id,checked_at);
CREATE INDEX IF NOT EXISTS carrier_authority_checks_dashboard_latest_idx ON carrier_authority_checks(carrier_id,checked_at);
CREATE INDEX IF NOT EXISTS carrier_portal_users_dashboard_pending_idx ON carrier_portal_users(created_at,id) WHERE status='pending';
