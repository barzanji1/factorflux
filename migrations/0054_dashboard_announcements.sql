BEGIN;
CREATE TABLE IF NOT EXISTS announcements (
  id serial PRIMARY KEY,
  author_id varchar REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  message text NOT NULL,
  severity varchar NOT NULL,
  status varchar NOT NULL,
  persistent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  expires_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by varchar REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason text,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT announcements_severity_check CHECK (severity IN ('green','amber','red')),
  CONSTRAINT announcements_status_check CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT announcements_expiry_check CHECK (
    (persistent AND expires_at IS NULL) OR (NOT persistent AND expires_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS announcements_feed_idx ON announcements(status, severity, posted_at);
CREATE INDEX IF NOT EXISTS announcements_author_idx ON announcements(author_id, created_at);
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  announcement_id integer NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);
COMMIT;
