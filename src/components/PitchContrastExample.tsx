import { useEffect, useState } from 'react';

import { getDb } from '../db/database';
import { getOddEarOutData, type OddEarOutClip } from '../db/repository';
import { useRangeLoop } from '../hooks/useRangeLoop';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { shapeLabel } from '../lib/oddEarOut';
import { inWordShapeKey, pickContrastClip } from '../lib/pitchContrastClip';

import { WordPitchContour } from './WordPitchContour';

function ContrastClipPlayer({
  clip,
  onPlay,
}: {
  clip: OddEarOutClip;
  onPlay: () => void;
}) {
  const blob = useSentenceAudioBlob(clip.audio);
  const loop = useRangeLoop(clip.audio.id, blob);
  return (
    <div className="stack" style={{ gap: '0.3rem' }}>
      <audio ref={loop.audioElRef} src={loop.objectUrl ?? undefined} hidden />
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`speak-button${loop.isLooping ? ' speaking' : ''}`}
          aria-pressed={loop.isLooping}
          disabled={!blob}
          onClick={() => {
            if (!loop.isLooping) onPlay();
            void loop.toggleLoop(clip.span);
          }}
        >
          {loop.isLooping ? '🔁 Looping…' : '🔁 Hear it'}
        </button>
        <span className="jp">
          {clip.expression}
          {clip.reading !== clip.expression ? `（${clip.reading}）` : ''}
        </span>
        {clip.meaning ? <span className="muted">{clip.meaning}</span> : null}
      </div>
      <WordPitchContour
        audioId={clip.audio.id}
        blob={blob}
        span={clip.span}
        label="Measured pitch of this word"
        ariaLabel={`Measured pitch of ${clip.expression}`}
      />
      {loop.playbackError ? <div className="muted">{loop.playbackError}</div> : null}
    </div>
  );
}

/**
 * After a `pitch_accent` miss: a real word of the same length that has the
 * pattern the learner *picked*, from the same book as the card's clip when
 * possible (same-speaker proxy), so they can hear what their answer actually
 * sounds like next to the native word they just missed. Word-only spans
 * (Odd Ear Out's clip set — no particle), so the contour reflects the word's
 * own morae. Renders nothing when heiban/odaka were confused (a word-only
 * clip can't show that difference) or no fitting word exists yet.
 *
 * `onShown`/`onPlayed` feed the review's `assistance` log
 * (docs/STATUS.md, pitch drill tracking) so the comparison's usage can be
 * correlated with later reviews of the same word.
 */
export function PitchContrastExample({
  moraCount,
  chosenPosition,
  correctPosition,
  vocabularyItemId,
  reading,
  sentenceId,
  onShown,
  onPlayed,
}: {
  moraCount: number;
  chosenPosition: number;
  correctPosition: number;
  vocabularyItemId: string;
  reading: string;
  /** The card's own sentence — its book is preferred for the example (same-speaker proxy). */
  sentenceId: string;
  onShown: () => void;
  onPlayed: () => void;
}) {
  const [clip, setClip] = useState<OddEarOutClip | null>(null);
  const applicable =
    inWordShapeKey(moraCount, chosenPosition) !== inWordShapeKey(moraCount, correctPosition);

  useEffect(() => {
    if (!applicable) return;
    let cancelled = false;
    void Promise.all([
      getOddEarOutData(),
      getDb().bookSentences.where('sentenceId').equals(sentenceId).first(),
    ])
      .then(([{ clips }, membership]) => {
        if (cancelled) return;
        const picked = pickContrastClip(clips, {
          moraCount,
          chosenPosition,
          correctPosition,
          excludeVocabularyItemId: vocabularyItemId,
          excludeReading: reading,
          preferBookId: membership?.bookId,
        });
        setClip(picked);
        if (picked) onShown();
      })
      .catch(() => {
        // Offline / no alignments — the comparison is optional scaffolding.
      });
    return () => {
      cancelled = true;
    };
    // onShown is a stable markAssistance wrapper's caller; only the answer's
    // identity should re-run the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicable, moraCount, chosenPosition, correctPosition, vocabularyItemId, reading, sentenceId]);

  if (!clip) return null;
  const chosenShape = inWordShapeKey(moraCount, chosenPosition);
  return (
    <div className="stack" style={{ gap: '0.3rem' }}>
      <div className="muted">
        Here&rsquo;s what the pattern you picked sounds like — a {moraCount}-mora word that{' '}
        {shapeLabel(chosenShape)}. Compare it with the word you just missed.
      </div>
      <ContrastClipPlayer clip={clip} onPlay={onPlayed} />
    </div>
  );
}
