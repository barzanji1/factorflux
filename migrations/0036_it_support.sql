ALTER TABLE users ADD COLUMN IF NOT EXISTS is_it_support boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_single_it_support_idx ON users (is_it_support) WHERE is_it_support = true;
CREATE TABLE IF NOT EXISTS it_support_requests (
  id serial PRIMARY KEY,
  title varchar(200) NOT NULL,
  description text NOT NULL,
  type varchar NOT NULL CHECK (type IN ('bug', 'feature_idea', 'question')),
  priority varchar NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status varchar NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_progress', 'resolved')),
  submitted_by_agent_id varchar NOT NULL REFERENCES users(id),
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS it_support_requests_submitter_idx ON it_support_requests(submitted_by_agent_id);
CREATE INDEX IF NOT EXISTS it_support_requests_status_idx ON it_support_requests(status);
CREATE TABLE IF NOT EXISTS it_support_responses (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES it_support_requests(id) ON DELETE CASCADE,
  author_id varchar NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS it_support_responses_request_idx ON it_support_responses(request_id);
CREATE TABLE IF NOT EXISTS it_support_notifications (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES it_support_requests(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar NOT NULL CHECK (type IN ('it_request_submitted', 'it_request_updated')),
  read boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS it_support_notifications_recipient_idx ON it_support_notifications(user_id,type,read);
