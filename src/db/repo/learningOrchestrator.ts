// ---------------------------------------------------------------------------
// Learning Orchestrator (docs/AI_OVERVIEW.md) — the only Dexie-querying half
// of the feature. Everything decision-shaped (scoring, allocation, step
// selection, explanation) lives in the pure src/lib/sessionPlanner.ts; this
// section's job is purely "fetch real data, adapt it into that module's
// plain input types." PlannerSession syncs (unlike the shadowing Attempt
// section) so the SessionBar "continue where you left off" state follows
// the learner across devices — conflicts resolve last-write-wins, not the
// usual manual panel (src/sync/engine.ts's LAST_WRITE_WINS_ENTITIES).
// ---------------------------------------------------------------------------

import { surfaceReadingFromInline } from '../../lib/readingAnswer';
import {
  MEANING_CHECK_KEY_PREFIX,
  strugglingWordIds,
} from '../../lib/wordEvidence';
import { findSetExpressions } from '../../lib/setExpressions';
import { GRAMMAR_USE_KEY_PREFIX, grammarPatternStrengths } from '../../lib/grammarEvidence';
import { dueGrammarChecks, type GrammarCheckSentence } from '../../lib/grammarCheckSteps';
import {
  pickAnotherExample,
  pickOtherExamples,
  type ExampleParts,
} from '../../lib/grammarExamples';
import {
  evidenceLevel,
  type EvidenceLevel,
  planWeakWordSentences,
  READER_KNOWN_STRENGTH,
} from '../../lib/wordStrength';
import {
  readCheckReason,
  sentencesDueForReadCheck,
} from '../../lib/readCheck';
import { markedSurfacesIn } from '../../lib/markedWords';
import { withoutResetWalkthroughs } from '../../lib/sentenceLearning';
import {
  explainWeakWordSentences,
  type WeakWordExplanation,
} from '../../lib/weakWordExplain';
import { parkedSentenceIds } from '../../lib/glossSkill';
import {
  buildGrammarDetector,
  buildReferenceIndex,
  curatedGrammarByPattern,
  wordSpansForDetection,
} from '../../lib/grammarReference';
import {
  grammarLevelCosts,
  knownGrammarEntries,
  orderByIPlusOne,
  orderByStrictIPlusOne,
  type IPlusOneItem,
} from '../../lib/iPlusOne';
import { summariseIPlusOne, type IPlusOneNextStep, type IPlusOneStatus, type IPlusOneStatusEntry } from '../../lib/iPlusOneStatus';
import {
  isIPlusOneOrdering,
  isStrictIPlusOne,
  iPlusOneStretchEvery,
  isSequentialStudyMode,
} from '../../lib/sentenceLed';
import {
  buildKnownLemmaSet,
  lemmaKey,
  partlyMetLemmas,
  scoreSentence,
  unknownLemmasForSentence,
  WORD_MIN_EXPOSURES,
} from '../../lib/unknownLemmas';
import { sessionStepCategory } from '../../lib/sessionStepCategory';
import { sentencesDueForFreshTry } from '../../lib/sentenceJourney';
import type {
  ReviewTroubleLog,
  ReviewTroubleTag,
  SentenceLearningEvent,
  BookSentence,
  GrammarPattern,
  PlannerSession,
  PlannerSessionStep,
  PlannerStepStatus,
  Review,
  ReviewRating,
  Sentence,
  SentenceAnalysis,
  SentenceVocabulary,
  SessionBucket,
  StudyItem,
} from '../../domain/types';
import {
  buildSessionRecap,
  type SessionRecap,
} from '../../lib/sessionRecap';
import { createId } from '../../lib/ids';
import { nowIso } from '../../lib/normalize';
import {
  isBookInStudyRotation,
  membershipIsShelved,
  studyItemIsHeldBackBySuspension,
} from '../../lib/suspendedBooks';
import type { TileDictation } from '../../lib/earTiles';
import { dueListeningTools } from '../../lib/listeningTools';
import {
  readingCheckTile,
  recentReadingMisses,
} from '../../lib/readingMissSteps';
import {
  dueWordChecks,
  pickTransferSentence,
  transferWordCheckReason,
  type TransferSentenceOption,
} from '../../lib/wordCheckSteps';
import {
  buildReviewTroubleReport,
  type ReviewTroubleReport,
} from '../../lib/reviewTroubleReport';
import { buildListeningAttempts } from '../../lib/listeningEvidence';
import {
  buildRecommendedSession,
  computeNeglectScores,
  computeRecentActivityDistribution,
  shadowAttemptSummary,
  type ExploreCandidate,
  type ListeningToolCandidate,
  type WordCheckCandidate,
  type GrammarCheckCandidate,
  type ReadCheckCandidate,
  type GrammarNoticingCandidate,
  type RecentActivityEvent,
  type RecommendedSession,
  type ReviewPriorityInput,
  type SessionPlannerInput,
  type ShadowCandidate,
} from '../../lib/sessionPlanner';
import {
  normalizeTroubleTags,
  routeTroubleTags,
} from '../../lib/reviewTroubleTags';
import {
  activeShadowSnoozeIds,
  shadowSnoozeUntil,
} from '../../lib/shadowSnooze';
import {
  EXPLORE_CANDIDATE_LIMIT,
  EXPLORE_REVISITS_PER_BOOK,
  LISTENING_TOOL_CANDIDATE_LIMIT,
  WORD_CHECK_CANDIDATE_LIMIT,
  GRAMMAR_CHECK_CANDIDATE_LIMIT,
  READ_CHECK_CANDIDATE_LIMIT,
  WEAK_WORD_REVISIT_MIN_GAP_DAYS,
  isSentenceCardSubject,
  EXPLORE_SENTENCE_PREVIEW_LIMIT,
  NEGLECT_WINDOW_DAYS,
  PRACTICE_ACTIVITY_TYPES,
  RETIRED_DRILL_SUBJECT_TYPES,
  RETAIN_ACTIVITY_TYPES,
  SESSION_PLANNER_CANDIDATE_POOL_SIZE,
  SHADOW_CANDIDATE_LIMIT,
  SHADOW_POOL_BOOK_LIMIT,
} from '../../lib/sessionPlannerConfig';
import { ensureSettings, getDb, localDateKey, readSettings } from '../database';
import { updateSettings } from './settingsWrites';
import { clearPlannerSnapshots } from '../plannerSnapshots';
import {
  notifySync,
  notifySyncMany,
} from '../syncNotify';
import {
  confirmSentenceVocabulary,
  setSentenceGrammarReviewStatus,
} from './vocabularyKanji';
import { setBookSentenceStatus } from './sentenceWrites';
import { loadSuspendedBookIndex } from './suspendedIndex';
import {
  ANY_OF_SCAN_THRESHOLD,
  allAudioSentenceIds,
  beginPlannerWarming,
  bookSentencesForSentences,
  clearPlannerReadCaches,
  createPlannerTimer,
  endPlannerPass,
  endPlannerWarming,
  learningEventsForSentences,
  plannerPassActive,
  readAllBookSentencesForPass,
  readAllGlossDecisionsForPass,
  readAllLearningEventsForPass,
  readAllSentenceVocabularyForPass,
  readAllStudyItemsForPass,
  readSentenceStudyItemsForPass,
  readTileEligibilityForPass,
  reviewsForStudyItems,
  rowCount,
  sentenceIdsWithAudioClip,
  traceStep,
} from './passReads';
import { getSequentialBookStatus } from './sequentialUnlocks';
import { listSentenceLearningEvents } from './sentenceLearningEvents';
import {
  listSentenceGrammarForPattern,
  chunkChainPlannedForSentence,
  getActiveMarkedWords,
  suggestPhraseShadowForSentence,
} from './grammarPatterns';
import {
  getBookVocabularyCoverage,
  getDueStudyItems,
  getIntroducedReadingVocabularyItemIds,
  getIntroducedSentenceIds,
  getSentenceFullReviewReadiness,
  getSentenceShadowingReadiness,
} from './reviewScheduling';
import {
  loadWordReadingStrengths,
  PLANNER_STRENGTH_CACHE_MS,
  READER_STRENGTH_CACHE_MS,
  type WordReadingStrengths,
} from './wordReadingStrengths';

/**
 * Batched (not N+1) conversion of already-fetched due StudyItems into
 * scoreReviewPriority's input shape — one context-diversity query per
 * subjectType touched, one reviews query for the whole batch, regardless of
 * how many study items are in `studyItems` (mirrors listGrammarPatternSummaries's
 * "batched" discipline above).
 */
/**
 * Priority inputs for due cards. The planner's due scan leaves out the retired
 * word/grammar subjects (`RETIRED_DRILL_SUBJECT_TYPES`), so only sentence cards
 * carry source diversity: the distinct books (by source key) holding the sentence.
 */
async function buildReviewPriorityInputs(
  studyItems: StudyItem[],
  mode: SessionBucket,
  now: Date,
): Promise<ReviewPriorityInput[]> {
  if (studyItems.length === 0) return [];
  const db = getDb();

  const sentenceIds = [
    ...new Set(studyItems.filter((item) => item.subjectType === 'sentence').map((item) => item.subjectId)),
  ];
  const memberships = sentenceIds.length ? await bookSentencesForSentences(sentenceIds) : [];
  const bookIds = [...new Set(memberships.map((item) => item.bookId))];
  const books = await db.books.bulkGet(bookIds);
  const sourceKeyByBookId = new Map<string, string>();
  books.forEach((book, index) => {
    if (book) sourceKeyByBookId.set(bookIds[index]!, book.sourceKey ?? book.id);
  });
  const sourceKeysBySentenceId = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const key = sourceKeyByBookId.get(membership.bookId);
    if (!key) continue;
    const existing = sourceKeysBySentenceId.get(membership.sentenceId);
    if (existing) existing.add(key);
    else sourceKeysBySentenceId.set(membership.sentenceId, new Set([key]));
  }

  const allReviews = await reviewsForStudyItems(studyItems.map((item) => item.id));
  const reviewsByStudyItemId = new Map<string, Review[]>();
  for (const review of allReviews) {
    const list = reviewsByStudyItemId.get(review.studyItemId);
    if (list) list.push(review);
    else reviewsByStudyItemId.set(review.studyItemId, [review]);
  }

  return studyItems.map((item) => {
    const itemReviews = (reviewsByStudyItemId.get(item.id) ?? [])
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const recent = itemReviews.slice(0, 7);
    const recentAgainCount = recent.filter((review) => review.rating === 'again').length;
    const lastNaturalEncounter = itemReviews.find((review) => review.source === 'natural_encounter');
    const isSentence = item.subjectType === 'sentence';

    return {
      studyItemId: item.id,
      subjectType: item.subjectType,
      activityType: item.activityType,
      mode,
      due: item.fsrsState.due,
      scheduledDays: item.fsrsState.scheduledDays,
      state: item.fsrsState.state,
      distinctSourceCount: isSentence ? (sourceKeysBySentenceId.get(item.subjectId)?.size ?? 0) : 0,
      distinctSentenceCount: isSentence ? 1 : 0,
      recentAgainCount,
      recentReviewCount: recent.length,
      daysSinceLastEncounter: lastNaturalEncounter
        ? (now.getTime() - new Date(lastNaturalEncounter.timestamp).getTime()) / (24 * 60 * 60 * 1000)
        : null,
      now,
    } satisfies ReviewPriorityInput;
  });
}

/**
 * Review-card "Fresh try this sentence": queue the card's sentence to be drafted
 * as a Fresh try next, ahead of the spacing schedule. Only walked-through
 * sentences qualify; anything else would just come up as a first lesson anyway.
 */
export async function requestFreshTry(sentenceId: string, now: Date = new Date()): Promise<'queued' | 'not_walked'> {
  const events = withoutResetWalkthroughs(await getDb().sentenceLearningEvents.where('sentenceId').equals(sentenceId).toArray());
  if (!events.some((event) => event.action === 'walkthrough_completed')) return 'not_walked';
  const settings = await ensureSettings(getDb());
  await updateSettings({ freshTryRequests: { ...settings.freshTryRequests, [sentenceId]: now.toISOString() } });
  return 'queued';
}

/**
 * Review "what was hard?" tags (docs/ROADMAP.md "Review trouble tags and
 * remediation queue"). Logs the tags locally and queues the follow-up after the
 * review: reading/meaning/kanji → a Fresh try (walked-through sentences only),
 * sound → shadowing priority. Never touches FSRS or credits any card.
 */
export async function recordReviewTroubleTags(input: {
  studyItemId: string;
  sentenceId: string;
  rating: ReviewRating;
  tags: readonly ReviewTroubleTag[];
  now?: Date;
}): Promise<ReviewTroubleLog | undefined> {
  const tags = normalizeTroubleTags(input.tags);
  if (tags.length === 0) return undefined;
  const now = input.now ?? new Date();
  const route = routeTroubleTags(tags);
  const queued = { freshTry: false, shadow: false };
  if (route.freshTry) queued.freshTry = (await requestFreshTry(input.sentenceId, now)) === 'queued';
  if (route.shadow) {
    const settings = await ensureSettings(getDb());
    const { [input.sentenceId]: _clearedSnooze, ...remainingSnoozes } = settings.shadowSnoozes ?? {};
    await updateSettings({
      shadowRequests: { ...settings.shadowRequests, [input.sentenceId]: now.toISOString() },
      shadowSnoozes: remainingSnoozes,
    });
    queued.shadow = true;
  }
  const log: ReviewTroubleLog = {
    id: createId('review_trouble'),
    timestamp: now.toISOString(),
    studyItemId: input.studyItemId,
    sentenceId: input.sentenceId,
    rating: input.rating,
    tags,
    queued,
  };
  await getDb().reviewTroubleLogs.put(log);
  notifySyncMany([{ entity: 'review_trouble_logs', recordId: log.id, payload: log }]);
  return log;
}

/**
 * Progress notes for the review trouble tags (`buildReviewTroubleReport`).
 * Read-only; gathers the tag log plus the reviews, Fresh try attempts and
 * shadowing attempts that followed it.
 */
