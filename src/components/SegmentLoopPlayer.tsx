import { useEffect, useMemo, useRef, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment, setSentenceVocabularyAudioRange } from '../db/repository';
import type { SentenceAudio, SentenceVocabulary } from '../domain/types';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { isolatedWordRange } from '../lib/isolatedWordRange';
import { nativeAudioController } from '../lib/nativeAudio';
import { PlaybackCoordinator, PLAYBACK_SPEEDS, type TimeRangeMs } from '../lib/recording';

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
  surfaceForm,
  link,
  loopLabel = 'Loop native word',
  loopingLabel = 'Looping word…',
  fallbackHint = 'Couldn’t isolate just the word — play the whole sentence instead.',
  wordOnly = false,
}: {
  audio: SentenceAudio;
  japanese: string;
  surfaceForm: string;
  /** The occurrence's link — its `audioStartMs`/`audioEndMs`, when set,
   * override the alignment guess, and the "Adjust" editor writes back to it. */
  link?: SentenceVocabulary;
  loopLabel?: string;
  loopingLabel?: string;
  fallbackHint?: string;
  wordOnly?: boolean;
}) {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const coordinatorRef = useRef(new PlaybackCoordinator());
  const [blob, setBlob] = useState<Blob | null>(
    audio.blob && audio.blob.size > 0 ? audio.blob : null,
  );
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [autoRange, setAutoRange] = useState<TimeRangeMs | null>(null);
  const [alignmentResolved, setAlignmentResolved] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
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

  // Metadata-only row (audio synced from another device, blob not
  // downloaded yet) — fetch the clip before it can be looped.
  useEffect(() => {
    if (blob) return;
    let cancelled = false;
    void import('../sync/audioSync').then(async ({ repairSentenceAudio }) => {
      const fetched = await repairSentenceAudio(audio.id);
      if (!cancelled && fetched) setBlob(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, blob]);

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
      setAutoRange(result ? isolatedWordRange(result.words, japanese, surfaceForm) : null);
      setAlignmentResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, blob, japanese, surfaceForm]);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => {
      coordinator.cancel();
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [blob]);

  async function toggleLoop() {
    if (isLooping) {
      coordinatorRef.current.cancel();
      setIsLooping(false);
      return;
    }
    const el = audioElRef.current;
    if (!el || !editRange) return;
    nativeAudioController.stop();
    setIsLooping(true);
    try {
      await coordinatorRef.current.loopRange(el, editRange, speed);
    } finally {
      setIsLooping(false);
    }
  }

  const persistOverride = (next: TimeRangeMs | null) => {
    setOverride(next);
    coordinatorRef.current.cancel();
    setIsLooping(false);
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
            onPlay={() => {
              coordinatorRef.current.cancel();
              setIsLooping(false);
            }}
          />
        )}
        {editRange ? (
          <label>
            Speed{' '}
            <select
              value={speed}
              onChange={(event) => {
                const next = Number(event.target.value);
                coordinatorRef.current.cancel();
                setIsLooping(false);
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
    </div>
  );
}
