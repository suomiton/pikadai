import { useId, useMemo } from 'react';
import { formatDate } from '../lib/dates';
import { topDates } from '../lib/votes';
import { usePoll } from '../state/AppStateProvider';

/**
 * The results tile: the three dates most people can make, once enough people have answered. Everyone who
 * can see the whole table sees it too; disabled participants are not counted.
 */
export function Results() {
  const { event } = usePoll();
  const id = useId();
  const scores = useMemo(() => topDates(event.options, event.participants), [event.options, event.participants]);
  const bestYes = scores?.[0]?.yes;

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Results</h2>
      {scores === null ? (
        // "three" is TOP_DATES_MIN_ANSWERS in src/lib/votes.ts.
        <p className="hint">The three most popular dates appear here once three people have answered.</p>
      ) : scores.length === 0 ? (
        <p className="hint">No one has said yes to a date yet.</p>
      ) : (
        <table className="score-table" aria-label="Top dates">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">
                Can join
              </th>
              <th scope="col" className="num">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {scores.map(({ option, yes, total, percent }) => (
              <tr key={option.id} className={yes === bestYes ? 'is-best' : undefined}>
                <th scope="row">
                  {formatDate(option.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </th>
                <td className="num">
                  <strong>{yes}</strong>
                  <span className="muted"> / {total}</span>
                </td>
                <td className="num">{percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
