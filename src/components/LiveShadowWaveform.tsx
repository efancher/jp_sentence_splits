import { useEffect, useMemo, useRef, useState } from 'react';

import { estimateFramePitch, extractPitch, hzToRelativeSemitones, medianHz } from '../lib/pitch';
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
  gentleLiveGain,
  livePeaksFromAmplitudes,
  peakMagnitude,
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
/** Voiced-frame count before the learner's running median is stable enough to normalize against. */
const LIVE_PITCH_MIN_VOICED_FRAMES = 5;
/**
 * Drop a live frame whose pitch sits more than this far from the running
 * median — an octave error (±12 st) or other single-frame YIN glitch, which
 * would otherwise draw as a spike. Legit speech stays inside the ±8 display.
 */
const LIVE_PITCH_OUTLIER_SEMITONES = 10;

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
  const [liveMedianHz, setLiveMedianHz] = useState<number | null>(null);
  const [playheadIndex, setPlayheadIndex] = useState(0);
  const [error, setError] = useState<string>();
  /** Per-bucket max-abs amplitude for the *current* rep; display gain is applied at render. */
  const liveAmpRef = useRef<number[]>([]);
  /** Per-bucket sum / count of voiced Hz readings in the current rep — averaged at render, like the reference contour. */
  const liveHzSumRef = useRef<number[]>([]);
  const liveHzCountRef = useRef<number[]>([]);
  /** Every voiced Hz reading across all reps this loop — a slow-moving normalization centre so the contour doesn't jump each rep. */
  const liveVoicedHzRef = useRef<number[]>([]);
  /** Last raw media time, to spot the reference `<audio loop>` wrapping back to the start of a new rep. */
  const lastMediaTimeRef = useRef(0);
  const referenceMagnitudeRef = useRef(0);
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
        referenceMagnitudeRef.current = peakMagnitude(wave.peaks);
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
    liveAmpRef.current = new Array<number>(buckets).fill(0);
    liveHzSumRef.current = new Array<number>(buckets).fill(0);
    liveHzCountRef.current = new Array<number>(buckets).fill(0);
    liveVoicedHzRef.current = [];
    lastMediaTimeRef.current = 0;
    setLivePeaks(emptyLivePeaks(buckets));
    setLivePitchBuckets(emptyLivePitchBuckets(buckets));
    setLiveMedianHz(null);
    setPlayheadIndex(0);
    frameCountRef.current = 0;

    if (!analyser || durationSeconds <= 0) return;

    const samples = new Float32Array(analyser.fftSize);

    // Wipe the per-bucket amplitude/pitch buffers at the top of each rep. Without
    // this the contour accretes every past rep's one-shot frames into one
    // ever-denser line that reads as a growing vibration around the median.
    const startRep = () => {
      liveAmpRef.current.fill(0);
      liveHzSumRef.current.fill(0);
      liveHzCountRef.current.fill(0);
    };

    const tick = () => {
      const rawMediaTime = getMediaTimeRef.current();
      if (lastMediaTimeRef.current - rawMediaTime > durationSeconds / 2) startRep();
      lastMediaTimeRef.current = rawMediaTime;
      // Shift left by output latency so drawing tracks what you hear over AirPods.
      const mediaTime = Math.max(0, rawMediaTime - SHADOW_OUTPUT_LATENCY_SECONDS);
      const progress = Math.min(1, Math.max(0, mediaTime / durationSeconds));
      const index = Math.min(buckets - 1, Math.floor(progress * buckets));

      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      if (index >= 0 && index < buckets) {
        liveAmpRef.current[index] = Math.max(liveAmpRef.current[index] ?? 0, peak);
      }

      frameCountRef.current += 1;
      if (frameCountRef.current % PITCH_ESTIMATE_EVERY_N_FRAMES === 0) {
        const frameStart = Math.max(0, samples.length - LIVE_PITCH_FRAME_SAMPLES);
        const frame = samples.subarray(frameStart);
        const estimated = estimateFramePitch(frame, sampleRate);
        if (estimated.voiced && estimated.hz !== null && index >= 0 && index < buckets) {
          const runningMedian =
            liveVoicedHzRef.current.length >= LIVE_PITCH_MIN_VOICED_FRAMES
              ? medianHz(liveVoicedHzRef.current)
              : null;
          const isOutlier =
            runningMedian !== null &&
            Math.abs(hzToRelativeSemitones(estimated.hz, runningMedian)) >
              LIVE_PITCH_OUTLIER_SEMITONES;
          if (!isOutlier) {
            liveHzSumRef.current[index] = (liveHzSumRef.current[index] ?? 0) + estimated.hz;
            liveHzCountRef.current[index] = (liveHzCountRef.current[index] ?? 0) + 1;
            liveVoicedHzRef.current.push(estimated.hz);
          }
        }
      }

      // Gain is derived from this rep's levels; the pitch centre (median) is
      // pooled across every rep so the contour's vertical position stays put
      // while its shape is redrawn fresh each rep.
      let liveMagnitude = 0;
      for (const amplitude of liveAmpRef.current) liveMagnitude = Math.max(liveMagnitude, amplitude);
      const gain = gentleLiveGain(liveMagnitude, referenceMagnitudeRef.current);
      // Wait for a few readings before drawing the contour so the median
      // (and thus the whole normalized line) isn't thrashing on the first
      // one or two voiced frames.
      const median =
        liveVoicedHzRef.current.length >= LIVE_PITCH_MIN_VOICED_FRAMES
          ? medianHz(liveVoicedHzRef.current)
          : null;

      setPlayheadIndex(index);
      setLivePeaks(livePeaksFromAmplitudes(liveAmpRef.current, gain));
      setLiveMedianHz(median);
      setLivePitchBuckets(
        liveHzCountRef.current.map((count, bucket) => {
          if (!count || !median || median <= 0) return null;
          const bucketHz = (liveHzSumRef.current[bucket] ?? 0) / count;
          return hzToRelativeSemitones(bucketHz, median);
        }),
      );
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
        <span className="muted">Live shadow waveform (your level auto-boosted toward the reference)</span>
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
          Gold is your live voice vs the reference contour — each is centred on its
          own median pitch, so match the shape, not the height
          {referenceMedianHz ? ` (ref ${Math.round(referenceMedianHz)} Hz` : ''}
          {referenceMedianHz && liveMedianHz ? `, you ${Math.round(liveMedianHz)} Hz` : ''}
          {referenceMedianHz ? ')' : ''}
          {active ? '' : ' — start recording to draw'}.
        </p>
      </div>
    </div>
  );
}
