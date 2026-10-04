/**
 * The form two names are compared in when the Worker decides whether one is already taken in a poll.
 * The stored `name` stays as typed; this key goes into `participants.name_key`, which carries the
 * unique index. NFKC folds compatibility spellings (full-width letters, decomposed accents),
 * `toLowerCase` handles case beyond A–Z, which SQLite's NOCASE does not, invisible format characters
 * (zero-width spaces, soft hyphens) are dropped, and any run of whitespace counts as one space.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
