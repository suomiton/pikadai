import { Link, Outlet } from 'react-router';

export function Layout() {
  return (
    <div className="app">
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◐
          </span>{' '}
          pikadai
        </Link>
        <span className="tagline">find a date, no strings attached</span>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        No accounts. No cookies. No tracking. Polls delete themselves after they expire.
      </footer>
    </div>
  );
}
