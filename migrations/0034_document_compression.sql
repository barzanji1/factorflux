ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_size integer;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS compressed_size integer;
ALTER TABLE carrier_submission_documents ADD COLUMN IF NOT EXISTS original_size integer;
ALTER TABLE carrier_submission_documents ADD COLUMN IF NOT EXISTS compressed_size integer;
