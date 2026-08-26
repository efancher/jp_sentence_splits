import type { WordAlignment } from '../domain/types';
import type { PitchAnalysisPayload, PitchFrame } from './pitch';
import type { TimingObservation } from './timingObservations';
import { displayWordText, pairWords } from './wordTimingObservations';

/**
 * Compares *where in time* pitch movement happens, word by word, using
 * Milestone 2b/3's real word alignment to scope each word's pitch frames —
 * not just the aggregate median-register comparison
 * `timingObservations.ts` already did. Per the brief's own caution:
 * acoustic pitch differences are NOT claimed as linguistic pitch-accent
 * errors — messages describe observed movement ("your pitch falls where
 * the reference stays level"), and confidence is capped at 'medium' even
 * for a clear signal, 'low' when trend direction itself disagrees (the
 * brief's explicit guidance: hedge unless confidence is high, and a
 * pitch-accent-adjacent judgment call rarely is).
 */

type Trend = 'rising' | 'falling' | 'flat' | 'unclear';

interface TrendResult {
  trend: Trend;
  /** 0-1 position (by time) of the trend's turning point within the word's voiced span. */
  transitionFraction: number | null;
}

const MIN_VOICED_FRAMES = 4;
const TREND_THRESHOLD_SEMITONES = 1.0;
const TRANSITION_OFFSET_THRESHOLD = 0.25;

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function framesInRange(
  pitch: PitchAnalysisPayload,
  startSeconds: number,
  endSeconds: number,
): PitchFrame[] {
  return pitch.frames.filter(
    (frame) =>
      frame.voiced &&
      frame.relativeSemitones !== null &&
      frame.timeSeconds >= startSeconds &&
      frame.timeSeconds < endSeconds,
  );
}

function classifyTrend(frames: PitchFrame[]): TrendResult {
  if (frames.length < MIN_VOICED_FRAMES) return { trend: 'unclear', transitionFraction: null };
  const values = frames.map((frame) => frame.relativeSemitones!);
  const third = Math.max(1, Math.floor(frames.length / 3));
  const startAvg = average(values.slice(0, third));
  const endAvg = average(values.slice(-third));
  const diff = endAvg - startAvg;
  if (Math.abs(diff) < TREND_THRESHOLD_SEMITONES) return { trend: 'flat', transitionFraction: null };

  const trend: Trend = diff > 0 ? 'rising' : 'falling';
  // The transition point is the extreme (peak for a fall, trough for a
  // rise) — the moment the movement actually turns. Use the *last* frame
  // at the extreme value (not the first) so a brief plateau at the peak
  // is measured as "just before it fell", the more meaningful point.
  const extremeIndex =
    trend === 'falling'
      ? values.lastIndexOf(Math.max(...values))
      : values.lastIndexOf(Math.min(...values));
  const spanStart = frames[0]!.timeSeconds;
  const spanEnd = frames[frames.length - 1]!.timeSeconds;
  const span = Math.max(0.001, spanEnd - spanStart);
  const transitionFraction = (frames[extremeIndex]!.timeSeconds - spanStart) / span;
  return { trend, transitionFraction };
}

function describeTrend(trend: Trend): string {
  if (trend === 'falling') return 'falls';
  if (trend === 'rising') return 'rises';
  return 'stays level';
}

export function buildPitchTimingObservations({
  referenceWords,
  learnerWords,
  referencePitch,
  learnerPitch,
  referenceTimeOffsetSeconds = 0,
}: {
  referenceWords: WordAlignment[];
  learnerWords: WordAlignment[];
  referencePitch: PitchAnalysisPayload;
  learnerPitch: PitchAnalysisPayload;
  /**
   * Reference word timestamps are in the full-clip's time base; reference
   * *pitch* frames may have been extracted from a `targetRange`-sliced
   * clip (Phase 8.2's practice-target isolation), which starts its own
   * clock at 0. Pass `targetRange.startMs / 1000` here to translate.
   * Learner audio/pitch is never sliced, so it needs no offset.
   */
  referenceTimeOffsetSeconds?: number;
}): TimingObservation[] {
  const observations: TimingObservation[] = [];
  const pairs = pairWords(referenceWords, learnerWords);

  pairs.forEach(([refWord, learnerWord], index) => {
    const refStart = refWord.start - referenceTimeOffsetSeconds;
    const refEnd = refWord.end - referenceTimeOffsetSeconds;
    if (refEnd <= 0) return; // entirely before the target range's start

    const ref = classifyTrend(framesInRange(referencePitch, refStart, refEnd));
    const learner = classifyTrend(framesInRange(learnerPitch, learnerWord.start, learnerWord.end));
    if (ref.trend === 'unclear' || learner.trend === 'unclear') return;

    if (ref.trend === learner.trend) {
      if (ref.trend === 'flat' || ref.transitionFraction === null || learner.transitionFraction === null) {
        return; // both flat, or no clear turning point to compare — nothing to say
      }
      const offset = learner.transitionFraction - ref.transitionFraction;
      if (Math.abs(offset) <= TRANSITION_OFFSET_THRESHOLD) return; // close enough — not an error
      const verb = ref.trend === 'falling' ? 'drop' : 'rise';
      observations.push({
        id: `pitch-timing-${index}`,
        kind: 'pitch_timing',
        confidence: 'medium',
        severity: Math.min(1, Math.abs(offset) / 0.5),
        segment: { startMs: refWord.start * 1000, endMs: refWord.end * 1000 },
        message: `Your pitch ${verb} occurs ${offset > 0 ? 'later' : 'earlier'} than the reference around 「${displayWordText(refWord.text)}」.`,
      });
      return;
    }

    observations.push({
      id: `pitch-shape-${index}`,
      kind: 'pitch_shape',
      confidence: 'low',
      // Fixed, modest — already the lower-confidence category; kept as a
      // low-priority "Focus on this" candidate rather than excluded
      // entirely, since a shape mismatch (not just timing) can still be
      // the most useful thing to notice sometimes.
      severity: 0.3,
      segment: { startMs: refWord.start * 1000, endMs: refWord.end * 1000 },
      message: `Your pitch ${describeTrend(learner.trend)} during 「${displayWordText(refWord.text)}」 where the reference ${describeTrend(ref.trend)}.`,
    });
  });

  return observations;
}
