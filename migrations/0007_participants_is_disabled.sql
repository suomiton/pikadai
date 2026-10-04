-- Whether the organiser has disabled the participant. A disabled row is left out of the poll view for everyone
-- but the organiser and the participant themselves, so its answers no longer count; its comments stay, marked.
-- Additive: an older Worker ignores the column.
ALTER TABLE participants ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0;