export async function getReviewTroubleReport(): Promise<ReviewTroubleReport> {
  const db = getDb();
  const logs = await db.reviewTroubleLogs.toArray();
  if (logs.length === 0) return buildReviewTroubleReport({ logs, reviews: [], expressionAttempts: [], shadowAttempts: [] });
  const firstLog = logs.map((log) => log.timestamp).sort()[0]!;
  const sentenceIds = [...new Set(logs.map((log) => log.sentenceId))];
  const [reviews, events, attempts] = await Promise.all([
    db.reviews.where('timestamp').aboveOrEqual(firstLog).toArray(),
    db.sentenceLearningEvents.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.attempts.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  return buildReviewTroubleReport({
    logs,
    reviews: reviews.map((review) => ({
      studyItemId: review.studyItemId,
      timestamp: review.timestamp,
      rating: review.rating,
    })),
    expressionAttempts: events
      // Same done-rule as pendingFreshTryRequestIds: a finished walkthrough counts too.
      .filter((event) => event.action === 'expression_attempt' || event.action === 'walkthrough_completed')
      .map((event) => ({ sentenceId: event.sentenceId, timestamp: event.timestamp })),
    shadowAttempts: attempts.map((attempt) => ({ sentenceId: attempt.sentenceId, timestamp: attempt.createdAt })),
  });
}

/** Requested sentences still waiting: no attempt or finished walkthrough since the request. */
function pendingFreshTryRequestIds(
  requests: Record<string, string> | undefined,
  events: SentenceLearningEvent[],
): string[] {
  if (!requests) return [];
  return Object.entries(requests)
    .filter(
      ([id, at]) =>
        !events.some(
          (e) =>
            e.sentenceId === id &&
            (e.action === 'expression_attempt' || e.action === 'walkthrough_completed') &&
            e.timestamp > at,
        ),
    )
    .map(([id]) => id);
}


/** Strength per grammar pattern that has any reader tap: its weakest tapped facet. Untapped patterns are absent. */
async function loadGrammarPatternStrengths(): Promise<Map<string, number>> {
  return grammarPatternStrengths(await readAllLearningEventsForPass(), Date.now());
}

/**
 * How much evidence the learner has on each of a sentence's words and grammar patterns, for the Reader to show
 * on the selected sentence: `unchecked` (never tapped, reviewed or walked: no signal yet), `shaky` (some, below
 * `READER_KNOWN_STRENGTH`) or `solid`. Keys are `word:<vocabularyItemId>` and `pattern:<patternId>`. Display
 * only: it changes no scheduling and grades nothing.
 */
export async function getReaderEvidenceLevels(
  wordIds: string[],
  patternIds: string[],
): Promise<Map<string, EvidenceLevel>> {
  const levels = new Map<string, EvidenceLevel>();
  if (wordIds.length > 0) {
    const { strengthByWord } = await loadWordReadingStrengths(READER_STRENGTH_CACHE_MS);
    for (const id of wordIds) levels.set(`word:${id}`, evidenceLevel(strengthByWord.get(id)));
  }
  if (patternIds.length > 0) {
    const strengthByPattern = await loadGrammarPatternStrengths();
    for (const id of patternIds) levels.set(`pattern:${id}`, evidenceLevel(strengthByPattern.get(id)));
  }
  return levels;
}

export interface GrammarStrengthReport {
  /** Patterns the learner has met in a sentence, by evidence level (same thresholds as the reader markers). */
  counts: Record<EvidenceLevel, number>;
  /** The shakiest patterns that have some evidence, weakest first. */
  weakest: Array<{ patternId: string; name: string; strength: number; sentences: number }>;
}

/**
 * The /progress grammar-strength panel: how many linked patterns are unchecked / shaky / solid, and which
 * tapped ones are weakest. Display only; the same signal the reader markers and weak-grammar revisits use.
 */
export async function getGrammarStrengthReport(limit = 5): Promise<GrammarStrengthReport> {
  const db = getDb();
  const [links, strengthByPattern] = await Promise.all([db.sentenceGrammar.toArray(), loadGrammarPatternStrengths()]);
  const sentencesByPattern = new Map<string, Set<string>>();
  for (const link of links) {
    const set = sentencesByPattern.get(link.grammarPatternId);
    if (set) set.add(link.sentenceId);
    else sentencesByPattern.set(link.grammarPatternId, new Set([link.sentenceId]));
  }
  const counts: Record<EvidenceLevel, number> = { unchecked: 0, shaky: 0, solid: 0 };
  for (const id of sentencesByPattern.keys()) counts[evidenceLevel(strengthByPattern.get(id))] += 1;
  const weakIds = [...sentencesByPattern.keys()]
    .filter((id) => strengthByPattern.has(id) && strengthByPattern.get(id)! < READER_KNOWN_STRENGTH)
    .sort((a, b) => strengthByPattern.get(a)! - strengthByPattern.get(b)!)
    .slice(0, limit);
  const patterns = weakIds.length > 0 ? await db.grammarPatterns.where('id').anyOf(weakIds).toArray() : [];
  const nameById = new Map(patterns.map((pattern) => [pattern.id, pattern.canonicalName]));
  return {
    counts,
    weakest: weakIds.map((id) => ({
      patternId: id,
      name: nameById.get(id) ?? id,
      strength: strengthByPattern.get(id)!,
      sentences: sentencesByPattern.get(id)!.size,
    })),
  };
}

/**
 * The pattern a Grammar check should ask about: the weakest one with evidence, else the first with none yet
 * (an unchecked pattern is unseen, not weak, but still worth a look when nothing is known to be weak).
 */
export async function pickGrammarCheckPatternId(patternIds: string[]): Promise<string | undefined> {
  if (patternIds.length === 0) return undefined;
  const strengthByPattern = await loadGrammarPatternStrengths();
  const withEvidence = patternIds.filter((id) => strengthByPattern.has(id));
  if (withEvidence.length === 0) return patternIds[0];
  return withEvidence.reduce((weakest, id) => (strengthByPattern.get(id)! < strengthByPattern.get(weakest)! ? id : weakest));
}

export interface GrammarCheckExample {
  sentenceId: string;
  parts: ExampleParts;
  translation?: string;
  /** What the construction does in that sentence, when its link records it. */
  occurrenceExplanation?: string;
}

/**
 * A second sentence from the learner's books with the pattern, shown after a Grammar check they needed help on
 * (`pickAnotherExample`: an introduced sentence first, then the simplest). Teaching only: nothing is logged or
 * credited for it. Undefined when the pattern has no other usable sentence.
 */
export async function getGrammarCheckExample(
  grammarPatternId: string,
  checked: { id: string; japanese: string },
): Promise<GrammarCheckExample | undefined> {
  const encounters = await listSentenceGrammarForPattern(grammarPatternId);
  if (encounters.length === 0) return undefined;
  const introduced = await getIntroducedSentenceIds([...new Set(encounters.map((item) => item.sentence.id))]);
  const example = pickAnotherExample(encounters, checked, introduced);
  if (!example) return undefined;
  return {
    sentenceId: example.item.sentence.id,
    parts: example.parts,
    translation: example.item.sentence.translation || undefined,
    occurrenceExplanation: example.item.sentenceGrammar.occurrenceExplanation || undefined,
  };
}

/**
 * Up to `limit` other sentences from the learner's books with the pattern, for the reader's "see it in other
 * sentences" option (`pickOtherExamples`). Teaching only: nothing is logged or credited.
 */
export async function getGrammarExamples(
  grammarPatternId: string,
  current: { id: string; japanese: string },
  limit = 3,
): Promise<GrammarCheckExample[]> {
  const encounters = await listSentenceGrammarForPattern(grammarPatternId);
  if (encounters.length === 0) return [];
  const introduced = await getIntroducedSentenceIds([...new Set(encounters.map((item) => item.sentence.id))]);
  return pickOtherExamples(encounters, current, introduced, limit).map((example) => ({
    sentenceId: example.item.sentence.id,
    parts: example.parts,
    translation: example.item.sentence.translation || undefined,
    occurrenceExplanation: example.item.sentenceGrammar.occurrenceExplanation || undefined,
  }));
}

/**
 * The grammar twin of `getWeakWordSentenceSignal`: which of `sentenceIds` carry grammar patterns the learner
 * hasn't retained, from their reader taps (`buildGrammarEvidence`). A pattern's strength is its weakest facet
 * that has any evidence (spotting it, understanding it); a pattern with no taps is unseen, not weak. `labels`
 * names each pick's weak patterns. Selection only: no due dates, no FSRS effect.
 */
export async function getWeakGrammarSentenceSignal(
  sentenceIds: string[],
): Promise<{ order: string[]; labels: Map<string, string[]> }> {
  if (sentenceIds.length === 0) return { order: [], labels: new Map() };
  const db = getDb();
  const strengthByPattern = await loadGrammarPatternStrengths();
  if (strengthByPattern.size === 0) return { order: [], labels: new Map() };
  const links = await db.sentenceGrammar.where('sentenceId').anyOf(sentenceIds).toArray();
  const patternsBySentence = new Map<string, string[]>();
  for (const link of links) {
    if (!strengthByPattern.has(link.grammarPatternId)) continue;
    const list = patternsBySentence.get(link.sentenceId);
    if (list) list.push(link.grammarPatternId);
    else patternsBySentence.set(link.sentenceId, [link.grammarPatternId]);
  }
  const plan = planWeakWordSentences(
    sentenceIds.map((sentenceId) => ({ sentenceId, wordIds: patternsBySentence.get(sentenceId) ?? [] })),
    strengthByPattern,
  );
  const patternIds = [...new Set([...plan.weakWordsBySentence.values()].flat())];
  const patterns = new Map(
    (await db.grammarPatterns.bulkGet(patternIds)).filter((p): p is GrammarPattern => Boolean(p)).map((p) => [p.id, p.canonicalName]),
  );
  const labels = new Map<string, string[]>();
  for (const [sentenceId, ids] of plan.weakWordsBySentence) {
    labels.set(sentenceId, ids.map((id) => patterns.get(id)).filter((x): x is string => Boolean(x)));
  }
  return { order: plan.order, labels };
}

/**
 * Walked-through sentences worth another walkthrough for the weak words (or, after the words, weak grammar
 * patterns) they contain: last walked at least WEAK_WORD_REVISIT_MIN_GAP_DAYS ago, not already `excluded`,
 * ranked by `getWeakWordSentenceSignal` then `getWeakGrammarSentenceSignal`. Returns sentence id → the weak
 * words and the weak patterns to name in the step's reason, in pick order. Selection only.
 */
async function findWeakWordRevisits(
  events: SentenceLearningEvent[],
  excluded: ReadonlySet<string>,
  limit: number,
  now: Date = new Date(),
): Promise<Map<string, { words: string[]; grammar: string[] }>> {
  const lastWalk = new Map<string, string>();
  for (const event of events) {
    if (event.action !== 'walkthrough_completed') continue;
    const seen = lastWalk.get(event.sentenceId);
    if (seen === undefined || event.timestamp > seen) lastWalk.set(event.sentenceId, event.timestamp);
  }
  const cutoff = now.getTime() - WEAK_WORD_REVISIT_MIN_GAP_DAYS * 86_400_000;
  const candidates = [...lastWalk]
    .filter(([id, at]) => !excluded.has(id) && Date.parse(at) <= cutoff)
    .map(([id]) => id);
  // Planner runs call this once per book; the shared strengths scan reads five whole tables, so reuse it.
  const signal = await getWeakWordSentenceSignal(candidates, PLANNER_STRENGTH_CACHE_MS);
  const grammar = await getWeakGrammarSentenceSignal(candidates);
  // Weak words lead; weak grammar fills the remaining room, so grammar revisits never crowd out word ones.
  const picked = [...new Set([...signal.order, ...grammar.order])].slice(0, limit);
  return new Map(
    picked.map((id) => [id, { words: signal.labels.get(id) ?? [], grammar: grammar.labels.get(id) ?? [] }]),
  );
}

/**
 * Walked-through sentences due for a Read check (src/lib/readCheck.ts), most urgent first.
 * Sentences in `excluded` (already spoken for today, or about to get a Fresh try) are skipped.
 * Selection only: nothing is stored and no card is created.
 */
export async function findReadCheckCandidates(
  limit: number,
  excluded: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): Promise<ReadCheckCandidate[]> {
  const db = getDb();
  const [events, books, suspendedIndex] = await Promise.all([
    readAllLearningEventsForPass(),
    db.books.toArray(),
    loadSuspendedBookIndex(),
  ]);
  const due = sentencesDueForReadCheck(events, now).filter((entry) => !excluded.has(entry.sentenceId));
  if (due.length === 0) return [];
  const activeBooks = new Set(books.filter(isBookInStudyRotation).map((book) => book.id));
  const memberships = await bookSentencesForSentences(due.map((entry) => entry.sentenceId));
  const membershipBySentence = new Map<string, BookSentence>();
  for (const membership of memberships) {
    if (!activeBooks.has(membership.bookId)) continue;
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!membershipBySentence.has(membership.sentenceId)) membershipBySentence.set(membership.sentenceId, membership);
  }
  const reachable = due.filter((entry) => membershipBySentence.has(entry.sentenceId));
  const picked = reachable.slice(0, limit);
  const sentences = await db.sentences.bulkGet(picked.map((entry) => entry.sentenceId));
  return picked.map((entry, index) => ({
    bookId: membershipBySentence.get(entry.sentenceId)!.bookId,
    sentenceId: entry.sentenceId,
    preview: sentences[index]?.japanese.slice(0, 24) ?? '',
    reason: readCheckReason(entry),
    waiting: reachable.length,
  }));
}

/**
 * Sentences due for an Ear tiles or Dictation round in the reader (see `listeningTools.ts`): introduced, in an
 * active book, with native audio and enough phrases for the tool, not tried by ear recently. Evidence only.
 */
export async function findListeningToolCandidates(
  limit: number,
  excluded: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): Promise<ListeningToolCandidate[]> {
  const db = getDb();
  const audioIds = (await allAudioSentenceIds()).filter((id) => !excluded.has(id));
  if (audioIds.length === 0) return [];
  const [introduced, books, suspendedIndex] = await Promise.all([
    getIntroducedSentenceIds(audioIds),
    db.books.toArray(),
    loadSuspendedBookIndex(),
  ]);
  const wanted = audioIds.filter((id) => introduced.has(id));
  if (wanted.length === 0) return [];
  const activeBooks = new Set(books.filter(isBookInStudyRotation).map((book) => book.id));
  const memberships = await bookSentencesForSentences(wanted);
  const membershipBySentence = new Map<string, BookSentence>();
  for (const membership of memberships) {
    if (!activeBooks.has(membership.bookId)) continue;
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!membershipBySentence.has(membership.sentenceId)) membershipBySentence.set(membership.sentenceId, membership);
  }
  const reachable = wanted.filter((id) => membershipBySentence.has(id));
  const tileEligibility = await readTileEligibilityForPass();
  const eligible = reachable.flatMap((id) => {
    const entry = tileEligibility.get(id);
    return entry ? [{ sentenceId: id, tilesEligible: entry.tiles, dictateEligible: entry.dictate }] : [];
  });
  if (eligible.length === 0) return [];

  const ids = eligible.map((entry) => entry.sentenceId);
  const events = await learningEventsForSentences(ids);
  const idSet = new Set(ids);
  const studyItems = (
    ids.length > ANY_OF_SCAN_THRESHOLD
      ? await readSentenceStudyItemsForPass()
      : (await db.studyItems.where('subjectId').anyOf(ids).toArray()).filter((item) => item.subjectType === 'sentence')
  ).filter((item) => idSet.has(item.subjectId));
  const itemIds = studyItems.map((item) => item.id);
  const reviews = itemIds.length ? await reviewsForStudyItems(itemIds) : [];
  const lastReadCheck = new Map<string, { at: number; gotIt: boolean }>();
  for (const event of events) {
    if (event.action !== 'gist_check' || !event.outcome) continue;
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at) || at <= (lastReadCheck.get(event.sentenceId)?.at ?? 0)) continue;
    lastReadCheck.set(event.sentenceId, { at, gotIt: event.outcome === 'got_it' });
  }
  const due = dueListeningTools({
    sentences: eligible,
    attempts: buildListeningAttempts({ reviews, studyItems, learningEvents: events }),
    lastReadCheck,
    now: now.getTime(),
  }).slice(0, limit);
  const dueSentences = await db.sentences.bulkGet(due.map((entry) => entry.sentenceId));
  const byId = new Map(dueSentences.flatMap((sentence) => (sentence ? [[sentence.id, sentence] as const] : [])));
  return due.map((entry) => ({
    bookId: membershipBySentence.get(entry.sentenceId)!.bookId,
    sentenceId: entry.sentenceId,
    preview: byId.get(entry.sentenceId)?.japanese.slice(0, 24) ?? '',
    reason: entry.reason,
    tool: entry.tool,
  }));
}

/**
 * Sentences due for a typed-reading check (`readingMissSteps.ts`): the learner said in the reader they couldn't read a
 * word recently, in a sentence of an active book whose phrase around that word can be shown with a known reading. Not
 * gated on the sentence being introduced: the miss itself is the evidence that they met it. Evidence only.
 */
