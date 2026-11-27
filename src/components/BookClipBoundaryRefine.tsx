import { useEffect, useState } from 'react';

import {
  getBoundaryBackfillJob,
  startBoundaryBackfill,
  type BoundaryBackfillStatus,
} from '../lib/boundaryBackfillApi';

function failed(error: unknown): BoundaryBackfillStatus {
  return {
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
    log: [],
    startedAt: Date.now(),
  };
}

/**
 * Book-page panel: re-cut this book's existing clips with forced-alignment
 * boundary refinement. "Preview" lists how far each clip's start/end would
 * move (nothing is written); "Re-cut clips" replaces the ones that move
 * noticeably and look trustworthy. Runs on the mining box.
 */
export function BookClipBoundaryRefine({ bookId }: { bookId: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<BoundaryBackfillStatus | null>(null);
  const [lastWasApply, setLastWasApply] = useState(false);
  const running = status?.status === 'running';

  useEffect(() => {
    if (!jobId || status?.status !== 'running') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void getBoundaryBackfillJob(jobId).then(
        (next) => {
          if (!cancelled) setStatus(next);
        },
        (error: unknown) => {
          if (!cancelled) setStatus(failed(error));
        },
      );
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, status]);

  function start(apply: boolean) {
    setLastWasApply(apply);
    setStatus({ status: 'running', message: 'Starting…', log: [], startedAt: Date.now() });
    startBoundaryBackfill(bookId, apply).then(setJobId, (error: unknown) => setStatus(failed(error)));
  }

  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Clip boundaries</h3>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Re-aligns this book&apos;s sentence audio to the sentence text so clips start and end on the
        speech. Preview first: it only reports how far each clip would move. Re-cutting replaces
        clips that move by 0.15 s or more and look trustworthy; flagged ones (held sounds, big
        shifts) are listed for review and left alone. Run &ldquo;Precompute word audio
        alignment&rdquo; afterwards.
      </p>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="secondary" disabled={running} onClick={() => start(false)}>
          Preview clip boundaries
        </button>
        <button type="button" className="secondary" disabled={running} onClick={() => start(true)}>
          Re-cut clips
        </button>
        {status ? (
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {status.status === 'error'
              ? `Failed — ${status.message}`
              : status.status === 'done'
                ? `${lastWasApply ? 'Re-cut finished.' : 'Preview finished.'} ${status.message}`
                : status.message}
          </span>
        ) : null}
      </div>
      {status && status.log.length > 0 ? (
        <pre
          className="muted"
          style={{ fontSize: '0.75rem', maxHeight: '16rem', overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}
        >
          {status.log.join('\n')}
        </pre>
      ) : null}
    </section>
  );
}
