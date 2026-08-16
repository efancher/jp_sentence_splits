import type { PitchAnalysisPayload } from './pitch';
import type { ConfidenceLevel } from './waveform';

/**
 * Ported (heuristic timing-feedback subset) from
 * ~/projects/shadowing/web/src/analysis/japanese.ts for Phase 8.4b.
 * Mora-level hints (sokuon/long-vowel observations, driven by the source's
 * `seedMoraUnits`/mora timing guide) are not ported — this app doesn't
 * have a mora timing guide yet (deferred per Phase 8.2's notes, revisit
 * if word-precise practice-target isolation needs it later). Passing no
 * `morae` here just means those two observation lines never appear,
 * which degrades gracefully.
 */

export interface TimingObservation {
  id: string;
  kind: string;
  message: string;
  confidence: ConfidenceLevel;
  detail?: string;
  /**
   * 0-1, higher = more prominent/actionable (Phase 9, Milestone 5/6).
   * Absent or 0 means "not a candidate for Focus on this" — e.g. a
   * reassuring "close to reference" note, or an informational comparison
   * (pitch register differences are expected across speakers, not
   * something to fix).
   */
  severity?: number;
  /** Reference-clip time range (full-clip time base), for auto-proposing a practice loop. */
  segment?: { startMs: number; endMs: number };
}

export function confidenceFromSignal(options: {
  hasReading: boolean;
  voicedRatio: number;
  alignmentConfidence?: ConfidenceLevel;
  origin: 'heuristic' | 'manual';
}): ConfidenceLevel {
  if (options.origin === 'manual' && options.voicedRatio > 0.35) return 'high';
  if (!options.hasReading) return 'low';
  if (options.voicedRatio < 0.2) return 'low';
  if (options.alignmentConfidence === 'low') return 'low';
  if (options.voicedRatio > 0.45) return 'medium';
  return 'low';
}

export function buildTimingObservations(options: {
  referenceDuration: number;
  learnerDuration: number;
  referencePitch?: PitchAnalysisPayload;
  learnerPitch?: PitchAnalysisPayload;
  confidence: ConfidenceLevel;
}): TimingObservation[] {
  const observations: TimingObservation[] = [];
  const ratio =
    options.referenceDuration > 0 ? options.learnerDuration / options.referenceDuration : 1;
  if (Math.abs(ratio - 1) > 0.12) {
    observations.push({
      id: 'duration-ratio',
      kind: 'duration',
      confidence: options.confidence,
      severity: Math.min(1, Math.abs(ratio - 1)),
      message:
        ratio > 1
          ? 'Your recording is longer than the reference.'
          : 'Your recording is shorter than the reference.',
      detail: `Duration ratio ${ratio.toFixed(2)} (learner ÷ reference). This measures overall length, not pronunciation quality.`,
    });
  } else {
    observations.push({
      id: 'duration-close',
      kind: 'duration',
      confidence: options.confidence === 'low' ? 'low' : 'medium',
      message: 'Overall duration is close to the reference.',
      detail: `Duration ratio ${ratio.toFixed(2)}.`,
    });
  }

  const refMedian = options.referencePitch?.medianHz;
  const learnMedian = options.learnerPitch?.medianHz;
  if (refMedian && learnMedian) {
    const semitoneGap = 12 * Math.log2(learnMedian / refMedian);
    observations.push({
      id: 'pitch-register',
      kind: 'pitch',
      confidence: options.confidence,
      message:
        Math.abs(semitoneGap) < 2
          ? 'Median pitch register is similar after accounting for speaker differences.'
          : 'Median absolute pitch differs, which is expected across speakers. Prefer the normalized contour view.',
      detail: `Reference median ${refMedian.toFixed(0)} Hz, learner median ${learnMedian.toFixed(0)} Hz (${semitoneGap.toFixed(1)} semitones).`,
    });
  }

  if (options.confidence === 'low') {
    observations.push({
      id: 'low-confidence',
      kind: 'meta',
      confidence: 'low',
      message: 'Automatic observations have low confidence. Use them as listening prompts, not corrections.',
      detail: 'Improve confidence by recording with less noise; a longer, clearer recording raises the voiced ratio.',
    });
  }

  return observations;
}
