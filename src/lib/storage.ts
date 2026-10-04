/**
 * The only client-side state: the secrets that prove "this browser created the
 * poll" or "this browser owns this answer". localStorage is strictly necessary
 * for the service to work, so no consent banner is required, and nothing here
 * identifies a person.
 */
export interface ParticipantIdentity {
  id: string;
  token: string;
}

const PREFIX = 'pikadai';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the user can still use the poll in this tab.
  }
};

export const storage = {
  /**
   * Whether this browser keeps what is written here. False in some private modes and when site data
   * is blocked. Reopening a saved private link still restores access; the UI asks the viewer to
   * save it for reloads or after the tab closes.
   */
  available: (): boolean => {
    try {
      localStorage.setItem(`${PREFIX}:probe`, '1');
      localStorage.removeItem(`${PREFIX}:probe`);
      return true;
    } catch {
      return false;
    }
  },

  getAdminToken: (eventId: string): string | null => read(`${PREFIX}:admin:${eventId}`),
  setAdminToken: (eventId: string, token: string | null): void => write(`${PREFIX}:admin:${eventId}`, token),

  getParticipant: (eventId: string): ParticipantIdentity | null => {
    const raw = read(`${PREFIX}:participant:${eventId}`);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as ParticipantIdentity).id === 'string' &&
        typeof (parsed as ParticipantIdentity).token === 'string'
      ) {
        return parsed as ParticipantIdentity;
      }
    } catch {
      // Corrupt entry; treat as absent.
    }
    return null;
  },
  setParticipant: (eventId: string, identity: ParticipantIdentity | null): void =>
    write(`${PREFIX}:participant:${eventId}`, identity ? JSON.stringify(identity) : null),
};
