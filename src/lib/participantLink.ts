import type { ParticipantIdentity } from './storage';

/** Keep the edit secret in the fragment: it is never sent in the URL to the server or in referrers. */
export function participantHash(me: ParticipantIdentity, adminToken: string | null = null): string {
  const hash = `#participant=${encodeURIComponent(me.id)}&token=${encodeURIComponent(me.token)}`;
  return adminToken ? `${hash}&admin=${encodeURIComponent(adminToken)}` : hash;
}

export function participantLink(
  origin: string,
  eventId: string,
  me: ParticipantIdentity,
  adminToken: string | null = null,
): string {
  return `${origin}/e/${encodeURIComponent(eventId)}${participantHash(me, adminToken)}`;
}

/** An explicit private link takes precedence over this browser's saved identity, even if malformed. */
export function hasParticipantHash(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.has('participant') || params.has('token');
}

export function parseParticipantHash(hash: string): ParticipantIdentity | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const ids = params.getAll('participant');
  const tokens = params.getAll('token');
  if (
    ids.length !== 1 ||
    tokens.length !== 1 ||
    !/^[A-Za-z0-9_-]{22}$/.test(ids[0]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(tokens[0])
  ) {
    return null;
  }
  return { id: ids[0], token: tokens[0] };
}
