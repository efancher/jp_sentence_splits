// ---------------------------------------------------------------------------
// Progress and diagnostics readers (pronunciation profile, progress report,
// error mix, leeches, blind spots, calibration, skill coverage, FSRS
// confidence, step usefulness, follow-up effect, "What's stuck"). Read-only
// joins over the lower repo/ modules.
// ---------------------------------------------------------------------------

import type {
  Review,
} from '../../domain/types';
import { ANALYSIS_SUMMARY_VERSION } from '../../lib/pronunciationHistory';
import {
  buildPronunciationProfile,
  type PronunciationProfile,
} from '../../lib/pronunciationProfile';
import {
  buildProgressReport,
  type ProgressReport,
} from '../../lib/progressReport';
import {
  buildBlindSpots,
  vocabularyKey,
  type BlindSpots,
} from '../../lib/blindSpots';
import {
  buildErrorMix,
  classificationKey,
  type ErrorMix,
} from '../../lib/errorMix';
import {
  buildLeechList,
  type LeechListReport,
} from '../../lib/leechList';
import {
  isBookInStudyRotation,
  membershipIsShelved,
} from '../../lib/suspendedBooks';
import {
  buildStuckSummary,
  type StuckReason,
} from '../../lib/stuckSentences';
import {
  isVocabularyItemProficient,
  predictRetrievability,
} from '../../lib/scheduling';
import {
  buildFsrsConfidenceSnapshot,
  type FsrsConfidenceSnapshot,
} from '../../lib/fsrsConfidence';
import {
  buildSelfRatingCalibration,
  type CalibrationReviewInput,
  type SelfRatingCalibration,
} from '../../lib/selfRatingCalibration';
import {
  buildSkillCoverage,
  type SkillCoverage,
} from '../../lib/skillCoverage';
import {
  buildStepUsefulness,
  type StepUsefulnessReport,
} from '../../lib/stepUsefulness';
import {
  buildFollowUpEffect,
  parseOffer,
  type FollowUpEffectReport,
} from '../../lib/followUpEffect';
import { buildListeningAttempts } from '../../lib/listeningEvidence';
import { SHADOW_POOL_BOOK_LIMIT } from '../../lib/sessionPlannerConfig';
import {
  getDb,
  localDateKey,
} from '../database';
import { activeSentenceIdsForShadowing } from './/learningOrchestrator';
import { getShadowingWeakWords } from './/shadowingAttempts';
import { loadSuspendedBookIndex } from './/suspendedIndex';
import {
  allAudioSentenceIds,
  bookSentencesForSentences,
  readTileEligibilityForPass,
} from './/passReads';
import { listStudyItemSummaries } from './/studyItemExplainability';
import { listGrammarPatternSummaries } from './/grammarPatterns';
import {
  filterVocabularyItemIdsByActivity,
  getIntroducedSentenceIds,
  getProficientPitchAccentVocabularyItemIds,
  getProficientRecognitionVocabularyItemIds,
} from './/reviewScheduling';

/**
 * Cross-sentence shadowing learner profile (docs/ROADMAP.md) — aggregates
 * every analyzed attempt across every sentence into a recurring-focus-area
 * ranking + overall timing/pitch trend. `sinceDays` optionally restricts to
 * recent attempts (default: all history). Pure derivation lives in
 * `src/lib/pronunciationProfile.ts`.
 */
export async function getPronunciationProfile(
  options: { sinceDays?: number; now?: Date } = {},
): Promise<PronunciationProfile> {
  const db = getDb();
  const rows = (await db.attemptAnalysisSummaries.toArray()).filter(
    (row) => row.analysisSummaryVersion === ANALYSIS_SUMMARY_VERSION,
  );
  const now = options.now ?? new Date();
  const cutoff =
    options.sinceDays !== undefined
      ? now.getTime() - options.sinceDays * 24 * 60 * 60 * 1000
      : undefined;
  const scoped =
    cutoff === undefined
      ? rows
      : rows.filter((row) => new Date(row.createdAt).getTime() >= cutoff);
  return buildPronunciationProfile(scoped);
}

