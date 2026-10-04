import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { LIMITS } from '@shared/limits';
import type { EventView } from '@shared/types';
import { AdminPanel } from '../components/AdminPanel';
import { Comments } from '../components/Comments';
import { NameCard } from '../components/NameCard';
import { Results } from '../components/Results';
import { ShareBox } from '../components/ShareBox';
import { VoteGrid } from '../components/VoteGrid';
import { formatTimestamp } from '../lib/dates';
import { hasAnswered } from '../lib/votes';
import { useAppState, usePollActions } from '../state/AppStateProvider';
import type { LoadError } from '../state/app';

const EventHeader = ({ event }: { event: EventView }) => (
  <header className="event-head">
    <div className="event-title-row">
      <h1>{event.title}</h1>
      {event.viewer.isAdmin && <span className="tag tag-accent">organiser view</span>}
    </div>
    {event.description && <p className="event-description">{event.description}</p>}
    <p className="meta">
      Created {formatTimestamp(event.createdAt)} · auto-deletes {formatTimestamp(event.expiresAt)}
    </p>
  </header>
);

const PollUnavailable = ({ error, onRetry }: { error: LoadError; onRetry: () => void }) => (
  <section className="card stack">
    <h1>Poll unavailable</h1>
    <p>{error.message}</p>
    <div className="btn-row">
      {!error.gone && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
      <Link to="/" className="btn btn-primary">
        Create a new poll
      </Link>
    </div>
  </section>
);

export function EventPage() {
  const { id = '' } = useParams();
  const { hash, key } = useLocation();
  const { openPoll, refresh } = usePollActions();
  const { poll } = useAppState();

  // Also repeat for explicit navigation to another identity in the same poll. Replacing the address
  // bar after capturing a private link does not navigate or reset a draft. The router key distinguishes
  // real navigation back to the saved identity from StrictMode's repeated opening effect.
  useEffect(() => {
    void openPoll(id, key, hash);
  }, [id, hash, key, openPoll]);

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
    return <PollUnavailable error={error} onRetry={() => void refresh(id)} />;
  }

  const { event, adminToken, me, error, identityNotice, identityError } = current;
  const isAdmin = event.viewer.isAdmin;

  /*
   * The page unfolds in steps for someone answering. First only the Name tile; once they have joined,
   * their own row and the comments; once they have answered a date, everyone's answers, the tallies,
   * the results and the share links. The organiser sees everything from the start, and so does a visitor who can
   * no longer join because the poll is full.
   */
  const mine = me ? event.participants.find((p) => p.id === me.id) : undefined;
  const isFull = event.participants.length >= LIMITS.participantsMax;
  const showAll =
    isAdmin || identityError !== null || (mine !== undefined && hasAnswered(mine)) || (me === null && isFull);
  const joined = me !== null;

  return (
    <div className="stack-lg">
      <EventHeader event={event} />

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

      {identityNotice && (
        <p className="notice" role="status">
          {identityNotice}
        </p>
      )}
      {identityError && (
        <div className="card refresh-error" role="alert">
          <p>Could not confirm your private link. {identityError}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void refresh(id)}>
            Try again
          </button>
        </div>
      )}
      {!(me === null && isFull) && <NameCard />}
      {(joined || showAll) && <VoteGrid showAll={showAll} />}
      {showAll && <Results />}
      {(joined || showAll) && <Comments />}
      {showAll && <ShareBox />}
      {adminToken && <AdminPanel />}
    </div>
  );
}
