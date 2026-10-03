import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { EventView } from '@shared/types';
import { AdminPanel } from '../components/AdminPanel';
import { ShareBox } from '../components/ShareBox';
import { SuggestDate } from '../components/SuggestDate';
import { VoteGrid } from '../components/VoteGrid';
import { api } from '../lib/api';
import { formatTimestamp } from '../lib/dates';
import { describeError } from '../lib/errors';
import { storage, type ParticipantIdentity } from '../lib/storage';

/**
 * The admin link carries its token in the URL fragment, which browsers never
 * send to the server. On first visit we move it into localStorage and strip it
 * from the address bar so it isn't leaked by copy-paste or screenshots.
 */
function captureAdminTokenFromHash(eventId: string): string | null {
  const match = /(?:^#|[#&])admin=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (!match) return null;
  const token = match[1];
  storage.setAdminToken(eventId, token);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

export function EventPage() {
  const { id = '' } = useParams();
  const [adminToken] = useState<string | null>(() => captureAdminTokenFromHash(id) ?? storage.getAdminToken(id));
  const [me, setMe] = useState<ParticipantIdentity | null>(() => storage.getParticipant(id));
  const [event, setEvent] = useState<EventView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setEvent(await api.getEvent(id, adminToken));
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [id, adminToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Forget a stored identity whose row no longer exists (e.g. removed by the organiser). Judged
  // only against freshly loaded data: right after answering, the identity is set before the
  // re-fetch lands, and the stale participant list must not be allowed to discard it.
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  useEffect(() => {
    const current = meRef.current;
    if (event && current && !event.participants.some((p) => p.id === current.id)) {
      storage.setParticipant(id, null);
      setMe(null);
    }
  }, [event, id]);

  if (loading) {
    return (
      <p className="status">
        Loading
        <span className="dots" aria-hidden="true" />
      </p>
    );
  }

  if (error || !event) {
    return (
      <section className="card stack">
        <h1>Poll unavailable</h1>
        <p>{error ?? 'This poll could not be loaded.'}</p>
        <div className="btn-row">
          <Link to="/" className="btn btn-primary">
            Create a new poll
          </Link>
        </div>
      </section>
    );
  }

  const isAdmin = event.viewer.isAdmin;
  const effectiveAdminToken = isAdmin ? adminToken : null;

  return (
    <div className="stack-lg">
      <header className="event-head">
        <h1>{event.title}</h1>
        {event.description && <p className="event-description">{event.description}</p>}
        <p className="meta">
          Created {formatTimestamp(event.createdAt)} · auto-deletes {formatTimestamp(event.expiresAt)}
          {isAdmin && <span className="tag tag-accent">organiser view</span>}
        </p>
      </header>

      <VoteGrid event={event} me={me} adminToken={effectiveAdminToken} onChanged={load} onIdentityChange={setMe} />
      <SuggestDate event={event} me={me} adminToken={effectiveAdminToken} onChanged={load} />
      <ShareBox eventId={event.id} adminToken={effectiveAdminToken} />
      {effectiveAdminToken && <AdminPanel event={event} adminToken={effectiveAdminToken} onChanged={load} />}
    </div>
  );
}
