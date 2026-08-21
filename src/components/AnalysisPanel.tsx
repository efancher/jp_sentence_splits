import { useEffect, useMemo, useState } from 'react';

import {
  getAttemptAlignment,
  getAttemptTranscription,
  getReferenceAlignment,
  getVocabularyTargetCandidates,
  listAttemptAnalysisSummariesForSentence,
  saveAttemptAlignment,
  saveAttemptAnalysisSummary,
  saveAttemptTranscription,
  saveReferenceAlignment,
} from '../db/repository';
import type { AlignmentResult } from '../domain/types';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { transcribeAudio } from '../lib/analysisApi';
import type { TimeRangeMs } from '../lib/recording';
import type { PitchAnalysisPayload } from '../lib/pitch';
import { extractPitch } from '../lib/pitch';
import { buildTimingObservations, confidenceFromSignal } from '../lib/timingObservations';
import type { TimingObservation } from '../lib/timingObservations';
import { buildPitchTimingObservations } from '../lib/pitchTimingObservations';
import { buildPitchAccentShapeObservations, type PitchAccentTarget } from '../lib/pitchAccentObservations';
import { buildWordTimingObservations } from '../lib/wordTimingObservations';
import { buildAsrObservations } from '../lib/asrObservations';
import { compareObservations, rankObservations, selectPrimaryObservation } from '../lib/feedbackRanking';
import { categorizeObservations } from '../lib/pronunciationHistory';
import {
  analyzeAlignment,
  canonicalizeAudioBuffer,
  decodeAudioBuffer,
  peaksToPolyline,
  sliceCanonicalAudio,
  type AlignmentMode,
  type WavePeak,
} from '../lib/waveform';

/** Same cache-then-fetch contract as `loadOrComputeAlignment`, for ASR (Phase 9, Milestone 7). */
async function loadTranscription(
  attemptId: string,
  blob: Blob,
  prompt: string,
): Promise<string | undefined> {
  const cached = await getAttemptTranscription(attemptId);
  if (cached !== undefined) return cached;
  const fetched = await transcribeAudio(blob, prompt);
  if (fetched) await saveAttemptTranscription(attemptId, fetched);
  return fetched ?? undefined;
}

