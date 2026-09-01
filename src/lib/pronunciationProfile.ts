import { ANALYSIS_SUMMARY_VERSION } from './pronunciationHistory';

/**
 * Cross-sentence shadowing learner profile (docs/ROADMAP.md "Planned";
 * Phase 9's one open milestone / brief's Phase 15). The per-sentence history
 * view (`pronunciationHistory.ts`) only compares an attempt to the previous
 * attempt *of the same sentence*; this aggregates every analyzed attempt
 * across every sentence into "what keeps coming up" — a recurring-focus-area
 * ranking plus overall timing/pitch trend lines.
 *
 * Pure, no Dexie/network — same convention as `pronunciationHistory.ts` /
 * `scheduling.ts`, so the whole derivation is inspectable and unit-tested
 * without a browser. `src/db/repository.ts#getPronunciationProfile` does the
 * only fetching.
 *
 * Built entirely from `AttemptAnalysisSummary` severities, which are already
 * per-speaker-normalized upstream: pitch *register* differences between a
 * baritone learner and a higher reference are scored as severity 0 by
 * `pitchTimingObservations`/`pitchAccentObservations` (informational, not a
 * fault), so summing/averaging severity here never compares absolute pitch
 * or loudness across speakers — see the `user_voice_baritone_quiet` note.
 */

export const PRONUNCIATION_PROFILE_VERSION = ANALYSIS_SUMMARY_VERSION;

/** Minimum data points before a trend is claimed rather than "not enough yet". */
export const MIN_TREND_SAMPLES = 4;

/** Relative severity change (recent-half mean vs earlier-half mean) past which a trend is called, not "steady". */
export const TREND_SEVERITY_DELTA = 0.08;

export type TrendDirection = 'improving' | 'steady' | 'worsening' | 'insufficient_data';

export type FocusCategory = 'timing' | 'pitch' | 'other';

interface KindMeta {
  label: string;
  category: FocusCategory;
}

/**
 * `primaryIssueKind` values emitted by the observation modules
 * (`timingObservations`, `wordTimingObservations`, `pitchTimingObservations`,
 * `pitchAccentObservations`, `asrObservations`). Unknown kinds fall through
 * to a generic 'other' entry rather than being dropped.
 */
const KIND_META: Record<string, KindMeta> = {
  sokuon_timing: { label: 'Small tsu (っ) timing', category: 'timing' },
  long_vowel_timing: { label: 'Long-vowel length', category: 'timing' },
  'word-duration': { label: 'Word pace', category: 'timing' },
  duration: { label: 'Overall pace', category: 'timing' },
  pitch: { label: 'Pitch range', category: 'pitch' },
  pitch_timing: { label: 'Pitch-movement timing', category: 'pitch' },
  pitch_shape: { label: 'Pitch-contour shape', category: 'pitch' },
  pitch_accent_shape: { label: 'Pitch-accent shape', category: 'pitch' },
  asr_diagnostic: { label: 'Clarity (speech-recognition check)', category: 'other' },
};

export function focusKindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { label: kind, category: 'other' };
}

export interface ProfileSummaryLike {
  id: string;
  sentenceId: string;
  createdAt: string;
  timingSeverity: number;
  pitchSeverity: number;
  primaryIssueKind?: string;
  primaryIssueSeverity?: number;
}

export interface FocusArea {
  kind: string;
  label: string;
  category: FocusCategory;
  /** How many analyzed attempts had this as their single top ("Focus on this") issue. */
  primaryCount: number;
  /** Distinct sentences in which it was the top issue. */
  sentenceCount: number;
  lastSeenAt: string;
  /** Mean primary-issue severity (0-1) over the attempts where it led. */
  meanSeverity: number;
  trend: TrendDirection;
}

export interface PronunciationProfile {
  attemptsAnalyzed: number;
  sentencesPracticed: number;
  /** Days between the oldest and newest analyzed attempt (0 if <2). */
  spanDays: number;
  timingTrend: TrendDirection;
  pitchTrend: TrendDirection;
  /** Recurring focus areas, most frequent first (ties broken by recency). */
  focusAreas: FocusArea[];
  /** One-line plain-language read of the above, or null when there's nothing yet. */
  headline: string | null;
}

