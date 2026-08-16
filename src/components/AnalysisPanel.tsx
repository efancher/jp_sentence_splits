import { useEffect, useMemo, useState } from 'react';

import type { TimeRangeMs } from '../lib/recording';
import type { PitchAnalysisPayload } from '../lib/pitch';
import { extractPitch } from '../lib/pitch';
import { buildTimingObservations, confidenceFromSignal } from '../lib/timingObservations';
import {
  analyzeAlignment,
  canonicalizeAudioBuffer,
  decodeAudioBuffer,
  peaksToPolyline,
  sliceCanonicalAudio,
  type AlignmentMode,
  type WavePeak,
} from '../lib/waveform';

const WAVE_WIDTH = 600;
const WAVE_HEIGHT = 80;
const PITCH_WIDTH = 600;
const PITCH_HEIGHT = 120;
const ALIGNMENT_MODES: AlignmentMode[] = ['original', 'onset-aligned', 'time-normalized'];

/**
 * Ported from
 * ~/projects/shadowing/web/src/components/AnalysisPanel.tsx for Phase
 * 8.4b. Two deliberate adaptations: takes `referenceBlob`/`learnerBlob`
 * directly instead of DB asset ids (matching the Phase 8 blob-based
 * pattern established since 8.3), and skips the source's
 * `AnalysisService` caching layer (a `derivedAnalyses` table this app
 * doesn't have) — clips are short enough to just recompute on open.
 */
function PeakWaveform({ peaks, label }: { peaks: WavePeak[]; label: string }) {
  const points = useMemo(() => peaksToPolyline(peaks, WAVE_WIDTH, WAVE_HEIGHT), [peaks]);
  return (
    <div className="stack">
      <span className="muted">{label}</span>
      <svg
        viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
        role="img"
        aria-label={`${label} waveform`}
        style={{ width: '100%', height: WAVE_HEIGHT, color: 'var(--text-muted)' }}
      >
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
      </svg>
    </div>
  );
}

