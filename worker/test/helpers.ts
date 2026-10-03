import { env, SELF } from 'cloudflare:test';
import { vi, type Mock } from 'vitest';
import { LIMITS } from '@shared/limits';
import type { CreateEventResponse, CreateParticipantResponse, EventView, TurnstileAction } from '@shared/types';
import { rateLimitKey } from '../lib/ratelimit';
import { issueTicket } from '../lib/tickets';

/** The hostname every request is addressed to; siteverify stubs must echo it to be accepted. */
export const HOST = 'pikadai.test';
export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

let ipCounter = 0;
/** A fresh client address per caller, so rate limits and ticket bindings never cross between tests. */
export function freshIp(): string {
  ipCounter += 1;
  return `203.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

interface CallInit {
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
}

/** A minimal API client bound to one client address. */
export function client(ip = freshIp()) {
  async function call<T = unknown>(method: string, path: string, init: CallInit = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { 'CF-Connecting-IP': ip, ...init.headers };
    let body = init.raw;
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const res = await SELF.fetch(`https://${HOST}${path}`, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }
  return {
    ip,
    call,
    get: <T = unknown>(path: string, headers?: Record<string, string>) => call<T>('GET', path, { headers }),
    post: <T = unknown>(path: string, body: unknown, headers?: Record<string, string>) =>
      call<T>('POST', path, { body, headers }),
    put: <T = unknown>(path: string, body: unknown, headers?: Record<string, string>) =>
      call<T>('PUT', path, { body, headers }),
    patch: <T = unknown>(path: string, body: unknown, headers?: Record<string, string>) =>
      call<T>('PATCH', path, { body, headers }),
    delete: <T = unknown>(path: string, headers?: Record<string, string>) => call<T>('DELETE', path, { headers }),
  };
}
export type Client = ReturnType<typeof client>;

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const asParticipant = (p: CreateParticipantResponse) => ({
  Authorization: `Bearer ${p.editToken}`,
  'X-Participant-Id': p.id,
});

export function futureIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A ticket signed for `ip` the way POST /api/tickets would have, but already old enough to spend. */
export function agedTicket(ip: string, ageMs = LIMITS.minCreateDelayMs + 1000): Promise<string> {
  return issueTicket(env.TICKET_SECRET, rateLimitKey(ip), Date.now() - ageMs);
}

type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/**
 * Stand in for Turnstile: the Worker's one outbound call. Responses are served in
 * order, the last one repeating; anything else outbound fails loudly.
 */
export function stubSiteverify(...responses: Array<Record<string, unknown>>): FetchMock {
  const queue = [...responses];
  const fn: FetchMock = vi.fn(async (input) => {
    const url = urlOf(input);
    if (!url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
      throw new Error(`unexpected outbound fetch: ${url}`);
    }
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return Response.json(next);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Siteverify during an outage: every call answers with a server error. */
export function stubSiteverifyDown(status = 502): FetchMock {
  const fn: FetchMock = vi.fn(async () => new Response('bad gateway', { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** For tests that must prove a request was rejected before Turnstile was contacted. */
export function forbidOutboundFetch(): FetchMock {
  const fn: FetchMock = vi.fn(async (input) => {
    throw new Error(`outbound fetch must not happen here: ${urlOf(input)}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const siteverifyOk = (action: TurnstileAction, hostname = HOST) => ({
  success: true,
  hostname,
  action,
  challenge_ts: new Date().toISOString(),
  'error-codes': [],
});

export interface Draft {
  title: string;
  description: string;
  dates: string[];
  allowSuggestions: boolean;
}

export const draft = (overrides: Partial<Draft> = {}): Draft => ({
  title: 'Test poll',
  description: '',
  dates: [futureIso(10), futureIso(11)],
  allowSuggestions: true,
  ...overrides,
});

export interface Poll extends CreateEventResponse {
  client: Client;
  view: EventView;
}

/** Create a poll the honest way: aged ticket, accepted Turnstile, then read it back. */
export async function createPoll(c: Client = client(), overrides: Partial<Draft> = {}): Promise<Poll> {
  stubSiteverify(siteverifyOk('create'));
  const ticket = await agedTicket(c.ip);
  const res = await c.post<CreateEventResponse>('/api/events', {
    ...draft(overrides),
    ticket,
    turnstileToken: DUMMY_TOKEN,
  });
  if (res.status !== 201) throw new Error(`createPoll failed: ${res.status} ${JSON.stringify(res.body)}`);
  const view = await getView(c, res.body.id);
  return { ...res.body, client: c, view };
}

export async function getView(c: Client, id: string, headers?: Record<string, string>): Promise<EventView> {
  const res = await c.get<EventView>(`/api/events/${id}`, headers);
  if (res.status !== 200) throw new Error(`getView failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function addParticipant(
  c: Client,
  eventId: string,
  name: string,
  votes: Record<string, 'yes' | 'no' | 'maybe'> = {},
): Promise<CreateParticipantResponse> {
  stubSiteverify(siteverifyOk('answer'));
  const res = await c.post<CreateParticipantResponse>(`/api/events/${eventId}/participants`, {
    name,
    votes,
    turnstileToken: DUMMY_TOKEN,
  });
  if (res.status !== 201) throw new Error(`addParticipant failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Insert a bare event row straight into D1, for states the API cannot produce (expired polls, bulk rows). */
export async function insertEventRow(row: { id: string; expires_at: number; created_at?: number }): Promise<void> {
  const now = row.created_at ?? Date.now();
  await env.DB.prepare(
    `INSERT INTO events (id, title, description, admin_token_hash, allow_suggestions, ticket_nonce, created_at, updated_at, expires_at)
     VALUES (?, 'Row', '', 'nohash', 1, NULL, ?, ?, ?)`,
  )
    .bind(row.id, now, now, row.expires_at)
    .run();
}

export async function countRows(
  table: 'events' | 'participants' | 'options' | 'votes' | 'comments',
  eventId?: string,
): Promise<number> {
  const sql =
    table === 'events'
      ? 'SELECT COUNT(*) AS n FROM events WHERE id = ?'
      : table === 'votes'
        ? 'SELECT COUNT(*) AS n FROM votes v JOIN participants p ON p.id = v.participant_id WHERE p.event_id = ?'
        : `SELECT COUNT(*) AS n FROM ${table} WHERE event_id = ?`;
  const row = await env.DB.prepare(sql).bind(eventId).first<{ n: number }>();
  return row?.n ?? 0;
}
