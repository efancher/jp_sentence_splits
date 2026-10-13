import { useEffect, useState } from 'react';

import type { AssistRunStatus } from '../lib/miningApi';

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatAt(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** What the assistant call in flight is doing (ticking clock) plus the newest-last activity log. */
export function AssistRunActivity({ run }: { run: Pick<AssistRunStatus, 'status' | 'live' | 'log'> }) {
  const [now, setNow] = useState(() => Date.now());
  const running = run.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const live = running ? run.live : null;
  const log = run.log ?? [];
  if (!live && log.length === 0) return null;
  const elapsed = live?.startedAt ? (now - live.startedAt) / 1000 : null;
  return (
    <div className="stack" style={{ gap: '0.25rem', fontSize: '0.85rem' }}>
      {live ? (
        <div>
          <strong>{live.backend ?? 'assistant'}</strong> is working
          {elapsed !== null
            ? ` — ${formatClock(elapsed)}${live.timeoutSeconds ? ` of ${formatClock(live.timeoutSeconds)} allowed` : ''}`
            : ''}
          <span className="muted">
            {' '}
            (a long reply is silent until it finishes; if the assistant stops answering, the server switches to the other
            one after about 2 minutes)
          </span>
        </div>
      ) : null}
      {log.length > 0 ? (
        <details>
          <summary className="muted">Activity ({log.length})</summary>
          <ul className="muted" style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
            {[...log].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                {formatAt(entry.at)} — {entry.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
