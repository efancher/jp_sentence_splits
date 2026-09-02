import { useEffect, useRef, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { isolatedWordRange } from '../lib/isolatedWordRange';
import { nativeAudioController } from '../lib/nativeAudio';
import { PlaybackCoordinator, PLAYBACK_SPEEDS, type TimeRangeMs } from '../lib/recording';

import { NativeAudioButton } from './NativeAudioButton';

/**
 * Loops just one word's span of a sentence's reference recording — a model
 * of how a native actually says that word, in isolation. Isolation needs
 * forced alignment (`isolatedWordRange`); when that is unavailable it
 * degrades to a plain whole-sentence play button.
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
  loopLabel = 'Loop native word',
  loopingLabel = 'Looping word…',
  fallbackHint = 'Couldn’t isolate just the word — play the whole sentence instead.',
  wordOnly = false,
}: {
  audio: SentenceAudio;
  japanese: string;
  surfaceForm: string;
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
  const [range, setRange] = useState<TimeRangeMs | null>(null);
  const [alignmentResolved, setAlignmentResolved] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);

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
    setRange(null);
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
      setRange(result ? isolatedWordRange(result.words, japanese, surfaceForm) : null);
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
    if (!el || !range) return;
    nativeAudioController.stop();
    setIsLooping(true);
    try {
      await coordinatorRef.current.loopRange(el, range, speed);
    } finally {
      setIsLooping(false);
    }
  }

  if (!blob) return null;
  // wordOnly: this control is optional scaffolding — show nothing rather
  // than a bare whole-sentence button when the word can't be isolated.
  if (wordOnly && !range) return null;

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <audio ref={audioElRef} src={objectUrl ?? undefined} hidden />
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {range ? (
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
        {range ? (
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
      </div>
      {!range && alignmentResolved ? <div className="muted">{fallbackHint}</div> : null}
    </div>
  );
}
