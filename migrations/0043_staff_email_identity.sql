-- Preserve existing email spelling/passwords; enforce normalized uniqueness.
-- Existing normalized duplicates must be resolved explicitly, never merged.
CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_email_unique
ON users (lower(btrim(email)))
WHERE email IS NOT NULL AND btrim(email) <> '';
