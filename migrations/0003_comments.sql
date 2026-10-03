-- Comments, posted under a participant's nickname. Removing the participant removes their comments;
-- the nickname is read from the participant row, so a rename shows on old comments too.
CREATE TABLE comments (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_comments_event_created ON comments (event_id, created_at);
-- The "one comment per 10 seconds" check reads a participant's newest comment.
CREATE INDEX idx_comments_participant_created ON comments (participant_id, created_at);
