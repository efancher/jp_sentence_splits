import { useEffect, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { useRangeLoop } from '../hooks/useRangeLoop';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { isolatedWordSpans, type IsolatedWordSpans } from '../lib/isolatedWordRange';

/**
 * Ungraded perception warm-up for the `pitch_accent` review card's heiban
 * (no downstep) vs. odaka (downstep right after the word) edge cases —
 * within the word itself the two contours are identical, so the only
 * audible cue is whether the following particle stays high or drops. Lets
 * the learner loop the word alone, then the word + particle, and check
 * their own guess before answering the card's real (graded) drop-position
 * question below it.
 *
 * Renders nothing until forced alignment resolves *and* actually finds a
 * following particle-sized span to contrast against the word-alone span —
 * this is optional scaffolding on top of an already-optional warm-up, so it
 * degrades silently rather than showing a partial/broken control (mirrors
 * `SegmentLoopPlayer`'s `wordOnly` mode).
 */
export function PitchWordPhraseWarmup({
  audio,
  japanese,
  surfaceForm,
  isHeiban,
}: {
  audio: SentenceAudio;
  japanese: string;
  surfaceForm: string;
  /** true: the correct answer is "stays high"; false: "drops on the particle". */
  isHeiban: boolean;
}) {
  const blob = useSentenceAudioBlob(audio);
  const [spans, setSpans] = useState<IsolatedWordSpans | null>(null);
  const [resolved, setResolved] = useState(false);
  const [guess, setGuess] = useState<'stays' | 'drops' | null>(null);

  const wordLoop = useRangeLoop(audio.id, blob);
  const phraseLoop = useRangeLoop(audio.id, blob);

  useEffect(() => {
    let cancelled = false;
    setSpans(null);
    setResolved(false);
    if (!blob) return;
    void loadOrComputeAlignment(
      audio.id,
      blob,
      japanese,
      getReferenceAlignment,
      saveReferenceAlignment,
    ).then((result) => {
      if (cancelled) return;
      setSpans(result ? isolatedWordSpans(result.words, japanese, surfaceForm) : null);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, blob, japanese, surfaceForm]);

  if (!resolved || !spans?.withParticle) return null;
  const { wordOnly, withParticle } = spans;

  const correct = isHeiban ? 'stays' : 'drops';

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <audio ref={wordLoop.audioElRef} src={wordLoop.objectUrl ?? undefined} hidden />
      <audio ref={phraseLoop.audioElRef} src={phraseLoop.objectUrl ?? undefined} hidden />
      <div className="muted">Warm-up (not graded)</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`speak-button${wordLoop.isLooping ? ' speaking' : ''}`}
          onClick={() => void wordLoop.toggleLoop(wordOnly)}
        >
          🔁 {wordLoop.isLooping ? 'Looping word…' : 'Word alone'}
        </button>
        <button
          type="button"
          className={`speak-button${phraseLoop.isLooping ? ' speaking' : ''}`}
          onClick={() => void phraseLoop.toggleLoop(withParticle)}
        >
          🔁 {phraseLoop.isLooping ? 'Looping…' : 'Word + particle'}
        </button>
      </div>
      <div className="muted">Does the pitch stay high through the particle, or drop?</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setGuess('stays')}>
          Stays high
        </button>
        <button type="button" onClick={() => setGuess('drops')}>
          Drops
        </button>
      </div>
      {guess ? (
        <div className="muted">
          {guess === correct
            ? `✓ Right — the pitch ${correct === 'stays' ? 'stays high' : 'drops'} on the particle.`
            : `✗ Actually it ${correct === 'stays' ? 'stays high' : 'drops'} — listen again if it's not clear yet.`}
        </div>
      ) : null}
      {wordLoop.playbackError ? <div className="muted">{wordLoop.playbackError}</div> : null}
      {phraseLoop.playbackError ? <div className="muted">{phraseLoop.playbackError}</div> : null}
    </div>
  );
}
