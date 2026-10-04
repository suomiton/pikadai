-- Name uniqueness beyond A–Z. NOCASE folds only ASCII letters, so "Äiti" and "äiti" could both join a poll,
-- and so could names that differ only in spacing or invisible characters. The Worker now stores the key
-- `nameKey` in worker/lib/names.ts derives from the name, under a second unique index.
--
-- SQLite's lower() is ASCII-only too, so existing rows get the closest key SQL can compute. The Worker's
-- pre-check therefore derives keys from the stored names instead of trusting this column; the column and
-- its index only close the race between two simultaneous requests. The backfilled keys cannot collide:
-- the NOCASE index already kept the names apart.
--
-- Additive: the NOCASE index stays. Two names equal ignoring ASCII case always share a key, so it never
-- refuses a name the new rule allows, and it still guards rows without a key, such as those an older
-- Worker inserts before the new one is deployed.
ALTER TABLE participants ADD COLUMN name_key TEXT;
UPDATE participants SET name_key = lower(name);
CREATE UNIQUE INDEX idx_participants_event_name_key ON participants (event_id, name_key);