export async function findReadingCheckCandidates(
  limit: number,
  excluded: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): Promise<ListeningToolCandidate[]> {
  const misses = recentReadingMisses(await readAllLearningEventsForPass(), now.getTime()).filter(
    (miss) => !excluded.has(miss.sentenceId),
  );
  if (misses.length === 0) return [];
  const db = getDb();
  const ids = misses.map((miss) => miss.sentenceId);
  const [rows, books, suspendedIndex, memberships] = await Promise.all([
    db.sentences.bulkGet(ids),
    db.books.toArray(),
    loadSuspendedBookIndex(),
    bookSentencesForSentences(ids),
  ]);
  const activeBooks = new Set(books.filter(isBookInStudyRotation).map((book) => book.id));
  const membershipBySentence = new Map<string, BookSentence>();
  for (const membership of memberships) {
    if (!activeBooks.has(membership.bookId)) continue;
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!membershipBySentence.has(membership.sentenceId)) membershipBySentence.set(membership.sentenceId, membership);
  }
  const out: ListeningToolCandidate[] = [];
  for (const [index, miss] of misses.entries()) {
    const sentence = rows[index];
    const membership = membershipBySentence.get(miss.sentenceId);
    if (!sentence || !membership || !readingCheckTile(sentence, miss.surface)) continue;
    out.push({
      bookId: membership.bookId,
      sentenceId: sentence.id,
      preview: sentence.japanese.slice(0, 24),
      reason: `You couldn't read ${miss.surface} — type its reading`,
      tool: 'reading',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** The missed word's phrase for a Reading check opened on `sentence`, or null when it has no recent miss left to check. */
export async function getReadingCheckTarget(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  /** No recent miss on the sentence: ask about its weakest-reading kanji word instead (the learner said reading was hard). */
  options: { orWeakest?: boolean } = {},
): Promise<ReadingCheckTarget | null> {
  const miss = recentReadingMisses(await readAllLearningEventsForPass(), Date.now()).find((m) => m.sentenceId === sentence.id);
  const found = miss ? readingCheckTile(sentence, miss.surface) : null;
  if (miss && found) return { wordId: miss.wordId, surface: miss.surface, tile: found.tile };
  return options.orWeakest ? weakestReadingTarget(sentence, await loadWordReadingStrengths(READER_STRENGTH_CACHE_MS)) : null;
}

/** A Reading check's word. `wordId` is '' when the word has no vocabulary item yet; the caller makes one from `word` when the learner answers. */
export interface ReadingCheckTarget {
  wordId: string;
  surface: string;
  tile: TileDictation;
  word?: { expression: string; reading: string; meaning: string };
}

/** The sentence's content word with kanji whose reading is weakest (unseen counts as weakest), when its phrase has a reading to type. */
function weakestReadingTarget(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  strengths: WordReadingStrengths,
): ReadingCheckTarget | null {
  const words = meaningCheckWordsFor(sentence, strengths)
    .filter((word) => /\p{Script=Han}/u.test(word.surface))
    .map((word) => ({ word, strength: (word.vocabularyItemId && strengths.strengthByWord.get(word.vocabularyItemId)) || 0 }))
    .sort((a, b) => a.strength - b.strength || a.word.start - b.word.start);
  for (const { word } of words) {
    const found = readingCheckTile(sentence, word.surface);
    if (found) {
      return {
        wordId: word.vocabularyItemId,
        surface: word.surface,
        tile: found.tile,
        word: { expression: word.expression, reading: word.reading, meaning: word.meaning },
      };
    }
  }
  return null;
}

/** i+1 ordering inputs shared by every book: one global rank and each sentence's not-yet-met words. */
interface IPlusOneContext {
  /** Position in the i+1 order over every not-yet-introduced book sentence (lower = sooner). */
  rank: Map<string, number>;
  /** Display forms of the content words in the sentence the learner has not met yet. */
  newWords: Map<string, string[]>;
  /** Not-yet-introduced sentences the i+1 score can judge (tokenized, with content words). */
  scorable: Set<string>;
}

/**
 * The "known" lemmas for i+1: content words of every introduced sentence
 * (`getIntroducedSentenceIds`) seen in at least `WORD_MIN_EXPOSURES` of them, plus words with a reading/meaning study item
 * that has been reviewed at least once (pitch-only practice doesn't count).
 */
async function loadKnownLemmaSet(introducedRows: (Sentence | undefined)[]): Promise<Set<string>> {
  const vocabulary = await getDb().vocabularyItems.toArray();
  const reviewed = await getIntroducedReadingVocabularyItemIds(vocabulary.map((item) => item.id));
  const reviewedKeys = vocabulary
    .filter((item) => reviewed.has(item.id))
    .map((item) => lemmaKey(item.expression, item.reading));
  const known = buildKnownLemmaSet(
    introducedRows.map((row) => row?.vocabularySuggestions),
    reviewedKeys,
    WORD_MIN_EXPOSURES,
  );
  // A word the learner keeps missing in the reader / Word check is unknown again, however often it was seen.
  const struggling = strugglingWordIds(await readAllLearningEventsForPass(), Date.now());
  for (const item of vocabulary) if (struggling.has(item.id)) known.delete(lemmaKey(item.expression, item.reading));
  return known;
}

/**
 * Curated grammar (vendored OpenJLPT list) per sentence, via the learner's own pattern links. Only unambiguous
 * matches count (see `curatedGrammarByPattern`); `known` is every curated entry carried by at least
 * `GRAMMAR_MIN_EXPOSURES` introduced sentences and not shaky (`knownGrammarEntries`).
 */
async function loadCuratedGrammar(
  introduced: ReadonlySet<string>,
  rows: readonly (Sentence | undefined)[],
): Promise<{
  entriesBySentence: Map<string, string[]>;
  known: Set<string>;
  names: Map<string, string>;
  cost: Map<string, number>;
}> {
  const db = getDb();
  const [{ default: reference }, patterns, links] = await Promise.all([
    import('../../data/openJlptGrammar.json'),
    db.grammarPatterns.toArray(),
    db.sentenceGrammar.toArray(),
  ]);
  const index = buildReferenceIndex(reference.patterns);
  const byPattern = curatedGrammarByPattern(patterns, index);
  const names = new Map(reference.patterns.map((entry) => [entry.id!, entry.pattern]));
  const entriesBySentence = new Map<string, string[]>();
  const sightings = new Map<string, Set<string>>();
  const sight = (entryId: string, sentenceId: string) => {
    const set = sightings.get(entryId) ?? new Set<string>();
    set.add(sentenceId);
    sightings.set(entryId, set);
  };
  const strengthByPattern = await loadGrammarPatternStrengths();
  const shaky = new Set<string>();
  for (const link of links) {
    const entryId = byPattern.get(link.grammarPatternId);
    if (!entryId) continue;
    const strength = strengthByPattern.get(link.grammarPatternId);
    if (strength !== undefined && strength < READER_KNOWN_STRENGTH) shaky.add(entryId);
    const entries = entriesBySentence.get(link.sentenceId) ?? [];
    if (!entries.includes(entryId)) entries.push(entryId);
    entriesBySentence.set(link.sentenceId, entries);
    if (introduced.has(link.sentenceId)) sight(entryId, link.sentenceId);
  }
  // Text detection covers the sentences the AI never linked (see buildGrammarDetector).
  const detect = buildGrammarDetector(reference.patterns);
  for (const row of rows) {
    if (!row) continue;
    for (const entryId of detect(row.japanese, wordSpansForDetection(row.vocabularySuggestions ?? []))) {
      const entries = entriesBySentence.get(row.id) ?? [];
      if (!entries.includes(entryId)) entries.push(entryId);
      entriesBySentence.set(row.id, entries);
      if (introduced.has(row.id)) sight(entryId, row.id);
    }
  }
  const known = knownGrammarEntries(new Map([...sightings].map(([id, set]) => [id, set.size])), shaky);
  const levels = new Map<string, string | undefined>();
  for (const entries of entriesBySentence.values()) {
    for (const id of entries) levels.set(id, reference.patterns.find((entry) => entry.id === id)?.level);
  }
  return { entriesBySentence, known, names, cost: grammarLevelCosts(levels, known) };
}

/**
 * Known lemmas that still read as shaky: some reading/meaning evidence, strength below the reader's known line.
 * Maps lemma key → deficit. A known word with no evidence at all (met in sentences only, never checked or linked
 * to a vocabulary item) counts as mildly weak (`UNCHECKED_WORD_DEFICIT`, under the deficit of any word that has
 * been checked and missed), so it still earns a revisit in a new sentence.
 * Used to serve all-known sentences carrying such words first (`orderByIPlusOne`).
 */
const UNCHECKED_WORD_DEFICIT = 0.3;

async function loadWeakKnownLemmas(known: ReadonlySet<string>): Promise<Map<string, number>> {
  const { strengthByWord, vocabByLemma } = await loadWordReadingStrengths(READER_STRENGTH_CACHE_MS);
  const weak = new Map<string, number>();
  for (const key of known) {
    const item = vocabByLemma.get(key);
    const strength = item ? strengthByWord.get(item.id) : undefined;
    if (strength === undefined) weak.set(key, UNCHECKED_WORD_DEFICIT);
    else if (strength < READER_KNOWN_STRENGTH) weak.set(key, READER_KNOWN_STRENGTH - strength);
  }
  return weak;
}

/** How `loadIPlusOneContext` orders: the stretch cadence, or strict i+1 (`orderByStrictIPlusOne`). */
interface IPlusOneOptions {
  stretchEvery: number;
  strict?: boolean;
  /** Strict only: sentences already in today's session; their words and grammar join the list as if studied. */
  planned?: ReadonlySet<string>;
}

/**
 * Ranks every not-yet-introduced sentence across all books at once (so
 * unlock value and the stretch cadence are global, not per book). A pure
 * permutation of reading order; callers sort their own lists by `rank`.
 */
async function loadIPlusOneContext({ stretchEvery, strict = false, planned }: IPlusOneOptions): Promise<IPlusOneContext> {
  const memberships = await readAllBookSentencesForPass();
  const sentenceIds = [...new Set(memberships.map((row) => row.sentenceId))];
  const introduced = await getIntroducedSentenceIds(sentenceIds);
  const rows = await getDb().sentences.bulkGet(sentenceIds);
  const introducedRows = rows.filter((row) => row && introduced.has(row.id));
  const known = await loadKnownLemmaSet(introducedRows);
  const plannedIds = strict && planned ? new Set([...planned].filter((id) => !introduced.has(id))) : new Set<string>();
  const reinforce = partlyMetLemmas(
    introducedRows.map((row) => row?.vocabularySuggestions),
    known,
  );
  const weak = await loadWeakKnownLemmas(known);
  const grammar = await loadCuratedGrammar(introduced, rows);
  for (const row of rows) {
    if (!row || !plannedIds.has(row.id)) continue;
    for (const key of unknownLemmasForSentence(row.vocabularySuggestions, known)) known.add(key);
    for (const id of grammar.entriesBySentence.get(row.id) ?? []) grammar.known.add(id);
  }
  // Sentences already started per episode (book + chapter): new lessons lean toward episodes the learner is into.
  const startedByEpisode = new Map<string, number>();
  const episodesOf = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const row of memberships) {
    const episode = `${row.bookId}|${row.chapterId ?? ''}`;
    episodesOf.set(row.sentenceId, [...(episodesOf.get(row.sentenceId) ?? []), episode]);
    if (introduced.has(row.sentenceId) && !seen.has(`${episode}|${row.sentenceId}`)) {
      seen.add(`${episode}|${row.sentenceId}`);
      startedByEpisode.set(episode, (startedByEpisode.get(episode) ?? 0) + 1);
    }
  }
  const momentumOf = (sentenceId: string) =>
    Math.max(0, ...(episodesOf.get(sentenceId) ?? []).map((episode) => startedByEpisode.get(episode) ?? 0));
  const items: IPlusOneItem[] = [];
  const newWords = new Map<string, string[]>();
  const scorable = new Set<string>();
  rows.forEach((row, index) => {
    if (!row || introduced.has(sentenceIds[index]!) || plannedIds.has(row.id)) return;
    if (scoreSentence(row.vocabularySuggestions, known).scorable) scorable.add(row.id);
    const entryIds = grammar.entriesBySentence.get(row.id);
    items.push({
      sentenceId: row.id,
      suggestions: row.vocabularySuggestions,
      grammar: entryIds,
      momentum: momentumOf(row.id),
    });
    const words = unknownLemmasForSentence(row.vocabularySuggestions, known).map((key) => key.split('|')[0]!);
    const patterns = (entryIds ?? []).filter((id) => !grammar.known.has(id)).map((id) => grammar.names.get(id)!);
    if (words.length + patterns.length > 0) newWords.set(row.id, [...words, ...patterns]);
  });
  const order = strict
    ? orderByStrictIPlusOne(items, known, { knownGrammar: grammar.known, grammarCost: grammar.cost, reinforce, weak })
    : orderByIPlusOne(items, known, {
        stretchEvery,
        knownGrammar: grammar.known,
        grammarCost: grammar.cost,
        reinforce,
        weak,
      });
  return { rank: new Map(order.map((id, index) => [id, index])), newWords, scorable };
}

export interface ReadyToPickUp {
  sentenceId: string;
  japanese: string;
  translation: string;
  /** Words and curated grammar patterns in the sentence the learner has not met yet (at most two). */
  newPieces: string[];
}

/**
 * A book's sentences that are ready to pick up next under i+1: at most two unmet pieces (words plus curated
 * grammar), in the global i+1 order, so the book page can show what the planner would offer from it.
 */
export async function getBookReadyToPickUp(
  bookId: string,
  limit = 8,
): Promise<{ total: number; items: ReadyToPickUp[] }> {
  const strict = isStrictIPlusOne(await readSettings(getDb()));
  const [context, memberships, suspended] = await Promise.all([
    loadIPlusOneContext({ stretchEvery: 0, strict }),
    readAllBookSentencesForPass(),
    loadSuspendedBookIndex(),
  ]);
  const ready = memberships
    .filter((row) => row.bookId === bookId && !(suspended && membershipIsShelved(row, suspended)))
    .filter((row) => context.rank.has(row.sentenceId) && (context.newWords.get(row.sentenceId)?.length ?? 0) <= 2)
    .sort((a, b) => context.rank.get(a.sentenceId)! - context.rank.get(b.sentenceId)!);
  const unique = [...new Set(ready.map((row) => row.sentenceId))];
  const rows = await getDb().sentences.bulkGet(unique.slice(0, limit));
  const items = rows.flatMap((row) =>
    row
      ? [{
          sentenceId: row.id,
          japanese: row.japanese,
          translation: row.translation,
          newPieces: context.newWords.get(row.id) ?? [],
        }]
      : [],
  );
  return { total: unique.length, items };
}

export interface IPlusOneStatusStep extends IPlusOneNextStep {
  bookId: string | undefined;
  japanese: string;
  translation: string;
}

export interface IPlusOneStatusReport extends Omit<IPlusOneStatus, 'next'> {
  next: IPlusOneStatusStep[];
}

/**
 * The learner's i+1 position across every active book: how many waiting sentences have nothing new, which
 * sentence brings the next new words, and how many sentences learning them would open up. Shelved (suspended)
 * book sentences are left out, like the planner. Scores every sentence, so call it on demand, not live.
 */
export async function getIPlusOneStatus(): Promise<IPlusOneStatusReport> {
  const strict = isStrictIPlusOne(await readSettings(getDb()));
  const [context, memberships, suspended] = await Promise.all([
    loadIPlusOneContext({ stretchEvery: 0, strict }),
    readAllBookSentencesForPass(),
    loadSuspendedBookIndex(),
  ]);
  const bookOf = new Map<string, string>();
  for (const row of memberships) {
    if (suspended && membershipIsShelved(row, suspended)) continue;
    if (!bookOf.has(row.sentenceId)) bookOf.set(row.sentenceId, row.bookId);
  }
  const entries: IPlusOneStatusEntry[] = [];
  for (const [sentenceId, rank] of context.rank) {
    if (!bookOf.has(sentenceId) || !context.scorable.has(sentenceId)) continue;
    entries.push({ sentenceId, rank, newPieces: context.newWords.get(sentenceId) ?? [] });
  }
  const summary = summariseIPlusOne(entries);
  const rows = await getDb().sentences.bulkGet(summary.next.map((step) => step.sentenceId));
  const next = summary.next.flatMap((step, index) => {
    const row = rows[index];
    return row
      ? [{ ...step, bookId: bookOf.get(step.sentenceId), japanese: row.japanese, translation: row.translation }]
      : [];
  });
  return { ...summary, next };
}

/**
 * Strict i+1 serves new sentences in one global order (the planner merges books by rank), so every book holding a
 * new sentence among the first `EXPLORE_SENTENCE_PREVIEW_LIMIT` ranks is kept, even past `limit`; the other books
 * fill up to `limit`. `candidates` keeps its order.
 */
function strictExploreBooks(
  candidates: ExploreCandidate[],
  rank: ReadonlyMap<string, number>,
  limit: number,
): ExploreCandidate[] {
  const ranksOf = (candidate: ExploreCandidate) =>
    candidate.sentences.flatMap((sentence) =>
      !sentence.revisit && rank.has(sentence.sentenceId) ? [rank.get(sentence.sentenceId)!] : [],
    );
  const cutoff = candidates.flatMap(ranksOf).sort((a, b) => a - b)[EXPLORE_SENTENCE_PREVIEW_LIMIT - 1] ?? Infinity;
  const needed = new Set(candidates.filter((candidate) => ranksOf(candidate).some((r) => r <= cutoff)));
  let room = Math.max(0, limit - needed.size);
  return candidates.filter((candidate) => needed.has(candidate) || (room > 0 && room-- > 0));
}

/** Explore candidates: books with sentences not yet started, most-recently-opened first ("continue where you left off" reusing Book.lastOpenedAt, the same signal BookDetailPage's touchBookOpened already maintains). */
async function findExploreCandidates(
  limit: number,
  sequential = false,
  iPlusOne?: IPlusOneOptions,
): Promise<ExploreCandidate[]> {
  const db = getDb();
  // i+1 order: ranked once across every book (see orderByIPlusOne); each book keeps its own order by that rank.
  const iPlusOneContext =
    iPlusOne && !sequential
      ? await traceStep('explore: i+1 context', () => loadIPlusOneContext(iPlusOne))
      : undefined;
  // Strict i+1 builds on today's session: sentences already in it are not offered again, but their books stay open.
  const strict = Boolean(iPlusOneContext && iPlusOne?.strict);
  const planned = strict ? iPlusOne?.planned ?? new Set<string>() : new Set<string>();
  const [allBooks, coverageByBookId, suspendedIndex] = await Promise.all([
    db.books.toArray(),
    traceStep('explore: getBookVocabularyCoverage', () => getBookVocabularyCoverage()),
    loadSuspendedBookIndex(),
  ]);
  const notShelved = (item: { bookId: string; chapterId?: string }) =>
    !(suspendedIndex && membershipIsShelved(item, suspendedIndex));
  const books = allBooks
    .filter(isBookInStudyRotation)
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt))
    .slice(0, 30);

  const freshTryRequests = (await ensureSettings(db)).freshTryRequests;
  const candidates: ExploreCandidate[] = [];
  /** Sequential mode: learnt sentences in the episode each book would offer first. */
  const leadEpisodeLearnt = new Map<string, number>();
  for (const book of books) {
    const memberships = await traceStep(
      'explore: book memberships',
      async () =>
        plannerPassActive()
          ? (await readAllBookSentencesForPass()).filter((row) => row.bookId === book.id)
          : db.bookSentences.where('bookId').equals(book.id).toArray(),
      rowCount,
    );
    // A lesson never changes BookSentence.status, so a sentence is "done" once
    // its walkthrough was completed, not once it's marked complete.
    const bookEvents = await traceStep('explore: book events', () => listSentenceLearningEvents(book.id), rowCount);
    const walked = new Set(
      bookEvents
        .filter((event) => event.action === 'walkthrough_completed')
        .map((event) => event.sentenceId),
    );
    const parkedGlossIds = parkedSentenceIds(
      await traceStep(
        'explore: glossDecisions',
        async () => (await readAllGlossDecisionsForPass()).filter((decision) => decision.bookId === book.id),
        rowCount,
      ),
    );
    // Review-card requests jump the spacing queue (walked-through sentences only).
    const requestedIds = pendingFreshTryRequestIds(freshTryRequests, bookEvents).filter((id) => walked.has(id));
    const parkedGlossSet = new Set(parkedGlossIds);
    // Sequential study mode gates *introduction* only: a locked sentence is
    // simply not offered as new. Revisits (already-introduced) are unaffected.
    const unlocked = sequential
      ? new Set(
          (await getSequentialBookStatus(book.id, memberships))
            .sentences.filter((status) => status.accessible)
            .map((status) => status.sentenceId),
        )
      : undefined;
    const inReadingOrder = memberships
      .filter((item) =>
        item.status !== 'complete' &&
        !walked.has(item.sentenceId) &&
        (!unlocked || unlocked.has(item.sentenceId)) &&
        notShelved(item) &&
        !planned.has(item.sentenceId),
      )
      .sort((a, b) => a.position - b.position)
      .filter((item, index, all) => all.findIndex((other) => other.sentenceId === item.sentenceId) === index);
    // Sequential mode: episodes already being learnt come first, the one with
    // the most learnt sentences leading; order within an episode stays by
    // position (stable sort), but is only a preference.
    if (sequential) {
      const learntByEpisode = new Map<string, number>();
      for (const item of memberships) {
        if (item.status !== 'unstarted' || walked.has(item.sentenceId)) {
          const key = item.chapterId ?? '';
          learntByEpisode.set(key, (learntByEpisode.get(key) ?? 0) + 1);
        }
      }
      const learnt = (item: BookSentence) => learntByEpisode.get(item.chapterId ?? '') ?? 0;
      inReadingOrder.sort((a, b) => learnt(b) - learnt(a));
      leadEpisodeLearnt.set(book.id, inReadingOrder[0] ? learnt(inReadingOrder[0]) : 0);
    }
    const newInOrder = iPlusOneContext
      ? [...inReadingOrder].sort(
          (a, b) =>
            (iPlusOneContext.rank.get(a.sentenceId) ?? Infinity) - (iPlusOneContext.rank.get(b.sentenceId) ?? Infinity),
        )
      : inReadingOrder;
    const unstarted = newInOrder;
    // Shelved (suspended-episode) sentences are dropped *before* the cap, or the
    // oldest due ones — often in shelved episodes — would eat the cap and then vanish.
    const shelvedIds = new Set(memberships.filter((item) => !notShelved(item)).map((item) => item.sentenceId));
    // The cap only keeps revisits from crowding out new lessons: with none waiting there is nothing to protect.
    const automaticRevisitCap = unstarted.length > 0 ? EXPLORE_REVISITS_PER_BOOK : EXPLORE_SENTENCE_PREVIEW_LIMIT;
    // Walked-through sentences holding words that haven't stuck: the lowest-priority revisit source,
    // so they only fill whatever room the learner's requests, parked checks and spaced tries leave.
    const weakWordRevisits = await traceStep('explore: findWeakWordRevisits', () =>
      findWeakWordRevisits(bookEvents, new Set([...requestedIds, ...shelvedIds]), automaticRevisitCap),
    );
    const revisitIds = [
      ...new Set([
        ...requestedIds.filter((id) => !planned.has(id)),
        // The per-book cap only throttles automatic revisits; ones the learner asked for are all kept.
        ...[...new Set([...parkedGlossIds, ...sentencesDueForFreshTry(bookEvents), ...weakWordRevisits.keys()])]
          .filter((id) => !requestedIds.includes(id) && !shelvedIds.has(id) && !planned.has(id))
          .slice(0, automaticRevisitCap),
      ]),
    ];
    const seenRevisit = new Set<string>();
    const revisitMemberships = memberships.filter((item) => {
      if (!revisitIds.includes(item.sentenceId) || seenRevisit.has(item.sentenceId) || !notShelved(item)) return false;
      seenRevisit.add(item.sentenceId);
      return true;
    });
    if (unstarted.length === 0 && revisitMemberships.length === 0) continue;
    const revisitSet = new Set(revisitMemberships.map((item) => item.sentenceId));
    const preview = [...revisitMemberships, ...unstarted].slice(0, EXPLORE_SENTENCE_PREVIEW_LIMIT);
    const sentenceRows = await traceStep('explore: preview sentences', () =>
      db.sentences.bulkGet(preview.map((item) => item.sentenceId)),
    );
    candidates.push({
      bookId: book.id,
      label: book.title,
      reason: `${unstarted.length} new sentence${unstarted.length === 1 ? '' : 's'} waiting`,
      sentences: preview.map((item, index) => ({
        sentenceId: item.sentenceId,
        preview: sentenceRows[index]?.japanese.slice(0, 24) ?? '',
        ...(revisitSet.has(item.sentenceId) ? { revisit: true } : {}),
        ...(parkedGlossSet.has(item.sentenceId) ? { parkedGloss: true } : {}),
        ...(revisitSet.has(item.sentenceId) && weakWordRevisits.get(item.sentenceId)?.words.length
          ? { weakWords: weakWordRevisits.get(item.sentenceId)!.words }
          : {}),
        ...(revisitSet.has(item.sentenceId) && weakWordRevisits.get(item.sentenceId)?.grammar.length
          ? { weakGrammar: weakWordRevisits.get(item.sentenceId)!.grammar }
          : {}),
        ...(iPlusOneContext && !revisitSet.has(item.sentenceId) && iPlusOneContext.rank.has(item.sentenceId)
          ? {
              iPlusOneRank: iPlusOneContext.rank.get(item.sentenceId),
              ...(iPlusOneContext.newWords.get(item.sentenceId)
                ? { newWords: iPlusOneContext.newWords.get(item.sentenceId)!.slice(0, 3) }
                : {}),
            }
          : {}),
      })),
    });
  }
  // Array.sort is stable, so recency order is preserved within each group.
  const sorted = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      // Sequential mode: a book whose next episode is further along goes first.
      const leadA = leadEpisodeLearnt.get(a.candidate.bookId) ?? 0;
      const leadB = leadEpisodeLearnt.get(b.candidate.bookId) ?? 0;
      if (leadA !== leadB) return leadB - leadA;
      // An easier (higher known-vocabulary ratio) book edges out a harder one
      // ("Ready to read" step 3, docs/ROADMAP.md). Unanalyzed books (null ratio) sort last.
      const ratioA = coverageByBookId.get(a.candidate.bookId)?.ratio ?? null;
      const ratioB = coverageByBookId.get(b.candidate.bookId)?.ratio ?? null;
      if (ratioA !== ratioB) {
        if (ratioA === null) return 1;
        if (ratioB === null) return -1;
        return ratioB - ratioA;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
  return strict ? strictExploreBooks(sorted, iPlusOneContext!.rank, limit) : sorted.slice(0, limit);
}

/**
 * Grammar-noticing candidates: sentences the learner has already worked
 * through (marked `complete` in their book) whose own vocabulary is confirmed
 * + proficient (same getSentenceFullReviewReadiness gate as grammar review /
 * shadowing / glossing — vocab confirmation always comes before glossing
 * work in this app), but whose grammar-noticing pass hasn't been marked done
 * (`SentenceAnalysis.grammarReviewStatus !== 'confirmed'`). Reading order
 * within each recent book, mirroring findExploreCandidates' scope and its
 * per-book preview cap so the (expensive) readiness check runs over a bounded
 * shortlist, not the whole worked-through corpus.
 *
 * Exported for two callers: `buildGrammarNoticingSteps` (session planner,
 * budget/session-limited) and `GrammarNoticingFlowPage` in standalone mode
 * (2026-09-22 — "a way to do notice grammar outside of sessions", no budget,
 * just "show me what's currently eligible").
 */
export async function findGrammarNoticingCandidates(limit: number): Promise<GrammarNoticingCandidate[]> {
  const db = getDb();
  const suspendedIndex = await loadSuspendedBookIndex();
  const books = (await db.books.toArray())
    .filter(isBookInStudyRotation)
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt))
    .slice(0, 30);

  type Pending = { sentenceId: string; bookId: string; position: number; bookRank: number };
  const pending: Pending[] = [];
  for (let bookRank = 0; bookRank < books.length; bookRank += 1) {
    const book = books[bookRank]!;
    const worked = (await db.bookSentences.where('bookId').equals(book.id).toArray())
      .filter(
        (membership) =>
          membership.status === 'complete' &&
          !(suspendedIndex && membershipIsShelved(membership, suspendedIndex)),
      )
      .sort((a, b) => a.position - b.position)
      .slice(0, EXPLORE_SENTENCE_PREVIEW_LIMIT);
    for (const membership of worked) {
      pending.push({
        sentenceId: membership.sentenceId,
        bookId: book.id,
        position: membership.position,
        bookRank,
      });
    }
  }
  if (pending.length === 0) return [];

  const sentenceIds = [...new Set(pending.map((entry) => entry.sentenceId))];
  const analysisById = new Map(
    (await db.analyses.bulkGet(sentenceIds))
      .filter((a): a is SentenceAnalysis => Boolean(a))
      .map((a) => [a.sentenceId, a]),
  );

  const seen = new Set<string>();
  const shortlist = pending
    .filter((entry) => {
      if (seen.has(entry.sentenceId)) return false;
      seen.add(entry.sentenceId);
      const status = analysisById.get(entry.sentenceId)?.grammarReviewStatus ?? 'unreviewed';
      return status !== 'confirmed';
    })
    .sort((a, b) => a.bookRank - b.bookRank || a.position - b.position)
    .slice(0, limit * 4);
  if (shortlist.length === 0) return [];

  const shortlistIds = shortlist.map((entry) => entry.sentenceId);
  const [sentences, readiness] = await Promise.all([
    db.sentences.bulkGet(shortlistIds),
    getSentenceFullReviewReadiness(shortlistIds),
  ]);
  const sentenceById = new Map(
    sentences.filter((s): s is Sentence => Boolean(s)).map((s) => [s.id, s]),
  );

  return shortlist
    .filter((entry) => readiness.get(entry.sentenceId) && sentenceById.has(entry.sentenceId))
    .slice(0, limit)
    .map((entry) => ({
      sentenceId: entry.sentenceId,
      bookId: entry.bookId,
      label: sentenceById.get(entry.sentenceId)!.japanese.slice(0, 24),
      reason: 'Vocabulary learned — pull out the grammar patterns worth tracking',
    }));
}

