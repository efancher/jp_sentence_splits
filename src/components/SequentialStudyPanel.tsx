import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import {
  getSequentialSentenceView,
  latchSequentialUnlocks,
  unlockSentenceManually,
} from '../db/repository';
import type { SequentialSentenceStatus } from '../lib/sequentialStudy';

function progressLine(status: SequentialSentenceStatus): string {
  const { progress } = status;
  if (status.waived) return 'This sentence has no meaning check, so it never blocks the next one.';
  if (progress.cleared) return 'Cleared — the next sentence is open.';
  if (progress.attempts < progress.windowSize) {
    return `${progress.attempts} of ${progress.windowSize} spaced first-try answers so far (${progress.correctInWindow} correct). Needs ${progress.required} of the last ${progress.windowSize} correct.`;
  }
  return `${progress.correctInWindow} of the last ${progress.windowSize} correct — needs ${progress.required}. Keep answering in Review; each new first-try answer shifts the window.`;
}

/**
 * Episode-order progress for sequential study mode. Renders nothing when the
 * mode is off. On a book page it shows the frontier (the next locked sentence
 * and the gating sentence's progress); given a `sentenceId` it also reports
 * how that sentence is doing toward unlocking the one after it.
 */
export function SequentialStudyPanel({ bookId, sentenceId }: { bookId: string; sentenceId?: string }) {
  const view = useLiveQuery(() => getSequentialSentenceView(bookId, sentenceId), [bookId, sentenceId]);

  useEffect(() => {
    void latchSequentialUnlocks(bookId);
  }, [bookId, view?.book.newlyLatched.length]);

  if (!view) return null;
  const { frontier, gatingSentence } = view.book;
  const total = view.book.sentences.length;
  const open = view.book.sentences.filter((s) => s.accessible).length;
  return (
    <section className="panel stack" aria-label="Episode order progress">
      <strong>
        Episode order · {open} of {total} sentences open
      </strong>
      {view.current ? (
        <p className="muted" style={{ margin: 0 }}>
          This sentence: {progressLine(view.current)}
        </p>
      ) : null}
      {frontier && gatingSentence ? (
        <p className="muted" style={{ margin: 0 }}>
          Next to unlock: sentence {frontier.position + 1}. It opens when sentence{' '}
          {gatingSentence.position + 1} is cleared. {progressLine(gatingSentence)}
        </p>
      ) : !frontier ? (
        <p className="muted" style={{ margin: 0 }}>Every sentence in this book is open.</p>
      ) : null}
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Reviews count once they are first-try answers made before any reveal, at least 10 minutes
        apart. <Link to="/review">Go to Review</Link>
      </p>
    </section>
  );
}

/** Shown in place of the study tools for a locked sentence; playback and the episode stay reachable. */
export function LockedSentenceNotice({
  bookId,
  sentenceId,
}: {
  bookId: string;
  sentenceId: string;
}) {
  const view = useLiveQuery(() => getSequentialSentenceView(bookId, sentenceId), [bookId, sentenceId]);
  const gating = view?.previous;
  return (
    <section className="panel stack" aria-label="Sentence locked">
      <strong>Not unlocked yet</strong>
      <p style={{ margin: 0 }}>
        Sentences open in episode order. This one opens once the previous sentence is cleared:
        at least 4 of its last 5 first-try meaning answers correct.
      </p>
      {gating ? <p className="muted" style={{ margin: 0 }}>{progressLine(gating)}</p> : null}
      <div className="row">
        <Link to="/review">Go to Review</Link>
        <Link to={`/books/${bookId}/read`}>Read the episode</Link>
        <button type="button" onClick={() => void unlockSentenceManually(sentenceId)}>
          Unlock this sentence anyway
        </button>
      </div>
    </section>
  );
}
