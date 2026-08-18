import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { APP_NAME, APP_SHORT_NAME } from '../appConfig';
import { MigrationModal } from '../components/MigrationModal';
import { SyncStatusBadge } from '../components/SyncStatusBadge';

const NAV = [
  { to: '/', label: 'Books', end: true },
  { to: '/inbox', label: 'Inbox' },
  { to: '/review', label: 'Review' },
  { to: '/study-items', label: 'Study items' },
  { to: '/vocabulary', label: 'Words' },
  { to: '/search', label: 'Search' },
  { to: '/import', label: 'Import' },
  { to: '/settings', label: 'Settings' },
] as const;

export function AppShell() {
  const location = useLocation();
  const hideNav =
    location.pathname.includes('/analyze') ||
    location.pathname.includes('/practice') ||
    location.pathname.includes('/build') ||
    location.pathname.includes('/review');

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>{APP_NAME}</h1>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {APP_SHORT_NAME} · offline-first study workspace
          </div>
        </div>
        <SyncStatusBadge />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <MigrationModal />
      {!hideNav && (
        <nav className="bottom-nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <span aria-hidden="true">•</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