/** Sentences from the learner's most-recently-opened, non-archived books that have actually been started — the pool shadowing candidates are drawn from, so a fresh import doesn't immediately dominate the shadow queue. */
export async function activeSentenceIdsForShadowing(bookLimit: number): Promise<Set<string>> {
  const db = getDb();
  const suspendedIndex = await loadSuspendedBookIndex();
  const books = (await db.books.toArray())
    .filter(isBookInStudyRotation)
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt))
    .slice(0, bookLimit);
  const walkedThrough = new Set(
    (await traceStep('shadow: sentenceLearningEvents.toArray', () => readAllLearningEventsForPass(), rowCount))
      .filter((event) => event.action === 'walkthrough_completed')
      .map((event) => event.sentenceId),
  );
  const ids = new Set<string>();
  const allMemberships = plannerPassActive() ? await readAllBookSentencesForPass() : null;
  for (const book of books) {
    const memberships = allMemberships
      ? allMemberships.filter((row) => row.bookId === book.id)
      : await db.bookSentences.where('bookId').equals(book.id).toArray();
    for (const membership of memberships) {
      if (membership.status === 'unstarted' && !walkedThrough.has(membership.sentenceId)) continue;
      if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
      ids.add(membership.sentenceId);
    }
  }
  return ids;
}

/**
 * Which of `sentenceIds` cover the learner's weakest words
 * (`planWeakWordSentences`). `order` is the pick order and `labels` names each
 * pick's weak words for the planner's reason line. Empty when no word is weak enough.
 */
export async function getWeakWordSentenceSignal(
  sentenceIds: string[],
  maxAgeMs = 0,
): Promise<{ order: string[]; labels: Map<string, string[]> }> {
  if (sentenceIds.length === 0) return { order: [], labels: new Map() };
  const { strengthByWord, wordsBySentence, vocabById } = await loadWordReadingStrengths(maxAgeMs);
  const plan = planWeakWordSentences(
    sentenceIds.map((sentenceId) => ({ sentenceId, wordIds: wordsBySentence.get(sentenceId) ?? [] })),
    strengthByWord,
  );
  const labels = new Map<string, string[]>();
  for (const [sentenceId, wordIds] of plan.weakWordsBySentence) {
    labels.set(
      sentenceId,
      wordIds.map((id) => vocabById.get(id)?.expression).filter((x): x is string => Boolean(x)),
    );
  }
  return { order: plan.order, labels };
}

