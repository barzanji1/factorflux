BEGIN;

-- Keep this migration safe to re-run, and serialize the collision check with
-- writes to invoices so the decisions below cannot race another backfill.
LOCK TABLE invoices IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE event_ledger, carrier_submissions, documents, doc_reviews,
  doc_field_candidates, doc_extraction_results IN SHARE MODE;

CREATE TABLE IF NOT EXISTS invoice_carrier_reference_backfill_log (
  invoice_id integer PRIMARY KEY,
  source varchar,
  source_row_id integer,
  status varchar NOT NULL,
  reference varchar,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_carrier_reference_backfill_log_status_idx
  ON invoice_carrier_reference_backfill_log (status);

-- Event lookups are scoped to invoice entity rows. IF NOT EXISTS makes this
-- safe where an equivalent index has already been added.
CREATE INDEX IF NOT EXISTS event_ledger_invoice_backfill_lookup_idx
  ON event_ledger (entity_type, entity_id);

CREATE TEMP TABLE _carrier_invoice_reference_backfill_results
ON COMMIT DROP
AS
WITH targets AS (
  SELECT
    i.id AS invoice_id,
    i.client_id,
    i.load_number,
    i.amount,
    i.broker_id
  FROM invoices AS i
  WHERE nullif(btrim(i.carrier_invoice_number), '') IS NULL
),
source_candidates AS (
  -- Only the explicitly named carrier invoice keys are valid here.
  SELECT
    t.invoice_id,
    t.client_id,
    1 AS priority,
    'event_ledger'::varchar AS source,
    el.id AS source_row_id,
    nullif(btrim(ref.value), '') AS reference,
    NULL::numeric AS confidence
  FROM targets AS t
  JOIN event_ledger AS el
    ON el.entity_type = 'invoice'
   AND el.entity_id = t.invoice_id
  CROSS JOIN LATERAL (
    VALUES
      ('carrierInvoiceNumber', el.payload_json ->> 'carrierInvoiceNumber'),
      ('carrier_invoice_number', el.payload_json ->> 'carrier_invoice_number')
  ) AS ref(key_name, value)
  WHERE jsonb_typeof(el.payload_json) = 'object'
    AND jsonb_typeof(el.payload_json -> ref.key_name) IN ('string', 'number')
    AND nullif(btrim(ref.value), '') IS NOT NULL

  UNION ALL

  -- carrier_submissions has no invoice foreign key; only use exact carrier /
  -- load matches, require both amount and broker identifiers on both sides,
  -- and accept only approved/funded submissions.
  SELECT
    t.invoice_id,
    t.client_id,
    3 AS priority,
    'carrier_submission'::varchar AS source,
    cs.id AS source_row_id,
    nullif(btrim(cs.invoice_number), '') AS reference,
    NULL::numeric AS confidence
  FROM targets AS t
  JOIN carrier_submissions AS cs
    ON cs.carrier_id = t.client_id
   AND cs.status IN ('approved', 'funded')
   AND nullif(btrim(cs.load_number), '') IS NOT NULL
   AND nullif(btrim(t.load_number), '') IS NOT NULL
   AND btrim(cs.load_number) = btrim(t.load_number)
   AND t.amount IS NOT NULL
   AND cs.amount IS NOT NULL
   AND t.amount = cs.amount
   AND t.broker_id IS NOT NULL
   AND cs.broker_id IS NOT NULL
   AND t.broker_id = cs.broker_id
  WHERE nullif(btrim(cs.invoice_number), '') IS NOT NULL

  UNION ALL

  SELECT
    t.invoice_id,
    t.client_id,
    2 AS priority,
    'confirmed_doc_review'::varchar AS source,
    dr.id AS source_row_id,
    nullif(btrim(review_ref.reference), '') AS reference,
    NULL::numeric AS confidence
  FROM targets AS t
  JOIN documents AS d
    ON d.invoice_id = t.invoice_id
   AND (d.document_type = 'invoice' OR d.final_document_type = 'invoice')
  JOIN doc_reviews AS dr
    ON dr.document_id = d.id
   AND dr.review_status = 'confirmed'
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN jsonb_typeof(dr.final_fields_json -> 'invoice_number') IN ('string', 'number')
        THEN dr.final_fields_json ->> 'invoice_number'
      WHEN jsonb_typeof(dr.final_fields_json -> 'invoice_number') = 'object'
        AND jsonb_typeof(dr.final_fields_json -> 'invoice_number' -> 'value') IN ('string', 'number')
        THEN dr.final_fields_json -> 'invoice_number' ->> 'value'
      ELSE NULL
    END AS reference
  ) AS review_ref
  WHERE jsonb_typeof(dr.final_fields_json) = 'object'
    AND nullif(btrim(review_ref.reference), '') IS NOT NULL

  UNION ALL

  SELECT
    t.invoice_id,
    t.client_id,
    4 AS priority,
    'doc_field_candidate'::varchar AS source,
    dfc.id AS source_row_id,
    nullif(btrim(coalesce(nullif(dfc.normalized_value, ''), dfc.field_value)), '') AS reference,
    CASE
      WHEN btrim(dfc.confidence_score) ~ '^[+-]?[0-9]+([.][0-9]+)?$'
        THEN btrim(dfc.confidence_score)::numeric
      ELSE NULL::numeric
    END AS confidence
  FROM targets AS t
  JOIN documents AS d
    ON d.invoice_id = t.invoice_id
   AND (d.document_type = 'invoice' OR d.final_document_type = 'invoice')
  JOIN doc_field_candidates AS dfc
    ON dfc.document_id = d.id
   AND dfc.field_name = 'invoice_number'
  WHERE NOT EXISTS (
      SELECT 1
      FROM doc_reviews AS any_review
      WHERE any_review.document_id = d.id
    )
    AND nullif(btrim(coalesce(nullif(dfc.normalized_value, ''), dfc.field_value)), '') IS NOT NULL

  UNION ALL

  -- Extraction results are eligible only when they contain a structured,
  -- explicitly named invoice_number value (never free-text OCR output).
  SELECT
    t.invoice_id,
    t.client_id,
    5 AS priority,
    'doc_extraction_result'::varchar AS source,
    der.id AS source_row_id,
    nullif(btrim(
      CASE
        WHEN jsonb_typeof(der.raw_payload_json -> 'invoice_number') IN ('string', 'number')
          THEN der.raw_payload_json ->> 'invoice_number'
        WHEN jsonb_typeof(der.raw_payload_json -> 'invoice_number') = 'object'
          AND jsonb_typeof(der.raw_payload_json -> 'invoice_number' -> 'value') IN ('string', 'number')
          THEN der.raw_payload_json -> 'invoice_number' ->> 'value'
        WHEN jsonb_typeof(der.raw_payload_json -> 'fields' -> 'invoice_number') IN ('string', 'number')
          THEN der.raw_payload_json -> 'fields' ->> 'invoice_number'
        WHEN jsonb_typeof(der.raw_payload_json -> 'fields' -> 'invoice_number') = 'object'
          AND jsonb_typeof(der.raw_payload_json -> 'fields' -> 'invoice_number' -> 'value') IN ('string', 'number')
          THEN der.raw_payload_json -> 'fields' -> 'invoice_number' ->> 'value'
        ELSE NULL
      END
    ), '') AS reference,
    NULL::numeric AS confidence
  FROM targets AS t
  JOIN documents AS d
    ON d.invoice_id = t.invoice_id
   AND (d.document_type = 'invoice' OR d.final_document_type = 'invoice')
  JOIN doc_extraction_results AS der
    ON der.document_id = d.id
  WHERE NOT EXISTS (
      SELECT 1
      FROM doc_reviews AS any_review
      WHERE any_review.document_id = d.id
    )
    AND nullif(btrim(
    CASE
      WHEN jsonb_typeof(der.raw_payload_json -> 'invoice_number') IN ('string', 'number')
        THEN der.raw_payload_json ->> 'invoice_number'
      WHEN jsonb_typeof(der.raw_payload_json -> 'invoice_number') = 'object'
        AND jsonb_typeof(der.raw_payload_json -> 'invoice_number' -> 'value') IN ('string', 'number')
        THEN der.raw_payload_json -> 'invoice_number' ->> 'value'
      WHEN jsonb_typeof(der.raw_payload_json -> 'fields' -> 'invoice_number') IN ('string', 'number')
        THEN der.raw_payload_json -> 'fields' ->> 'invoice_number'
      WHEN jsonb_typeof(der.raw_payload_json -> 'fields' -> 'invoice_number') = 'object'
        AND jsonb_typeof(der.raw_payload_json -> 'fields' -> 'invoice_number' -> 'value') IN ('string', 'number')
        THEN der.raw_payload_json -> 'fields' -> 'invoice_number' ->> 'value'
      ELSE NULL
    END
  ), '') IS NOT NULL
),
ranked_sources AS (
  SELECT invoice_id, min(priority) AS priority
  FROM source_candidates
  GROUP BY invoice_id
),
top_candidates AS (
  SELECT sc.*
  FROM source_candidates AS sc
  JOIN ranked_sources AS rs
    ON rs.invoice_id = sc.invoice_id
   AND rs.priority = sc.priority
  WHERE sc.priority <> 4
     OR sc.confidence IS NOT DISTINCT FROM (
       SELECT max(sc2.confidence)
       FROM source_candidates AS sc2
       WHERE sc2.invoice_id = sc.invoice_id
         AND sc2.priority = sc.priority
     )
),
resolutions AS (
  SELECT
    tc.invoice_id,
    count(DISTINCT tc.reference) AS distinct_reference_count,
    CASE WHEN count(DISTINCT tc.reference) = 1 THEN min(tc.reference) END AS reference,
    min(tc.source) AS source,
    min(tc.source_row_id) AS source_row_id,
    min(tc.priority) AS priority,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'source', tc.source,
        'source_row_id', tc.source_row_id,
        'reference', tc.reference,
        'confidence', tc.confidence,
        'indirect_match', tc.source = 'carrier_submission'
      )
    ) AS candidate_details
  FROM top_candidates AS tc
  GROUP BY tc.invoice_id
),
all_candidate_sources AS (
  SELECT
    sc.invoice_id,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'priority', sc.priority,
        'source', sc.source,
        'source_row_id', sc.source_row_id,
        'reference', sc.reference,
        'confidence', sc.confidence,
        'indirect_match', sc.source = 'carrier_submission'
      )
    ) AS candidate_details
  FROM source_candidates AS sc
  GROUP BY sc.invoice_id
),
all_reference_counts AS (
  SELECT
    invoice_id,
    count(DISTINCT reference) AS distinct_reference_count
  FROM source_candidates
  GROUP BY invoice_id
),
batch_collisions AS (
  SELECT
    client_id,
    reference,
    count(DISTINCT invoice_id) AS invoice_count
  FROM source_candidates
  GROUP BY client_id, reference
)
SELECT
  t.invoice_id,
  t.client_id,
  r.source,
  CASE
    WHEN r.distinct_reference_count = 1 THEN r.source_row_id
    ELSE NULL
  END AS source_row_id,
  CASE
    WHEN r.invoice_id IS NULL THEN 'no_reference'
    WHEN arc.distinct_reference_count > 1 THEN 'skipped_ambiguous'
    WHEN EXISTS (
      SELECT 1
      FROM invoices AS existing
      WHERE existing.client_id = t.client_id
        AND existing.id <> t.invoice_id
        AND nullif(btrim(existing.carrier_invoice_number), '') = r.reference
    ) THEN 'skipped_conflict'
    WHEN coalesce(bc.invoice_count, 0) > 1 THEN 'skipped_conflict'
    ELSE 'updated'
  END AS status,
  CASE
    WHEN r.distinct_reference_count = 1
      AND arc.distinct_reference_count = 1 THEN r.reference
    ELSE NULL
  END AS reference,
  jsonb_build_object(
    'client_id', t.client_id,
    'priority', r.priority,
    'distinct_reference_count_across_sources', coalesce(arc.distinct_reference_count, 0),
    'candidate_details', coalesce(r.candidate_details, '[]'::jsonb),
    'all_candidate_sources', coalesce(acs.candidate_details, '[]'::jsonb),
    'indirect_match', coalesce(r.source = 'carrier_submission', false),
    'existing_reference_conflict', CASE
      WHEN r.distinct_reference_count = 1
        AND arc.distinct_reference_count = 1 THEN EXISTS (
        SELECT 1
        FROM invoices AS existing
        WHERE existing.client_id = t.client_id
          AND existing.id <> t.invoice_id
          AND nullif(btrim(existing.carrier_invoice_number), '') = r.reference
      )
      ELSE false
    END,
    'existing_conflicting_invoice_ids', coalesce((
      SELECT jsonb_agg(existing.id ORDER BY existing.id)
      FROM invoices AS existing
      WHERE r.distinct_reference_count = 1
        AND arc.distinct_reference_count = 1
        AND existing.client_id = t.client_id
        AND existing.id <> t.invoice_id
        AND nullif(btrim(existing.carrier_invoice_number), '') = r.reference
    ), '[]'::jsonb),
    'batch_reference_conflict', coalesce(bc.invoice_count, 0) > 1,
    'batch_reference_invoice_count', coalesce(bc.invoice_count, 0),
    'batch_conflicting_invoice_ids', coalesce((
      SELECT jsonb_agg(matches.invoice_id ORDER BY matches.invoice_id)
      FROM (
        SELECT DISTINCT sc.invoice_id
        FROM source_candidates AS sc
        WHERE sc.client_id = t.client_id
          AND sc.reference = r.reference
      ) AS matches
      WHERE bc.invoice_count > 1
    ), '[]'::jsonb)
  ) AS details
