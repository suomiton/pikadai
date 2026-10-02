-- Pikadai schema. All timestamps are unix epoch milliseconds (UTC).
-- Tokens are never stored; only their SHA-256 hex digests are.

CREATE TABLE events (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  admin_token_hash TEXT NOT NULL,
  allow_suggestions INTEGER NOT NULL DEFAULT 1,
  ticket_nonce     TEXT UNIQUE,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);
CREATE INDEX idx_events_expires_at ON events (expires_at);

CREATE TABLE participants (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  nickname        TEXT NOT NULL,
  edit_token_hash TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_participants_event_id ON participants (event_id);

CREATE TABLE options (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  date         TEXT NOT NULL, -- ISO calendar date, YYYY-MM-DD
  suggested_by TEXT REFERENCES participants (id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (event_id, date)
);
CREATE INDEX idx_options_event_id ON options (event_id);

CREATE TABLE votes (
  participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  option_id      TEXT NOT NULL REFERENCES options (id) ON DELETE CASCADE,
  answer         TEXT NOT NULL CHECK (answer IN ('yes', 'no', 'maybe')),
  PRIMARY KEY (participant_id, option_id)
);
CREATE INDEX idx_votes_option_id ON votes (option_id);
