BEGIN;
CREATE TABLE IF NOT EXISTS entity_notes (
  id serial PRIMARY KEY,
  entity_type varchar NOT NULL CHECK (entity_type IN ('invoice','carrier','broker','document','chargeback','followup','task','submission','load','payout')),
  entity_id integer NOT NULL,
  user_id varchar REFERENCES users(id),
  note_text text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  edited_at timestamp,
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS entity_notes_entity_idx ON entity_notes(entity_type, entity_id);
DO $$
BEGIN
  IF to_regclass('public.invoice_notes') IS NOT NULL THEN
    INSERT INTO entity_notes (id,entity_type,entity_id,user_id,note_text,created_at,updated_at,edited_at,deleted_at)
      SELECT id,'invoice',invoice_id,created_by,body,created_at,updated_at,edited_at,deleted_at
      FROM invoice_notes ON CONFLICT (id) DO NOTHING;
    IF EXISTS (
      SELECT 1 FROM invoice_notes old LEFT JOIN entity_notes n ON n.id=old.id
      WHERE n.id IS NULL OR n.entity_type<>'invoice' OR n.entity_id<>old.invoice_id
        OR n.user_id IS DISTINCT FROM old.created_by OR n.note_text IS DISTINCT FROM old.body
        OR n.created_at IS DISTINCT FROM old.created_at OR n.updated_at IS DISTINCT FROM old.updated_at
        OR n.edited_at IS DISTINCT FROM old.edited_at OR n.deleted_at IS DISTINCT FROM old.deleted_at
    ) THEN RAISE EXCEPTION 'Invoice note migration verification failed; old table retained';
    END IF;
    DROP TABLE invoice_notes;
  END IF;
END $$;
SELECT setval(pg_get_serial_sequence('entity_notes','id'),
  greatest(coalesce((SELECT max(id) FROM entity_notes),0),1),
  EXISTS (SELECT 1 FROM entity_notes));
COMMIT;
