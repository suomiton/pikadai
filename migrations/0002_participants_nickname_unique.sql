-- Nickname uniqueness per poll, case-insensitive, enforced by the database.
-- The Worker still checks first so it can return a friendly `nickname_taken`;
-- this index closes the race between two concurrent inserts or renames.
CREATE UNIQUE INDEX idx_participants_event_nickname ON participants (event_id, nickname COLLATE NOCASE);
