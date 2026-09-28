BEGIN;

DO $$
DECLARE
  duplicate_group_count bigint;
  duplicate_details text;
BEGIN
  SELECT count(*)
  INTO duplicate_group_count
  FROM (
    SELECT invoice_number
    FROM invoices
    GROUP BY invoice_number
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_group_count > 0 THEN
    SELECT string_agg(
      format('%L (count=%s, invoice_ids=[%s])', invoice_number, duplicate_count, invoice_ids),
      E'\n'
      ORDER BY invoice_number
    )
    INTO duplicate_details
    FROM (
      SELECT
        invoice_number,
        count(*) AS duplicate_count,
        string_agg(id::text, ', ' ORDER BY id) AS invoice_ids
      FROM invoices
      GROUP BY invoice_number
      HAVING count(*) > 1
      ORDER BY invoice_number
      LIMIT 25
    ) AS duplicate_values;

    RAISE EXCEPTION
      'Cannot restore global invoice_number uniqueness: found % duplicate invoice_number value(s)',
      duplicate_group_count
      USING DETAIL = duplicate_details;
  END IF;
END
$$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS carrier_invoice_number varchar;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_carrier_invoice_number_unique
  ON invoices (client_id, carrier_invoice_number)
  WHERE carrier_invoice_number IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('invoices_client_carrier_invoice_number_unique') IS NULL THEN
    RAISE EXCEPTION 'Required index invoices_client_carrier_invoice_number_unique was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'invoices'::regclass
      AND conname = 'invoices_invoice_number_unique'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_invoice_number_unique UNIQUE (invoice_number);
  END IF;
END
$$;

DROP INDEX IF EXISTS invoices_client_invoice_number_unique;

CREATE SEQUENCE IF NOT EXISTS invoices_internal_number_seq
  AS bigint
  START WITH 1;

DO $$
DECLARE
  too_large_invoice_number text;
  max_existing_number numeric;
  sequence_last_value bigint;
  sequence_is_called boolean;
BEGIN
  SELECT invoice_number
  INTO too_large_invoice_number
  FROM invoices
  WHERE invoice_number ~ '^INV[0-9]+$'
    AND (
      length(coalesce(nullif(ltrim(substring(invoice_number FROM 4), '0'), ''), '0')) > 19
      OR (
        length(coalesce(nullif(ltrim(substring(invoice_number FROM 4), '0'), ''), '0')) = 19
        AND coalesce(nullif(ltrim(substring(invoice_number FROM 4), '0'), ''), '0') >= '9223372036854775807'
      )
    )
  ORDER BY length(substring(invoice_number FROM 4)) DESC
  LIMIT 1;

  IF too_large_invoice_number IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot seed invoices_internal_number_seq: invoice_number % cannot be followed within the bigint sequence range',
      too_large_invoice_number
      USING DETAIL = 'Only strictly formatted INV followed by digits are considered; this value is too large to seed a strictly greater next value.';
  END IF;

  SELECT max(
    coalesce(nullif(ltrim(substring(invoice_number FROM 4), '0'), ''), '0')::numeric
  )
  INTO max_existing_number
  FROM invoices
  WHERE invoice_number ~ '^INV[0-9]+$';

  IF max_existing_number > 0 THEN
    SELECT last_value, is_called
    INTO sequence_last_value, sequence_is_called
    FROM invoices_internal_number_seq;

    IF sequence_last_value::numeric < max_existing_number
      OR (sequence_last_value::numeric = max_existing_number AND NOT sequence_is_called) THEN
      PERFORM setval(
        'invoices_internal_number_seq'::regclass,
        max_existing_number::bigint,
        true
      );
    END IF;
  END IF;
END
$$;

COMMIT;