FROM targets AS t
LEFT JOIN resolutions AS r
  ON r.invoice_id = t.invoice_id
LEFT JOIN all_candidate_sources AS acs
  ON acs.invoice_id = t.invoice_id
LEFT JOIN all_reference_counts AS arc
  ON arc.invoice_id = t.invoice_id
LEFT JOIN batch_collisions AS bc
  ON bc.client_id = t.client_id
 AND bc.reference = r.reference;

-- The result table has at most one row per invoice. Only carrier_invoice_number
-- is written; invoice_number is intentionally never read as a source or changed.
UPDATE invoices AS i
SET carrier_invoice_number = r.reference
FROM _carrier_invoice_reference_backfill_results AS r
WHERE i.id = r.invoice_id
  AND r.status = 'updated';

INSERT INTO invoice_carrier_reference_backfill_log (
  invoice_id,
  source,
  source_row_id,
  status,
  reference,
  details,
  updated_at
)
SELECT
  invoice_id,
  source,
  source_row_id,
  status,
  reference,
  details,
  now()
FROM _carrier_invoice_reference_backfill_results
ON CONFLICT (invoice_id) DO UPDATE
SET source = EXCLUDED.source,
    source_row_id = EXCLUDED.source_row_id,
    status = EXCLUDED.status,
    reference = EXCLUDED.reference,
    details = EXCLUDED.details,
    updated_at = now();

-- Per-status counts, including the invoice/client/reference detail for every
-- collision or ambiguity that was deliberately skipped.
SELECT
  status,
  count(*) AS invoice_count,
  jsonb_agg(
    jsonb_build_object(
      'invoice_id', invoice_id,
      'client_id', client_id,
      'reference', reference,
      'source', source,
      'details', details
    )
    ORDER BY invoice_id
  ) FILTER (WHERE status IN ('skipped_conflict', 'skipped_ambiguous')) AS skipped_details
FROM _carrier_invoice_reference_backfill_results
GROUP BY status
ORDER BY status;

COMMIT;