import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';

import { ASSIST_CONCURRENCY_KEY, readStoredConcurrency } from '../lib/assistRun';
import { countBookSentencesNeedingGloss, fillBookGlosses } from '../lib/sentenceGlossFill';

/**
 * Book-wide word glosses through the box assistant: finds sentences whose content words
 * have no stored gloss or saved meaning (the words the Reader's word help would drop) and
 * asks the assistant for short in-context meanings, one call per sentence. Saves as it
 * goes; stopping or failing keeps the work done and a rerun picks up the rest.
 */
export function BookWordGlosses({ bookId }: { bookId: string }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Re-counts as sentences gain glosses (live query over the sentence table).
  const remaining = useLiveQuery(() => countBookSentencesNeedingGloss(bookId), [bookId]);

  async function start() {
    cancelRef.current = false;
    setRunning(true);
    setStatus(null);
    setProgress({ done: 0, total: remaining ?? 0 });
    try {
      const result = await fillBookGlosses(bookId, {
        concurrency: readStoredConcurrency(),
        isCancelled: () => cancelRef.current,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const parts = [`Glossed ${result.filled} of ${result.total} sentence${result.total === 1 ? '' : 's'}.`];
      if (result.empty > 0) parts.push(`${result.empty} got nothing usable (assistant unreachable or no match) — run again to retry.`);
      if (result.cancelled) parts.push('Stopped early.');
      setStatus(parts.join(' '));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Glossing failed.');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  if (remaining === undefined || (remaining === 0 && !running && !status)) return null;

  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Word glosses</h3>
      <p className="muted" style={{ margin: 0 }}>
        {remaining} sentence{remaining === 1 ? '' : 's'} in this book have words with no English gloss, so the
        Reader shows no definition for them. The assistant writes short in-context meanings (one call per
        sentence, {readStoredConcurrency()} at a time — see Agents under Generate extras; stored under{' '}
        <code>{ASSIST_CONCURRENCY_KEY}</code>).
      </p>
      <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
        {running ? (
          <button type="button" className="ghost" onClick={() => (cancelRef.current = true)}>
            Stop
          </button>
        ) : (
          <button type="button" disabled={remaining === 0} onClick={() => void start()}>
            Add word glosses
          </button>
        )}
        {progress ? (
          <span className="muted">
            {progress.done} / {progress.total}
          </span>
        ) : null}
      </div>
      {status ? <p className="muted" style={{ margin: 0 }}>{status}</p> : null}
    </section>
  );
}