function PitchCanvas({
  pitch,
  label,
  mode,
  dashed,
}: {
  pitch?: PitchAnalysisPayload;
  label: string;
  mode: 'hz' | 'semitones';
  dashed?: boolean;
}) {
  const path = useMemo(() => {
    if (!pitch || pitch.frames.length === 0) return '';
    const values = pitch.frames
      .map((frame) => (mode === 'hz' ? frame.hz : frame.relativeSemitones))
      .filter((value): value is number => value !== null);
    if (values.length === 0) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.001, max - min);
    return pitch.frames
      .map((frame, index) => {
        const value = mode === 'hz' ? frame.hz : frame.relativeSemitones;
        if (value === null || !frame.voiced) return null;
        const x = (index / Math.max(1, pitch.frames.length - 1)) * PITCH_WIDTH;
        const y = PITCH_HEIGHT - ((value - min) / span) * (PITCH_HEIGHT - 12) - 6;
        return `${x},${y}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [pitch, mode]);

  return (
    <div className="stack">
      <span className="muted">{label}</span>
      <svg
        viewBox={`0 0 ${PITCH_WIDTH} ${PITCH_HEIGHT}`}
        role="img"
        aria-label={`${label} pitch contour`}
        style={{ width: '100%', height: PITCH_HEIGHT, color: 'var(--text-muted)' }}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={dashed ? '6 4' : undefined}
          points={path}
        />
      </svg>
    </div>
  );
}

export function AnalysisPanel({
  referenceBlob,
  learnerBlob,
  hasReading,
  durationHintSeconds,
  targetRange,
}: {
  referenceBlob: Blob;
  learnerBlob: Blob;
  hasReading: boolean;
  durationHintSeconds: number;
  /** Restricts the reference side to this sub-range (Phase 8.2's practice-target isolation). */
  targetRange?: TimeRangeMs;
}) {
  const [mode, setMode] = useState<AlignmentMode>('original');
  const [pitchMode, setPitchMode] = useState<'hz' | 'semitones'>('semitones');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [referencePitch, setReferencePitch] = useState<PitchAnalysisPayload>();
  const [learnerPitch, setLearnerPitch] = useState<PitchAnalysisPayload>();
  const [alignment, setAlignment] = useState<{
    referencePeaks: WavePeak[];
    learnerPeaks: WavePeak[];
    offsetSeconds: number;
    durationRatio: number;
    confidence: ReturnType<typeof confidenceFromSignal>;
  }>();

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        const referenceBuffer = await decodeAudioBuffer(referenceBlob);
        const referenceFull = canonicalizeAudioBuffer(referenceBuffer);
        const referenceCanonical = targetRange
          ? sliceCanonicalAudio(referenceFull, targetRange)
          : referenceFull;
        const learnerBuffer = await decodeAudioBuffer(learnerBlob);
        const learnerCanonical = canonicalizeAudioBuffer(learnerBuffer);
        const [refPitch, learnPitch, alignmentResult] = await Promise.all([
          Promise.resolve(extractPitch(referenceCanonical)),
          Promise.resolve(extractPitch(learnerCanonical)),
          analyzeAlignment(referenceBlob, learnerBlob, mode, targetRange),
        ]);
        if (!active) return;
        setReferencePitch(refPitch);
        setLearnerPitch(learnPitch);
        setAlignment({
          referencePeaks: alignmentResult.referencePeaks,
          learnerPeaks: alignmentResult.learnerPeaks,
          offsetSeconds: alignmentResult.offsetSeconds,
          durationRatio: alignmentResult.durationRatio,
          confidence: alignmentResult.confidence,
        });
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Analysis failed.');
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [referenceBlob, learnerBlob, mode, targetRange]);

  const confidence = confidenceFromSignal({
    hasReading,
    voicedRatio: Math.min(referencePitch?.voicedRatio ?? 0, learnerPitch?.voicedRatio ?? 0),
    alignmentConfidence: alignment?.confidence,
    origin: 'heuristic',
  });
  const observations = buildTimingObservations({
    referenceDuration: referencePitch?.durationSeconds ?? durationHintSeconds,
    learnerDuration: learnerPitch?.durationSeconds ?? durationHintSeconds,
    referencePitch,
    learnerPitch,
    confidence,
  });

  return (
    <div className="stack">
      <div className="row">
        {ALIGNMENT_MODES.map((value) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'primary' : undefined}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="muted">
        {mode === 'time-normalized'
          ? 'Time-normalized view compares contour shape. It does not mean your timing was correct.'
          : mode === 'onset-aligned'
            ? 'Onset-aligned view lines up detected speech starts.'
            : 'Original timing preserves real speed and pause differences.'}
      </p>
      {busy ? <p className="muted">Analyzing locally…</p> : null}
      {error ? <p className="muted">{error}</p> : null}
      {alignment ? (
        <>
          <PeakWaveform peaks={alignment.referencePeaks} label="Reference waveform" />
          <PeakWaveform peaks={alignment.learnerPeaks} label="Learner waveform" />
          <p className="muted">
            Offset {alignment.offsetSeconds.toFixed(2)}s · duration ratio{' '}
            {alignment.durationRatio.toFixed(2)} · confidence {alignment.confidence}
          </p>
        </>
      ) : null}
      <div className="row">
        <button
          type="button"
          className={pitchMode === 'semitones' ? 'primary' : undefined}
          aria-pressed={pitchMode === 'semitones'}
          onClick={() => setPitchMode('semitones')}
        >
          Speaker-normalized
        </button>
        <button
          type="button"
          className={pitchMode === 'hz' ? 'primary' : undefined}
          aria-pressed={pitchMode === 'hz'}
          onClick={() => setPitchMode('hz')}
        >
          Hertz
        </button>
      </div>
      <PitchCanvas pitch={referencePitch} label="Reference pitch" mode={pitchMode} />
      <PitchCanvas pitch={learnerPitch} label="Learner pitch" mode={pitchMode} dashed />
      <div className="stack">
        {observations.map((item) => (
          <article key={item.id} className="stack" style={{ gap: 0 }}>
            <strong>{item.confidence} confidence:</strong> {item.message}
            {item.detail ? <p className="muted">{item.detail}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
