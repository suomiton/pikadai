/** Hard limits shared by the client (for early feedback) and the Worker (enforced). */
export const LIMITS = {
  titleMax: 100,
  descriptionMax: 500,
  nicknameMax: 32,
  optionsMax: 40,
  participantsMax: 100,
  /** Minimum age of a creation ticket before the Worker accepts it. */
  minCreateDelayMs: 5000,
  /** Tickets older than this are rejected. */
  ticketMaxAgeMs: 15 * 60 * 1000,
  /** A poll is deleted this many days after its last date option. */
  ttlAfterLastDateDays: 30,
  /** A poll with no dates (all removed) is deleted this many days after creation. */
  ttlWithoutDatesDays: 90,
} as const;
