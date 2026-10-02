import { useEffect, useState, useSyncExternalStore } from 'react';

import { getRecentSyncLogs, getSyncLogRevision, subscribeSyncLogs } from '../sync/logger';
import { getSyncProgress, subscribeSyncProgress } from '../sync/progress';
import { readSyncMeta } from '../sync/queue';
import { useSync } from '../sync/SyncProvider';
import { getSupabase } from '../sync/supabaseClient';

const STAGE_LABELS: Record<string, string> = {
  starting: 'Starting',
  push: 'Pushing local changes',
  pull: 'Pulling cloud changes',
  'pull-skipped': 'Pull skipped (recent)',
  sweep: 'Clearing stale conflicts',
  finish: 'Finishing',
  idle: 'Idle',
};
const STALL_HINT_MS = 20_000;

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function stageHint(stage: string, elapsedMs: number, pushEntity: string | null): string | null {
  if (elapsedMs < STALL_HINT_MS) return null;
  if (stage === 'push') {
    return `Pushing has taken a while${pushEntity ? ` (currently ${pushEntity})` : ''} — usually a slow connection or a large queue.`;
  }
  if (stage === 'pull') {
    return 'Pulling has taken a while — a large backlog of cloud changes, or a slow connection.';
  }
  return `${STAGE_LABELS[stage] ?? stage} is taking longer than expected.`;
}

export function SyncMonitor() {
  const sync = useSync();
  const progress = useSyncExternalStore(subscribeSyncProgress, getSyncProgress);
  useSyncExternalStore(subscribeSyncLogs, getSyncLogRevision);
  const [now, setNow] = useState(() => Date.now());
  const [backlog, setBacklog] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!progress.running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [progress.running]);

  async function checkBacklog() {
    setBacklog('Checking…');
    try {
      const supabase = getSupabase();
      const meta = await readSyncMeta();
      if (!supabase || !meta) {
        setBacklog('Not signed in.');
        return;
      }
      const { count, error } = await supabase
        .from('sync_events')
        .select('id', { count: 'exact', head: true })
        .gt('id', meta.lastPullEventId);
      if (error) throw new Error(error.message);
      const deferred = meta.deferredPullEventIds?.length ?? 0;
      setBacklog(
        `${count ?? 0} cloud change(s) not yet pulled to this device` +
          (deferred ? `; ${deferred} earlier change(s) deferred for retry` : '') +
          '.',
      );
    } catch (err) {
      setBacklog(err instanceof Error ? err.message : String(err));
    }
  }

  const logs = getRecentSyncLogs().slice(-40).reverse();
  const stageElapsed = progress.stageStartedAt != null ? now - progress.stageStartedAt : 0;
  const cycleElapsed = progress.cycleStartedAt != null ? now - progress.cycleStartedAt : 0;
  const hint = progress.running
    ? stageHint(progress.stage, stageElapsed, progress.pushEntity)
    : null;
  const last = progress.lastCycle;

  return (
    <details className="stack">
      <summary>Sync monitor{progress.running ? ' — running' : ''}</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <p style={{ margin: 0 }}>
          <strong>{progress.running ? STAGE_LABELS[progress.stage] ?? progress.stage : 'Idle'}</strong>
          {progress.running
            ? ` · ${formatMs(stageElapsed)} in this stage · ${formatMs(cycleElapsed)} total`
            : ''}
        </p>
        {hint ? <p style={{ margin: 0, color: 'var(--danger)' }}>{hint}</p> : null}
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Queue: {sync.pending} pending
            {progress.pushTotal > 0
              ? ` · pushed ${progress.pushDone}/${progress.pushTotal} this cycle`
              : ''}
            {progress.pushEntity && progress.running ? ` (${progress.pushEntity})` : ''}
          </li>
          <li>
            Pull: {progress.pullEvents} change(s) in {progress.pullPages} page(s)
            {progress.pullSkipped ? `, ${progress.pullSkipped} deferred` : ''}
          </li>
          {progress.audioTotal > 0 ? (
            <li>
              Audio download: {progress.audioDone}/{progress.audioTotal}
            </li>
          ) : null}
          <li>Online: {sync.online ? 'yes' : 'no'}</li>
        </ul>
        {last ? (
          <p className="muted" style={{ margin: 0 }}>
            Last cycle: {last.ok ? 'ok' : 'failed'} in {formatMs(last.totalMs)} (
            {Object.entries(last.stageMs)
              .map(([name, ms]) => `${name} ${formatMs(ms)}`)
              .join(', ')}
            ) · pushed {last.pushed}, pulled {last.pulledEvents} at{' '}
            {new Date(last.finishedAt).toLocaleTimeString()}
          </p>
        ) : null}
        <div className="row">
          <button type="button" onClick={() => void checkBacklog()}>
            Check cloud backlog
          </button>
          <button
            type="button"
            onClick={() => {
              const text = logs
                .map((e) => `${e.at} ${e.level} ${e.code ?? ''} ${e.message} ${e.details ? JSON.stringify(e.details) : ''}`)
                .join('\n');
              void navigator.clipboard
                ?.writeText(text)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'Copied' : 'Copy log'}
          </button>
        </div>
        {backlog ? <p className="muted" style={{ margin: 0 }}>{backlog}</p> : null}
        <div
          className="muted"
          style={{ maxHeight: 220, overflow: 'auto', fontFamily: 'monospace', fontSize: 12 }}
        >
          {logs.length === 0 ? 'No sync events yet this session.' : null}
          {logs.map((e, i) => (
            <div key={`${e.at}-${i}`}>
              {new Date(e.at).toLocaleTimeString()} {e.level}
              {e.code ? ` ${e.code}` : ''} — {e.message}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
