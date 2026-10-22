BEGIN;
CREATE TABLE IF NOT EXISTS client_email_templates (
  id varchar PRIMARY KEY,
  name varchar(100) NOT NULL,
  subject varchar(200) NOT NULL,
  body text NOT NULL,
  created_by varchar NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
COMMIT;