/**
 * "How am I doing" progress report (docs/ROADMAP.md) — every number is
 * recomputed from `Review` rows, `StudyItem` FSRS state, and the shadowing
 * analysis summaries, so there's nothing to seed or maintain. The heavy
 * lifting is the pure `buildProgressReport`; this only fetches.
 */
export async function getProgressReport(
  options: { now?: Date } = {},
): Promise<ProgressReport> {
  const db = getDb();
  const now = options.now ?? new Date();
  const [reviews, studyItems, pronunciation] = await Promise.all([
    db.reviews.toArray(),
    db.studyItems.toArray(),
    getPronunciationProfile({ now }),
  ]);
  return buildProgressReport({
    now,
    reviews: reviews.map((review) => ({
      studyItemId: review.studyItemId,
      timestamp: review.timestamp,
      rating: review.rating,
      source: review.source,
    })),
    studyItems: studyItems.map((item) => ({
      id: item.id,
      subjectId: item.subjectId,
      subjectType: item.subjectType,
      activityType: item.activityType,
      createdAt: item.createdAt,
      state: item.fsrsState.state,
      scheduledDays: item.fsrsState.scheduledDays,
    })),
    shadowing: {
      attemptsAnalyzed: pronunciation.attemptsAnalyzed,
      sentencesPracticed: pronunciation.sentencesPracticed,
      timingTrend: pronunciation.timingTrend,
      pitchTrend: pronunciation.pitchTrend,
    },
  });
}

/**
 * "What to work on" (`buildErrorMix`) — an interpretable breakdown of the
 * kinds of mistakes the learner keeps making, from `Review.errorClassification`
 * (written by `classifyReviewError`), plus a pronunciation block from the
 * shadowing side. Pure derivation; this only fetches. `windowDays` 0 = all
 * time.
 */
export async function getErrorMix(
  options: { windowDays?: number; now?: Date } = {},
): Promise<ErrorMix> {
  const db = getDb();
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 30;
  const [reviews, weakWords, profile] = await Promise.all([
    db.reviews.toArray(),
    getShadowingWeakWords(),
    getPronunciationProfile({ now }),
  ]);
  const topFocus = profile.focusAreas[0];
  return buildErrorMix({
    now,
    windowDays,
    reviews: reviews.map((review) => ({
      timestamp: review.timestamp,
      rating: review.rating,
      errorClassification: review.errorClassification,
    })),
    weakWords: weakWords.map((word) => ({
      surfaceForm: word.surfaceForm,
      issueKind: word.issueKind,
      attemptCount: word.attemptCount,
      trend: word.trend,
    })),
    pronunciationHeadline: profile.headline,
    pronunciationTopFocus: topFocus
      ? {
          label: topFocus.label,
          sentenceCount: topFocus.sentenceCount,
          trend: topFocus.trend,
        }
      : null,
  });
}

/**
 * "Leech list" (`buildLeechList`, docs/ROADMAP.md "Possibilities") — every
 * study item with at least one real FSRS lapse, ranked by lapses + recent
 * weakness, each with its most common recent `errorClassification` reason.
 * Reuses `listStudyItemSummaries` for the label (no separate subject-lookup
 * pass) and only fetches reviews for the lapsed subset, not the whole
 * `reviews` table.
 */
