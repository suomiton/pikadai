-- Whether the participant row was created by the organiser (the join request carried the admin token).
-- The UI shows an "organiser" pill after that nickname on the answer row and on comments.
ALTER TABLE participants ADD COLUMN is_organiser INTEGER NOT NULL DEFAULT 0;
