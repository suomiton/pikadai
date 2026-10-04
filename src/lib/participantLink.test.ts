import { describe, expect, it } from 'vitest';
import { hasParticipantHash, parseParticipantHash, participantHash, participantLink } from './participantLink';

const me = { id: 'p'.repeat(22), token: 't'.repeat(43) };

describe('private participant links', () => {
  it('round-trips the existing identity and keeps the secret entirely in the fragment', () => {
    const url = new URL(participantLink('https://pikadai.test', 'poll', me));
    expect(url.pathname).toBe('/e/poll');
    expect(url.search).toBe('');
    expect(url.hash).toBe(participantHash(me));
    expect(parseParticipantHash(url.hash)).toEqual(me);
    expect(hasParticipantHash(url.hash)).toBe(true);
  });

  it('includes organiser access in the private link when its verified admin token is supplied', () => {
    const url = new URL(participantLink('https://pikadai.test', 'poll', me, 'admin-token'));
    expect(url.pathname).toBe('/e/poll');
    expect(url.search).toBe('');
    expect(url.hash).toBe(`${participantHash(me)}&admin=admin-token`);
    expect(parseParticipantHash(url.hash)).toEqual(me);
  });

  it('accepts URL-safe tokens and unrelated keys, in any order', () => {
    const identity = { id: '_-'.repeat(11), token: '_-'.repeat(21) + '_' };
    expect(parseParticipantHash(`#token=${identity.token}&admin=admin-token&participant=${identity.id}`)).toEqual(
      identity,
    );
    expect(participantLink('https://pikadai.test', 'poll/path', identity)).toContain('/e/poll%2Fpath#');
  });

  it.each([
    '',
    '#admin=token',
    '#participant=',
    `#participant=${me.id}`,
    `#token=${me.token}`,
    `#participant=short&token=${me.token}`,
    `#participant=${me.id}&token=short`,
    `#participant=${'p'.repeat(23)}&token=${me.token}`,
    `#participant=${me.id}&token=${'t'.repeat(44)}`,
    `#participant=${me.id}&token=${'!'.repeat(43)}`,
    `#participant=${me.id}&token=${'%'.repeat(43)}`,
    `#participant=${'!'.repeat(22)}&token=${me.token}`,
    `#participant=${me.id}&participant=${me.id}&token=${me.token}`,
    `#participant=${me.id}&token=${me.token}&token=${me.token}`,
  ])('rejects a missing, malformed or ambiguous identity: %s', (hash) => {
    expect(parseParticipantHash(hash)).toBeNull();
  });

  it('distinguishes an explicitly broken private link from an ordinary poll or admin link', () => {
    expect(hasParticipantHash('#participant=')).toBe(true);
    expect(hasParticipantHash('#token=')).toBe(true);
    expect(hasParticipantHash('')).toBe(false);
    expect(hasParticipantHash('#admin=token')).toBe(false);
  });
});
