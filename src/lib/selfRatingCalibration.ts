/**
 * "Self-rating check" (docs/ROADMAP.md — "Self-rating calibration").
 * Several activity types have no objective correctness check — the
 * learner reveals the answer and picks their own again/hard/good/easy
 * with nothing comparing a typed answer or choice (see
 * `classifyReviewError`'s doc comment in `scheduling.ts` for the
 * canonical list this mirrors). Comparing their pass rate against the
 * activity types that *do* have an objective check is the only signal
 * available for "is my self-rating honest" without redesigning any card.
 *
 * Deliberately a global comparison, not a same-subject join (e.g. this
 * word's `cloze` self-rating vs. its own `reading_production` grade) —
 * the overlap between the two populations is real but sparse for many
 * words, and this codebase's stated preference is a simple, robust
 * aggregate over a precise-but-thin one (see `progressReport.ts`'s own
 * "deliberately minimal" note).
 *
 * Pure, no Dexie/network — same convention as `progressReport.ts`.
 * `src/db/repository.ts#getSelfRatingCalibration` does the only fetching.
 */

const SELF_RATED_ACTIVITY_TYPES = [
  'reading_retrieval',
  'cloze',
  'reading_in_context',
  'listening',
  'word_listening',
  'grammar_recognition',
  // Measured per-mora H/L feedback is shown before rating, but — unlike
  // pitch_accent's single tapped-position ✓/✗ — nothing compares it to a
  // single expected answer or feeds classifyReviewError, so it stays in
  // this bucket rather than GRADED_ACTIVITY_TYPES (docs/ROADMAP.md "Pull
  // the pitch-accent production drill into a review card…").
  'pitch_accent_production',
] as const;

const GRADED_ACTIVITY_TYPES = [
  'reading_production',
  'sentence_transformation',
  'grammar_completion',
  'pitch_accent',
  'contrastive',
] as const;

export interface CalibrationReviewInput {
  activityType: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
}

export interface CalibrationGroup {
  activityTypes: readonly string[];
  reviewCount: number;
  passRate: number | null;
}

export interface SelfRatingCalibration {
  hasData: boolean;
  selfRated: CalibrationGroup;
  graded: CalibrationGroup;
  /** selfRated.passRate - graded.passRate, when both exist — positive means self-ratings run more generous than measured performance. */
  gap: number | null;
  /** Per self-rated activity type, for the "which specific card type" breakdown. */
  selfRatedByActivityType: { activityType: string; reviewCount: number; passRate: number | null }[];
}

function passRate(reviews: CalibrationReviewInput[]): number | null {
  if (reviews.length === 0) return null;
  return reviews.filter((r) => r.rating !== 'again').length / reviews.length;
}

export function buildSelfRatingCalibration(
  reviews: CalibrationReviewInput[],
): SelfRatingCalibration {
  const selfRatedReviews = reviews.filter((r) =>
    (SELF_RATED_ACTIVITY_TYPES as readonly string[]).includes(r.activityType),
  );
  const gradedReviews = reviews.filter((r) =>
    (GRADED_ACTIVITY_TYPES as readonly string[]).includes(r.activityType),
  );
  const selfRatedPassRate = passRate(selfRatedReviews);
  const gradedPassRate = passRate(gradedReviews);

  const selfRatedByActivityType = SELF_RATED_ACTIVITY_TYPES.map((activityType) => {
    const forType = selfRatedReviews.filter((r) => r.activityType === activityType);
    return { activityType, reviewCount: forType.length, passRate: passRate(forType) };
  });

  return {
    hasData: selfRatedReviews.length > 0 && gradedReviews.length > 0,
    selfRated: {
      activityTypes: SELF_RATED_ACTIVITY_TYPES,
      reviewCount: selfRatedReviews.length,
      passRate: selfRatedPassRate,
    },
    graded: {
      activityTypes: GRADED_ACTIVITY_TYPES,
      reviewCount: gradedReviews.length,
      passRate: gradedPassRate,
    },
    gap:
      selfRatedPassRate !== null && gradedPassRate !== null
        ? selfRatedPassRate - gradedPassRate
        : null,
    selfRatedByActivityType,
  };
}
