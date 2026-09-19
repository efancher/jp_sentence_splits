import { useEffect, useState } from 'react';

import { getReferencePitchTrack, saveReferencePitchTrack } from '../db/repository';
import { cropPitchPayload } from '../lib/oddEarOut';
import type { PitchAnalysisPayload } from '../lib/pitch';
import type { TimeRangeMs } from '../lib/recording';
import { loadOrComputeReferencePitch } from '../lib/referencePitchCache';

import { MeasuredPitchContour } from './MeasuredPitchContour';

/**
 * The measured pitch of just one word's span, cropped out of its sentence
 * clip's cached track (`loadOrComputeReferencePitch`, so the YIN pass is
 * shared with every other surface showing that clip). Renders nothing while
 * the blob/track is unavailable — a decode failure is an ordinary condition
 * (some iOS contexts have no working AudioContext), not an error to show.
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
  const [payload, setPayload] = useState<PitchAnalysisPayload | undefined>(undefined);
  const startMs = span?.startMs;
  const endMs = span?.endMs;
  useEffect(() => {
    setPayload(undefined);
    if (!blob || startMs == null || endMs == null) return;
    let cancelled = false;
    void loadOrComputeReferencePitch(audioId, blob, getReferencePitchTrack, saveReferencePitchTrack).then(
      (track) => {
        if (!cancelled && track) setPayload(cropPitchPayload(track, { startMs, endMs }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [audioId, blob, startMs, endMs]);
  if (!payload) return null;
  return <MeasuredPitchContour payload={payload} label={label} ariaLabel={ariaLabel} height={height} />;
}
