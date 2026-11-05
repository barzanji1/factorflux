BEGIN;

-- Preserve all existing IDs. Block concurrent inserts while installing and
-- positioning the sequence so the next generated ID cannot collide.
LOCK TABLE public.time_entries IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE IF NOT EXISTS public.time_entries_id_seq;
ALTER SEQUENCE public.time_entries_id_seq OWNED BY public.time_entries.id;

SELECT setval(
  'public.time_entries_id_seq',
  GREATEST(
    COALESCE((SELECT MAX(id)::bigint FROM public.time_entries), 0) + 1,
    (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END
     FROM public.time_entries_id_seq)
  ),
  false
);

ALTER TABLE public.time_entries
  ALTER COLUMN id SET DEFAULT nextval('public.time_entries_id_seq'::regclass);

COMMIT;
