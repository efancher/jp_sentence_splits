import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { APP_NAME, APP_SHORT_NAME } from '../appConfig';
import { MigrationModal } from '../components/MigrationModal';
import { SyncStatusBadge } from '../components/SyncStatusBadge';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/books', label: 'Books' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/review', label: 'Review' },
  { to: '/issues', label: 'Issues' },
  { to: '/study-items', label: 'Study items' },
  { to: '/vocabulary', label: 'Words' },
  { to: '/grammar', label: 'Grammar' },
  { to: '/search', label: 'Search' },
  { to: '/import', label: 'Import' },
  { to: '/settings', label: 'Settings' },
] as const;

/**
 * Primary navigation, opened from a header button rather than a persistent
 * bottom bar — the header is `position: sticky`, so the menu stays reachable
 * from anywhere on a long page (Analyze/Practice/Build/Review/Session used
 * to hide the old bottom nav entirely for exactly this reason; this menu
 * has no such exception, it's available on every route).
 */
export function AppShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="row" style={{ gap: '0.6rem' }}>
          <button
            type="button"
            className="ghost nav-menu-button"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="nav-menu-panel"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div>
            <h1>{APP_NAME}</h1>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {APP_SHORT_NAME} · offline-first study workspace
            </div>
          </div>
        </div>
        <SyncStatusBadge />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <MigrationModal />
      {menuOpen ? (
        <div className="nav-menu-backdrop" onClick={() => setMenuOpen(false)}>
          <nav
            id="nav-menu-panel"
            className="nav-menu-panel"
            aria-label="Primary"
            onClick={(event) => event.stopPropagation()}
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
