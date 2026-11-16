-- Retain all messages, moderation history and dismissals; legacy headlines are
-- derived on read. New Team Announcements publish immediately for active staff.
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS highlight_color varchar;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.announcements'::regclass
      AND conname = 'announcements_highlight_check'
  ) THEN
    ALTER TABLE public.announcements ADD CONSTRAINT announcements_highlight_check
      CHECK (highlight_color IS NULL OR highlight_color IN ('teal','green','amber','red','blue','purple'));
  END IF;
END $$;
