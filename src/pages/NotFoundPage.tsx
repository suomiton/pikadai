import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="card stack">
      <h1>Nothing here</h1>
      <p>That page does not exist. Poll links look like /e/… and are case-sensitive.</p>
      <div className="btn-row">
        <Link to="/" className="btn btn-primary">
          Create a poll
        </Link>
      </div>
    </section>
  );
}
