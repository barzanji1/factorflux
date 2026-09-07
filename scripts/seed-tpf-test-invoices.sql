-- One-time development seed for TPF Test Carrier.
-- Idempotent: invoice numbers are fixed and ON CONFLICT prevents duplicates.
WITH carrier AS (
  SELECT id FROM clients WHERE lower(name) = lower('TPF Test Carrier') LIMIT 1
),
broker AS (
  INSERT INTO debtors (name, email, status, created_at, updated_at)
  SELECT 'TPF Test Broker', 'accounting@tpftestbroker.example', 'active', now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM debtors WHERE lower(name) = lower('TPF Test Broker')
  )
  RETURNING id
),
selected_broker AS (
  SELECT id FROM broker
  UNION ALL
  SELECT id FROM debtors WHERE lower(name) = lower('TPF Test Broker')
  LIMIT 1
),
seed_data (
  invoice_number, load_number, bol_number, amount, status, days_ago,
  payment_type, pickup_location, delivery_location, factoring_stage
) AS (
  VALUES
    ('TPF-SEED-001', 'LOAD-7101', 'BOL-8101',  2500.00, 'submitted',    3, 'ACH',  'Denver, CO',       'Omaha, NE',        'document_intake'),
    ('TPF-SEED-002', 'LOAD-7102', 'BOL-8102',  3875.50, 'under_review', 8, 'Wire', 'Salt Lake City, UT','Boise, ID',        'verification'),
    ('TPF-SEED-003', 'LOAD-7103', 'BOL-8103',  5200.00, 'approved',    13, 'ACH',  'Phoenix, AZ',      'Albuquerque, NM', 'verification'),
    ('TPF-SEED-004', 'LOAD-7104', 'BOL-8104',  6750.75, 'funded',      19, 'Wire', 'Dallas, TX',       'Memphis, TN',     'approval'),
    ('TPF-SEED-005', 'LOAD-7105', 'BOL-8105',  8900.00, 'collected',   24, 'ACH',  'Chicago, IL',      'Nashville, TN',   'payment_receipt'),
    ('TPF-SEED-006', 'LOAD-7106', 'BOL-8106', 11250.25, 'submitted',   31, 'Wire', 'Kansas City, MO',  'Tulsa, OK',       'document_intake'),
    ('TPF-SEED-007', 'LOAD-7107', 'BOL-8107', 13750.00, 'under_review',37, 'ACH',  'Portland, OR',      'Sacramento, CA',  'verification'),
    ('TPF-SEED-008', 'LOAD-7108', 'BOL-8108', 16500.50, 'approved',    43, 'Wire', 'Seattle, WA',      'Spokane, WA',     'verification'),
    ('TPF-SEED-009', 'LOAD-7109', 'BOL-8109', 19875.00, 'funded',      49, 'ACH',  'Houston, TX',      'New Orleans, LA', 'approval'),
    ('TPF-SEED-010', 'LOAD-7110', 'BOL-8110', 22500.75, 'collected',   56, 'Wire', 'Atlanta, GA',      'Charlotte, NC',   'payment_receipt'),
    ('TPF-SEED-011', 'LOAD-7111', 'BOL-8111', 26750.00, 'submitted',   63, 'ACH',  'Indianapolis, IN', 'Columbus, OH',    'document_intake'),
    ('TPF-SEED-012', 'LOAD-7112', 'BOL-8112', 31000.25, 'under_review',69, 'Wire', 'Detroit, MI',      'Cleveland, OH',   'verification'),
    ('TPF-SEED-013', 'LOAD-7113', 'BOL-8113', 35750.00, 'approved',    76, 'ACH',  'Minneapolis, MN',  'Milwaukee, WI',   'verification'),
    ('TPF-SEED-014', 'LOAD-7114', 'BOL-8114', 40250.50, 'funded',      83, 'Wire', 'Los Angeles, CA',  'Las Vegas, NV',   'approval'),
    ('TPF-SEED-015', 'LOAD-7115', 'BOL-8115', 45000.00, 'collected',   89, 'ACH',  'San Antonio, TX',  'El Paso, TX',     'payment_receipt')
),
inserted AS (
  INSERT INTO invoices (
    invoice_number, load_id, client_id, debtor_id, load_number, bol_number, amount,
    currency, invoice_date, due_date, status, payment_type, load_type,
    pickup_location, delivery_location, factoring_stage, submitted_at,
    approved_at, funded_at, created_at, updated_at, notes
  )
  SELECT
    s.invoice_number, NULL, c.id, b.id, s.load_number, s.bol_number, s.amount,
    'USD', now() - make_interval(days => s.days_ago),
    now() - make_interval(days => s.days_ago) + interval '30 days',
    s.status, s.payment_type, 'otr_load', s.pickup_location, s.delivery_location,
    s.factoring_stage,
    CASE WHEN s.status IN ('submitted','under_review','approved','funded','collected')
      THEN now() - make_interval(days => s.days_ago) + interval '1 hour' END,
    CASE WHEN s.status IN ('approved','funded','collected')
      THEN now() - make_interval(days => s.days_ago) + interval '1 day' END,
    CASE WHEN s.status IN ('funded','collected')
      THEN now() - make_interval(days => s.days_ago) + interval '2 days' END,
    now() - make_interval(days => s.days_ago),
    now() - make_interval(days => s.days_ago),
    'One-time realistic freight factoring test seed; no documents required.'
  FROM seed_data s
  CROSS JOIN carrier c
  CROSS JOIN selected_broker b
  ON CONFLICT (invoice_number) DO NOTHING
  RETURNING id
)
SELECT count(*) AS invoices_created FROM inserted;