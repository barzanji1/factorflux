-- Run summaries only; do not scan per-entity authority check tables.
-- NULL means historical authority detail was not retained, not zero active.
ALTER TABLE public.compliance_integration_runs
  ADD COLUMN IF NOT EXISTS active_count integer;

UPDATE public.compliance_integration_runs AS run
SET active_count = (
  SELECT count(*)::integer
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(run.detail) = 'array' THEN run.detail ELSE '[]'::jsonb END) AS entry
  WHERE entry->>'outcome' = 'ok' AND entry->>'authorityStatus' = 'ACTIVE'
)
WHERE active_count IS NULL
  AND status IN ('completed', 'failed')
  AND jsonb_typeof(detail) = 'array'
  AND (
    jsonb_array_length(CASE WHEN jsonb_typeof(detail) = 'array' THEN detail ELSE '[]'::jsonb END) > 0
    OR coalesce(success_count, 0) = 0
  )
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(run.detail) = 'array' THEN run.detail ELSE '[]'::jsonb END) AS entry
    WHERE entry->>'outcome' = 'ok' AND NOT (entry ? 'authorityStatus')
  );