export async function getLeechList(options: { limit?: number } = {}): Promise<LeechListReport> {
  const db = getDb();
  const summaries = await listStudyItemSummaries();
  const candidates = summaries.filter((summary) => summary.studyItem.fsrsState.lapses > 0);
  if (candidates.length === 0) return buildLeechList([]);

  const candidateIds = candidates.map((summary) => summary.studyItem.id);
  const reviews = await db.reviews.where('studyItemId').anyOf(candidateIds).toArray();
  const reviewsByStudyItemId = new Map<string, Review[]>();
  for (const review of reviews) {
    const list = reviewsByStudyItemId.get(review.studyItemId);
    if (list) list.push(review);
    else reviewsByStudyItemId.set(review.studyItemId, [review]);
  }

  const inputs = candidates.map(({ studyItem, subjectLabel }) => {
    const recent = (reviewsByStudyItemId.get(studyItem.id) ?? [])
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 7);
    const recentAgainCount = recent.filter((review) => review.rating === 'again').length;

    const classificationCounts = new Map<string, number>();
    for (const review of recent) {
      if (review.rating !== 'again' || !review.errorClassification) continue;
      const key = classificationKey(review.errorClassification);
      classificationCounts.set(key, (classificationCounts.get(key) ?? 0) + 1);
    }
    let topErrorClassificationKey: string | null = null;
    let topCount = 0;
    for (const [key, count] of classificationCounts) {
      if (count > topCount) {
        topErrorClassificationKey = key;
        topCount = count;
      }
    }

    return {
      studyItemId: studyItem.id,
      subjectLabel,
      activityType: studyItem.activityType,
      lapses: studyItem.fsrsState.lapses,
      recentAgainCount,
      recentReviewCount: recent.length,
      topErrorClassificationKey,
    };
  });

  return buildLeechList(inputs, options.limit);
}

/**
 * "Blind spots" (`buildBlindSpots`) — vocabulary and grammar that recur
 * across books the learner has actually worked but were never confirmed /
 * tracked. Distinct from the new-card backlog (words already picked, not
 * yet reviewed). Read-only; feeds the `/progress` "Blind spots" panel.
 */
export async function getBlindSpots(): Promise<BlindSpots> {
  const db = getDb();
  const [sentences, bookSentences, vocabularyItems, grammarSummaries] = await Promise.all([
    db.sentences.toArray(),
    db.bookSentences.toArray(),
    db.vocabularyItems.toArray(),
    listGrammarPatternSummaries(),
  ]);

  const workedBookIds = new Set<string>();
  const bookIdsBySentenceId = new Map<string, string[]>();
  for (const membership of bookSentences) {
    const list = bookIdsBySentenceId.get(membership.sentenceId) ?? [];
    list.push(membership.bookId);
    bookIdsBySentenceId.set(membership.sentenceId, list);
    if (membership.status !== 'unstarted') workedBookIds.add(membership.bookId);
  }

  const confirmedKeys = new Set(
    vocabularyItems.map((item) => vocabularyKey(item.expression, item.reading)),
  );

  return buildBlindSpots({
    sentences: sentences.map((sentence) => ({
      id: sentence.id,
      suggestions: [
        ...(sentence.vocabularySuggestions ?? []).map((suggestion) => ({
          expression: suggestion.expression,
          reading: suggestion.reading,
          english: suggestion.english,
          // A morphology token only counts when it'd start checked in the
          // picker (content word); Satori-sourced suggestions always count.
          contentful: suggestion.source === 'satori' || suggestion.selectedByDefault,
        })),
        ...(sentence.targetVocabulary ?? []).map((entry) => ({
          expression: entry.expression,
          reading: entry.reading,
          english: entry.english,
          contentful: true,
        })),
      ],
    })),
    bookIdsBySentenceId,
    workedBookIds,
    confirmedKeys,
    grammar: grammarSummaries.map((summary) => ({
      patternId: summary.pattern.id,
      name: summary.pattern.canonicalName,
      encounterCount: summary.encounterCount,
      worthLearningNow: summary.priorityBucket === 'worth_learning_now',
    })),
  });
}

/**
 * "Self-rating check" (2026-09-16, docs/ROADMAP.md "Self-rating
 * calibration"). Read-only; every `Review` row already carries
 * `activityType`/`rating`, so this only fetches — see
 * `buildSelfRatingCalibration` for the actual comparison.
 */
export async function getSelfRatingCalibration(): Promise<SelfRatingCalibration> {
  const db = getDb();
  const [reviews, studyItems] = await Promise.all([db.reviews.toArray(), db.studyItems.toArray()]);
  const activityTypeByStudyItemId = new Map(
    studyItems.map((item) => [item.id, item.activityType]),
  );
  const calibrationReviews: CalibrationReviewInput[] = [];
  for (const review of reviews) {
    const activityType = activityTypeByStudyItemId.get(review.studyItemId);
    if (activityType) calibrationReviews.push({ activityType, rating: review.rating });
  }
  return buildSelfRatingCalibration(calibrationReviews);
}


