import { useEffect, useMemo, useRef, useState } from 'react';

import { estimateFramePitch, extractPitch, hzToRelativeSemitones } from '../lib/pitch';
import {
  LIVE_PITCH_DISPLAY_MAX_SEMITONES,
  LIVE_PITCH_DISPLAY_MIN_SEMITONES,
  LIVE_PITCH_FRAME_SAMPLES,
  LIVE_WAVEFORM_BUCKETS,
  SHADOW_OUTPUT_LATENCY_SECONDS,
  canonicalizeAudioBuffer,
  decodeAudioBuffer,
  emptyLivePeaks,
  emptyLivePitchBuckets,
  mergeLivePeak,
  peaksFromBlob,
  peaksToPolyline,
  pitchBucketsToPolyline,
  pitchFramesToBucketSemitones,
  type WavePeak,
} from '../lib/waveform';

const VIEW_WIDTH = 600;
const WAVE_HEIGHT = 96;
const PITCH_HEIGHT = 120;
const PITCH_ESTIMATE_EVERY_N_FRAMES = 2;

/**
 * Ported from ~/projects/shadowing/web/src/components/LiveShadowWaveform.tsx.
 * Amplitude-only landed in Phase 8.3; the pitch-contour half (deferred at
 * the time, since it needed the DSP port that's Phase 8.4a's scope)
 * landed here. One adaptation kept from 8.3: takes a `referenceBlob` prop
 * directly instead of a DB asset-id lookup.
 */
export function LiveShadowWaveform({
  referenceBlob,
  active,
  getMediaTime,
  analyser,
  sampleRate = 48_000,
}: {
  referenceBlob: Blob;
  active: boolean;
  /** Current reference media time in seconds (shadow player clock). */
  getMediaTime: () => number;
  /** Shared analyser from ShadowReferencePlayer (do not open a second AudioContext). */
  analyser: AnalyserNode | undefined;
  sampleRate?: number;
}) {
  const [referencePeaks, setReferencePeaks] = useState<WavePeak[]>([]);
  const [referencePitchBuckets, setReferencePitchBuckets] = useState<Array<number | null>>([]);
  const [referenceMedianHz, setReferenceMedianHz] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [livePeaks, setLivePeaks] = useState<WavePeak[]>([]);
  const [livePitchBuckets, setLivePitchBuckets] = useState<Array<number | null>>([]);
  const [playheadIndex, setPlayheadIndex] = useState(0);
  const [error, setError] = useState<string>();
  const livePeaksRef = useRef<WavePeak[]>([]);
  const livePitchRef = useRef<Array<number | null>>([]);
  const referenceMedianRef = useRef<number | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const frameCountRef = useRef(0);
  const getMediaTimeRef = useRef(getMediaTime);
  getMediaTimeRef.current = getMediaTime;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void (async () => {
      try {
        if (!referenceBlob.size) throw new Error('Reference audio is missing.');
        const [wave, buffer] = await Promise.all([
          peaksFromBlob(referenceBlob, LIVE_WAVEFORM_BUCKETS),
          decodeAudioBuffer(referenceBlob),
        ]);
        const pitch = extractPitch(canonicalizeAudioBuffer(buffer));
        if (cancelled) return;
        setReferencePeaks(wave.peaks);
        setDurationSeconds(wave.durationSeconds);
        setReferenceMedianHz(pitch.medianHz);
        referenceMedianRef.current = pitch.medianHz;
        setReferencePitchBuckets(
          pitchFramesToBucketSemitones(pitch.frames, wave.durationSeconds, LIVE_WAVEFORM_BUCKETS),
        );
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
    livePitchRef.current = emptyLivePitchBuckets(buckets);
    setLivePeaks(livePeaksRef.current.slice());
    setLivePitchBuckets(livePitchRef.current.slice());
    setPlayheadIndex(0);
    frameCountRef.current = 0;

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

      frameCountRef.current += 1;
      if (frameCountRef.current % PITCH_ESTIMATE_EVERY_N_FRAMES === 0) {
        const frameStart = Math.max(0, samples.length - LIVE_PITCH_FRAME_SAMPLES);
        const frame = samples.subarray(frameStart);
        const estimated = estimateFramePitch(frame, sampleRate);
        const median = referenceMedianRef.current;
        if (estimated.voiced && estimated.hz !== null && median && median > 0) {
          livePitchRef.current[index] = hzToRelativeSemitones(estimated.hz, median);
        }
      }

      setPlayheadIndex(index);
      setLivePeaks(livePeaksRef.current.slice());
      setLivePitchBuckets(livePitchRef.current.slice());
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [active, analyser, durationSeconds, referencePeaks.length, sampleRate]);

  const referenceLine = useMemo(
    () => peaksToPolyline(referencePeaks, VIEW_WIDTH, WAVE_HEIGHT),
    [referencePeaks],
  );
  const liveLine = useMemo(
    () =>
      peaksToPolyline(livePeaks, VIEW_WIDTH, WAVE_HEIGHT, active ? playheadIndex : livePeaks.length - 1),
    [active, livePeaks, playheadIndex],
  );
  const referencePitchLine = useMemo(
    () =>
      pitchBucketsToPolyline(
        referencePitchBuckets,
        VIEW_WIDTH,
        PITCH_HEIGHT,
        LIVE_PITCH_DISPLAY_MIN_SEMITONES,
        LIVE_PITCH_DISPLAY_MAX_SEMITONES,
      ),
    [referencePitchBuckets],
  );
  const livePitchLine = useMemo(
    () =>
      pitchBucketsToPolyline(
        livePitchBuckets,
        VIEW_WIDTH,
        PITCH_HEIGHT,
        LIVE_PITCH_DISPLAY_MIN_SEMITONES,
        LIVE_PITCH_DISPLAY_MAX_SEMITONES,
        active ? playheadIndex : livePitchBuckets.length - 1,
      ),
    [active, livePitchBuckets, playheadIndex],
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
      <div className="stack">
        <span className="muted">Live shadow waveform</span>
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${WAVE_HEIGHT}`}
          role="img"
          aria-label="Reference and live recording waveform"
          style={{ width: '100%', height: WAVE_HEIGHT, color: 'var(--text-muted)' }}
        >
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={referenceLine} />
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

      <div className="stack">
        <span className="muted">Live shadow pitch (speaker-normalized)</span>
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${PITCH_HEIGHT}`}
          role="img"
          aria-label="Reference and live pitch contour"
          style={{ width: '100%', height: PITCH_HEIGHT, color: 'var(--text-muted)' }}
        >
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={referencePitchLine} />
          {livePitchLine && (
            <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" points={livePitchLine} />
          )}
          {active && (
            <line
              x1={playheadX}
              x2={playheadX}
              y1="0"
              y2={PITCH_HEIGHT}
              stroke="var(--warning)"
              strokeWidth="2"
            />
          )}
        </svg>
        <p className="muted">
          Gold is your live voice vs the reference contour
          {referenceMedianHz ? ` (ref median ${Math.round(referenceMedianHz)} Hz)` : ''}
          {active ? '' : ' — start recording to draw'}.
        </p>
      </div>
    </div>
  );
}