function meanSeverityTrend(points: { createdAt: string; severity: number }[]): TrendDirection {
  if (points.length < MIN_TREND_SAMPLES) return 'insufficient_data';
  const sorted = [...points].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const split = Math.floor(sorted.length / 2);
  const earlier = sorted.slice(0, split);
  const recent = sorted.slice(sorted.length - split);
  const mean = (list: typeof points) =>
    list.reduce((sum, point) => sum + point.severity, 0) / list.length;
  const delta = mean(recent) - mean(earlier);
  if (delta <= -TREND_SEVERITY_DELTA) return 'improving';
  if (delta >= TREND_SEVERITY_DELTA) return 'worsening';
  return 'steady';
}

function describeTrend(trend: TrendDirection): string {
  switch (trend) {
    case 'improving':
      return 'improving';
    case 'worsening':
      return 'getting worse';
    case 'steady':
      return 'holding steady';
    case 'insufficient_data':
      return 'not enough data yet';
  }
}

export function buildPronunciationProfile(
  summaries: ProfileSummaryLike[],
): PronunciationProfile {
  if (summaries.length === 0) {
    return {
      attemptsAnalyzed: 0,
      sentencesPracticed: 0,
      spanDays: 0,
      timingTrend: 'insufficient_data',
      pitchTrend: 'insufficient_data',
      focusAreas: [],
      headline: null,
    };
  }

  const sorted = [...summaries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const spanMs =
    new Date(sorted[sorted.length - 1]!.createdAt).getTime() -
    new Date(sorted[0]!.createdAt).getTime();
  const spanDays = spanMs > 0 ? spanMs / (24 * 60 * 60 * 1000) : 0;

  const timingTrend = meanSeverityTrend(
    sorted.map((s) => ({ createdAt: s.createdAt, severity: s.timingSeverity })),
  );
  const pitchTrend = meanSeverityTrend(
    sorted.map((s) => ({ createdAt: s.createdAt, severity: s.pitchSeverity })),
  );

  interface Bucket {
    kind: string;
    severities: number[];
    sentenceIds: Set<string>;
    lastSeenAt: string;
    points: { createdAt: string; severity: number }[];
  }
  const buckets = new Map<string, Bucket>();
  for (const summary of sorted) {
    const kind = summary.primaryIssueKind;
    if (!kind || kind === 'meta') continue;
    const severity = summary.primaryIssueSeverity ?? 0;
    const bucket = buckets.get(kind) ?? {
      kind,
      severities: [],
      sentenceIds: new Set<string>(),
      lastSeenAt: summary.createdAt,
      points: [],
    };
    bucket.severities.push(severity);
    bucket.sentenceIds.add(summary.sentenceId);
    if (summary.createdAt > bucket.lastSeenAt) bucket.lastSeenAt = summary.createdAt;
    bucket.points.push({ createdAt: summary.createdAt, severity });
    buckets.set(kind, bucket);
  }

  const focusAreas: FocusArea[] = [...buckets.values()]
    .map((bucket) => {
      const meta = focusKindMeta(bucket.kind);
      return {
        kind: bucket.kind,
        label: meta.label,
        category: meta.category,
        primaryCount: bucket.severities.length,
        sentenceCount: bucket.sentenceIds.size,
        lastSeenAt: bucket.lastSeenAt,
        meanSeverity:
          bucket.severities.reduce((sum, value) => sum + value, 0) / bucket.severities.length,
        trend: meanSeverityTrend(bucket.points),
      };
    })
    .sort(
      (a, b) =>
        b.primaryCount - a.primaryCount || b.lastSeenAt.localeCompare(a.lastSeenAt),
    );

  const sentencesPracticed = new Set(sorted.map((s) => s.sentenceId)).size;

  let headline: string | null = null;
  const top = focusAreas[0];
  if (top && top.primaryCount >= 2) {
    const trendClause =
      top.trend === 'improving' || top.trend === 'worsening'
        ? `, ${describeTrend(top.trend)}`
        : '';
    headline = `Across ${sorted.length} analyzed attempt${sorted.length === 1 ? '' : 's'} on ${sentencesPracticed} sentence${sentencesPracticed === 1 ? '' : 's'}, your most common focus area is ${top.label.toLowerCase()} (${top.primaryCount} attempts${trendClause}).`;
  } else if (sorted.length >= 3) {
    headline = `${sorted.length} analyzed attempts on ${sentencesPracticed} sentences — no single issue dominates yet.`;
  }

  return {
    attemptsAnalyzed: sorted.length,
    sentencesPracticed,
    spanDays,
    timingTrend,
    pitchTrend,
    focusAreas,
    headline,
  };
}