/**
 * "Skill coverage" (2026-09-16, docs/ROADMAP.md "Skill-imbalance metric").
 * Denominator is every vocabulary item recognition-proficient
 * (`reading_retrieval`/`cloze`); numerators are the subset also proficient
 * on production, pitch, and word-listening (at least one occurrence).
 */
export async function getSkillCoverage(): Promise<SkillCoverage> {
  const db = getDb();
  const vocabularyItems = await db.vocabularyItems.toArray();
  const allIds = vocabularyItems.map((item) => item.id);
  const [recognizedIds, productionProficientIds, pitchProficientIds, wordListeningItems] =
    await Promise.all([
      getProficientRecognitionVocabularyItemIds(allIds).then((set) => [...set]),
      filterVocabularyItemIdsByActivity(allIds, ['reading_production'], isVocabularyItemProficient),
      getProficientPitchAccentVocabularyItemIds(allIds),
      db.studyItems.where('activityType').equals('word_listening').toArray(),
    ]);
  const proficientLinkIds = new Set(
    wordListeningItems
      .filter((item) => isVocabularyItemProficient(item.fsrsState.state))
      .map((item) => item.subjectId),
  );
  const heardProficientIds = new Set<string>();
  if (proficientLinkIds.size > 0) {
    const links = await db.sentenceVocabulary
      .where('id')
      .anyOf([...proficientLinkIds])
      .toArray();
    for (const link of links) heardProficientIds.add(link.vocabularyItemId);
  }
  return buildSkillCoverage({
    recognizedIds,
    productionProficientIds,
    pitchProficientIds,
    heardProficientIds,
  });
}

/**
 * "FSRS confidence snapshot" (2026-09-16, docs/ROADMAP.md "FSRS
 * calibration surfacing"). Every non-`new` study item's current predicted
 * retrievability (`predictRetrievability`), bucketed — see
 * `fsrsConfidence.ts` for why this is a live snapshot, not a
 * predicted-vs-actual validation.
 */
export async function getFsrsConfidenceSnapshot(options: { now?: Date } = {}): Promise<FsrsConfidenceSnapshot> {
  const now = options.now ?? new Date();
  const studyItems = await getDb().studyItems.toArray();
  const retrievabilities = studyItems
    // Every item scheduleReview has ever touched has lastReview set — this
    // guards against legacy/malformed rows where it's missing despite a
    // non-'new' state, which ts-fsrs's get_retrievability throws on rather
    // than tolerates.
    .filter((item) => item.fsrsState.state !== 'new' && item.fsrsState.lastReview)
    .map((item) => predictRetrievability(item.fsrsState, now));
  return buildFsrsConfidenceSnapshot(retrievabilities);
}

/**
 * "Step usefulness" (2026-09-16, docs/ROADMAP.md). Flattens every
 * `PlannerSession.steps` created in the last `windowDays` (tagged with the
 * owning session's `date`), grouped by `targetKind` — see
 * `buildStepUsefulness` for the completed/skipped rollup.
 */
export async function getStepUsefulness(
  options: { windowDays?: number; now?: Date } = {},
): Promise<StepUsefulnessReport> {
  const windowDays = options.windowDays ?? 56;
  const now = options.now ?? new Date();
  const cutoff = localDateKey(new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000));
  const sessions = await getDb().plannerSessions.where('date').aboveOrEqual(cutoff).toArray();
  const steps = sessions.flatMap((session) =>
    session.steps.map((step) => ({ targetKind: step.targetKind, status: step.status })),
  );
  return buildStepUsefulness(steps, windowDays);
}

/**
 * What followed each reader follow-up offer (see `followUpEffect.ts`). Reads the offers, then the other
 * lesson events and listening cards on just the sentences they were made on.
 */
