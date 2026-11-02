import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { APP_NAME, APP_SHORT_NAME } from '../appConfig';
import { MigrationModal } from '../components/MigrationModal';
import { ReportIssueButton } from '../components/ReportIssueButton';
import { SessionBar } from '../components/SessionBar';
import { SlowPageBanner } from '../components/SlowPageBanner';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { expireStalePlannerSessions } from '../db/repository';
import { useActiveSession } from '../hooks/useActiveSession';
import { autoGenerateMeaningChecks } from '../lib/meaningCheckAutogen';
import { summarizePageTimings, summarizeStepRuns, trackPageLoad } from '../lib/pageTiming';
import { loadWordFrequency } from '../lib/wordFrequency';
import { registerReportContext } from '../lib/reportContext';
import { getRecentSyncLogs } from '../sync/logger';
import { getSyncProgress } from '../sync/progress';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/books', label: 'Books' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/review', label: 'Review' },
  { to: '/issues', label: 'Issues' },
  { to: '/study-items', label: 'Study items' },
  { to: '/vocabulary', label: 'Words' },
  { to: '/grammar', label: 'Grammar' },
  { to: '/progress', label: 'Progress' },
  { to: '/search', label: 'Search' },
  { to: '/import', label: 'Import' },
  { to: '/import/youtube', label: 'Import from YouTube' },
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
  const activeSession = useActiveSession();
  // Sticky-positioned SessionBar doesn't reserve layout space the way a
  // normal-flow footer would, so without this a page whose content ends
  // right at the viewport edge would have its last inch permanently covered
  // once scrolled to the bottom — reserve room for it whenever it'll render
  // (see SessionBar's own matching route check).
  const showSessionBar =
    !!activeSession && location.pathname !== `/session/${activeSession.session.id}`;

  useEffect(() => {
    void expireStalePlannerSessions();
    const timer = window.setInterval(() => void expireStalePlannerSessions(), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Warm the word-frequency table so readers rarely wait on its download.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadWordFrequency(), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const run = () => void autoGenerateMeaningChecks().catch(() => undefined);
    const first = window.setTimeout(run, 15 * 1000);
    const timer = window.setInterval(run, 3 * 60 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Time each navigation until its "Loading…" placeholders are gone.
  const mainRef = useRef<HTMLElement>(null);
  const firstNavigation = useRef(true);
  useEffect(() => {
    const initial = firstNavigation.current;
    firstNavigation.current = false;
    return trackPageLoad({
      path: location.pathname,
      root: mainRef.current,
      initial,
      startedAt: initial ? 0 : performance.now(),
      syncState: () => {
        const progress = getSyncProgress();
        return { running: progress.running, stage: progress.stage };
      },
    });
  }, [location.pathname]);

  useEffect(
    () =>
      registerReportContext('pageTimings', () => ({
        recent: summarizePageTimings(),
        stepRuns: summarizeStepRuns(),
        syncLastCycle: getSyncProgress().lastCycle,
        syncLogs: getRecentSyncLogs()
          .filter((event) => event.code === 'PULL_TIMING' || event.code === 'AUDIO_HYDRATE')
          .slice(-15)
          .map((event) => `${event.at} ${event.message}`),
      })),
    [],
  );

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
        <div className="row" style={{ gap: '0.5rem' }}>
          <ReportIssueButton />
          <SyncStatusBadge />
        </div>
      </header>
      <main ref={mainRef} className={showSessionBar ? 'app-main has-session-bar' : 'app-main'}>
        <SlowPageBanner />
        <Outlet />
      </main>
      {showSessionBar ? <SessionBar /> : null}
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
