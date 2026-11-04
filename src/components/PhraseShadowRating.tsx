import { useState } from 'react';

import { logPhraseShadow } from '../db/repository';
import { PHRASE_SHADOW_OUTCOMES, type PhraseShadowOutcome } from '../lib/phraseShadow';

/**
 * Self-rating for a phrase shadow: shown under the Shadow pane's target controls once the learner
 * has marked a span narrower than the clip. Three explicit buttons; the learner's call is logged as
 * a `phrase_shadow` event (evidence only: no FSRS, and it does not count as shadowing the sentence).
 * Remounted (keyed) when the marked span changes, so a new span starts unrated.
 */
export function PhraseShadowRating({
  bookId,
  sentenceId,
  sentenceAudioId,
  clipDurationMs,
  range,
  visitId,
}: {
  bookId: string;
  sentenceId: string;
  sentenceAudioId: string;
  clipDurationMs: number;
  range: { startMs: number; endMs: number };
  /** Groups the rating with the reader tool visit that opened this workspace, when there is one. */
  visitId?: string;
}) {
  const [logged, setLogged] = useState<PhraseShadowOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rate(outcome: PhraseShadowOutcome) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const event = await logPhraseShadow({ bookId, sentenceId, sentenceAudioId, clipDurationMs, range, outcome, visitId });
      if (event) setLogged((prev) => [...prev, outcome]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save that rating.');
    } finally {
      setBusy(false);
    }
  }

  const last = logged[logged.length - 1];
  const lastLabel = PHRASE_SHADOW_OUTCOMES.find((entry) => entry.outcome === last)?.label;

  return (
    <div className="stack" role="group" aria-label="Rate this phrase" style={{ gap: '0.25rem' }}>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted">How did this phrase go?</span>
        {PHRASE_SHADOW_OUTCOMES.map((entry) => (
          <button key={entry.outcome} type="button" disabled={busy} onClick={() => void rate(entry.outcome)}>
            {entry.label}
          </button>
        ))}
      </div>
      {lastLabel ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Logged “{lastLabel}” for this phrase{logged.length > 1 ? ` (${logged.length} passes)` : ''}. Your own call —
          it does not grade any card or count as shadowing the whole sentence.
        </p>
      ) : null}
      {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
