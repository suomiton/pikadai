export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolve once the wall clock reaches `timestampMs`, immediately if it already has. */
export const waitUntil = (timestampMs: number) => sleep(Math.max(0, timestampMs - Date.now()));
