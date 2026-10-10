-- Additive provenance tagging; existing broker values remain untouched.
ALTER TABLE brokers ADD COLUMN IF NOT EXISTS data_origin varchar;
