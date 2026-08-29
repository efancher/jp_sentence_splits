import { useEffect, useRef, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { isolatedWordRange } from '../lib/isolatedWordRange';
import { nativeAudioController } from '../lib/nativeAudio';
import { PlaybackCoordinator, PLAYBACK_SPEEDS, type TimeRangeMs } from '../lib/recording';

import { NativeAudioButton } from './NativeAudioButton';

/**
 * Pitch-accent review reveal (ReviewPage `pitch_accent` card): when the
 * sentence has a native recording, lets the learner loop just the target
 * word — a model of how a native actually realizes the accent, next to the
 * dictionary contour diagram. Isolation needs forced alignment; when that
 * is unavailable it degrades to a plain whole-sentence play button.
 *
 * Plays through a local <audio> element + PlaybackCoordinator (which sets
 * `preservesPitch` so slowed playback keeps the pitch), not the
 * nativeAudioController singleton — that singleton has no range support.
 * Starting the loop stops the singleton so a full-sentence play and the
 * word loop can't overlap.
 */
export function PitchAccentNativeAudio({
  audio,
  japanese,
  surfaceForm,
}: {
  audio: SentenceAudio;
  japanese: string;
  surfaceForm: string;
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
            {isLooping ? '🔁 Looping word…' : '🔁 Loop native word'}
          </button>
        ) : null}
        <NativeAudioButton
          audio={audio}
          displayLabel="Whole sentence"
          onPlay={() => {
            coordinatorRef.current.cancel();
            setIsLooping(false);
          }}
        />
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
      {!range && alignmentResolved ? (
        <div className="muted">
          Couldn’t isolate just the word — play the whole sentence for the native model.
        </div>
      ) : null}
    </div>
  );
}
