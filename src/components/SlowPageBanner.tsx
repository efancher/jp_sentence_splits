import { useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';

import { reportSyncIssue } from '../db/repository';
import { buildPageSnapshot } from '../lib/pageSnapshot';
import {
  getPageTimings,
  SLOW_PAGE_MS,
  subscribePageTimings,
  type PageTiming,
} from '../lib/pageTiming';

/**
 * Appears after a slow page load with a one-tap report. The report reuses the
 * header "Report issue" snapshot, which already carries the recent page timings
 * and sync state, so it can be triaged later from /issues.
 */
export function SlowPageBanner() {
  const location = useLocation();
  const timings = useSyncExternalStore(subscribePageTimings, getPageTimings);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const latest: PageTiming | undefined = timings[timings.length - 1];
  if (!latest || latest.ms < SLOW_PAGE_MS) return null;
  if (latest.path !== location.pathname || dismissed === latest.at) return null;

  const seconds = Math.round(latest.ms / 1000);
  async function send() {
    if (!latest || state === 'sending') return;
    setState('sending');
    try {
      await reportSyncIssue({
        note: `Slow page: ${latest.path} took ${seconds}s${latest.timedOut ? '+ (still loading)' : ''}`,
        diagnosticsSnapshot: await buildPageSnapshot(location.pathname, location.search, ''),
        conflictEntity: 'page_report',
        conflictRecordId: location.pathname,
      });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="panel row" role="status" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
      <span className="muted">
        {state === 'sent'
          ? '✓ Slow page reported'
          : `This page took ${seconds}s to load${latest.syncRunning ? ' (sync was running)' : ''}.`}
      </span>
      {state === 'sent' ? null : (
        <button type="button" disabled={state === 'sending'} onClick={() => void send()}>
          {state === 'sending' ? 'Saving…' : state === 'error' ? 'Retry report' : 'Report slow page'}
        </button>
      )}
      <button type="button" className="ghost" onClick={() => setDismissed(latest.at)}>
        Dismiss
      </button>
    </div>
  );
}
