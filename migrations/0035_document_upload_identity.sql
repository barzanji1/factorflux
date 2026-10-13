ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_sha256 varchar(64);
CREATE INDEX IF NOT EXISTS documents_pending_upload_identity_idx
ON documents (uploaded_by, source_sha256)
WHERE invoice_id IS NULL AND load_id IS NULL AND source_sha256 IS NOT NULL;
