import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getBookReadyToPickUp, type ReadyToPickUp } from '../db/repository';

/**
 * A book's next i+1 sentences: at most two words or grammar patterns the learner has not met, in the order the
 * planner would offer them. Computed when opened (it scores every sentence in every book) rather than live.
 */
export function ReadyToPickUpPanel({ bookId }: { bookId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ total: number; items: ReadyToPickUp[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getBookReadyToPickUp(bookId).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, bookId]);

  return (
    <details className="panel stack" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <strong>Ready to pick up</strong>
        {state ? <span className="muted"> · {state.total} sentences with at most two new pieces</span> : null}
      </summary>
      {open && !state ? <p className="muted">Scoring sentences…</p> : null}
      {state && state.items.length === 0 ? (
        <p className="muted">Nothing here is within two new pieces of what you know yet.</p>
      ) : null}
      {state?.items.map((item) => (
        <article key={item.sentenceId} className="list-card stack">
          <Link to={`/books/${bookId}/analyze/${item.sentenceId}`} lang="ja">
            {item.japanese}
          </Link>
          <span className="muted">{item.translation}</span>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {item.newPieces.length > 0 ? `New here: ${item.newPieces.join(', ')}` : 'Nothing new here'}
          </span>
        </article>
      ))}
    </details>
  );
}