function WordTimingRow({ words, label }: { words: AlignmentResult['words']; label: string }) {
  const audible = words.filter((word) => word.text && word.text !== '<eps>');
  if (audible.length === 0) return null;
  return (
    <div className="row mora-row" aria-label={label}>
      {audible.map((word, index) => (
        <span key={`${word.text}-${index}`} className="chip jp">
          {word.text}{' '}
          <span className="muted">{Math.round((word.end - word.start) * 1000)}ms</span>
        </span>
      ))}
    </div>
  );
}

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
  sentenceId,
  referenceAudioId,
  referenceBlob,
  attemptId,
  attemptCreatedAt,
  learnerBlob,
  transcript,
  hasReading,
  durationHintSeconds,
  targetRange,
  onProposeSegment,
}: {
  /** History records (Phase 9, Milestone 8) are grouped by sentence. */
  sentenceId: string;
  /** Cache key for the reference clip's server alignment (Phase 9, Milestone 2b). */
  referenceAudioId: string;
  referenceBlob: Blob;
  /** Cache key for the learner attempt's server alignment (Phase 9, Milestone 2b). */
  attemptId: string;
  /** The attempt's own recording time — history is ordered/labeled by this, not analysis time. */
  attemptCreatedAt: string;
  learnerBlob: Blob;
  /** Plain Japanese sentence text sent to the alignment service. */
  transcript: string;
  hasReading: boolean;
  durationHintSeconds: number;
  /** Restricts the reference side to this sub-range (Phase 8.2's practice-target isolation). */
  targetRange?: TimeRangeMs;
  /**
   * Applies the "Focus on this" primary issue's segment as the reference
   * player's practice-target range (Phase 9, Milestone 5/6) — reuses the
   * existing loop/A-B mechanism (Phase 8.2) rather than a new one.
   */
  onProposeSegment?: (range: TimeRangeMs) => void;
}) {
  const [mode, setMode] = useState<AlignmentMode>('original');
  const [pitchMode, setPitchMode] = useState<'hz' | 'semitones'>('semitones');
  /** The "All observations" list only mounts once opened — collapsed really means absent, not just visually hidden (matters for cross-recording occurrence counts elsewhere in this panel). */
  const [allObservationsOpen, setAllObservationsOpen] = useState(false);
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
  /** Most recent attempt for this sentence strictly before this one, for the cross-recording comparison below — undefined until loaded, or if this is the first attempt. */
  const [previousSummary, setPreviousSummary] = useState<{
    primaryIssueKind?: string;
    primaryIssueMessage?: string;
    primaryIssueSeverity?: number;
  }>();

  useEffect(() => {
    let active = true;
    void listAttemptAnalysisSummariesForSentence(sentenceId).then((summaries) => {
      if (!active) return;
      const previous = summaries
        .filter((summary) => summary.id !== attemptId && summary.createdAt < attemptCreatedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      setPreviousSummary(previous);
    });
    return () => {
      active = false;
    };
  }, [sentenceId, attemptId, attemptCreatedAt]);

  /** Confirmed vocabulary for this sentence with dictionary pitch-accent data — targets for pitchAccentObservations below. */
  const [pitchAccentTargets, setPitchAccentTargets] = useState<PitchAccentTarget[]>([]);

  useEffect(() => {
    let active = true;
    void getVocabularyTargetCandidates([sentenceId]).then((candidates) => {
      if (!active) return;
      setPitchAccentTargets(
        candidates
          .filter((candidate) => candidate.vocabularyItem.pitchAccentPositions?.length)
          .map((candidate) => ({
            surfaceForm: candidate.surfaceForm,
            reading: candidate.vocabularyItem.reading,
            pitchAccentPositions: candidate.vocabularyItem.pitchAccentPositions!,
          })),
      );
    });
    return () => {
      active = false;
    };
  }, [sentenceId]);

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

  const [serverAlignment, setServerAlignment] = useState<{
    reference?: AlignmentResult;
    learner?: AlignmentResult;
  }>();
  const [serverAlignmentStatus, setServerAlignmentStatus] = useState<
    'idle' | 'loading' | 'unavailable' | 'ready'
  >('idle');

  // Separate from the effect above on purpose: local pitch/waveform
  // analysis is fast and should never wait on this — the alignment
  // service can take up to ~45s on a cold start, and is expected to be
  // unreachable sometimes (off-tailnet). See loadAlignment's contract.
  useEffect(() => {
    let active = true;
    setServerAlignmentStatus('loading');
    setServerAlignment(undefined);
    void (async () => {
      const [reference, learner] = await Promise.all([
        loadOrComputeAlignment(
          referenceAudioId,
          referenceBlob,
          transcript,
          getReferenceAlignment,
          saveReferenceAlignment,
        ),
        loadOrComputeAlignment(
          attemptId,
          learnerBlob,
          transcript,
          getAttemptAlignment,
          saveAttemptAlignment,
        ),
      ]);
      if (!active) return;
      if (!reference && !learner) {
        setServerAlignmentStatus('unavailable');
        return;
      }
      setServerAlignment({ reference, learner });
      setServerAlignmentStatus('ready');
    })();
    return () => {
      active = false;
    };
  }, [referenceAudioId, referenceBlob, attemptId, learnerBlob, transcript]);

  const [transcribedText, setTranscribedText] = useState<string>();
  const [asrSettled, setAsrSettled] = useState(false);

  // A third, independent effect (Phase 9, Milestone 7) — ASR is a
  // secondary, non-authoritative signal on the learner recording only
  // (the reference transcript is already known), and shouldn't block or
  // be blocked by the alignment fetch above.
  useEffect(() => {
    let active = true;
    setTranscribedText(undefined);
    setAsrSettled(false);
    void (async () => {
      const text = await loadTranscription(attemptId, learnerBlob, transcript);
      if (!active) return;
      setTranscribedText(text);
      setAsrSettled(true);
    })();
    return () => {
      active = false;
    };
  }, [attemptId, learnerBlob, transcript]);

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
  const segmentObservations = useMemo(() => {
    if (!serverAlignment?.reference || !serverAlignment.learner) return [];
    return buildWordTimingObservations({
      reference: serverAlignment.reference,
      learner: serverAlignment.learner,
    });
  }, [serverAlignment]);
  const pitchTimingObservations = useMemo(() => {
    if (!serverAlignment?.reference || !serverAlignment.learner || !referencePitch || !learnerPitch) {
      return [];
    }
    return buildPitchTimingObservations({
      referenceWords: serverAlignment.reference.words,
      learnerWords: serverAlignment.learner.words,
      referencePitch,
      learnerPitch,
      referenceTimeOffsetSeconds: targetRange ? targetRange.startMs / 1000 : 0,
    });
  }, [serverAlignment, referencePitch, learnerPitch, targetRange]);

  const asrObservations = useMemo(() => {
    if (!serverAlignment?.reference || !transcribedText) return [];
    return buildAsrObservations({
      referenceWords: serverAlignment.reference.words,
      transcribedText,
    });
  }, [serverAlignment, transcribedText]);

  // Ground-truth pitch-accent scoring (dictionary-predicted shape, not a
  // reference recording) — only needs the learner's own alignment/pitch,
  // unlike every other server-alignment-derived observation source above.
  const pitchAccentObservations = useMemo(() => {
    if (!serverAlignment?.learner || !learnerPitch || !pitchAccentTargets.length) return [];
    return buildPitchAccentShapeObservations({
      learnerWords: serverAlignment.learner.words,
      learnerPitch,
      targets: pitchAccentTargets,
    });
  }, [serverAlignment, learnerPitch, pitchAccentTargets]);

  const primaryObservation = useMemo(
    () =>
      selectPrimaryObservation([
        ...observations,
        ...segmentObservations,
        ...pitchTimingObservations,
        ...pitchAccentObservations,
        ...asrObservations,
      ]),
    [observations, segmentObservations, pitchTimingObservations, pitchAccentObservations, asrObservations],
  );
  const hasComputedAnyObservations =
    observations.length > 0 ||
    segmentObservations.length > 0 ||
    pitchTimingObservations.length > 0 ||
    pitchAccentObservations.length > 0 ||
    asrObservations.length > 0;

  /**
   * Every candidate `selectPrimaryObservation` considered, ranked, not just
   * the winner — closes the one real gap flagged when Phase 9 scoped down
   * a separate debug view (docs/STATUS.md: "there's no single view of the
   * ranked candidate list before selectPrimaryObservation picks one").
   * Purely a view of already-computed data, no new analysis.
   */
  const rankedObservations = useMemo(
    () =>
      rankObservations([
        ...observations,
        ...segmentObservations,
        ...pitchTimingObservations,
        ...pitchAccentObservations,
        ...asrObservations,
      ]),
    [observations, segmentObservations, pitchTimingObservations, pitchAccentObservations, asrObservations],
  );

  // Once every source has settled (not just local analysis — the server
  // alignment/ASR calls too), save a lightweight trend summary for the
  // history view (Phase 9, Milestone 8). Redundant re-saves on later
  // renders are harmless (a single Dexie `put`, same key).
  const analysisSettled =
    !busy && serverAlignmentStatus !== 'idle' && serverAlignmentStatus !== 'loading' && asrSettled;
  useEffect(() => {
    if (!analysisSettled) return;
    const all = [
      ...observations,
      ...segmentObservations,
      ...pitchTimingObservations,
      ...pitchAccentObservations,
      ...asrObservations,
    ];
    const { timingSeverity, pitchSeverity } = categorizeObservations(all);
    const primary = selectPrimaryObservation(all);
    void saveAttemptAnalysisSummary({
      id: attemptId,
      sentenceId,
      createdAt: attemptCreatedAt,
      timingSeverity,
      pitchSeverity,
      primaryIssueKind: primary?.kind,
      primaryIssueMessage: primary?.message,
      primaryIssueSeverity: primary?.severity,
    });
    // Intentionally not depending on the observation arrays themselves —
    // they're new references every render; `analysisSettled` already
    // captures "the inputs that produce them have stopped changing".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisSettled, attemptId, sentenceId, attemptCreatedAt]);

  /**
   * Cross-recording comparison (docs/STATUS.md follow-up to Phase 9,
   * Milestone 8's per-sentence timing/pitch trend labels): those labels
   * compare category-level severity between consecutive attempts; this
   * compares the specific "Focus on this" issue instead, so a re-record can
   * say "that same thing is smaller now" or "a different issue took over,"
   * not just "timing: improving." Only computed once this attempt's own
   * analysis has settled, so it isn't shown against a still-loading primary.
   */
  const comparison = useMemo(() => {
    if (!analysisSettled || !previousSummary) return undefined;
    const previousPrimary: TimingObservation | undefined = previousSummary.primaryIssueKind
      ? {
          id: 'previous',
          kind: previousSummary.primaryIssueKind,
          message: previousSummary.primaryIssueMessage ?? '',
          confidence: 'medium',
          severity: previousSummary.primaryIssueSeverity,
        }
      : undefined;
    return compareObservations(previousPrimary, primaryObservation);
  }, [analysisSettled, previousSummary, primaryObservation]);

  return (
    <div className="stack">
      {primaryObservation ? (
        <div className="panel stack" aria-label="Focus on this">
          <strong>FOCUS ON THIS</strong>
          <p style={{ margin: 0 }}>{primaryObservation.message}</p>
          {comparison?.status === 'improved' ? (
            <p className="muted" style={{ margin: 0 }}>
              Closer than last time — still the same kind of thing, but the gap is smaller.
            </p>
          ) : comparison?.status === 'new_focus' ? (
            <p className="muted" style={{ margin: 0 }}>
              What stood out last time isn't showing up anymore.
            </p>
          ) : null}
          {primaryObservation.segment && onProposeSegment ? (
            <button
              type="button"
              className="primary"
              onClick={() =>
                onProposeSegment({
                  startMs: primaryObservation.segment!.startMs,
                  endMs: primaryObservation.segment!.endMs,
                })
              }
            >
              Practice this part
            </button>
          ) : null}
        </div>
      ) : hasComputedAnyObservations ? (
        <p className="muted">
          Nothing stands out this time.
          {comparison?.status === 'resolved'
            ? ' What stood out last time isn’t showing up anymore.'
            : ''}
        </p>
      ) : null}
      {rankedObservations.length > 0 ? (
        <details onToggle={(event) => setAllObservationsOpen(event.currentTarget.open)}>
          <summary className="muted">All observations ({rankedObservations.length})</summary>
          {allObservationsOpen ? (
            <div className="stack" style={{ gap: '0.25rem' }}>
              {rankedObservations.map((observation) => (
                <div key={observation.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{observation.message}</span>
                  <span className="muted">
                    {observation.kind} · {observation.confidence}
                    {observation.severity !== undefined
                      ? ` · severity ${observation.severity.toFixed(2)}`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}
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
      {serverAlignmentStatus === 'loading' ? (
        <p className="muted">Fetching server word timing…</p>
      ) : null}
      {serverAlignmentStatus === 'ready' && serverAlignment ? (
        <div className="stack">
          <strong>Word timing (server)</strong>
          {serverAlignment.reference ? (
            <WordTimingRow words={serverAlignment.reference.words} label="Reference word timing" />
          ) : null}
          {serverAlignment.learner ? (
            <WordTimingRow words={serverAlignment.learner.words} label="Learner word timing" />
          ) : null}
        </div>
      ) : null}
      {segmentObservations.length > 0 ? (
        <div className="stack">
          <strong>Segment timing</strong>
          {segmentObservations.map((item) => (
            <article key={item.id} className="stack" style={{ gap: 0 }}>
              <strong>{item.confidence} confidence:</strong> {item.message}
              {item.detail ? <p className="muted">{item.detail}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
      {pitchTimingObservations.length > 0 ? (
        <div className="stack">
          <strong>Pitch movement</strong>
          {pitchTimingObservations.map((item) => (
            <article key={item.id} className="stack" style={{ gap: 0 }}>
              <strong>{item.confidence} confidence:</strong> {item.message}
              {item.detail ? <p className="muted">{item.detail}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
      {pitchAccentObservations.length > 0 ? (
        <div className="stack">
          <strong>Pitch accent (dictionary)</strong>
          {pitchAccentObservations.map((item) => (
            <article key={item.id} className="stack" style={{ gap: 0 }}>
              <strong>{item.confidence} confidence:</strong> {item.message}
              {item.detail ? <p className="muted">{item.detail}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
      {asrObservations.length > 0 ? (
        <div className="stack">
          <strong>Possible pronunciation differences</strong>
          {asrObservations.map((item) => (
            <article key={item.id} className="stack" style={{ gap: 0 }}>
              <strong>{item.confidence} confidence:</strong> {item.message}
              {item.detail ? <p className="muted">{item.detail}</p> : null}
            </article>
          ))}
        </div>
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
