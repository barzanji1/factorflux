BEGIN;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lumper_total numeric(10, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS held_for text[] NOT NULL DEFAULT '{}';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS held_recipient_ids text[] NOT NULL DEFAULT '{}';
COMMIT;
