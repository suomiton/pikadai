import { test as base, type APIRequestContext, type BrowserContext } from '@playwright/test';

/** A random address in 10/8 so every test is its own rate-limit client and ticket binding. */
export const randomClientIp = () =>
  `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;

export const DUMMY_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export interface CreatedPoll {
  id: string;
  adminToken: string;
  dates: string[];
  participantUrl: string;
  adminUrl: string;
}

/** ISO date `days` from today, in UTC; far enough ahead to be selectable. */
export function futureIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Create a poll through the API, as a browser would: ticket first, then the create
 * request once the ticket is old enough. The dev server's Turnstile test secret
 * accepts the dummy token.
 */
export async function createPollViaApi(
  request: APIRequestContext,
  clientIp: string,
  overrides: Partial<{ title: string; description: string; dates: string[]; allowSuggestions: boolean }> = {},
): Promise<CreatedPoll> {
  const headers = { 'CF-Connecting-IP': clientIp };
  const ticketRes = await request.post('/api/tickets', { headers });
  const { ticket, minAgeMs } = (await ticketRes.json()) as { ticket: string; minAgeMs: number };
  await new Promise((r) => setTimeout(r, minAgeMs + 300));
  const dates = overrides.dates ?? [futureIso(14), futureIso(15), futureIso(16)];
  const res = await request.post('/api/events', {
    headers,
    data: {
      title: 'Board game night',
      description: 'Bring snacks.',
      allowSuggestions: true,
      ...overrides,
      dates,
      ticket,
      turnstileToken: DUMMY_TURNSTILE_TOKEN,
    },
  });
  if (res.status() !== 201) throw new Error(`create failed: ${res.status()} ${await res.text()}`);
  const { id, adminToken } = (await res.json()) as { id: string; adminToken: string };
  return {
    id,
    adminToken,
    dates,
    participantUrl: `/e/${id}`,
    adminUrl: `/e/${id}#admin=${adminToken}`,
  };
}

type Fixtures = {
  clientIp: string;
  /** A second, independent browser with its own storage and client address: another person. */
  otherPerson: BrowserContext;
};

/**
 * Tag requests to the dev server with a client address, the way Cloudflare's edge
 * would. Only the local origin gets the header: third parties such as the Turnstile
 * challenge endpoint must see an ordinary browser request.
 */
async function tagAsClient(context: BrowserContext, ip: string): Promise<void> {
  await context.route(/^http:\/\/localhost:5173\//, (route) =>
    route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }),
  );
}

export const test = base.extend<Fixtures>({
  clientIp: async ({}, use) => {
    await use(randomClientIp());
  },
  context: async ({ context, clientIp }, use) => {
    await tagAsClient(context, clientIp);
    await use(context);
  },
  otherPerson: async ({ browser }, use) => {
    const context = await browser.newContext();
    await tagAsClient(context, randomClientIp());
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
