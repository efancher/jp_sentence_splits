import { useEffect, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment } from '../db/repository';
import type { PitchAccentMinimalPairOccurrence } from '../db/repository';
import { useRangeLoop } from '../hooks/useRangeLoop';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { isolatedWordRange } from '../lib/isolatedWordRange';
import { segmentIntoMorae } from '../lib/mora';
import type { MinimalPairTrial } from '../lib/pitchAccentMinimalPairs';
import { pitchPatternLabel } from '../lib/pitchAccentShape';
import type { TimeRangeMs } from '../lib/recording';

/**
 * Real-audio pitch-perception bridge, "same/different + ABX on near-minimal
 * pairs" (docs/ROADMAP.md). Two words sharing a reading but not a
 * pitch-accent position — 箸 vs 橋, both はし — played from real native
 * clips, isolated to the word alone via forced alignment
 * (`isolatedWordRange`, same technique as `PitchWordPhraseWarmup`). The
 * learner picks which clip is which *before* the reveal; each pair is
 * tried once from the same book (a same-speaker proxy — see
 * `getPitchAccentMinimalPairOccurrences`'s doc comment) and, corpus
 * permitting, once more across two different books. Ungraded and
 * unpersisted — a perception check, not an SRS card.
 */

const PATTERN_DESCRIPTION: Record<string, string> = {
  heiban: 'flat — no drop',
  atamadaka: 'drops right after the first mora',
  nakadaka: 'drops partway through',
  odaka: 'drops right after the word (only audible on what follows)',
};

function describePattern(position: number, moraCount: number): string {
  const pattern = pitchPatternLabel(position, moraCount);
  return `${pattern} — ${PATTERN_DESCRIPTION[pattern]}`;
}

type Slot = 'first' | 'second';

interface MinimalPairClip {
  blob: Blob | null;
  span: TimeRangeMs | null | undefined;
}

/** One blob fetch per occurrence, shared between span resolution and playback. */
function useMinimalPairClip(occurrence: PitchAccentMinimalPairOccurrence): MinimalPairClip {
  const blob = useSentenceAudioBlob(occurrence.audio);
  const [span, setSpan] = useState<TimeRangeMs | null | undefined>(undefined);
  const { audio, sentence, surfaceForm } = occurrence;

  useEffect(() => {
    let cancelled = false;
    setSpan(undefined);
    if (!blob) return;
    void loadOrComputeAlignment(
      audio.id,
      blob,
      sentence.japanese,
      getReferenceAlignment,
      saveReferenceAlignment,
    ).then((result) => {
      if (cancelled) return;
      setSpan(result ? isolatedWordRange(result.words, sentence.japanese, surfaceForm) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, blob, sentence.japanese, surfaceForm]);

  return { blob, span };
}

function TrialClip({
  label,
  audioId,
  blob,
  span,
}: {
  label: string;
  audioId: string;
  blob: Blob | null;
  span: TimeRangeMs;
}) {
  const loop = useRangeLoop(audioId, blob);
  return (
    <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <audio ref={loop.audioElRef} src={loop.objectUrl ?? undefined} hidden />
      <button
        type="button"
        className={`speak-button${loop.isLooping ? ' speaking' : ''}`}
        onClick={() => void loop.toggleLoop(span)}
      >
        🔁 {loop.isLooping ? 'Looping…' : label}
      </button>
      {loop.playbackError ? <span className="muted">{loop.playbackError}</span> : null}
    </div>
  );
}

/** One trial: resolves both clips' isolated spans, then walks guess → reveal. */
function TrialView({
  trial,
  onNext,
  isLast,
}: {
  trial: MinimalPairTrial<PitchAccentMinimalPairOccurrence>;
  onNext: () => void;
  isLast: boolean;
}) {
  const { a, b, sameBook } = trial;
  const clipA = useMinimalPairClip(a);
  const clipB = useMinimalPairClip(b);
  // Coin flip for which clip plays first — fixed for this trial's lifetime
  // (the parent remounts this component per trial via `key`).
  const [flipped] = useState(() => Math.random() < 0.5);
  const [guess, setGuess] = useState<Slot | null>(null);

  // `a` is the trial's quiz target — whichever slot it landed in is correct.
  const correctSlot: Slot = flipped ? 'second' : 'first';
  const moraCount = segmentIntoMorae(a.reading).length;

  if (clipA.span === undefined || clipB.span === undefined) {
    return <p className="muted">Loading clips…</p>;
  }
  if (!clipA.span || !clipB.span) {
    return (
      <div className="stack" style={{ gap: '0.4rem' }}>
        <p className="muted">
          Couldn't isolate one of these two words from its clip this time.
        </p>
        <button type="button" onClick={onNext}>
          {isLast ? 'Finish' : 'Skip to next pair'}
        </button>
      </div>
    );
  }

  const first = flipped ? b : a;
  const second = flipped ? a : b;
  // Non-null: both branches already checked above.
  const firstSpan = (flipped ? clipB.span : clipA.span)!;
  const secondSpan = (flipped ? clipA.span : clipB.span)!;
  const firstBlob = flipped ? clipB.blob : clipA.blob;
  const secondBlob = flipped ? clipA.blob : clipB.blob;

  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <div>
        <strong>{a.reading}</strong> — {a.expression} ({describePattern(a.position, moraCount)})
        {' vs. '}
        {b.expression} ({describePattern(b.position, moraCount)})
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        {sameBook
          ? 'Same book — likely the same speaker.'
          : 'Different books — likely two different speakers.'}
      </p>
      <TrialClip label="Clip 1" audioId={first.audio.id} blob={firstBlob} span={firstSpan} />
      <TrialClip label="Clip 2" audioId={second.audio.id} blob={secondBlob} span={secondSpan} />
      <div className="muted">
        Which clip is {a.expression} ({a.meaning || a.reading})?
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setGuess('first')}>
          Clip 1
        </button>
        <button type="button" onClick={() => setGuess('second')}>
          Clip 2
        </button>
      </div>
      {guess ? (
        <div className="muted">
          {guess === correctSlot
            ? `✓ Right — Clip ${correctSlot === 'first' ? 1 : 2} was ${a.expression}.`
            : `✗ Actually Clip ${correctSlot === 'first' ? 1 : 2} was ${a.expression}.`}
        </div>
      ) : null}
      {guess ? (
        <button type="button" onClick={onNext}>
          {isLast ? 'Finish' : 'Next pair'}
        </button>
      ) : null}
    </div>
  );
}

export function PitchAccentMinimalPairWarmup({
  trials,
}: {
  trials: MinimalPairTrial<PitchAccentMinimalPairOccurrence>[];
}) {
  const [position, setPosition] = useState(0);

  if (trials.length === 0) return null;

  const done = position >= trials.length;
  const trial = trials[position];

  return (
    <div className="panel stack" style={{ gap: '0.5rem' }}>
      <strong>Same word, different accent</strong>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Real native clips of words that share a reading but not a pitch-accent shape. Guess
        which clip is which before checking — not graded, not saved.
      </p>
      {done ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            You've been through all {trials.length} pair{trials.length === 1 ? '' : 's'} available
            right now.
          </p>
          <div>
            <button type="button" onClick={() => setPosition(0)}>
              Start over
            </button>
          </div>
        </>
      ) : trial ? (
        <>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {position + 1} of {trials.length}
          </div>
          <TrialView
            key={`${trial.a.audio.id}:${trial.b.audio.id}`}
            trial={trial}
            onNext={() => setPosition(position + 1)}
            isLast={position + 1 >= trials.length}
          />
        </>
      ) : null}
    </div>
  );
}
