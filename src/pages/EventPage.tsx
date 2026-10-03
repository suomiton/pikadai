import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { AdminPanel } from '../components/AdminPanel';
import { ShareBox } from '../components/ShareBox';
import { VoteGrid } from '../components/VoteGrid';
import { formatTimestamp } from '../lib/dates';
import { useAppState, usePollActions } from '../state/AppStateProvider';

export function EventPage() {
  const { id = '' } = useParams();
  const { openPoll } = usePollActions();
  const { poll } = useAppState();

  // Capturing the admin link, reading storage and the first fetch all happen here, once per route
  // id, so they repeat if the id changes while this page stays mounted. Nothing runs during render.
  useEffect(() => {
    void openPoll(id);
  }, [id, openPoll]);

  // Until the effect has dispatched, the store may still hold another poll or nothing at all.
  const current = poll?.id === id ? poll : null;

  if (!current || (!current.event && !current.error)) {
    return (
      <p className="status">
        Loading
        <span className="dots" aria-hidden="true" />
      </p>
    );
  }

  if (current.error || !current.event) {
    return (
      <section className="card stack">
        <h1>Poll unavailable</h1>
        <p>{current.error?.message ?? 'This poll could not be loaded.'}</p>
        <div className="btn-row">
          <Link to="/" className="btn btn-primary">
            Create a new poll
          </Link>
        </div>
      </section>
    );
  }

  const { event, adminToken } = current;
  const isAdmin = event.viewer.isAdmin;

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

      <VoteGrid />
      <ShareBox />
      {adminToken && <AdminPanel />}
    </div>
  );
}