/**
 * Read-only explanation for the Home planner: for the walked-through sentences
 * (those with a completed walkthrough), whether each is waiting on a weak word,
 * on the spacing gap, or has nothing weak. Uses the same strengths and
 * thresholds as `findWeakWordRevisits`; changes nothing.
 */
export async function explainWeakWordRevisits(now: Date = new Date(), limit = 12): Promise<WeakWordExplanation[]> {
  const db = getDb();
  const walks = (await db.sentenceLearningEvents.toArray()).filter((event) => event.action === 'walkthrough_completed');
  const lastWalk = new Map<string, string>();
  for (const event of walks) {
    const seen = lastWalk.get(event.sentenceId);
    if (seen === undefined || event.timestamp > seen) lastWalk.set(event.sentenceId, event.timestamp);
  }
  if (lastWalk.size === 0) return [];
  const ids = [...lastWalk.keys()];
  const [rows, { strengthByWord, wordsBySentence, vocabById }] = await Promise.all([
    db.sentences.bulkGet(ids),
    loadWordReadingStrengths(),
  ]);
  const previews = new Map(ids.map((id, i) => [id, rows[i]?.japanese.slice(0, 24) ?? '']));
  return explainWeakWordSentences({
    sentences: ids.map((sentenceId) => ({ sentenceId, preview: previews.get(sentenceId)!, lastWalkedAt: lastWalk.get(sentenceId)! })),
    wordsBySentence,
    strengthByWord,
    expressionOf: (id) => vocabById.get(id)?.expression,
    now,
    minGapDays: WEAK_WORD_REVISIT_MIN_GAP_DAYS,
    minWeakness: 0.7,
  }).slice(0, limit);
}

/**
 * The weakest word in one sentence worth a typed-reading check before reveal
 * on a `reading_in_context` review: strength under 0.3, present in the
 * sentence as a linked surface form, with a reading derivable from the
 * sentence's inline reading. `undefined` when nothing qualifies, so the card
 * falls back to its other checks. Selection only; the answer is evidence for
 * the strength model, never a rating.
 */
export async function getWeakWordRecallTarget(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'inlineReading'>,
): Promise<{ japanese: string; expectedReading: string; vocabularyItemId: string } | undefined> {
  const { strengthByWord, links } = await loadWordReadingStrengths();
  const candidates = links
    .filter((link) => link.sentenceId === sentence.id && !!link.surfaceForm && sentence.japanese.includes(link.surfaceForm))
    .map((link) => ({ link, strength: strengthByWord.get(link.vocabularyItemId) }))
    .filter((entry): entry is { link: SentenceVocabulary; strength: number } => entry.strength !== undefined && entry.strength <= 0.3)
    .sort((a, b) => a.strength - b.strength || a.link.id.localeCompare(b.link.id));
  for (const { link } of candidates) {
    const expectedReading = surfaceReadingFromInline(sentence.inlineReading, link.surfaceForm!);
    if (expectedReading) {
      return { japanese: link.surfaceForm!, expectedReading, vocabularyItemId: link.vocabularyItemId };
    }
  }
  return undefined;
}

/**
 * The word in a sentence whose meaning the learner is least sure of, for the
 * reader's "What does this mean?" check: among the sentence's linked content
 * words, the lowest meaning strength (ties go to the weaker reading, then id).
 * Meaning only learns from recall, so a word never checked before ranks by its
 * frequency prior alone. The check is self-judged and logged as evidence by
 * `meaningCheckTargetKey`; it never touches FSRS.
 */
export async function getWordMeaningCheckTarget(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  maxAgeMs = 0,
  /** Ask about this word (dictionary form) when the sentence has it, as a check moved to an unstudied sentence does. */
  expression?: string,
): Promise<MeaningCheckWord | undefined> {
  const words = meaningCheckWordsFor(sentence, await loadWordReadingStrengths(maxAgeMs));
  return (expression ? words.find((word) => word.expression === expression) : undefined) ?? words[0];
}

/** A content word of a sentence the Word check can ask about. `vocabularyItemId` is '' until the word has an item. */
export interface MeaningCheckWord {
  vocabularyItemId: string;
  expression: string;
  surface: string;
  reading: string;
  meaning: string;
  /** Where the surface starts in the sentence text. */
  start: number;
  meaningStrength: number;
}

/**
 * A sentence's checkable content words, weakest meaning first. Words come from the sentence's own
 * morphology (default-checked `vocabularySuggestions`), not only from `sentence_vocabulary` links:
 * in the sentence-led flow most walked-through sentences have no links (35 of 202 in the 2026-11-11
 * production read), so a link-only pick left the Word check with nothing to ask. A word resolves to
 * its linked item, else to the vocabulary item with the same expression and reading, else to none
 * (the caller makes the item when the learner answers, as the reader's word taps do).
 */
function meaningCheckWordsFor(
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>,
  strengths: WordReadingStrengths,
): MeaningCheckWord[] {
  const { strengthByWord, meaningStrengthOf, meaningStrengthOfLemma, linksBySentence, vocabById, vocabByLemma } = strengths;
  const sentenceLinks = (linksBySentence.get(sentence.id) ?? []).filter((link) => vocabById.has(link.vocabularyItemId));
  const seen = new Set<string>();
  const words: Array<{ word: MeaningCheckWord; readingStrength: number }> = [];
  const ordered = [...sentence.vocabularySuggestions].sort((a, b) => a.start - b.start);
  // Pieces of a fixed phrase (つい of について) gloss misleadingly alone; the phrase is a grammar check, not a word check.
  const inSetExpression = new Set<number>();
  for (const { first, last } of findSetExpressions(ordered)) for (let i = first; i <= last; i += 1) inSetExpression.add(i);
  for (const [index, suggestion] of ordered.entries()) {
    if (inSetExpression.has(index)) continue;
    if (!suggestion.selectedByDefault || !suggestion.expression || seen.has(suggestion.expression)) continue;
    if (!suggestion.surface || !sentence.japanese.includes(suggestion.surface)) continue;
    seen.add(suggestion.expression);
    const surfaceLinks = sentenceLinks.filter((link) => link.surfaceForm === suggestion.surface);
    const linked =
      surfaceLinks.find((link) => vocabById.get(link.vocabularyItemId)!.expression === suggestion.expression) ?? surfaceLinks[0];
    const item = linked
      ? vocabById.get(linked.vocabularyItemId)
      : vocabByLemma.get(lemmaKey(suggestion.expression, suggestion.reading));
    const meaning = item?.meaning.trim() || suggestion.english?.trim() || '';
    if (!meaning) continue;
    words.push({
      word: {
        vocabularyItemId: item?.id ?? '',
        expression: item?.expression ?? suggestion.expression,
        surface: suggestion.surface,
        reading: item?.reading ?? suggestion.reading,
        meaning,
        start: suggestion.start,
        meaningStrength: item ? meaningStrengthOf(item.id) : meaningStrengthOfLemma(suggestion.expression, suggestion.reading),
      },
      readingStrength: item ? strengthByWord.get(item.id) ?? 0 : 0,
    });
  }
  return words
    .sort(
      (a, b) =>
        a.word.meaningStrength - b.word.meaningStrength || a.readingStrength - b.readingStrength || a.word.start - b.word.start,
    )
    .map((entry) => entry.word);
}

/**
 * Walked-through sentences due for a planner Word check (`wordCheckSteps.ts`): in an active book, walked at
 * least a day ago, with a content word whose meaning is not yet solid, spaced from the sentence's last
 * meaning check. Selection only: nothing is stored and no card is created.
 */
export async function findWordCheckCandidates(
  limit: number,
  excluded: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): Promise<WordCheckCandidate[]> {
  const db = getDb();
  const [events, books, suspendedIndex] = await Promise.all([
    readAllLearningEventsForPass(),
    db.books.toArray(),
    loadSuspendedBookIndex(),
  ]);
  const lastWalk = new Map<string, number>();
  const lastCheck = new Map<string, { at: number; gotIt: boolean }>();
  const lastReadCheck = new Map<string, { at: number; gotIt: boolean }>();
  const lastCheckByWord = new Map<string, { at: number; gotIt: boolean }>();
  const keepLatest = (map: Map<string, { at: number; gotIt: boolean }>, event: SentenceLearningEvent, at: number) => {
    if (!event.outcome || at <= (map.get(event.sentenceId)?.at ?? 0)) return;
    map.set(event.sentenceId, { at, gotIt: event.outcome === 'got_it' });
  };
  for (const event of events) {
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) continue;
    if (event.action === 'walkthrough_completed') {
      if (at > (lastWalk.get(event.sentenceId) ?? 0)) lastWalk.set(event.sentenceId, at);
    } else if (event.action === 'gist_check') {
      keepLatest(lastReadCheck, event, at);
    } else if (event.action === 'target_practice' && event.target?.key.startsWith(MEANING_CHECK_KEY_PREFIX)) {
      keepLatest(lastCheck, event, at);
      const wordId = event.target.key.slice(MEANING_CHECK_KEY_PREFIX.length);
      if (event.outcome && at > (lastCheckByWord.get(wordId)?.at ?? 0)) {
        lastCheckByWord.set(wordId, { at, gotIt: event.outcome === 'got_it' });
      }
    }
  }
  const walked = [...lastWalk.keys()].filter((id) => !excluded.has(id));
  if (walked.length === 0) return [];
  const activeBooks = new Set(books.filter(isBookInStudyRotation).map((book) => book.id));
  const membershipBySentence = new Map<string, BookSentence>();
  for (const membership of await bookSentencesForSentences(walked)) {
    if (!activeBooks.has(membership.bookId)) continue;
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!membershipBySentence.has(membership.sentenceId)) membershipBySentence.set(membership.sentenceId, membership);
  }
  const reachable = walked.filter((id) => membershipBySentence.has(id));
  if (reachable.length === 0) return [];
  const [rows, strengths] = await Promise.all([
    db.sentences.bulkGet(reachable),
    loadWordReadingStrengths(PLANNER_STRENGTH_CACHE_MS),
  ]);
  const sentenceById = new Map(rows.flatMap((row) => (row ? [[row.id, row] as const] : [])));
  const later = (a?: { at: number; gotIt: boolean }, b?: { at: number; gotIt: boolean }) =>
    !a ? b : !b ? a : b.at > a.at ? b : a;
  const due = dueWordChecks({
    sentences: reachable.flatMap((sentenceId) => {
      const sentence = sentenceById.get(sentenceId);
      if (!sentence) return [];
      const word = meaningCheckWordsFor(sentence, strengths)[0];
      // A check on the word in another sentence (a moved check) spaces this one too.
      const wordCheck = word?.vocabularyItemId ? lastCheckByWord.get(word.vocabularyItemId) : undefined;
      return [
        {
          sentenceId,
          lastWalkedAt: lastWalk.get(sentenceId)!,
          word: word ? { label: word.surface, meaningStrength: word.meaningStrength, expression: word.expression } : undefined,
          lastCheck: later(lastCheck.get(sentenceId), wordCheck),
          lastReadCheck: lastReadCheck.get(sentenceId),
        },
      ];
    }),
    now: now.getTime(),
  }).slice(0, limit);
  if (due.length === 0) return [];
  const sourceCandidate = (entry: (typeof due)[number]): WordCheckCandidate => ({
    bookId: membershipBySentence.get(entry.sentenceId)!.bookId,
    sentenceId: entry.sentenceId,
    preview: sentenceById.get(entry.sentenceId)!.japanese.slice(0, 24),
    reason: entry.reason,
  });
  // A struggling sentence keeps its check (it is about that sentence); the rest move to an unstudied sentence with the
  // same word when there is one, so a familiar line can't answer for the word.
  const wanted = new Set(due.filter((entry) => !entry.struggling && entry.expression).map((entry) => entry.expression!));
  const transfers = wanted.size
    ? await findTransferSentences(wanted, new Set([...excluded, ...lastWalk.keys()]), strengths)
    : new Map<string, Array<TransferSentenceOption & { bookId: string; sentence: Sentence }>>();
  const taken = new Set<string>();
  return due.map((entry) => {
    const source = sourceCandidate(entry);
    const options = !entry.struggling && entry.expression ? transfers.get(entry.expression) : undefined;
    const pick = options ? pickTransferSentence(options, taken) : undefined;
    if (!pick) return source;
    taken.add(pick.sentenceId);
    const transfer = options!.find((option) => option.sentenceId === pick.sentenceId)!;
    return {
      bookId: transfer.bookId,
      sentenceId: transfer.sentenceId,
      preview: transfer.sentence.japanese.slice(0, 24),
      reason: transferWordCheckReason(entry.word),
      word: entry.expression,
      source,
    };
  });
}

/**
 * Walked-through sentences due for a standalone Grammar check (`grammarCheckSteps.ts`): in an active book, walked
 * at least a day ago, with a linked grammar pattern that is unchecked or shaky and not checked recently. Selection
 * only: nothing is stored and no card is created.
 */
export async function findGrammarCheckCandidates(
  limit: number,
  excluded: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): Promise<GrammarCheckCandidate[]> {
  const db = getDb();
  const [events, books, suspendedIndex] = await Promise.all([
    readAllLearningEventsForPass(),
    db.books.toArray(),
    loadSuspendedBookIndex(),
  ]);
  const lastWalk = new Map<string, number>();
  const lastCheckByPattern = new Map<string, { at: number; gotIt: boolean }>();
  for (const event of events) {
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) continue;
    if (event.action === 'walkthrough_completed') {
      if (at > (lastWalk.get(event.sentenceId) ?? 0)) lastWalk.set(event.sentenceId, at);
    } else if (
      event.action === 'target_practice' &&
      event.outcome &&
      event.support === 'target_masked' &&
      event.target?.key.startsWith(GRAMMAR_USE_KEY_PREFIX)
    ) {
      const patternId = event.target.key.slice(GRAMMAR_USE_KEY_PREFIX.length);
      if (at > (lastCheckByPattern.get(patternId)?.at ?? 0)) lastCheckByPattern.set(patternId, { at, gotIt: event.outcome === 'got_it' });
    }
  }
  const walked = [...lastWalk.keys()].filter((id) => !excluded.has(id));
  if (walked.length === 0) return [];
  const activeBooks = new Set(books.filter(isBookInStudyRotation).map((book) => book.id));
  const membershipBySentence = new Map<string, BookSentence>();
  for (const membership of await bookSentencesForSentences(walked)) {
    if (!activeBooks.has(membership.bookId)) continue;
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!membershipBySentence.has(membership.sentenceId)) membershipBySentence.set(membership.sentenceId, membership);
  }
  const reachable = walked.filter((id) => membershipBySentence.has(id));
  if (reachable.length === 0) return [];
  const links = await db.sentenceGrammar.where('sentenceId').anyOf(reachable).toArray();
  if (links.length === 0) return [];
  const patternIds = [...new Set(links.map((link) => link.grammarPatternId))];
  const [patternRows, sentenceRows] = await Promise.all([db.grammarPatterns.bulkGet(patternIds), db.sentences.bulkGet(reachable)]);
  const nameById = new Map(patternRows.flatMap((row) => (row ? [[row.id, row.canonicalName] as const] : [])));
  const sentenceById = new Map(sentenceRows.flatMap((row) => (row ? [[row.id, row] as const] : [])));
  const strengthByPattern = grammarPatternStrengths(events, now.getTime());
  const patternsBySentence = new Map<string, GrammarCheckSentence['patterns']>();
  for (const link of links) {
    const name = nameById.get(link.grammarPatternId);
    if (!name) continue;
    const list = patternsBySentence.get(link.sentenceId) ?? [];
    if (list.some((entry) => entry.patternId === link.grammarPatternId)) continue;
    list.push({
      patternId: link.grammarPatternId,
      name,
      strength: strengthByPattern.get(link.grammarPatternId),
      lastCheck: lastCheckByPattern.get(link.grammarPatternId),
    });
    patternsBySentence.set(link.sentenceId, list);
  }
  return dueGrammarChecks({
    sentences: [...patternsBySentence].map(([sentenceId, patterns]) => ({
      sentenceId,
      lastWalkedAt: lastWalk.get(sentenceId)!,
      patterns,
    })),
    now: now.getTime(),
  })
    .filter((entry) => sentenceById.has(entry.sentenceId))
    .slice(0, limit)
    .map((entry) => ({
      bookId: membershipBySentence.get(entry.sentenceId)!.bookId,
      sentenceId: entry.sentenceId,
      preview: sentenceById.get(entry.sentenceId)!.japanese.slice(0, 24),
      reason: entry.reason,
    }));
}

