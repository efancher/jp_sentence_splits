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
  if (status.waived) return 'This sentence has no meaning check, so once you have worked through it the next sentence opens.';
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
  const { frontier } = view.book;
  const total = view.book.sentences.length;
  const open = view.book.sentences.filter((s) => s.accessible).length;
  const cleared = view.book.sentences.filter((s) => s.progress.cleared).length;
  return (
    <section className="panel stack" aria-label="Episode order progress">
      <strong>
        Episode order · {cleared} of {total} sentences comfortable
      </strong>
      <progress value={cleared} max={Math.max(total, 1)} aria-label="Sentences cleared" style={{ width: '100%' }} />
      <p className="muted" style={{ margin: 0 }}>
        {open} open.
      </p>
      {view.current ? (
        <p className="muted" style={{ margin: 0 }}>
          This sentence: {progressLine(view.current)}
        </p>
      ) : null}
      {frontier ? (
        <p className="muted" style={{ margin: 0 }}>
          Sentence {frontier.position + 1} is still locked: learn any sentence of its episode
          and the whole episode opens. Started episodes with the most learnt sentences come first.
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
  return (
    <section className="panel stack" aria-label="Sentence locked">
      <strong>Not unlocked yet</strong>
      <p style={{ margin: 0 }}>
        This sentence&rsquo;s episode hasn&rsquo;t been started. Learn its first sentence (or any
        sentence in it) and the rest of the episode opens.
      </p>
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
