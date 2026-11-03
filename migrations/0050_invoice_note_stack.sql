BEGIN;
ALTER TABLE invoice_notes ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
ALTER TABLE invoice_notes ADD COLUMN IF NOT EXISTS edited_at timestamp;
ALTER TABLE invoice_notes ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE invoice_notes ADD COLUMN IF NOT EXISTS legacy_import boolean NOT NULL DEFAULT false;
-- Old imports without a recorded creator must not be attributed to other staff.
ALTER TABLE invoice_notes ALTER COLUMN created_by DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_notes_legacy_import_unique
  ON invoice_notes(invoice_id) WHERE legacy_import;
INSERT INTO invoice_notes (invoice_id, body, created_by, created_at, updated_at, legacy_import)
SELECT i.id, i.notes, u.id, coalesce(i.created_at, now()), coalesce(i.updated_at, i.created_at, now()), true
FROM invoices i LEFT JOIN users u ON u.id = i.submitted_by
WHERE nullif(trim(i.notes), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM invoice_notes n WHERE n.invoice_id=i.id AND n.body=i.notes)
ON CONFLICT (invoice_id) WHERE legacy_import DO NOTHING;
COMMIT;
