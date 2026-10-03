import type {
  AddOptionInput,
  CreateCommentInput,
  CreateEventInput,
  CreateParticipantInput,
  UpdateEventInput,
  UpdateParticipantInput,
} from '@shared/schemas';
import type {
  ApiError,
  Comment,
  CreateEventResponse,
  CreateParticipantResponse,
  EventOption,
  EventView,
  TicketResponse,
} from '@shared/types';
import type { ParticipantIdentity } from './storage';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Lets the caller abort a request another one has superseded. */
  signal?: AbortSignal;
}

async function request<T>(
  path: string,
  { method = 'GET', body, headers = {}, signal }: RequestOptions = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    let payload: Partial<ApiError> = {};
    try {
      payload = (await res.json()) as ApiError;
    } catch {
      // Non-JSON error body (e.g. an edge 5xx page); fall back to the status text.
    }
    throw new ApiRequestError(
      res.status,
      payload.code ?? 'http_error',
      payload.error ?? res.statusText,
      payload.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Auth {
  adminToken: string | null;
  participant: ParticipantIdentity | null;
}

/**
 * At most one token per request, in the standard `Authorization` header so that
 * Cloudflare's log pipeline redacts it. The admin token wins when both exist,
 * because everything a participant may do the admin may do too.
 */
function authHeaders({ adminToken, participant }: Partial<Auth>): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = adminToken ?? participant?.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (participant) headers['X-Participant-Id'] = participant.id;
  return headers;
}

const eventPath = (id: string) => `/api/events/${encodeURIComponent(id)}`;

export const api = {
  createTicket: () => request<TicketResponse>('/api/tickets', { method: 'POST' }),

  createEvent: (input: CreateEventInput) =>
    request<CreateEventResponse>('/api/events', { method: 'POST', body: input }),

  getEvent: (id: string, adminToken: string | null, signal?: AbortSignal) =>
    request<EventView>(eventPath(id), { headers: authHeaders({ adminToken }), signal }),

  updateEvent: (id: string, input: UpdateEventInput, adminToken: string) =>
    request<void>(eventPath(id), { method: 'PATCH', body: input, headers: authHeaders({ adminToken }) }),

  deleteEvent: (id: string, adminToken: string) =>
    request<void>(eventPath(id), { method: 'DELETE', headers: authHeaders({ adminToken }) }),

  addOption: (id: string, input: AddOptionInput, auth: Auth) =>
    request<EventOption>(`${eventPath(id)}/options`, { method: 'POST', body: input, headers: authHeaders(auth) }),

  deleteOption: (id: string, optionId: string, adminToken: string) =>
    request<void>(`${eventPath(id)}/options/${encodeURIComponent(optionId)}`, {
      method: 'DELETE',
      headers: authHeaders({ adminToken }),
    }),

  addParticipant: (id: string, input: CreateParticipantInput) =>
    request<CreateParticipantResponse>(`${eventPath(id)}/participants`, { method: 'POST', body: input }),

  updateParticipant: (id: string, participantId: string, input: UpdateParticipantInput, auth: Auth) =>
    request<void>(`${eventPath(id)}/participants/${encodeURIComponent(participantId)}`, {
      method: 'PUT',
      body: input,
      headers: authHeaders(auth),
    }),

  deleteParticipant: (id: string, participantId: string, auth: Auth) =>
    request<void>(`${eventPath(id)}/participants/${encodeURIComponent(participantId)}`, {
      method: 'DELETE',
      headers: authHeaders(auth),
    }),

  /** Always as the participant: a comment is posted under a nickname, which the admin token does not have. */
  addComment: (id: string, input: CreateCommentInput, participant: ParticipantIdentity) =>
    request<Comment>(`${eventPath(id)}/comments`, {
      method: 'POST',
      body: input,
      headers: authHeaders({ participant }),
    }),
};
