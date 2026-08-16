import { useEffect, useMemo, useRef, useState } from 'react';

import {
  LIVE_WAVEFORM_BUCKETS,
  SHADOW_OUTPUT_LATENCY_SECONDS,
  emptyLivePeaks,
  mergeLivePeak,
  peaksFromBlob,
  peaksToPolyline,
  type WavePeak,
} from '../lib/waveform';

const VIEW_WIDTH = 600;
const WAVE_HEIGHT = 96;

/**
 * Ported (amplitude-only) from
 * ~/projects/shadowing/web/src/components/LiveShadowWaveform.tsx for Phase
 * 8.3. The pitch-contour half of the original component is deliberately
 * not ported yet — it needs the DSP port that's Phase 8.4's scope.
 */
export function LiveShadowWaveform({
  referenceBlob,
  active,
  getMediaTime,
  analyser,
}: {
  referenceBlob: Blob;
  active: boolean;
  /** Current reference media time in seconds (shadow player clock). */
  getMediaTime: () => number;
  /** Shared analyser from ShadowReferencePlayer (do not open a second AudioContext). */
  analyser: AnalyserNode | undefined;
}) {
  const [referencePeaks, setReferencePeaks] = useState<WavePeak[]>([]);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [livePeaks, setLivePeaks] = useState<WavePeak[]>([]);
  const [playheadIndex, setPlayheadIndex] = useState(0);
  const [error, setError] = useState<string>();
  const livePeaksRef = useRef<WavePeak[]>([]);
  const rafRef = useRef<number | undefined>(undefined);
  const getMediaTimeRef = useRef(getMediaTime);
  getMediaTimeRef.current = getMediaTime;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void (async () => {
      try {
        if (!referenceBlob.size) throw new Error('Reference audio is missing.');
        const wave = await peaksFromBlob(referenceBlob, LIVE_WAVEFORM_BUCKETS);
        if (cancelled) return;
        setReferencePeaks(wave.peaks);
        setDurationSeconds(wave.durationSeconds);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Could not load reference waveform.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [referenceBlob]);

  useEffect(() => {
    if (!active) {
      setPlayheadIndex(0);
      return;
    }
    const buckets = referencePeaks.length || LIVE_WAVEFORM_BUCKETS;
    livePeaksRef.current = emptyLivePeaks(buckets);
    setLivePeaks(livePeaksRef.current.slice());
    setPlayheadIndex(0);

    if (!analyser || durationSeconds <= 0) return;

    const samples = new Float32Array(analyser.fftSize);

    const tick = () => {
      // Shift left by output latency so drawing tracks what you hear over AirPods.
      const mediaTime = Math.max(0, getMediaTimeRef.current() - SHADOW_OUTPUT_LATENCY_SECONDS);
      const progress = Math.min(1, Math.max(0, mediaTime / durationSeconds));
      const index = Math.min(buckets - 1, Math.floor(progress * buckets));

      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      mergeLivePeak(livePeaksRef.current, index, peak);

      setPlayheadIndex(index);
      setLivePeaks(livePeaksRef.current.slice());
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [active, analyser, durationSeconds, referencePeaks.length]);

  const referenceLine = useMemo(
    () => peaksToPolyline(referencePeaks, VIEW_WIDTH, WAVE_HEIGHT),
    [referencePeaks],
  );
  const liveLine = useMemo(
    () =>
      peaksToPolyline(livePeaks, VIEW_WIDTH, WAVE_HEIGHT, active ? playheadIndex : livePeaks.length - 1),
    [active, livePeaks, playheadIndex],
  );
  const playheadX =
    referencePeaks.length > 1
      ? (playheadIndex / Math.max(1, referencePeaks.length - 1)) * VIEW_WIDTH
      : 0;

  if (error) return <p className="muted">{error}</p>;
  if (referencePeaks.length === 0) {
    return <p className="muted">Loading live waveform…</p>;
  }

  return (
    <div className="stack">
      <span className="muted">Live shadow waveform</span>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${WAVE_HEIGHT}`}
        role="img"
        aria-label="Reference and live recording waveform"
        style={{ width: '100%', height: WAVE_HEIGHT, color: 'var(--text-muted)' }}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={referenceLine}
        />
        {liveLine && (
          <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" points={liveLine} />
        )}
        {active && (
          <line
            x1={playheadX}
            x2={playheadX}
            y1="0"
            y2={WAVE_HEIGHT}
            stroke="var(--warning)"
            strokeWidth="2"
          />
        )}
      </svg>
    </div>
  );
}
