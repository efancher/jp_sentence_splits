import { useEffect, useMemo, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment, setSentenceVocabularyAudioRange } from '../db/repository';
import type { SentenceAudio, SentenceVocabulary } from '../domain/types';
import { useRangeLoop } from '../hooks/useRangeLoop';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { isolatedWordRange } from '../lib/isolatedWordRange';
import { PLAYBACK_SPEEDS, type TimeRangeMs } from '../lib/recording';

import { NativeAudioButton } from './NativeAudioButton';
import { WordAudioRangeEditor } from './WordAudioRangeEditor';

/**
 * Loops just one word's span of a sentence's reference recording — a model
 * of how a native actually says that word, in isolation. The span comes
 * from forced alignment (`isolatedWordRange`) unless the learner has
 * hand-corrected it via the "Adjust" editor (a `SentenceVocabulary`
 * `audioStartMs`/`audioEndMs` override, passed in as `link`). With neither
 * it degrades to a plain whole-sentence play button — but still offers
 * "Adjust", seeded with a rough duration-proportional guess, so the learner
 * can place the span by ear when alignment couldn't (see `proportionalSeed`).
 *
 * Plays through a local <audio> element + PlaybackCoordinator (which sets
 * `preservesPitch` so slowed playback keeps the pitch), not the
 * nativeAudioController singleton — that singleton has no range support.
 * Starting the loop stops the singleton so a full-sentence play and the
 * word loop can't overlap.
 *
 * The blob-fetch and loop/retry mechanics (including the Safari
 * WebKitBlobResource retry — user report card_issue_ed8e9e5e, 2026-09-11)
 * live in `useSentenceAudioBlob`/`useRangeLoop`, reused by the pitch
 * word-vs-phrase warm-up (`PitchWordPhraseWarmup`) to loop two independent
 * spans of the same clip.
 *
 * Extracted from PitchAccentNativeAudio (which now wraps it) so the
 * `word_listening` review card can reuse the same isolate-and-loop control.
 *
 * `wordOnly` strips it down to just the loop control (no whole-sentence
 * button, no "couldn't isolate" hint) and renders nothing at all when the
 * word can't be isolated — for callers that already provide their own
 * whole-sentence playback and only want this as optional scaffolding.
 */
