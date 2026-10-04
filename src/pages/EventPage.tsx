import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { LIMITS } from '@shared/limits';
import { AdminPanel } from '../components/AdminPanel';
import { Comments } from '../components/Comments';
import { NameCard } from '../components/NameCard';
import { ShareBox } from '../components/ShareBox';
import { VoteGrid } from '../components/VoteGrid';
import { formatTimestamp } from '../lib/dates';
import { hasAnswered } from '../lib/votes';
import { useAppState, usePollActions } from '../state/AppStateProvider';

export function EventPage() {
  const { id = '' } = useParams();
  const { hash } = useLocation();
  const { openPoll, refresh } = usePollActions();
  const { poll } = useAppState();

  // Also repeat for explicit navigation to another identity in the same poll. Replacing the address
  // bar with a private link does not navigate or reset a draft.
  useEffect(() => {
    void openPoll(id);
  }, [id, hash, openPoll]);

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

  const { event, adminToken, me, error } = current;
  const isAdmin = event.viewer.isAdmin;

  /*
   * The page unfolds in steps for someone answering. First only the Name tile; once they have joined,
   * their own row and the comments; once they have answered a date, everyone's answers, the tallies
   * and the share links. The organiser sees everything from the start, and so does a visitor who can
   * no longer join because the poll is full.
   */
  const mine = me ? event.participants.find((p) => p.id === me.id) : undefined;
  const isFull = event.participants.length >= LIMITS.participantsMax;
  const showAll = isAdmin || (mine !== undefined && hasAnswered(mine)) || (me === null && isFull);
  const joined = me !== null;

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

      {!(me === null && isFull) && <NameCard />}
      {(joined || showAll) && <VoteGrid showAll={showAll} />}
      {(joined || showAll) && <Comments />}
      {showAll && <ShareBox />}
      {adminToken && <AdminPanel />}
    </div>
  );
}
