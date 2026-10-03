/** Hard limits shared by the client (for early feedback) and the Worker (enforced). */
export const LIMITS = {
  titleMax: 100,
  descriptionMax: 500,
  nicknameMax: 32,
  optionsMax: 40,
  participantsMax: 100,
  /** Longest comment, in UTF-16 code units, which is what both the textarea and zod count. */
  commentMax: 512,
  /** Comments per poll; bounds storage and the size of the poll view like the other caps. */
  commentsMax: 200,
  /** A participant may post one comment per this interval. */
  commentIntervalMs: 10_000,
  /** Minimum age of a creation ticket before the Worker accepts it; the client learns it from POST /api/tickets. */
  minCreateDelayMs: 5000,
  /** Tickets older than this are rejected. */
  ticketMaxAgeMs: 15 * 60 * 1000,
  /** A poll is deleted this many days after its last date option. */
  ttlAfterLastDateDays: 30,
  /** A poll with no dates (all removed) is deleted this many days after creation. */
  ttlWithoutDatesDays: 90,
  /** Largest JSON body the API reads; legitimate requests stay under 2 KB. */
  requestBodyMaxBytes: 16 * 1024,
} as const;