/**
 * Not-yet-introduced sentences in active books where each wanted word (dictionary form) is a checkable word, for
 * moving a Word check off a familiar sentence (`pickTransferSentence`). `skip` holds walked or otherwise taken ids.
 */
async function findTransferSentences(
  expressions: ReadonlySet<string>,
  skip: ReadonlySet<string>,
  strengths: WordReadingStrengths,
): Promise<Map<string, Array<TransferSentenceOption & { bookId: string; sentence: Sentence }>>> {
  const db = getDb();
  const [memberships, books, suspendedIndex] = await Promise.all([
    readAllBookSentencesForPass(),
    db.books.toArray(),
    loadSuspendedBookIndex(),
  ]);
  const activeBooks = new Set(books.filter(isBookInStudyRotation).map((book) => book.id));
  const bookOf = new Map<string, string>();
  for (const membership of memberships) {
    if (membership.status !== 'unstarted' || skip.has(membership.sentenceId) || !activeBooks.has(membership.bookId)) continue;
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!bookOf.has(membership.sentenceId)) bookOf.set(membership.sentenceId, membership.bookId);
  }
  const result = new Map<string, Array<TransferSentenceOption & { bookId: string; sentence: Sentence }>>();
  if (bookOf.size === 0) return result;
  const ids = [...bookOf.keys()];
  const introduced = await getIntroducedSentenceIds(ids);
  const rows = await db.sentences.bulkGet(ids.filter((id) => !introduced.has(id)));
  for (const sentence of rows) {
    if (!sentence?.vocabularySuggestions.some((suggestion) => suggestion.expression && expressions.has(suggestion.expression))) continue;
    const words = meaningCheckWordsFor(sentence, strengths);
    for (const word of words) {
      if (!expressions.has(word.expression)) continue;
      const otherWeakWords = words.filter((other) => other !== word && other.meaningStrength < READER_KNOWN_STRENGTH).length;
      const list = result.get(word.expression) ?? [];
      list.push({ sentenceId: sentence.id, otherWeakWords, length: sentence.japanese.length, bookId: bookOf.get(sentence.id)!, sentence });
      result.set(word.expression, list);
    }
  }
  return result;
}

/**
 * Practice(shadowing) candidates: sentences with reference audio and the
 * fewest existing attempts, scoped to sentences actually in progress and
 * ready per getSentenceShadowingReadiness (user request, 2026-08-27) —
 * vocabulary confirmed and at least half of linked words' reading/meaning introduced
 * (seen once, not full proficiency; no pitch requirement since 2026-09-28),
 * so shadowing doesn't split attention between recalling words and
 * imitating pronunciation. Sentences covering weak words
 * (`getWeakWordSentenceSignal`) come ahead of the fewest-attempts order. (The
 * old "missed cloze card" boost went with the word cards: no cloze review can
 * clear a stale "missed twice" state, so it pinned the same sentences first.)
 */
async function findShadowCandidates(
  limit: number,
  activeSentenceIds: Set<string>,
): Promise<ShadowCandidate[]> {
  if (activeSentenceIds.size === 0) return [];
  const db = getDb();
  const activeIds = [...activeSentenceIds];
  const audioSentenceIds = await traceStep('shadow: sentenceAudio ids', () => sentenceIdsWithAudioClip(activeIds), (ids) => ids.size);
  if (audioSentenceIds.size === 0) return [];
  const sentenceIdsWithAudioUnfiltered = [...audioSentenceIds];
  const readiness = await traceStep('shadow: getSentenceShadowingReadiness', () => getSentenceShadowingReadiness(sentenceIdsWithAudioUnfiltered));
  const sentenceIdsWithAudio = sentenceIdsWithAudioUnfiltered.filter((id) => readiness.get(id));
  if (sentenceIdsWithAudio.length === 0) return [];

  const settingsRow = await ensureSettings(db);
  const shadowRequests = settingsRow.shadowRequests ?? {};
  const snoozedSentenceIds = activeShadowSnoozeIds(settingsRow.shadowSnoozes, new Date());
  // Attempt rows carry the recording Blob, so only the index keys are read to count attempts; full
  // rows are fetched just for the few sentences with a pending "sound" request.
  const requestIds = Object.keys(shadowRequests);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayIso = startOfToday.toISOString();
  const phraseCooldownIso = new Date(startOfToday.getTime() - (PHRASE_SHADOW_COOLDOWN_DAYS - 1) * 86_400_000).toISOString();
  const [attemptSentenceIds, requestAttempts, bookSentences, todayAttempts, recentPhraseEvents] = await Promise.all([
    sentenceIdsWithAudio.length <= ANY_OF_SCAN_THRESHOLD
      ? db.attempts.where('sentenceId').anyOf(sentenceIdsWithAudio).keys()
      : db.attempts.orderBy('sentenceId').keys(),
    requestIds.length ? db.attempts.where('sentenceId').anyOf(requestIds).toArray() : Promise.resolve([]),
    bookSentencesForSentences(sentenceIdsWithAudio),
    db.attempts.where('createdAt').aboveOrEqual(startOfTodayIso).toArray(),
    db.sentenceLearningEvents
      .where('timestamp')
      .aboveOrEqual(phraseCooldownIso)
      .filter((event) => event.action === 'phrase_shadow')
      .toArray(),
  ]);
  const todayPhraseEvents = recentPhraseEvents.filter((event) => event.timestamp >= startOfTodayIso);
  // Phrase-shadowed in the last few days: behind fresh sentences, so the same few don't return daily.
  const phraseCooldownIds = new Set(recentPhraseEvents.map((event) => event.sentenceId));
  // Shadowed today (whole-sentence attempt or phrase pass): sent to the back so a cleared or topped-up
  // session doesn't offer the same sentences again — clearing deletes the plan's own step list, which
  // is what the planner's exclusions otherwise come from.
  const shadowedTodayIds = new Set([
    ...todayAttempts.map((attempt) => attempt.sentenceId),
    ...todayPhraseEvents.map((event) => event.sentenceId),
  ]);
  const wantedSentenceIds = new Set(sentenceIdsWithAudio);
  const attemptCountBySentenceId = new Map<string, number>();
  for (const sentenceId of attemptSentenceIds as string[]) {
    if (!wantedSentenceIds.has(sentenceId)) continue;
    attemptCountBySentenceId.set(sentenceId, (attemptCountBySentenceId.get(sentenceId) ?? 0) + 1);
  }
  // A "sound" trouble tag stays pending until a shadowing attempt is saved after it.
  const requestedSentenceIds = new Set(
    Object.entries(shadowRequests)
      .filter(([id, at]) => !requestAttempts.some((attempt) => attempt.sentenceId === id && attempt.createdAt > at))
      .map(([id]) => id),
  );
  const bookIdBySentenceId = new Map(bookSentences.map((item) => [item.sentenceId, item.bookId]));
  const weakWords = await getWeakWordSentenceSignal(sentenceIdsWithAudio, PLANNER_STRENGTH_CACHE_MS);
  const weakRank = new Map(weakWords.order.map((id, rank) => [id, rank]));

  // Sentences containing a word the learner marked as hard in a chunk chain (lib/markedWords.ts). Only
  // read when a mark exists: finding them means scanning the sentence text.
  const markedWords = await getActiveMarkedWords();
  const markedBySentenceId = new Map<string, string>();
  if (markedWords.length > 0) {
    const rows = await db.sentences.bulkGet(sentenceIdsWithAudio);
    rows.forEach((row, index) => {
      const hit = row ? markedSurfacesIn(row.japanese, markedWords)[0] : undefined;
      if (hit) markedBySentenceId.set(sentenceIdsWithAudio[index], hit);
    });
  }

  const ranked = sentenceIdsWithAudio
    .map((sentenceId) => ({
      markedSurface: markedBySentenceId.get(sentenceId),
      sentenceId,
      attemptCount: attemptCountBySentenceId.get(sentenceId) ?? 0,
      requested: requestedSentenceIds.has(sentenceId),
      shadowedToday: shadowedTodayIds.has(sentenceId),
      coolingDown: phraseCooldownIds.has(sentenceId),
      weakRank: weakRank.get(sentenceId),
    }))
    .filter((candidate) => !snoozedSentenceIds.has(candidate.sentenceId))
    .sort((a, b) => {
      if (a.requested !== b.requested) return a.requested ? -1 : 1;
      if (a.shadowedToday !== b.shadowedToday) return a.shadowedToday ? 1 : -1;
      // A marked word's sentences lead the rest, rotating through them: one still cooling down falls back.
      const aMarked = Boolean(a.markedSurface) && !a.coolingDown;
      const bMarked = Boolean(b.markedSurface) && !b.coolingDown;
      if (aMarked !== bMarked) return aMarked ? -1 : 1;
      if (a.coolingDown !== b.coolingDown) return a.coolingDown ? 1 : -1;
      // Sentences covering the weakest words come next, in coverage order, ahead of the plain fewest-attempts fallback.
      if (a.weakRank !== b.weakRank) {
        if (a.weakRank === undefined) return 1;
        if (b.weakRank === undefined) return -1;
        return a.weakRank - b.weakRank;
      }
      return a.attemptCount - b.attemptCount;
    });
  // Sentence rows are large; fetch them only for the front of the ranking (a few spare cover any orphans).
  const shortlist = ranked.slice(0, limit * 3);
  const shortlistSentences = await db.sentences.bulkGet(shortlist.map((candidate) => candidate.sentenceId));
  return shortlist
    .map((candidate, index) => ({ ...candidate, sentence: shortlistSentences[index] }))
    .filter((candidate): candidate is typeof candidate & { sentence: Sentence } => Boolean(candidate.sentence))
    .slice(0, limit)
    .map((candidate) => {
      const weakLabels = weakWords.labels.get(candidate.sentenceId) ?? [];
      return {
        sentenceId: candidate.sentenceId,
        bookId: bookIdBySentenceId.get(candidate.sentenceId),
        label: candidate.sentence.japanese.slice(0, 24),
        reason: candidate.requested
          ? `You flagged the sound in review — ${shadowAttemptSummary(candidate.attemptCount).toLowerCase()}`
          : candidate.markedSurface
          ? `Has a word you marked as hard: ${candidate.markedSurface} — ${shadowAttemptSummary(candidate.attemptCount).toLowerCase()}`
          : weakLabels.length > 0
          ? `Practises words that haven't stuck: ${weakLabels.join('、')} — ${shadowAttemptSummary(candidate.attemptCount).toLowerCase()}`
          : shadowAttemptSummary(candidate.attemptCount),
      };
    });
}

/**
 * "Try again later" on a shadowing sentence: hides it from shadow candidates
 * until the start of the local day `days` days out, and skips any unsettled
 * shadowing step for it in an in-progress session (the planner won't re-offer
 * it, so a pending step would only sit there). Never touches FSRS.
 */
export async function snoozeShadowSentence(
  sentenceId: string,
  days: number,
  now: Date = new Date(),
): Promise<string> {
  const settings = await ensureSettings(getDb());
  const until = shadowSnoozeUntil(now, days);
  const live = Object.fromEntries(
    Object.entries(settings.shadowSnoozes ?? {}).filter(([, end]) => end > now.toISOString()),
  );
  await updateSettings({ shadowSnoozes: { ...live, [sentenceId]: until } });

  const sessions = await getDb().plannerSessions.where('status').equals('in_progress').toArray();
  for (const session of sessions) {
    for (const step of session.steps) {
      if (
        step.bucket === 'shadowing' &&
        step.sentenceId === sentenceId &&
        (step.status === 'pending' || step.status === 'active')
      ) {
        await updatePlannerSessionStep(session.id, step.id, { status: 'skipped' });
      }
    }
  }
  return until;
}

/**
 * Recent-activity events for the rolling-window balance/neglect calculation
 * (used by both the planner and the dashboard's balance display, so they
 * always agree). Every review row tags bucket `review` uniformly regardless
 * of activityType (2026-08-26 follow-up — the retain/practice split that
 * used to matter here was folded into one `review` bucket, so there's no
 * more per-activity-type branching to do, unlike the old ACTIVITY_TYPE_MODE
 * lookup this replaced).
 */
/**
 * How many distinct vocabulary words are confirmed (a `surfaceForm`-bearing
 * `sentence_vocabulary` link exists — the same eligibility
 * `getVocabularyTargetCandidates` uses) but have never been introduced to
 * the SRS: no `vocabularyItem`-subject study item for any activity type.
 * This is the backlog ReviewPage seeds lazily once the due queue drains; the
 * planner needs the raw count to reserve review-bucket minutes for it (see
 * getSessionPlannerInput / buildRecommendedSession), since it's otherwise
 * invisible to the "size the review bucket from due study_items" logic.
 */
export async function countNewVocabularyCardBacklog(): Promise<number> {
  const db = getDb();
  const [links, vocabularyStudyItems] = await Promise.all([
    db.sentenceVocabulary.toArray(),
    db.studyItems.where('subjectType').equals('vocabularyItem').toArray(),
  ]);
  const introduced = new Set(vocabularyStudyItems.map((item) => item.subjectId));
  const backlog = new Set<string>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    if (introduced.has(link.vocabularyItemId)) continue;
    backlog.add(link.vocabularyItemId);
  }
  return backlog.size;
}


/**
 * How many distinct sentences were given a card of `activityType` since
 * `sinceIso`. Counts what's in the database, so reopening Review can't exceed
 * the daily audio / sentence top-up quotas.
 */
export async function countSentencesSeededSince(activityType: string, sinceIso: string): Promise<number> {
  const items = await getDb().studyItems.where('subjectType').equals('sentence').toArray();
  const subjects = new Set<string>();
  for (const item of items) {
    if (item.activityType === activityType && item.createdAt >= sinceIso) subjects.add(item.subjectId);
  }
  return subjects.size;
}

/** The slice of a Dexie table `getRecentActivityEvents` needs: a range count and the newest row by an index. */
interface IndexedTimestampTable {
  where(index: string): { above(value: string): { count(): PromiseLike<number> } };
  orderBy(index: string): { last(): PromiseLike<object | undefined> };
}

/** Learning-event actions that are review work (recall checks) for the planner's neglect tracking, though they write no `Review` row. */
const REVIEW_LEARNING_ACTIONS: ReadonlySet<string> = new Set(['gist_check', 'held_back_check', 'transfer_recheck']);

