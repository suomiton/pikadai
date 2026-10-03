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
        <span className="tagline">pick a date &amp; meet, anonymously</span>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        Copyright Toni Suominen ·{' '}
        <a href="https://github.com/suomiton" target="_blank" rel="noopener noreferrer">
          suomiton
        </a>
      </footer>
    </div>
  );
}