export function SegmentLoopPlayer({
  audio,
  japanese,
  inlineReading,
  surfaceForm,
  link,
  loopLabel = 'Loop native word',
  loopingLabel = 'Looping word…',
  fallbackHint = 'Couldn’t isolate just the word — play the whole sentence instead.',
  wordOnly = false,
  onRangeChange,
  onLoopStart,
}: {
  audio: SentenceAudio;
  japanese: string;
  /** The sentence's ruby reading — lets the word span be cut at a mora boundary when the target ends inside an aligner token. */
  inlineReading?: string;
  surfaceForm: string;
  /** The occurrence's link — its `audioStartMs`/`audioEndMs`, when set,
   * override the alignment guess, and the "Adjust" editor writes back to it. */
  link?: SentenceVocabulary;
  loopLabel?: string;
  loopingLabel?: string;
  fallbackHint?: string;
  wordOnly?: boolean;
  /** Reports the span the loop plays (hand override, else the alignment's), or null while unknown — lets a caller draw that same span's measured pitch. */
  onRangeChange?: (range: TimeRangeMs | null) => void;
  /** Fires each time the learner starts (not stops) the loop — usage tracking. */
  onLoopStart?: () => void;
}) {
  const blob = useSentenceAudioBlob(audio);
  const {
    audioElRef,
    objectUrl,
    isLooping,
    playbackError,
    speed,
    setSpeed,
    toggleLoop: toggleRangeLoop,
    cancel: cancelLoop,
  } = useRangeLoop(audio.id, blob);
  const [autoRange, setAutoRange] = useState<TimeRangeMs | null>(null);
  const [alignmentResolved, setAlignmentResolved] = useState(false);
  const [editing, setEditing] = useState(false);

  // Manual override — seeded from the link, then owned locally so a drag
  // reflects instantly without waiting on the DB write / a parent refresh.
  const [override, setOverride] = useState<TimeRangeMs | null>(() =>
    link?.audioStartMs != null && link?.audioEndMs != null
      ? { startMs: link.audioStartMs, endMs: link.audioEndMs }
      : null,
  );
  useEffect(() => {
    setOverride(
      link?.audioStartMs != null && link?.audioEndMs != null
        ? { startMs: link.audioStartMs, endMs: link.audioEndMs }
        : null,
    );
  }, [link?.id, link?.audioStartMs, link?.audioEndMs]);

  const range = override ?? autoRange;
  const rangeStartMs = range?.startMs;
  const rangeEndMs = range?.endMs;
  useEffect(() => {
    onRangeChange?.(
      rangeStartMs != null && rangeEndMs != null ? { startMs: rangeStartMs, endMs: rangeEndMs } : null,
    );
    // Deliberately keyed on the values, not the callback: an inline arrow
    // from the parent would otherwise re-fire this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStartMs, rangeEndMs]);

  // When forced alignment can't place the word (off-tailnet, OOV contraction,
  // degenerate span) there's no `range` at all — and without one the "Adjust"
  // editor was unreachable, so a learner had no recourse. Offer a crude
  // duration-proportional guess (target's character span × clip length) purely
  // as a starting point to drag from; it's never looped or persisted until the
  // learner actually adjusts it. Needs a `link` to save to and a known
  // duration. `wordOnly` callers have their own whole-sentence playback and
  // don't want this.
  const proportionalSeed = useMemo<TimeRangeMs | null>(() => {
    if (range || wordOnly || !link || !alignmentResolved) return null;
    const charIndex = japanese.indexOf(surfaceForm);
    if (charIndex === -1 || surfaceForm.length === 0 || !audio.durationMs) return null;
    const rawStart = (charIndex / japanese.length) * audio.durationMs;
    const rawEnd = ((charIndex + surfaceForm.length) / japanese.length) * audio.durationMs;
    const mid = (rawStart + rawEnd) / 2;
    const half = Math.max((rawEnd - rawStart) / 2, 300);
    return {
      startMs: Math.round(Math.max(0, mid - half)),
      endMs: Math.round(Math.min(audio.durationMs, mid + half)),
    };
  }, [range, wordOnly, link, alignmentResolved, japanese, surfaceForm, audio.durationMs]);

  // What the loop button plays and the editor seeds from: a real range if we
  // have one, else the guess while the editor is open (for a drag preview).
  const editRange = range ?? (editing ? proportionalSeed : null);

  useEffect(() => {
    let cancelled = false;
    setAutoRange(null);
    setAlignmentResolved(false);
    if (!blob) return;
    void loadOrComputeAlignment(
      audio.id,
      blob,
      japanese,
      getReferenceAlignment,
      saveReferenceAlignment,
    ).then((result) => {
      if (cancelled) return;
      setAutoRange(result ? isolatedWordRange(result.words, japanese, surfaceForm, { inlineReading }) : null);
      setAlignmentResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, blob, japanese, inlineReading, surfaceForm]);

  async function toggleLoop() {
    if (!editRange) return;
    if (!isLooping) onLoopStart?.();
    await toggleRangeLoop(editRange);
  }

  const persistOverride = (next: TimeRangeMs | null) => {
    setOverride(next);
    cancelLoop();
    if (link) void setSentenceVocabularyAudioRange(link.id, next);
  };

  // Live drag: update the range the loop button uses, without a DB write per
  // pointer move — `persistOverride` runs on drag end / snap / reset.
  const previewOverride = (next: TimeRangeMs) => setOverride(next);

  const canEdit = !!link && !!blob && (!!range || !!proportionalSeed);

  if (!blob) return null;
  // wordOnly: this control is optional scaffolding — show nothing rather
  // than a bare whole-sentence button when the word can't be isolated.
  if (wordOnly && !range) return null;

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <audio ref={audioElRef} src={objectUrl ?? undefined} hidden />
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {editRange ? (
          <button
            type="button"
            className={`speak-button${isLooping ? ' speaking' : ''}`}
            aria-label={isLooping ? 'Stop looping the native word' : 'Loop the native word'}
            aria-pressed={isLooping}
            onClick={() => void toggleLoop()}
          >
            {isLooping ? `🔁 ${loopingLabel}` : `🔁 ${loopLabel}`}
          </button>
        ) : null}
        {wordOnly ? null : (
          <NativeAudioButton
            audio={audio}
            displayLabel="Whole sentence"
            onPlay={cancelLoop}
          />
        )}
        {editRange ? (
          <label>
            Speed{' '}
            <select
              value={speed}
              onChange={(event) => {
                const next = Number(event.target.value);
                cancelLoop();
                setSpeed(next);
              }}
            >
              {PLAYBACK_SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value === 1 ? '1×' : `${value}×`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? 'Done' : override ? 'Adjusted' : 'Adjust'}
          </button>
        ) : null}
      </div>
      {canEdit && editing && editRange ? (
        <WordAudioRangeEditor
          blob={blob}
          value={editRange}
          hasOverride={!!override}
          onChange={previewOverride}
          onCommit={persistOverride}
          onReset={() => persistOverride(null)}
        />
      ) : null}
      {!range && alignmentResolved ? (
        <div className="muted">
          {proportionalSeed && !editing
            ? 'Couldn’t isolate just the word — tap Adjust to set it by ear.'
            : proportionalSeed
              ? 'Drag the edges onto the word, then Done.'
              : fallbackHint}
        </div>
      ) : null}
      {playbackError ? <div className="muted">{playbackError}</div> : null}
    </div>
  );
}
