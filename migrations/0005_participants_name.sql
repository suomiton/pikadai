-- The participant's chosen name was called "nickname"; the model, the API and the UI now say "name".
-- Renaming the column is not additive: the Worker before this change selects `nickname` and would fail
-- against the renamed table, so this migration and the Worker that uses it go out together.
ALTER TABLE participants RENAME COLUMN nickname TO name;
DROP INDEX idx_participants_event_nickname;
CREATE UNIQUE INDEX idx_participants_event_name ON participants (event_id, name COLLATE NOCASE);