export async function getFollowUpEffect(): Promise<FollowUpEffectReport> {
  const db = getDb();
  const offerEvents = await db.sentenceLearningEvents.filter((event) => event.action === 'follow_up_offer' && parseOffer(event) !== null).toArray();
  if (offerEvents.length === 0) return buildFollowUpEffect({ events: [], listening: [] });
  const sentenceIds = [...new Set(offerEvents.map((event) => event.sentenceId))];
  const events = await db.sentenceLearningEvents.where('sentenceId').anyOf(sentenceIds).toArray();
  const studyItems = (await db.studyItems.where('subjectId').anyOf(sentenceIds).toArray()).filter((item) => item.subjectType === 'sentence');
  const itemIds = studyItems.map((item) => item.id);
  const reviews = itemIds.length ? await db.reviews.where('studyItemId').anyOf(itemIds).toArray() : [];
  return buildFollowUpEffect({
    events,
    listening: buildListeningAttempts({ reviews, studyItems, learningEvents: events }),
  });
}

export interface StuckSentenceExample {
  sentenceId: string;
  bookId?: string;
  preview: string;
}

export interface StuckSentenceSnapshot {
  metCount: number;
  rows: { reason: StuckReason; count: number; examples: StuckSentenceExample[] }[];
}

/**
 * Progress "What's stuck" (`src/lib/stuckSentences.ts`): every met sentence (`getIntroducedSentenceIds`)
 * checked against the requirements the planner's current steps apply — a studied, non-shelved book; native
 * audio; a phrase split Ear tiles or Dictation can open on (`readTileEligibilityForPass`, the planner's own
 * check); and the shadowing pool (`activeSentenceIdsForShadowing`). Read-only.
 */
export async function getStuckSentenceSnapshot(): Promise<StuckSentenceSnapshot> {
  const db = getDb();
  const allIds = (await db.sentences.toCollection().primaryKeys()) as string[];
  const introduced = [...(await getIntroducedSentenceIds(allIds))];
  if (introduced.length === 0) return { metCount: 0, rows: [] };
  const [audioIds, books, suspendedIndex, memberships, tileEligibility, shadowPool] = await Promise.all([
    allAudioSentenceIds(),
    db.books.toArray(),
    loadSuspendedBookIndex(),
    bookSentencesForSentences(introduced),
    readTileEligibilityForPass(),
    activeSentenceIdsForShadowing(SHADOW_POOL_BOOK_LIMIT),
  ]);
  const withAudio = new Set(audioIds);
  const activeBooks = new Set(books.filter(isBookInStudyRotation).map((book) => book.id));
  const studiedBookBySentence = new Map<string, string>();
  for (const membership of memberships) {
    if (!activeBooks.has(membership.bookId)) continue;
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!studiedBookBySentence.has(membership.sentenceId)) studiedBookBySentence.set(membership.sentenceId, membership.bookId);
  }
  // Sentence rows only for the few no listening tool fits, to tell a missing analysis from a bad phrase count.
  const unsplittable = introduced.filter(
    (id) => studiedBookBySentence.has(id) && withAudio.has(id) && !tileEligibility.has(id),
  );
  const unsplittableRows = new Map(
    (await db.sentences.bulkGet(unsplittable)).flatMap((row) => (row ? [[row.id, row] as const] : [])),
  );
  const summary = buildStuckSummary(
    introduced.map((sentenceId) => ({
      sentenceId,
      bookId: studiedBookBySentence.get(sentenceId),
      hasAudio: withAudio.has(sentenceId),
      listeningToolFits: tileEligibility.has(sentenceId),
      sentence: unsplittableRows.get(sentenceId),
      inShadowPool: shadowPool.has(sentenceId),
    })),
  );
  const exampleIds = [...new Set(summary.rows.flatMap((row) => row.examples))];
  const exampleRows = new Map(
    (await db.sentences.bulkGet(exampleIds)).flatMap((row) => (row ? [[row.id, row] as const] : [])),
  );
  return {
    metCount: summary.metCount,
    rows: summary.rows.map((row) => ({
      reason: row.reason,
      count: row.count,
      examples: row.examples.map((sentenceId) => ({
        sentenceId,
        bookId: studiedBookBySentence.get(sentenceId),
        preview: exampleRows.get(sentenceId)?.japanese.slice(0, 24) ?? '',
      })),
    })),
  };
}
