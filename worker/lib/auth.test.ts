import { describe, expect, it } from 'vitest';
import type { EventRow, ParticipantRow } from '../db/queries';
import { bearerToken, isAdmin, isParticipantOwner, requireAdmin } from './auth';
import { sha256Hex } from './crypto';
import { HttpError } from './http';

const ADMIN_TOKEN = 'admin-token-value';
const EDIT_TOKEN = 'edit-token-value';

async function fixtures(): Promise<{ event: EventRow; participant: ParticipantRow }> {
  return {
    event: {
      id: 'ev1',
      title: 'Dinner',
      description: '',
      admin_token_hash: await sha256Hex(ADMIN_TOKEN),
      allow_suggestions: 1,
      ticket_nonce: null,
      created_at: 0,
      updated_at: 0,
      expires_at: Date.now() + 60_000,
    },
    participant: {
      id: 'p1',
      event_id: 'ev1',
      nickname: 'Ada',
      edit_token_hash: await sha256Hex(EDIT_TOKEN),
      is_organiser: 0,
      created_at: 0,
      updated_at: 0,
    },
  };
}

describe('bearerToken', () => {
  it('extracts the token from a Bearer header, whatever the case and spacing', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer  abc ')).toBe('abc');
  });

  it('returns null for a missing header, another scheme, or an oversized token', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(`Bearer ${'x'.repeat(129)}`)).toBeNull();
  });
});

describe('isAdmin', () => {
  it('accepts only the token whose hash the event stores', async () => {
    const { event } = await fixtures();
    expect(await isAdmin(ADMIN_TOKEN, event)).toBe(true);
    expect(await isAdmin(EDIT_TOKEN, event)).toBe(false);
    expect(await isAdmin(null, event)).toBe(false);
  });
});

describe('requireAdmin', () => {
  it('resolves for the admin and rejects anyone else with admin_required', async () => {
    const { event } = await fixtures();
    await expect(requireAdmin(ADMIN_TOKEN, event)).resolves.toBeUndefined();
    const rejection = requireAdmin('wrong', event);
    await expect(rejection).rejects.toBeInstanceOf(HttpError);
    await expect(rejection).rejects.toMatchObject({ status: 403, code: 'admin_required' });
  });
});

describe('isParticipantOwner', () => {
  it('accepts only the token whose hash the participant row stores', async () => {
    const { participant } = await fixtures();
    expect(await isParticipantOwner(EDIT_TOKEN, participant)).toBe(true);
    expect(await isParticipantOwner(ADMIN_TOKEN, participant)).toBe(false);
    expect(await isParticipantOwner(null, participant)).toBe(false);
  });
});