async function getRecentActivityEvents(now: Date): Promise<RecentActivityEvent[]> {
  const db = getDb();
  const cutoffIso = new Date(now.getTime() - NEGLECT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // The planner only uses, per mode, how many events fell in the window and when the latest one was.
  // IndexedDB charges per row read (about 0.3 ms each in WebKit, more on a phone) but a range count is
  // nearly free, so indexed tables are summarised with `count()` plus the single newest row instead of
  // reading thousands of timestamps. Each table yields one entry carrying its count at that latest time
  // (not one object per row, which made this live query cost grow with the table while a restore wrote it).
  const summarise = async (
    mode: SessionBucket,
    label: string,
    table: IndexedTimestampTable,
    index: string,
  ): Promise<RecentActivityEvent[]> => {
    const count = await traceStep(`recent: ${label} count`, () => table.where(index).above(cutoffIso).count());
    if (count === 0) return [];
    const newest = await traceStep(`recent: ${label} newest`, () => table.orderBy(index).last());
    const timestamp = (newest as Record<string, unknown> | undefined)?.[index] as string | undefined;
    if (!timestamp) return [];
    return [{ mode, timestamp, count }];
  };

  const [review, shadowing, grammarFromAnalyses, grammarFromLinks, allBookSentences, learningEvents] = await Promise.all([
    summarise('review', 'reviews', db.reviews, 'timestamp'),
    summarise('shadowing', 'attempts', db.attempts, 'createdAt'),
    summarise('grammar', 'analyses', db.analyses, 'updatedAt'),
    summarise('grammar', 'sentenceGrammar', db.sentenceGrammar, 'updatedAt'),
    // addedAt has no index, so glossing still needs the (shared, once-per-pass) membership scan.
    traceStep('recent: bookSentences.toArray', () => readAllBookSentencesForPass(), rowCount),
    // Read checks and the other sentence-led recall checks log learning events, never `Review` rows.
    traceStep('recent: sentenceLearningEvents.toArray', () => readAllLearningEventsForPass(), rowCount),
  ]);

  const events: RecentActivityEvent[] = [...review, ...shadowing, ...grammarFromAnalyses, ...grammarFromLinks];
  for (const event of learningEvents) {
    if (REVIEW_LEARNING_ACTIONS.has(event.action)) events.push({ mode: 'review', timestamp: event.timestamp });
  }
  for (const membership of allBookSentences) {
    if (membership.addedAt >= cutoffIso) events.push({ mode: 'glossing', timestamp: membership.addedAt });
  }
  return events;
}

/** Which sentences/books/grammar patterns are already spoken for by today's existing steps — so a top-up doesn't recommend the same thing twice while it's still pending. */
interface SessionPlannerExclusions {
  sentenceIds: Set<string>;
  bookIds: Set<string>;
  grammarPatternIds: Set<string>;
}

function exclusionsFromSteps(steps: PlannerSessionStep[]): SessionPlannerExclusions {
  const sentenceIds = new Set<string>();
  const bookIds = new Set<string>();
  const grammarPatternIds = new Set<string>();
  for (const step of steps) {
    if (step.sentenceId) sentenceIds.add(step.sentenceId);
    for (const id of step.sentenceIds ?? []) sentenceIds.add(id);
    if (step.bookId && (step.targetKind === 'continue_book' || step.targetKind === 'vocabulary_review' || step.targetKind === 'sentence_learning')) {
      bookIds.add(step.bookId);
    }
    if (step.grammarPatternId) grammarPatternIds.add(step.grammarPatternId);
  }
  return { sentenceIds, bookIds, grammarPatternIds };
}

const NO_EXCLUSIONS: SessionPlannerExclusions = {
  sentenceIds: new Set(),
  bookIds: new Set(),
  grammarPatternIds: new Set(),
};

/** Days (counting today) a phrase-shadowed sentence ranks behind sentences not shadowed recently. */
const PHRASE_SHADOW_COOLDOWN_DAYS = 7;

/**
 * Reads the tables the planner scans into the cross-tap cache, one after another, so the first "add
 * time" tap after opening the app finds them ready. Safe to call repeatedly; failures are ignored.
 */
export async function warmPlannerReads(): Promise<void> {
  beginPlannerWarming();
  try {
    await readAllBookSentencesForPass();
    await readAllLearningEventsForPass();
    await readAllSentenceVocabularyForPass();
    await loadSuspendedBookIndex();
    await allAudioSentenceIds();
    await readSentenceStudyItemsForPass();
    await loadWordReadingStrengths(PLANNER_STRENGTH_CACHE_MS);
    await reviewsForStudyItems(Array.from({ length: ANY_OF_SCAN_THRESHOLD + 1 }, (_, i) => `warm-${i}`));
  } catch {
    // Warming is best effort; the planner reads what it needs itself.
  } finally {
    endPlannerWarming();
  }
}

/**
 * Gathers everything buildRecommendedSession needs — the only Dexie-touching
 * step of the planning pipeline. `exclude` keeps a top-up from re-suggesting
 * a book/sentence/grammar pattern already sitting in today's step list.
 * `baselineOverride` lets a caller (Home's per-add-time split picker) use a
 * one-off allocation instead of the saved `settings.sessionAllocation`.
 */
export async function getSessionPlannerInput(
  totalMinutes: number,
  now: Date = new Date(),
  exclude: SessionPlannerExclusions = NO_EXCLUSIONS,
  baselineOverride?: Record<SessionBucket, number>,
): Promise<SessionPlannerInput> {
  try {
    return await gatherSessionPlannerInput(totalMinutes, now, exclude, baselineOverride);
  } finally {
    // The per-pass memo must never outlive the pass (a failed pass would leave stale reads behind).
    endPlannerPass();
  }
}

async function gatherSessionPlannerInput(
  totalMinutes: number,
  now: Date,
  exclude: SessionPlannerExclusions,
  baselineOverride?: Record<SessionBucket, number>,
): Promise<SessionPlannerInput> {
  const db = getDb();
  const timer = createPlannerTimer();
  const settings = await timer.time('readSettings', () => readSettings(db));
  const [
    recentActivity,
    shadowCandidatesFound,
    readCheckCandidates,
    listeningToolCandidates,
    wordCheckCandidates,
    grammarCheckCandidates,
    dueItems,
    exploreCandidatesRaw,
  ] = await Promise.all([
    timer.time('getRecentActivityEvents', () => getRecentActivityEvents(now)),
    // Quiet mode (settings, per-device): the learner can't speak aloud, so withhold every
    // shadowing candidate. buildShadowSteps then drafts nothing and allocateTimeAcrossModes routes
    // the shadowing minutes to the other buckets. Nothing is consumed — the candidates recompute on
    // the next plan once quiet mode is off.
    settings.quietMode
      ? Promise.resolve([] as ShadowCandidate[])
      : timer.time('findShadowCandidates (incl. activeSentenceIdsForShadowing)', async () =>
          findShadowCandidates(
            SHADOW_CANDIDATE_LIMIT + exclude.sentenceIds.size,
            await activeSentenceIdsForShadowing(SHADOW_POOL_BOOK_LIMIT),
          ),
        ),
    // The planner drops any sentence it actually drafts a Fresh try for (a full walkthrough already covers it).
    timer.time('findReadCheckCandidates', () =>
      findReadCheckCandidates(READ_CHECK_CANDIDATE_LIMIT, exclude.sentenceIds, now),
    ),
    // Reading checks on words just missed in the reader come first, ahead of the listening rounds.
    timer.time('findListeningToolCandidates', async () => {
      const reading = await findReadingCheckCandidates(LISTENING_TOOL_CANDIDATE_LIMIT, exclude.sentenceIds, now);
      const taken = new Set([...exclude.sentenceIds, ...reading.map((candidate) => candidate.sentenceId)]);
      return [...reading, ...(await findListeningToolCandidates(LISTENING_TOOL_CANDIDATE_LIMIT, taken, now))];
    }),
    timer.time('findWordCheckCandidates', () =>
      findWordCheckCandidates(WORD_CHECK_CANDIDATE_LIMIT, exclude.sentenceIds, now),
    ),
    timer.time('findGrammarCheckCandidates', () =>
      findGrammarCheckCandidates(GRAMMAR_CHECK_CANDIDATE_LIMIT, exclude.sentenceIds, now),
    ),
    // Not capped here: the pool is trimmed after the suspended/paused/readiness
    // filters below, or long-overdue paused-drill items crowd out live ones.
    // One scan for both groups (the lists are disjoint), split below: each scan is a
    // whole-table read, which is slow on a phone.
    timer.time('getDueStudyItems(retain+practice)', async () =>
      getDueStudyItems([...RETAIN_ACTIVITY_TYPES, ...PRACTICE_ACTIVITY_TYPES], {
        fromItems: await readAllStudyItemsForPass(),
        now,
        graduationMinScheduledDays: settings.graduationMinScheduledDays,
        // Word and grammar cards are retired; don't read them.
        excludeSubjectTypes: RETIRED_DRILL_SUBJECT_TYPES,
      }),
    ),
    // Over-fetch by the exclusion count so filtering below still leaves a full page of candidates.
    timer.time('findExploreCandidates', () =>
      findExploreCandidates(
        EXPLORE_CANDIDATE_LIMIT + exclude.bookIds.size,
        isSequentialStudyMode(settings),
        isIPlusOneOrdering(settings)
          ? {
              stretchEvery: iPlusOneStretchEvery(settings),
              strict: isStrictIPlusOne(settings),
              planned: exclude.sentenceIds,
            }
          : undefined,
      ),
    ),
  ]);

  // Hold back the exclusive review cards of any suspended book — same
  // treatment ReviewPage's global queue gives them (see src/lib/suspendedBooks).
  // `null` (nothing suspended) is the common case and skips all the work.
  const suspendedIndex = await timer.time('loadSuspendedBookIndex', () => loadSuspendedBookIndex());
  const notSuspended = (items: StudyItem[]): StudyItem[] =>
    suspendedIndex
      ? items.filter((item) => !studyItemIsHeldBackBySuspension(item, suspendedIndex))
      : items;

  // Quiet mode withholds pitch_accent_production due items ("can't speak aloud right
  // now", same reasoning as shadowCandidates). "Pause pitch accent"
  // (settings.pitchAccentPaused, 2026-09-28) withholds them too, same as
  // ReviewPage's pitchAccentProductionCandidates.
  // "Pause sentence cards" (settings.sentenceCardsPaused): the reader's Read checks replace them.
  const unlessSentenceCardsPaused = (items: StudyItem[]): StudyItem[] =>
    settings.sentenceCardsPaused ? items.filter((item) => !isSentenceCardSubject(item.subjectType)) : items;
  const retainTypes = new Set<string>(RETAIN_ACTIVITY_TYPES);
  const retainDueItems = dueItems.filter((item) => retainTypes.has(item.activityType));
  const practiceDueItems = dueItems.filter((item) => !retainTypes.has(item.activityType));
  const practiceDueReady = notSuspended(
    unlessSentenceCardsPaused(
      settings.quietMode || settings.pitchAccentPaused
        ? practiceDueItems.filter((item) => item.activityType !== 'pitch_accent_production')
        : practiceDueItems,
    ),
  );
  const retainDueReady = unlessSentenceCardsPaused(notSuspended(retainDueItems));

  // retainDueItems/practiceDueItems are ranked/packed together downstream
  // (one shared `review` bucket) — the 'review' tag here is only used for
  // ReviewPriorityInput's informational `mode` field, not for allocation.
  const [retainDue, practiceDue] = await Promise.all([
    timer.time('buildReviewPriorityInputs(retain)', () =>
      buildReviewPriorityInputs(
        retainDueReady.slice(0, SESSION_PLANNER_CANDIDATE_POOL_SIZE),
        'review',
        now,
      ),
    ),
    timer.time('buildReviewPriorityInputs(practice)', () =>
      buildReviewPriorityInputs(
        practiceDueReady.slice(0, SESSION_PLANNER_CANDIDATE_POOL_SIZE),
        'review',
        now,
      ),
    ),
  ]);

  // Quiet mode (settings, per-device): the learner can't speak aloud, so
  // withhold every shadowing candidate. buildShadowSteps then drafts
  // nothing and allocateTimeAcrossModes routes the shadowing minutes to the
  // other buckets. Nothing is consumed — the candidates recompute on the
  // next plan once quiet mode is off.
  // "Pause sentence shadowing" (settings.sentenceShadowingPaused) withholds them the same way, while phrase
  // shadowing builds up its own data; the Shadow page and the reader's Shadowing tool stay available.
  // While sentence shadowing is paused the same candidates are drafted as phrase shadows (mark a span, rate it).
  const shadowCandidatesRaw = settings.quietMode
    ? []
    : shadowCandidatesFound.map((candidate) =>
        settings.sentenceShadowingPaused ? { ...candidate, phrase: true } : candidate,
      );

  // Strict i+1 already dropped today's sentences and picked its books by rank, so a top-up keeps building on them.
  const strictExplore = isIPlusOneOrdering(settings) && isStrictIPlusOne(settings) && !isSequentialStudyMode(settings);
  const exploreCandidates = strictExplore
    ? exploreCandidatesRaw
    : exploreCandidatesRaw
        .filter((candidate) => !exclude.bookIds.has(candidate.bookId))
        .slice(0, EXPLORE_CANDIDATE_LIMIT);
  const shadowCandidatesTrimmed = shadowCandidatesRaw
    .filter((candidate) => !exclude.sentenceIds.has(candidate.sentenceId))
    .slice(0, SHADOW_CANDIDATE_LIMIT);
  // A phrase step becomes a chunk chain when the clip's cached alignment plans one (the reader starts it on
  // open); otherwise it names its suggested phrase (the weakest word's span) when the alignment is cached.
  const shadowCandidates = await Promise.all(
    shadowCandidatesTrimmed.map(async (candidate) => {
      if (!candidate.phrase) return candidate;
      if (await chunkChainPlannedForSentence(candidate.sentenceId).catch(() => false)) return { ...candidate, chunkChain: true };
      const suggestion = await suggestPhraseShadowForSentence(candidate.sentenceId).catch(() => null);
      return suggestion?.text ? { ...candidate, phraseText: suggestion.text } : candidate;
    }),
  );
  timer.report();
  return {
    now,
    totalMinutes,
    recentActivity,
    retainDue,
    practiceDue,
    exploreCandidates,
    readCheckCandidates,
    listeningToolCandidates,
    wordCheckCandidates,
    grammarCheckCandidates,
    shadowCandidates,
    baseline: baselineOverride ?? settings.sessionAllocation,
    quietMode: settings.quietMode ?? false,
  };
}

/** Previews what `addMinutesToTodaySession(minutes)` would add right now, without persisting anything. */
export async function planRecommendedSession(
  minutes: number,
  now: Date = new Date(),
  baselineOverride?: Record<SessionBucket, number>,
): Promise<RecommendedSession> {
  const input = await getSessionPlannerInput(minutes, now, undefined, baselineOverride);
  return buildRecommendedSession(input);
}

/** Today's (local calendar day) PlannerSession, if one has been started yet — read-only, never creates one. */
export async function getTodayPlannerSession(now: Date = new Date()): Promise<PlannerSession | undefined> {
  return (await plannerSessionsOnDate(localDateKey(now)))[0];
}

/**
 * Every session row for a local date, newest first. Two devices (or repeated taps while syncing) can each
 * create one, and a `.first()` on the date index would pick by id, not by age, so reads, top-ups and
 * clears all go through this to agree on the same row.
 */
async function plannerSessionsOnDate(date: string): Promise<PlannerSession[]> {
  const rows = await getDb().plannerSessions.where('date').equals(date).toArray();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The single action behind both "start today's session" (first call of the
 * day) and "I've got a bit more time" top-ups (every later call) — replacing
 * the old fixed-length Quick/Normal/Deep "Start Session" with one growing
 * daily list. Re-plans only against the newly added minutes, excluding
 * sentences/books/grammar patterns already present anywhere in today's step
 * list (regardless of status) so a top-up doesn't re-suggest something
 * already recommended. The `due_review_batch` step needs no such exclusion —
 * it always scores against the live due queue, which itself shrinks as
 * reviews actually get done via ReviewPage — except that one still sitting
 * `pending` (unstarted) is left alone rather than duplicated; its own live
 * due-queue link already reflects the larger budget in practice even though
 * its displayed count doesn't retroactively grow. `baselineOverride` (Home's
 * per-add-time split picker) applies only to this call's own newly-added
 * steps, not to the session's already-settled allocation history.
 */
export async function addMinutesToTodaySession(
  minutes: number,
  now: Date = new Date(),
  baselineOverride?: Record<SessionBucket, number>,
): Promise<PlannerSession> {
  const db = getDb();
  const date = localDateKey(now);
  const timestamp = nowIso();

  const existing = (await plannerSessionsOnDate(date))[0];
  const exclude = exclusionsFromSteps(existing?.steps ?? []);
  const hasPendingReviewBatch = (existing?.steps ?? []).some(
    (step) => step.activityType === 'due_review_batch' && step.status === 'pending',
  );

  const input = await getSessionPlannerInput(minutes, now, exclude, baselineOverride);
  const recommended = buildRecommendedSession(input);

  const newSteps: PlannerSessionStep[] = recommended.steps
    .filter((step) => !(step.activityType === 'due_review_batch' && hasPendingReviewBatch))
    .map((step) => ({ ...step, id: createId('planner_step'), status: 'pending' as const }));

  if (!existing) {
    const session: PlannerSession = {
      id: createId('planner_session'),
      createdAt: timestamp,
      updatedAt: timestamp,
      date,
      targetMinutes: minutes,
      allocation: recommended.allocation,
      explanation: recommended.explanation,
      steps: newSteps,
      status: 'in_progress',
    };
    await db.plannerSessions.put(session);
    notifySync('planner_sessions', session.id, session);
    // Today's plan replaces any earlier day's unfinished one, so the SessionBar stops resuming it.
    await endEarlierPlannerSessions(now);
    return session;
  }

  const allocation = { ...existing.allocation };
  for (const bucket of Object.keys(recommended.allocation) as SessionBucket[]) {
    allocation[bucket] = (allocation[bucket] ?? 0) + recommended.allocation[bucket];
  }

  // Only reopen a settled (completed/ended-early) session if this top-up
  // actually produced something new to do — a top-up that finds nothing new
  // to recommend (e.g. everything's already covered by existing steps)
  // should leave "all done" standing, not silently flip back to in_progress
  // with nothing pending.
  const reopens = newSteps.length > 0 && existing.status !== 'in_progress';
  const updated: PlannerSession = {
    ...existing,
    updatedAt: timestamp,
    targetMinutes: existing.targetMinutes + minutes,
    allocation,
    explanation:
      newSteps.length > 0
        ? [...existing.explanation, `Added ${minutes} more minutes:`, ...recommended.explanation]
        : existing.explanation,
    steps: [...existing.steps, ...newSteps],
    status: reopens ? 'in_progress' : existing.status,
    endedAt: reopens ? undefined : existing.endedAt,
  };
  await db.plannerSessions.put(updated);
  notifySync('planner_sessions', updated.id, updated);
  return updated;
}

export async function getPlannerSession(sessionId: string): Promise<PlannerSession | undefined> {
  return getDb().plannerSessions.get(sessionId);
}

/**
 * Post-session recap for `SessionRunnerPage` — what today's session moved,
 * recomputed from evidence (never stored). Window is the session's own
 * `[createdAt, endedAt ?? now]`. See `src/lib/sessionRecap.ts`.
 */
export async function getSessionRecap(
  session: PlannerSession,
  now: Date = new Date(),
): Promise<SessionRecap> {
  const db = getDb();
  const windowStart = session.createdAt;
  const windowEnd = session.endedAt ?? now.toISOString();
  const [reviews, vocabularyStudyItems, analyses] = await Promise.all([
    db.reviews.toArray(),
    db.studyItems.where('subjectType').equals('vocabularyItem').toArray(),
    db.analyses.toArray(),
  ]);
  const grammarNoticed = analyses.filter(
    (analysis) =>
      analysis.grammarReviewStatus === 'confirmed' &&
      analysis.updatedAt >= windowStart &&
      analysis.updatedAt <= windowEnd,
  ).length;
  return buildSessionRecap({
    windowStart,
    windowEnd,
    steps: session.steps.map((step) => ({
      bucket: step.bucket,
      status: step.status,
      targetKind: step.targetKind,
      category: sessionStepCategory(step),
    })),
    reviews: reviews.map((review) => ({
      studyItemId: review.studyItemId,
      timestamp: review.timestamp,
      rating: review.rating,
      source: review.source,
    })),
    vocabularyStudyItems: vocabularyStudyItems.map((item) => ({
      id: item.id,
      subjectId: item.subjectId,
      subjectType: item.subjectType,
    })),
    grammarNoticed,
  });
}

export async function listRecentPlannerSessions(limit = 10): Promise<PlannerSession[]> {
  const sessions = await getDb().plannerSessions.toArray();
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/**
 * The one session, if any, the learner is currently mid-way through — backs
 * a global "back to session" affordance (SessionBar) so any page can surface
 * it without threading a session id through every deep-link target. Most
 * recently updated wins in the (should be rare) case more than one is
 * somehow `in_progress` at once — in practice this is always today's
 * session, since `addMinutesToTodaySession` is the only writer and it's
 * keyed one-per-day.
 */
export async function getActiveInProgressPlannerSession(): Promise<PlannerSession | undefined> {
  const sessions = await getDb().plannerSessions.where('status').equals('in_progress').toArray();
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/**
 * Real-progress side effect of settling a glossing/grammar step as
 * *completed* (never skipped). A session's step list is a day-plan checklist
 * layered over real progress and normally never its source of truth — but
 * "Mark complete" on these exploration steps is the single advance control the
 * learner actually touches (2026-08-27 decision), and the underlying page's
 * own status pill / picker Confirm button was being left unpressed. The
 * planner's candidate finders key on those markers, so a fully-worked sentence
 * whose `BookSentence.status` was still `unstarted` got re-drafted as the same
 * `continue_book` step every session (user report, 2026-09-06). Completing the
 * step now also advances the marker its finder checks, so finished work drops
 * out of the pool:
 *   - continue_book     → BookSentence.status unstarted/in_progress → complete
 *   - vocabulary_review → vocabularyReviewStatus → confirmed (materializes the
 *                         autosaved selections, exactly like the picker's
 *                         Confirm button)
 *   - grammar_noticing  → grammarReviewStatus → confirmed
 * `grammar_detail` ("Examine <pattern>") is deliberately excluded — whether to
 * Track a pattern is a real decision the step exists to prompt, not a
 * foregone conclusion of having looked at it. Failures here are logged and
 * swallowed: the step still settles and the session still advances.
 */
async function advanceCompletedStepProgress(step: PlannerSessionStep): Promise<void> {
  try {
    if (step.targetKind === 'continue_book' && step.bookId && step.sentenceId) {
      const membership = await getDb()
        .bookSentences.where('[bookId+sentenceId]')
        .equals([step.bookId, step.sentenceId])
        .first();
      if (
        membership &&
        (membership.status === 'unstarted' || membership.status === 'in_progress')
      ) {
        await setBookSentenceStatus(step.bookId, step.sentenceId, 'complete');
      }
      return;
    }
    if (step.targetKind === 'vocabulary_review' && step.sentenceId) {
      const analysis = await getDb().analyses.get(step.sentenceId);
      if (analysis?.vocabularyReviewStatus !== 'confirmed') {
        await confirmSentenceVocabulary(step.sentenceId, analysis?.vocabularySelections ?? []);
      }
      return;
    }
    if (step.targetKind === 'grammar_noticing') {
      // Batched step walks `sentenceIds`; older per-sentence steps only have
      // `sentenceId`. Marking the step complete means "I'm done noticing
      // grammar in these" — confirm any the learner didn't already close in
      // the flow, same as the old single-sentence step did.
      const ids = step.sentenceIds?.length ? step.sentenceIds : step.sentenceId ? [step.sentenceId] : [];
      for (const sentenceId of ids) {
        const analysis = await getDb().analyses.get(sentenceId);
        if (analysis?.grammarReviewStatus !== 'confirmed') {
          await setSentenceGrammarReviewStatus(sentenceId, 'confirmed');
        }
      }
      return;
    }
  } catch (error) {
    console.error('advanceCompletedStepProgress failed', { stepId: step.id, error });
  }
}

/**
 * Marks one step's outcome (start/complete/skip). Session steps settle only
 * through an explicit user action — "Mark complete"/"Skip" in SessionBar or
 * SessionRunnerPage, ReviewPage's own "target review count reached" auto-
 * advance (which calls settleSessionStep directly), or endPlannerSessionEarly.
 * Doing the underlying work in place (confirmSentenceVocabulary,
 * setBookSentenceStatus) no longer settles anything on its own (2026-08-27),
 * so there's a single predictable advance control and nothing moves the
 * session's pointer past work the learner hasn't confirmed done. The reverse
 * direction *is* wired up, though: settling a glossing/grammar step as
 * completed advances that step's underlying real-progress marker so the
 * planner stops re-proposing it — see advanceCompletedStepProgress.
 * Once every step is completed/skipped/replaced, the session itself is
 * marked complete.
 */
export async function updatePlannerSessionStep(
  sessionId: string,
  stepId: string,
  update: { status: PlannerStepStatus; feedback?: 'too_easy' | 'difficult' },
  options: { deferProgress?: boolean } = {},
): Promise<PlannerSession | undefined> {
  const db = getDb();
  const session = await db.plannerSessions.get(sessionId);
  if (!session) return undefined;
  const timestamp = nowIso();
  const priorStep = session.steps.find((step) => step.id === stepId);
  const steps = session.steps.map((step) => {
    if (step.id !== stepId) return step;
    return {
      ...step,
      status: update.status,
      feedback: update.feedback ?? step.feedback,
      startedAt: step.startedAt ?? timestamp,
      completedAt:
        update.status === 'completed' || update.status === 'skipped' ? timestamp : step.completedAt,
    };
  });
  const allSettled = steps.every(
    (step) => step.status === 'completed' || step.status === 'skipped' || step.status === 'replaced',
  );
  const updated: PlannerSession = {
    ...session,
    steps,
    status: allSettled ? 'completed' : session.status,
    endedAt: allSettled ? timestamp : session.endedAt,
    updatedAt: timestamp,
  };
  await db.plannerSessions.put(updated);
  notifySync('planner_sessions', updated.id, updated);

  // Settling (not re-settling) a glossing/grammar step as completed advances
  // its underlying real-progress marker so the planner stops re-proposing it.
  if (
    update.status === 'completed' &&
    priorStep &&
    priorStep.status !== 'completed'
  ) {
    // Deferred so auto-advance navigates immediately; the helper swallows its own errors.
    if (options.deferProgress) void advanceCompletedStepProgress(priorStep);
    else await advanceCompletedStepProgress(priorStep);
  }

  return updated;
}

/**
 * Settles one step (Mark complete/Skip) and, if there's a next pending/
 * active step afterward, marks it active too — the auto-advance behavior
 * `SessionBar` and (2026-08-26 follow-up) `ReviewPage` both need, factored
 * out here so neither hand-rolls the same "find the next step, activate it"
 * lookup. Returns the next step (if any) so the caller can navigate to its
 * target path (`sessionStepTargetPath`).
 */
export async function settleSessionStep(
  sessionId: string,
  stepId: string,
  status: 'completed' | 'skipped',
): Promise<{ session: PlannerSession; nextStep: PlannerSessionStep | undefined } | undefined> {
  const before = await getDb().plannerSessions.get(sessionId);
  if (!before) return undefined;
  await updatePlannerSessionStep(sessionId, stepId, { status }, { deferProgress: true });

  const currentIndex = before.steps.findIndex((step) => step.id === stepId);
  const nextStepBefore = before.steps
    .slice(currentIndex + 1)
    .find((step) => step.status === 'pending' || step.status === 'active');

  const updated = nextStepBefore
    ? await updatePlannerSessionStep(sessionId, nextStepBefore.id, { status: 'active' })
    : await getDb().plannerSessions.get(sessionId);
  if (!updated) return undefined;
  return {
    session: updated,
    nextStep: nextStepBefore ? updated.steps.find((step) => step.id === nextStepBefore.id) : undefined,
  };
}

/** Count of Review rows recorded at/after `timestamp` — powers ReviewPage's live "X/N reviews done" progress against an active session's `review` step target count; timestamp-based (not component state) so progress survives leaving and returning to the page. */
export async function countReviewsSince(timestamp: string): Promise<number> {
  return getDb().reviews.where('timestamp').aboveOrEqual(timestamp).count();
}

/** Ends a session before every step is settled — any still-pending steps count as skipped, not completed. */
export async function endPlannerSessionEarly(sessionId: string): Promise<PlannerSession | undefined> {
  const db = getDb();
  const session = await db.plannerSessions.get(sessionId);
  if (!session) return undefined;
  const timestamp = nowIso();
  const updated: PlannerSession = {
    ...session,
    status: 'ended_early',
    endedAt: timestamp,
    updatedAt: timestamp,
    steps: session.steps.map((step) =>
      step.status === 'pending' || step.status === 'active'
        ? { ...step, status: 'skipped', completedAt: timestamp }
        : step,
    ),
  };
  await db.plannerSessions.put(updated);
  notifySync('planner_sessions', updated.id, updated);
  return updated;
}

/** An in-progress session from an earlier day, if any: what the SessionBar resumes while today has no plan. */
export async function getEarlierOpenPlannerSession(now: Date = new Date()): Promise<PlannerSession | undefined> {
  const today = localDateKey(now);
  const open = await getDb().plannerSessions.where('status').equals('in_progress').toArray();
  return open
    .filter((session) => session.date !== today)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Ends every in-progress session from an earlier day (unsettled steps count as skipped). */
export async function endEarlierPlannerSessions(now: Date = new Date()): Promise<void> {
  const today = localDateKey(now);
  const open = await getDb().plannerSessions.where('status').equals('in_progress').toArray();
  for (const session of open) {
    if (session.date !== today) await endPlannerSessionEarly(session.id);
  }
}

export const STALE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Ends in-progress sessions with no activity (`updatedAt`) for `maxAgeMs`, so a forgotten session stops surfacing in the SessionBar. */
export async function expireStalePlannerSessions(
  now: Date = new Date(),
  maxAgeMs: number = STALE_SESSION_MAX_AGE_MS,
): Promise<PlannerSession[]> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
  const open = await db.plannerSessions.where('status').equals('in_progress').toArray();
  const expired: PlannerSession[] = [];
  for (const session of open) {
    if (session.updatedAt >= cutoff) continue;
    const ended = await endPlannerSessionEarly(session.id);
    if (ended) expired.push(ended);
  }
  return expired;
}

/**
 * Deletes today's PlannerSession outright (user request, 2026-08-27: "clear
 * out a session after I created it with the wrong split") — unlike
 * endPlannerSessionEarly, which just settles remaining steps, this removes
 * the row entirely so the next "Start"/"+time" tap on Home builds a fresh
 * one from scratch with a corrected split, rather than only ever being able
 * to apply a corrected split to minutes added *after* the mistake. Any
 * step's real underlying progress (a sentence actually analyzed, vocabulary
 * actually confirmed, reviews actually done) is untouched — only the
 * session's own step list/allocation bookkeeping is discarded. Session steps
 * are a day-plan checklist layered over that real progress, never its source
 * of truth.
 */
export async function deleteTodayPlannerSession(now: Date = new Date()): Promise<void> {
  const db = getDb();
  // Every row for the date, not just the first: a surviving duplicate would become today's session again.
  for (const session of await plannerSessionsOnDate(localDateKey(now))) {
    await db.plannerSessions.delete(session.id);
    notifySync('planner_sessions', session.id, { id: session.id }, 'delete');
  }
}

/**
 * Home's "Replan fresh": throws away today's plan and plans the same number of minutes again from
 * storage, bypassing the planner's in-memory reads and packed snapshots (`plannerSnapshots.ts`) so
 * nothing from an earlier pass is reused. Like "Clear today's session", completed work is untouched.
 */
export async function replanTodayPlannerSession(
  fallbackMinutes: number,
  now: Date = new Date(),
  baselineOverride?: Record<SessionBucket, number>,
): Promise<PlannerSession> {
  const minutes = (await getTodayPlannerSession(now))?.targetMinutes ?? fallbackMinutes;
  clearPlannerReadCaches();
  await clearPlannerSnapshots(getDb());
  await deleteTodayPlannerSession(now);
  return addMinutesToTodaySession(minutes, now, baselineOverride);
}

export interface LearningBalanceEntry {
  bucket: SessionBucket;
  /** Number of distinct activity events observed in this bucket within the rolling window. */
  count: number;
  daysSinceLast: number | null;
  neglectScore: number;
}

/** The dashboard's compact rolling-window balance view — shares getRecentActivityEvents/computeNeglectScores with the planner itself, so the bars and the recommendation are always telling the same story. */
export async function computeLearningBalance(now: Date = new Date()): Promise<LearningBalanceEntry[]> {
  const events = await getRecentActivityEvents(now);
  const distribution = computeRecentActivityDistribution(events, now);
  const neglectScores = computeNeglectScores(distribution);
  return (Object.keys(distribution) as SessionBucket[]).map((mode) => ({
    bucket: mode,
    count: distribution[mode].count,
    daysSinceLast: distribution[mode].daysSinceLast,
    neglectScore: neglectScores[mode],
  }));
}
