import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { AdminPanel } from '../components/AdminPanel';
import { ShareBox } from '../components/ShareBox';
import { VoteGrid } from '../components/VoteGrid';
import { formatTimestamp } from '../lib/dates';
import { useAppState, usePollActions } from '../state/AppStateProvider';

export function EventPage() {
  const { id = '' } = useParams();
  const { openPoll, refresh } = usePollActions();
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

  if (!current.event) {
    // The first load failed, or the server has since said the poll is deleted or expired. Only the
    // first is worth retrying.
    const error = current.error ?? { message: 'This poll could not be loaded.', gone: false };
    return (
      <section className="card stack">
        <h1>Poll unavailable</h1>
        <p>{error.message}</p>
        <div className="btn-row">
          {!error.gone && (
            <button type="button" className="btn btn-secondary" onClick={() => void refresh(id)}>
              Try again
            </button>
          )}
          <Link to="/" className="btn btn-primary">
            Create a new poll
          </Link>
        </div>
      </section>
    );
  }

  const { event, adminToken, error } = current;
  const isAdmin = event.viewer.isAdmin;

  return (
    <div className="stack-lg">
      <header className="event-head">
        <div className="event-title-row">
          <h1>{event.title}</h1>
          {isAdmin && <span className="tag tag-accent">organiser view</span>}
        </div>
        {event.description && <p className="event-description">{event.description}</p>}
        <p className="meta">
          Created {formatTimestamp(event.createdAt)} · auto-deletes {formatTimestamp(event.expiresAt)}
        </p>
      </header>

      {error && (
        // A re-fetch after a change failed. The poll stays, with whatever drafts are open in it;
        // what is on screen may be behind until the retry succeeds.
        <div className="card refresh-error" role="alert">
          <p>Could not refresh the poll. {error.message}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void refresh(id)}>
            Try again
          </button>
        </div>
      )}

      <VoteGrid />
      <ShareBox />
      {adminToken && <AdminPanel />}
    </div>
  );
}
