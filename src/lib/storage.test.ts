import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from './storage';

const fakeLocalStorage = (store = new Map<string, string>()) => {
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    store,
  };
};

describe('storage', () => {
  let ls: ReturnType<typeof fakeLocalStorage>;
  beforeEach(() => {
    ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps admin tokens per poll and removes them on null', () => {
    storage.setAdminToken('poll1', 'tok1');
    storage.setAdminToken('poll2', 'tok2');
    expect(storage.getAdminToken('poll1')).toBe('tok1');
    expect(storage.getAdminToken('poll2')).toBe('tok2');
    storage.setAdminToken('poll1', null);
    expect(storage.getAdminToken('poll1')).toBeNull();
    expect(storage.getAdminToken('poll2')).toBe('tok2');
  });

  it('reports that writes stick and leaves no probe behind', () => {
    expect(storage.available()).toBe(true);
    expect(ls.store.size).toBe(0);
  });

  it('round-trips a participant identity', () => {
    storage.setParticipant('poll1', { id: 'p1', token: 't1' });
    expect(storage.getParticipant('poll1')).toEqual({ id: 'p1', token: 't1' });
    storage.setParticipant('poll1', null);
    expect(storage.getParticipant('poll1')).toBeNull();
  });

  it('treats corrupt or misshapen entries as absent', () => {
    ls.store.set('pikadai:participant:poll1', '{not json');
    expect(storage.getParticipant('poll1')).toBeNull();
    ls.store.set('pikadai:participant:poll1', JSON.stringify({ id: 1, token: 't' }));
    expect(storage.getParticipant('poll1')).toBeNull();
  });

  it('survives a blocked localStorage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => storage.setAdminToken('poll1', 'tok')).not.toThrow();
    expect(storage.getAdminToken('poll1')).toBeNull();
    expect(storage.getParticipant('poll1')).toBeNull();
    expect(storage.available()).toBe(false);
  });
});
