import { useEffect, useState } from 'react';

import { getReferencePitchTrack, saveReferencePitchTrack } from '../db/repository';
import { cropPitchPayload } from '../lib/oddEarOut';
import { pitchSemitoneRange, type PitchAnalysisPayload } from '../lib/pitch';
import type { TimeRangeMs } from '../lib/recording';
import { loadOrComputeReferencePitch } from '../lib/referencePitchCache';

import { MeasuredPitchContour } from './MeasuredPitchContour';

/**
 * The measured pitch of just one word's span, cropped out of its sentence
 * clip's cached track (`loadOrComputeReferencePitch`, so the YIN pass is
 * shared with every other surface showing that clip). Renders nothing while
 * the blob/track is unavailable — a decode failure is an ordinary condition
 * (some iOS contexts have no working AudioContext), not an error to show.
 *
 * Scales against the *whole clip's* semitone extent (`pitchSemitoneRange`),
 * not just this crop's own — otherwise a narrow word-only slice of pitch
 * movement gets stretched to fill the same chart height as the full
 * sentence would, making the same real contour look artificially steep
 * next to any other view of the same clip.
 */
export function WordPitchContour({
  audioId,
  blob,
  span,
  label = 'Measured pitch',
  ariaLabel,
  height = 40,
}: {
  audioId: string;
  blob: Blob | null;
  span: TimeRangeMs | null;
  label?: string;
  ariaLabel: string;
  height?: number;
}) {
  const [state, setState] = useState<
    { payload: PitchAnalysisPayload; scaleRange?: { min: number; max: number } } | undefined
  >(undefined);
  const startMs = span?.startMs;
  const endMs = span?.endMs;
  useEffect(() => {
    setState(undefined);
    if (!blob || startMs == null || endMs == null) return;
    let cancelled = false;
    void loadOrComputeReferencePitch(audioId, blob, getReferencePitchTrack, saveReferencePitchTrack).then(
      (track) => {
        if (cancelled || !track) return;
        setState({
          payload: cropPitchPayload(track, { startMs, endMs }),
          scaleRange: pitchSemitoneRange(track),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [audioId, blob, startMs, endMs]);
  if (!state) return null;
  return (
    <MeasuredPitchContour
      payload={state.payload}
      scaleRange={state.scaleRange}
      label={label}
      ariaLabel={ariaLabel}
      height={height}
    />
  );
}
