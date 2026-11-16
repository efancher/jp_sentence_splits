// ---------------------------------------------------------------------------
// FSRS-scheduled review (docs/UNIFIED_APP_ARCHITECTURE.md §10, Phase 4).
// study_items are created lazily the first time a subject is encountered in
// a review session (confirmed with the user — no batch seeding step).
// reviews are append-only; studyItems.fsrsState is the only thing ever
// updated after insert.
// ---------------------------------------------------------------------------

import type {
  ErrorClassification,
  FsrsState,
  MeaningChoiceRecord,
  Review,
  ReviewAssistance,
  ReviewPresentation,
  ReviewRating,
  ReviewSource,
  Sentence,
  SentenceAnalysis,
  SentenceVocabulary,
  StudyActivityType,
  StudyItem,
  StudySubjectType,
  VocabularyItem,
} from '../../domain/types';
import { buildBookCoverage, type BookCoverage } from '../../lib/bookCoverage';
import { createId } from '../../lib/ids';
import {
  buildReadingContextMap,
} from '../../lib/readingContext';
import {
  buildSentenceMasteryArc,
  type MasteryRungStatus,
  rankSentenceMasteryArcs,
  type SentenceMasteryArc,
} from '../../lib/masteryArc';
import { MATURE_MIN_SCHEDULED_DAYS } from '../../lib/maturity';
import { nowIso } from '../../lib/normalize';
import {
  classifyReviewError,
  computeGraduatedSubjectIds,
  createInitialFsrsState,
  isGraduated,
  isSentenceReadyForFullReview,
  isVocabularyItemIntroduced,
  isVocabularyItemProficient,
  predictRetrievability,
  scheduleReview,
} from '../../lib/scheduling';
import { withoutResetWalkthroughs } from '../../lib/sentenceLearning';
import { READER_KNOWN_STRENGTH } from '../../lib/wordStrength';
import { getDb, readSettings } from '../database';
import { notifySync, notifySyncMany } from '../syncNotify';
import {
  ANY_OF_SCAN_THRESHOLD,
  SMALL_TABLE_ANY_OF_LIMIT,
  bookSentencesForSentences,
  learningEventsForSentences,
  plannerPassActive,
  readAllBookSentencesForPass,
  readAllSentenceVocabularyForPass,
  readRowsByKeys,
  readSentenceStudyItemsForPass,
  rowCount,
  traceStep,
} from './passReads';
import { countAttemptsForSentences } from './shadowingAttempts';
import { pickContextSentenceForGrammarPattern } from './contextSentences';
import { latchSequentialUnlocksForSentence } from './sequentialUnlocks';
import { loadWordReadingStrengths, READER_STRENGTH_CACHE_MS } from './wordReadingStrengths';

export async function ensureStudyItem(
  subjectType: StudySubjectType,
  subjectId: string,
  activityType: StudyActivityType,
): Promise<StudyItem> {
  const db = getDb();
  const existing = await db.studyItems
    .where('[subjectType+subjectId+activityType]')
    .equals([subjectType, subjectId, activityType])
    .first();
  if (existing) return existing;
  const timestamp = nowIso();
  const studyItem: StudyItem = {
    id: createId('study_item'),
    subjectType,
    subjectId,
    activityType,
    fsrsState: createInitialFsrsState(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.studyItems.put(studyItem);
  notifySync('study_items', studyItem.id, studyItem);
  return studyItem;
}

export async function getDueStudyItems(
  activityTypes: StudyActivityType[],
  options: {
    subjectIds?: string[];
    now?: Date;
    limit?: number;
    /** Graduation (Phase 7.10) — omitted or 0 disables it; see isGraduated, src/lib/scheduling.ts. */
    graduationMinScheduledDays?: number;
    /**
     * Skip the `due <= now` filter, but only for items still in `new`/
     * `learning` state — used solely by ReviewPage's single-sentence "deep
     * dive" mode (docs/ROADMAP.md "Opt-in single-sentence deep dive") to
     * pull a lagging sentence's not-yet-proficient cards into a focused
     * session on purpose. Deliberately does NOT bypass the date for
     * `review`/`relearning` items: those are already proficient (or, for
     * `contextMature`, waiting on real calendar time to accumulate — cramming
     * an early review there doesn't grow `scheduledDays` the way maturity
     * actually needs and would just miscalibrate FSRS's stability estimate).
     */
    ignoreDue?: boolean;
    /** Select from these already-loaded study items instead of querying (the planner's snapshot-backed read). */
    fromItems?: readonly StudyItem[];
    /**
     * Subject types whose rows are never read. Callers that discard these
     * subjects afterwards (the planner, while word/grammar drills are paused)
     * use it to avoid loading thousands of unwanted rows.
     */
    excludeSubjectTypes?: readonly string[];
  } = {},
): Promise<StudyItem[]> {
  const db = getDb();
  const nowIsoValue = (options.now ?? new Date()).toISOString();
  const subjectIdSet = options.subjectIds ? new Set(options.subjectIds) : null;
  const activityTypeSet = new Set<string>(activityTypes);
  const excludedSubjects = new Set<string>(options.excludeSubjectTypes ?? []);
  const candidates = options.fromItems
    ? options.fromItems.filter((item) => activityTypeSet.has(item.activityType) && !excludedSubjects.has(item.subjectType))
    : await traceStep(
    'getDueStudyItems read',
    () =>
      options.excludeSubjectTypes?.length
        ? db.studyItems
            .where('subjectType')
            .noneOf([...options.excludeSubjectTypes])
            .and((item) => activityTypeSet.has(item.activityType))
            .toArray()
        : db.studyItems.where('activityType').anyOf(activityTypes).toArray(),
    rowCount,
  );
  const isUngraduatedState = (item: StudyItem) =>
    item.fsrsState.state === 'new' || item.fsrsState.state === 'learning';
  const due = candidates
    .filter(
      (item) =>
        item.fsrsState.due <= nowIsoValue || (options.ignoreDue && isUngraduatedState(item)),
    )
    .filter((item) => !subjectIdSet || subjectIdSet.has(item.subjectId))
    .filter((item) => !isGraduated(item.fsrsState, options.graduationMinScheduledDays ?? 0))
    .sort((a, b) => a.fsrsState.due.localeCompare(b.fsrsState.due));
  return options.limit ? due.slice(0, options.limit) : due;
}

/**
 * Distinct, surface-form-bearing (i.e. actually reviewable — see
 * getVocabularyTargetCandidates) vocabulary item ids linked to each of
 * `sentenceIds`, keyed by sentence id. Batched across all sentences in one
 * pass for use by deferUnreadySentenceReviews below.
 */
export async function getReviewableVocabularyItemIdsBySentence(
  sentenceIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (sentenceIds.length === 0) return map;
  const db = getDb();
  // Thousands of point lookups cost far more than one pass over this table (about 1.7k rows).
  const idSet = sentenceIds.length > ANY_OF_SCAN_THRESHOLD || plannerPassActive() ? new Set(sentenceIds) : null;
  const links = idSet
    ? (await readAllSentenceVocabularyForPass()).filter((link) => idSet.has(link.sentenceId))
    : await db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    const existing = map.get(link.sentenceId);
    if (existing) {
      if (!existing.includes(link.vocabularyItemId)) existing.push(link.vocabularyItemId);
    } else {
      map.set(link.sentenceId, [link.vocabularyItemId]);
    }
  }
  return map;
}

/**
 * The subset of `vocabularyItemIds` that have at least one
 * vocabulary-item-subject study item at FSRS proficiency (review/
 * relearning) — i.e. the learner has demonstrated recall of the word at
 * least once. Shared by getSentenceFullReviewReadiness and the
 * `word_listening` review card's tier-1 gate (a word's listening card is
 * withheld until its reading is proven — see ReviewPage).
 */
export async function getProficientVocabularyItemIds(
  vocabularyItemIds: string[],
): Promise<Set<string>> {
  if (vocabularyItemIds.length === 0) return new Set();
  const db = getDb();
  const idSet = new Set(vocabularyItemIds);
  return new Set(
    (await db.studyItems.where('subjectType').equals('vocabularyItem').toArray())
      .filter(
        (item) =>
          idSet.has(item.subjectId) && isVocabularyItemProficient(item.fsrsState.state),
      )
      .map((item) => item.subjectId),
  );
}

/**
 * Saved meanings and "known" status for surface expressions. An expression is
 * known when a saved vocabulary item with it is reading-proficient on its
 * cards, or its reading strength (`wordStrength.ts`) reaches
 * READER_KNOWN_STRENGTH. Cards have been paused under the sentence-led flow, so
 * card proficiency alone froze; strength keeps moving with recall, walkthroughs
 * and time, which is what fades furigana and word help as a word strengthens.
 * Read-only; used to decide how much word help the Reader shows.
 */
export async function getSavedWordStatus(
  expressions: string[],
  options: { skipStrength?: boolean } = {},
): Promise<{ savedMeanings: Map<string, string>; knownExpressions: Set<string> }> {
  const items = await readRowsByKeys(getDb().vocabularyItems, 'expression', expressions);
  const savedMeanings = new Map<string, string>();
  for (const item of items) if (item.meaning.trim() && !savedMeanings.has(item.expression)) savedMeanings.set(item.expression, item.meaning);
  const proficientIds = await getProficientReadingVocabularyItemIds(items.map((item) => item.id));
  // `skipStrength` leaves out the slow whole-table strength scan; `getStrengthKnownExpressions` supplies it later.
  const { strengthByWord } = items.length && !options.skipStrength
    ? await loadWordReadingStrengths(READER_STRENGTH_CACHE_MS)
    : { strengthByWord: new Map<string, number>() };
  const isKnown = (id: string) =>
    proficientIds.has(id) || (strengthByWord.get(id) ?? 0) >= READER_KNOWN_STRENGTH;
  return { savedMeanings, knownExpressions: new Set(items.filter((item) => isKnown(item.id)).map((item) => item.expression)) };
}

/**
 * The strength-based half of `getSavedWordStatus`'s "known": expressions whose reading strength has
 * reached READER_KNOWN_STRENGTH. Split out so the Reader can show its text first and shade these words
 * once the five-table strength scan finishes, instead of waiting for it.
 */
export async function getStrengthKnownExpressions(expressions: string[]): Promise<Set<string>> {
  if (expressions.length === 0) return new Set();
  const items = await readRowsByKeys(getDb().vocabularyItems, 'expression', expressions);
  if (items.length === 0) return new Set();
  const { strengthByWord } = await loadWordReadingStrengths(READER_STRENGTH_CACHE_MS);
  return new Set(items.filter((item) => (strengthByWord.get(item.id) ?? 0) >= READER_KNOWN_STRENGTH).map((item) => item.expression));
}

/**
 * Reading/meaning vocabulary cards (subjectType `vocabularyItem`) — the
 * activity types that actually test recalling a word's reading or meaning,
 * as opposed to `pitch_accent` on the same subject, a different skill (see
 * getSentenceShadowingReadiness below). Mirrors ReviewPage's
 * VOCABULARY_ACTIVITY_TYPES; kept separate rather than imported since
 * repository.ts is the data layer and shouldn't depend on a page module.
 */
const VOCABULARY_RECALL_ACTIVITY_TYPES: StudyActivityType[] = [
  'reading_retrieval',
  'cloze',
  'reading_production',
];

/** Recognition only (see a word, recall its reading/meaning) — excludes `reading_production`, a separate "produce it" skill per the 2026-09-16 skill-graph discussion. Used by getSkillCoverage's "recognized" denominator. */
const RECOGNITION_ACTIVITY_TYPES: StudyActivityType[] = ['reading_retrieval', 'cloze'];

const PITCH_ACCENT_ACTIVITY_TYPES: StudyActivityType[] = ['pitch_accent'];

/**
 * Same query shape as getProficientVocabularyItemIds, scoped to a specific
 * activity-type set and FSRS-state predicate instead of "any activity type,
 * review/relearning" — lets a caller ask about reading/meaning progress and
 * pitch progress separately rather than blended.
 */
export async function filterVocabularyItemIdsByActivity(
  vocabularyItemIds: string[],
  activityTypes: readonly StudyActivityType[],
  isMatch: (state: FsrsState['state']) => boolean,
): Promise<Set<string>> {
  if (vocabularyItemIds.length === 0) return new Set();
  const db = getDb();
  const idSet = new Set(vocabularyItemIds);
  // A handful of ids reads just their rows through the subjectId index. Beyond that one read of the
  // vocabulary cards beats a lookup per id (each waits in IndexedDB's queue); cards are paused, so few exist.
  const candidates = idSet.size <= SMALL_TABLE_ANY_OF_LIMIT
    ? await db.studyItems.where('subjectId').anyOf([...idSet]).toArray()
    : await db.studyItems.where('subjectType').equals('vocabularyItem').toArray();
  return new Set(
    candidates
      .filter(
        (item) =>
          item.subjectType === 'vocabularyItem' &&
          idSet.has(item.subjectId) &&
          activityTypes.includes(item.activityType) &&
          isMatch(item.fsrsState.state),
      )
      .map((item) => item.subjectId),
  );
}

/**
 * The subset of `vocabularyItemIds` that have at least one reading/meaning
 * study item that's left FSRS's `new` state (isVocabularyItemIntroduced) —
 * i.e. actually been reviewed once, not just picked during vocabulary
 * confirmation. `pitch_accent` reps on the same subject don't count. Feeds
 * the i+1 known-lemma set (`loadKnownLemmaSet`).
 */
export async function getIntroducedReadingVocabularyItemIds(
  vocabularyItemIds: string[],
): Promise<Set<string>> {
  return filterVocabularyItemIdsByActivity(
    vocabularyItemIds,
    VOCABULARY_RECALL_ACTIVITY_TYPES,
    isVocabularyItemIntroduced,
  );
}

/**
 * The subset of `vocabularyItemIds` that have at least one reading/meaning
 * study item at FSRS proficiency (review/relearning) — `pitch_accent` reps
 * on the same subject don't count. This is what `word_listening`'s tier-1
 * gate and the `contrastive` (confusion pair) gate in ReviewPage already
 * document their `proficientVocabularyItemIds`/`GateContext` field as
 * meaning ("the word's reading proficiency"); before 2026-09-16 they got it
 * from the blended `getProficientVocabularyItemIds` instead, so a word with
 * only `pitch_accent` reps could satisfy a gate meant to test reading
 * recall. See getSentenceShadowingReadiness for the same split applied to
 * shadowing.
 */
export async function getProficientReadingVocabularyItemIds(
  vocabularyItemIds: string[],
): Promise<Set<string>> {
  return filterVocabularyItemIdsByActivity(
    vocabularyItemIds,
    VOCABULARY_RECALL_ACTIVITY_TYPES,
    isVocabularyItemProficient,
  );
}

/**
 * Recognition-only proficiency (`reading_retrieval`/`cloze`) — narrower
 * than getProficientReadingVocabularyItemIds, which also counts
 * `reading_production`. Feeds getSkillCoverage's "recognized" denominator,
 * where recognition and production are deliberately two different rungs,
 * not one blended "reading" bucket.
 */
export async function getProficientRecognitionVocabularyItemIds(
  vocabularyItemIds: string[],
): Promise<Set<string>> {
  return filterVocabularyItemIdsByActivity(
    vocabularyItemIds,
    RECOGNITION_ACTIVITY_TYPES,
    isVocabularyItemProficient,
  );
}

/**
 * Pitch-accent proficiency, exported standalone (the two gate functions
 * below compute this inline) for getSkillCoverage to reuse without
 * duplicating the query.
 */
export async function getProficientPitchAccentVocabularyItemIds(
  vocabularyItemIds: string[],
): Promise<Set<string>> {
  return filterVocabularyItemIdsByActivity(
    vocabularyItemIds,
    PITCH_ACCENT_ACTIVITY_TYPES,
    isVocabularyItemProficient,
  );
}


/**
 * The subset of `sentenceIds` the learner has actually met: walked through,
 * started in a book, or already carrying a card (`getIntroducedSentenceIds`,
 * the same rule as `ReviewPage` and the shadowing gate), so a pitch clip never
 * comes from a sentence that was only triaged, never seen.
 */
export async function filterToIntroducedSentenceIds(sentenceIds: string[]): Promise<Set<string>> {
  return getIntroducedSentenceIds([...new Set(sentenceIds)]);
}

/**
 * How many of one book's sentences the learner has met, for the book page's progress panel. Same rule as
 * `getIntroducedSentenceIds`, but every read is an index range scoped to this book (or the sentence-card
 * subject type) instead of a whole-table pass: the page's live query re-runs on every write, and on a phone
 * mid-sync the whole-table reads (events, memberships, every study item) never finished (2026-11-15 report).
 * Walkthrough events are matched by the book they were logged in, so a sentence reused in another book is
 * counted here only by its membership or card.
 */
export async function countIntroducedBookSentences(bookId: string): Promise<number> {
  const db = getDb();
  const [memberships, events, items] = await Promise.all([
    db.bookSentences.where('bookId').equals(bookId).toArray(),
    db.sentenceLearningEvents.where('bookId').equals(bookId).toArray(),
    db.studyItems.where('subjectType').equals('sentence').toArray(),
  ]);
  const inBook = new Set(memberships.map((membership) => membership.sentenceId));
  const introduced = new Set<string>();
  for (const membership of memberships) {
    if (membership.status !== 'unstarted') introduced.add(membership.sentenceId);
  }
  for (const event of withoutResetWalkthroughs(events)) {
    if (event.action === 'walkthrough_completed' && inBook.has(event.sentenceId)) introduced.add(event.sentenceId);
  }
  for (const item of items) {
    if (inBook.has(item.subjectId)) introduced.add(item.subjectId);
  }
  return introduced.size;
}

/**
 * Shadowing readiness: a sentence can be shadowed once the learner has met it
 * (walked through, started in a book, or already carrying a card), the same
 * rule as the review queue. There is no vocabulary or pitch-accent requirement:
 * shadowing is the main vehicle for pitch accent, not something gated behind it.
 */
export async function getSentenceShadowingReadiness(
  sentenceIds: string[],
): Promise<Map<string, boolean>> {
  if (sentenceIds.length === 0) return new Map();
  const introduced = await getIntroducedSentenceIds(sentenceIds);
  return new Map(sentenceIds.map((sentenceId) => [sentenceId, introduced.has(sentenceId)]));
}

export async function getIntroducedSentenceIds(sentenceIds: string[]): Promise<Set<string>> {
  const db = getDb();
  const wanted = new Set(sentenceIds);
  const [events, memberships, items] = await Promise.all([
    learningEventsForSentences(sentenceIds),
    bookSentencesForSentences(sentenceIds),
    sentenceIds.length > ANY_OF_SCAN_THRESHOLD
      ? readSentenceStudyItemsForPass()
      : db.studyItems.where('subjectType').equals('sentence').toArray(),
  ]);
  return new Set([
    ...events.filter((event) => event.action === 'walkthrough_completed').map((event) => event.sentenceId),
    ...memberships.filter((membership) => membership.status !== 'unstarted').map((membership) => membership.sentenceId),
    ...items.filter((item) => wanted.has(item.subjectId)).map((item) => item.subjectId),
  ]);
}

/**
 * "Ready to read" coverage (docs/ROADMAP.md) — per-book known-vocabulary
 * ratio, for `BooksPage` to show "which of these is easiest to pick up
 * right now." Reuses the same `getReviewableVocabularyItemIdsBySentence` /
 * `getProficientVocabularyItemIds` primitives `getSentenceFullReviewReadiness`
 * is built from, batched once across every book rather than per-book, so
 * this stays one pass regardless of library size.
 */
export async function getBookVocabularyCoverage(): Promise<Map<string, BookCoverage>> {
  const db = getDb();
  const [books, bookSentences] = await Promise.all([
    db.books.toArray(),
    traceStep('coverage: bookSentences.toArray', () => readAllBookSentencesForPass(), rowCount),
  ]);
  const sentenceIdsByBook = new Map<string, string[]>();
  for (const membership of bookSentences) {
    const arr = sentenceIdsByBook.get(membership.bookId);
    if (arr) arr.push(membership.sentenceId);
    else sentenceIdsByBook.set(membership.bookId, [membership.sentenceId]);
  }
  const allSentenceIds = [...new Set(bookSentences.map((m) => m.sentenceId))];
  const vocabularyItemIdsBySentence = await traceStep('coverage: getReviewableVocabularyItemIdsBySentence', () =>
    getReviewableVocabularyItemIdsBySentence(allSentenceIds),
  );
  const allVocabularyItemIds = [
    ...new Set([...vocabularyItemIdsBySentence.values()].flat()),
  ];
  const proficientVocabularyItemIds = await traceStep('coverage: getProficientVocabularyItemIds', () =>
    getProficientVocabularyItemIds(allVocabularyItemIds),
  );
  const coverage = buildBookCoverage(
    books.map((book) => ({
      bookId: book.id,
      sentenceIds: sentenceIdsByBook.get(book.id) ?? [],
    })),
    vocabularyItemIdsBySentence,
    proficientVocabularyItemIds,
  );
  return new Map(coverage.map((entry) => [entry.bookId, entry]));
}

/**
 * Grammar-pattern rollup for a book's progress section — mirrors
 * getBookVocabularyCoverage's chain but for grammarPattern subjects:
 * bookSentences -> sentenceGrammar (indexed on sentenceId) -> distinct
 * grammarPatternIds -> their grammarPattern-subject study items ->
 * graduation (computeGraduatedSubjectIds, same "every study item crossed
 * the threshold" rule listGrammarPatternSummaries uses for its own
 * `graduated` field). Grammar patterns are deliberately book-agnostic
 * (src/lib/suspendedBooks.ts), so "encountered" here means "tagged on a
 * sentence that happens to be in this book," not "owned by" it — the same
 * pattern can show up in several books' rollups.
 */
export async function getBookGrammarProgress(bookId: string): Promise<{
  encountered: number;
  tracked: number;
  graduated: number;
}> {
  const db = getDb();
  const sentenceIds = (
    await db.bookSentences.where('bookId').equals(bookId).toArray()
  ).map((item) => item.sentenceId);
  if (sentenceIds.length === 0) return { encountered: 0, tracked: 0, graduated: 0 };

  const links = await db.sentenceGrammar.where('sentenceId').anyOf(sentenceIds).toArray();
  const patternIds = new Set(links.map((link) => link.grammarPatternId));
  if (patternIds.size === 0) return { encountered: 0, tracked: 0, graduated: 0 };

  const [studyItems, settings] = await Promise.all([
    db.studyItems
      .where('subjectType')
      .equals('grammarPattern')
      .filter((item) => patternIds.has(item.subjectId))
      .toArray(),
    readSettings(db),
  ]);
  const trackedPatternIds = new Set(studyItems.map((item) => item.subjectId));
  const graduatedPatternIds = computeGraduatedSubjectIds(
    studyItems,
    settings.graduationMinScheduledDays,
  );
  return {
    encountered: patternIds.size,
    tracked: trackedPatternIds.size,
    graduated: [...graduatedPatternIds].filter((id) => patternIds.has(id)).length,
  };
}


/**
 * Full-sentence review readiness (Phase 7.11) for each of `sentenceIds` —
 * shared by deferUnreadySentenceReviews (existing due items) and
 * ReviewPage's pending-seed filtering (items that don't exist yet), so a
 * sentence's readiness is computed the same way whichever path checks it.
 */
export async function getSentenceFullReviewReadiness(
  sentenceIds: string[],
): Promise<Map<string, boolean>> {
  const readiness = new Map<string, boolean>();
  if (sentenceIds.length === 0) return readiness;
  const db = getDb();
  const vocabularyItemIdsBySentence = await getReviewableVocabularyItemIdsBySentence(sentenceIds);
  const allVocabularyItemIds = [...new Set([...vocabularyItemIdsBySentence.values()].flat())];
  const proficientVocabularyItemIds = await getProficientVocabularyItemIds(allVocabularyItemIds);
  const analysesBySentenceId = new Map(
    (await db.analyses.bulkGet(sentenceIds))
      .filter((item): item is SentenceAnalysis => Boolean(item))
      .map((item) => [item.sentenceId, item]),
  );
  for (const sentenceId of sentenceIds) {
    const vocabularyItemIds = vocabularyItemIdsBySentence.get(sentenceId) ?? [];
    const analysis = analysesBySentenceId.get(sentenceId);
    // A confirmed sentence whose analysis recorded real vocabulary
    // selections but whose sentence_vocabulary links haven't resolved
    // locally (a cross-entity sync-pull ordering gap between `analyses` and
    // `sentence_vocabulary`, or a confirm that hasn't finished
    // materializing) must not fall through isSentenceVocabularyReady's
    // "nothing to gate on" vacuous-true case — that would pass a sentence
    // whose vocabulary the learner has literally never seen (card issue
    // report, 2026-09-23: 台風25号 surfaced reading_in_context with all six
    // linked words at zero reps). Only a sentence with genuinely no
    // confirmed selections gets the vacuous pass.
    const selectionsExpected = (analysis?.vocabularySelections?.length ?? 0) > 0;
    const ready =
      vocabularyItemIds.length === 0 && selectionsExpected
        ? false
        : isSentenceReadyForFullReview(
            analysis?.vocabularyReviewStatus,
            vocabularyItemIds,
            proficientVocabularyItemIds,
          );
    readiness.set(sentenceId, ready);
  }
  return readiness;
}

/**
 * Per-sentence mastery arc (docs/ROADMAP.md "Per-sentence mastery arc") —
 * the only fetching for `src/lib/masteryArc.ts#buildSentenceMasteryArc`.
 * One batched pass over every table each rung needs, reusing the same
 * proficiency primitives the rest of the app's gates already use
 * (`getProficientReadingVocabularyItemIds`, `getProficientPitchAccentVocabularyItemIds`,
 * `MATURE_MIN_SCHEDULED_DAYS`) rather than a new proficiency concept.
 * `word_listening`/`sentence_transformation` study items are keyed by
 * `subjectType: 'sentenceVocabulary'`, `subjectId: link.id` — the same
 * shape ReviewPage's own candidate-building already relies on.
 */
export async function getSentenceMasteryArcs(
  sentenceIds: string[],
): Promise<Map<string, SentenceMasteryArc>> {
  const result = new Map<string, SentenceMasteryArc>();
  if (sentenceIds.length === 0) return result;
  const db = getDb();

  const [analyses, allLinks, audioRows, grammarLinks, attemptCounts] = await Promise.all([
    db.analyses.bulkGet(sentenceIds),
    db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.sentenceGrammar.where('sentenceId').anyOf(sentenceIds).toArray(),
    countAttemptsForSentences(sentenceIds),
  ]);

  const analysisBySentenceId = new Map(
    analyses.filter((item): item is SentenceAnalysis => Boolean(item)).map((item) => [item.sentenceId, item]),
  );
  const audioSentenceIds = new Set(audioRows.map((row) => row.sentenceId));

  const links = allLinks.filter((link) => !!link.surfaceForm);
  const linksBySentence = new Map<string, SentenceVocabulary[]>();
  for (const link of links) {
    const arr = linksBySentence.get(link.sentenceId);
    if (arr) arr.push(link);
    else linksBySentence.set(link.sentenceId, [link]);
  }
  const allVocabularyItemIds = [...new Set(links.map((link) => link.vocabularyItemId))];
  const allLinkIds = new Set(links.map((link) => link.id));

  const grammarPatternIdsBySentence = new Map<string, string[]>();
  for (const link of grammarLinks) {
    const arr = grammarPatternIdsBySentence.get(link.sentenceId);
    if (arr) arr.push(link.grammarPatternId);
    else grammarPatternIdsBySentence.set(link.sentenceId, [link.grammarPatternId]);
  }
  const allGrammarPatternIds = new Set(grammarLinks.map((link) => link.grammarPatternId));

  const [
    readingProficientIds,
    pitchProficientIds,
    vocabularyItems,
    wordListeningItems,
    conjugationItems,
    grammarPatternItems,
    contextItems,
  ] = await Promise.all([
    getProficientReadingVocabularyItemIds(allVocabularyItemIds),
    getProficientPitchAccentVocabularyItemIds(allVocabularyItemIds),
    db.vocabularyItems.bulkGet(allVocabularyItemIds),
    allLinkIds.size
      ? db.studyItems
          .where('activityType')
          .equals('word_listening')
          .filter((item) => item.subjectType === 'sentenceVocabulary' && allLinkIds.has(item.subjectId))
          .toArray()
      : Promise.resolve([]),
    allLinkIds.size
      ? db.studyItems
          .where('activityType')
          .equals('sentence_transformation')
          .filter((item) => item.subjectType === 'sentenceVocabulary' && allLinkIds.has(item.subjectId))
          .toArray()
      : Promise.resolve([]),
    allGrammarPatternIds.size
      ? db.studyItems
          .where('activityType')
          .equals('grammar_recognition')
          .filter((item) => item.subjectType === 'grammarPattern' && allGrammarPatternIds.has(item.subjectId))
          .toArray()
      : Promise.resolve([]),
    db.studyItems
      .where('activityType')
      .equals('reading_in_context')
      .filter((item) => item.subjectType === 'sentence')
      .toArray(),
  ]);

  const pitchEligibleVocabularyItemIds = new Set(
    vocabularyItems
      .filter((item): item is VocabularyItem => Boolean(item?.pitchAccentPositions?.length))
      .map((item) => item.id),
  );
  const isProficient = (item: StudyItem) => isVocabularyItemProficient(item.fsrsState.state);
  const isMature = (item: StudyItem) =>
    item.fsrsState.state === 'review' && item.fsrsState.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS;

  const wordListeningByLink = new Map(wordListeningItems.map((item) => [item.subjectId, item]));
  const conjugationByLink = new Map(conjugationItems.map((item) => [item.subjectId, item]));
  const grammarItemsByPattern = new Map<string, StudyItem[]>();
  for (const item of grammarPatternItems) {
    const arr = grammarItemsByPattern.get(item.subjectId);
    if (arr) arr.push(item);
    else grammarItemsByPattern.set(item.subjectId, [item]);
  }
  const contextItemBySentence = new Map(contextItems.map((item) => [item.subjectId, item]));

  for (const sentenceId of sentenceIds) {
    const sentenceLinks = linksBySentence.get(sentenceId) ?? [];
    const vocabularyItemIds = [...new Set(sentenceLinks.map((link) => link.vocabularyItemId))];
    const hasVocabulary = vocabularyItemIds.length > 0;
    const hasAudio = audioSentenceIds.has(sentenceId);

    const vocabConfirmed: MasteryRungStatus =
      analysisBySentenceId.get(sentenceId)?.vocabularyReviewStatus === 'confirmed';

    const readingProficient: MasteryRungStatus = !hasVocabulary
      ? null
      : vocabularyItemIds.every((id) => readingProficientIds.has(id));

    const listeningLinks = hasAudio ? sentenceLinks : [];
    const listeningProficient: MasteryRungStatus =
      !hasAudio || listeningLinks.length === 0
        ? null
        : listeningLinks.every((link) => {
            const item = wordListeningByLink.get(link.id);
            return !!item && isProficient(item);
          });

    const conjugationLinks = sentenceLinks.filter((link) => conjugationByLink.has(link.id));
    const conjugationsProficient: MasteryRungStatus =
      conjugationLinks.length === 0
        ? null
        : conjugationLinks.every((link) => isProficient(conjugationByLink.get(link.id)!));

    const sentenceGrammarPatternIds = grammarPatternIdsBySentence.get(sentenceId) ?? [];
    const grammarRecognized: MasteryRungStatus =
      sentenceGrammarPatternIds.length === 0
        ? null
        : sentenceGrammarPatternIds.every((patternId) =>
            (grammarItemsByPattern.get(patternId) ?? []).some(isProficient),
          );

    const contextItem = contextItemBySentence.get(sentenceId);
    const contextMature: MasteryRungStatus = contextItem ? isMature(contextItem) : null;

    const shadowed: MasteryRungStatus = !hasAudio ? null : (attemptCounts.get(sentenceId) ?? 0) > 0;

    const pitchEligibleIds = vocabularyItemIds.filter((id) => pitchEligibleVocabularyItemIds.has(id));
    const pitchProficient: MasteryRungStatus =
      pitchEligibleIds.length === 0 ? null : pitchEligibleIds.every((id) => pitchProficientIds.has(id));

    result.set(
      sentenceId,
      buildSentenceMasteryArc(sentenceId, {
        vocabConfirmed,
        readingProficient,
        listeningProficient,
        conjugationsProficient,
        grammarRecognized,
        contextMature,
        shadowed,
        pitchProficient,
      }),
    );
  }

  return result;
}

export interface SentenceMasteryOverviewRow {
  arc: SentenceMasteryArc;
  japanese: string;
  /** First book this sentence belongs to, for a "jump in" link — undefined if it's in none. */
  bookId?: string;
}

export interface SentenceMasteryOverview {
  /** Confirmed sentences with at least one rung climbed and at least one still to go, furthest-along first. */
  rows: SentenceMasteryOverviewRow[];
  /** Distinct confirmed sentences considered (whether or not they made the ranked list). */
  confirmedCount: number;
  /** Of those, how many have every applicable rung cleared already. */
  completeCount: number;
}

/**
 * `/progress`'s "Sentence mastery" panel: every confirmed sentence's arc,
 * ranked to surface the "one rung left" cases first
 * (`rankSentenceMasteryArcs`). Scans every confirmed sentence in one pass —
 * same full-corpus-scan convention as `getBlindSpots`/`getStuckSentenceSnapshot`,
 * fine at this corpus's size.
 */
export async function getSentenceMasteryOverview(limit = 20): Promise<SentenceMasteryOverview> {
  const db = getDb();
  const analyses = await db.analyses.toArray();
  const confirmedSentenceIds = analyses
    .filter((analysis) => analysis.vocabularyReviewStatus === 'confirmed')
    .map((analysis) => analysis.sentenceId);
  if (confirmedSentenceIds.length === 0) {
    return { rows: [], confirmedCount: 0, completeCount: 0 };
  }
  const arcsById = await getSentenceMasteryArcs(confirmedSentenceIds);
  const arcs = [...arcsById.values()];
  const completeCount = arcs.filter((arc) => arc.complete).length;
  const ranked = rankSentenceMasteryArcs(arcs, limit);

  const rankedSentenceIds = ranked.map((arc) => arc.sentenceId);
  const [sentences, memberships] = await Promise.all([
    db.sentences.bulkGet(rankedSentenceIds),
    db.bookSentences.where('sentenceId').anyOf(rankedSentenceIds).toArray(),
  ]);
  const sentenceById = new Map(
    sentences.filter((s): s is Sentence => Boolean(s)).map((s) => [s.id, s]),
  );
  const bookIdBySentenceId = new Map<string, string>();
  for (const membership of memberships) {
    if (!bookIdBySentenceId.has(membership.sentenceId)) {
      bookIdBySentenceId.set(membership.sentenceId, membership.bookId);
    }
  }

  return {
    rows: ranked.map((arc) => ({
      arc,
      japanese: sentenceById.get(arc.sentenceId)?.japanese ?? '',
      bookId: bookIdBySentenceId.get(arc.sentenceId),
    })),
    confirmedCount: arcs.length,
    completeCount,
  };
}

export interface SentenceDeepDiveInfo {
  sentence: Sentence;
  arc: SentenceMasteryArc;
  /** First book this sentence belongs to — for the confirm-vocab/shadow links, same convention as SentenceMasteryOverviewRow. */
  bookId?: string;
}

/**
 * `SentenceDeepDivePage` — one sentence's arc plus enough to link out to its
 * non-review rungs (`vocabConfirmed`, `shadowed`) and open a `/review`
 * session scoped to just this sentence for the reviewable ones. `undefined`
 * when the sentence doesn't exist (soft-deleted, bad id).
 */
export async function getSentenceDeepDiveInfo(sentenceId: string): Promise<SentenceDeepDiveInfo | undefined> {
  const db = getDb();
  const sentence = await db.sentences.get(sentenceId);
  if (!sentence) return undefined;
  const [arcsById, membership] = await Promise.all([
    getSentenceMasteryArcs([sentenceId]),
    db.bookSentences.where('sentenceId').equals(sentenceId).first(),
  ]);
  const arc = arcsById.get(sentenceId) ?? buildSentenceMasteryArc(sentenceId, {});
  return { sentence, arc, bookId: membership?.bookId };
}

/**
 * Full-sentence review gating (user request, 2026-08-16): pushes any
 * currently-due `sentence`-subject study item (among `activityTypes`, e.g.
 * `SENTENCE_ACTIVITY_TYPES`) that isn't ready yet (see
 * getSentenceFullReviewReadiness above) out to at least `minDeferDays` from
 * `now`. Called both as an ongoing gate (ReviewPage runs this before every
 * queue build, so an *already-existing* sentence card never surfaces
 * before its vocabulary does — items that don't exist yet are handled
 * separately, by filtering ReviewPage's pending-seed pool through the same
 * readiness check, since a brand-new lazily-seeded item would otherwise
 * bypass this function entirely) and as a one-time reset over whatever's
 * currently due. Never pulls a due date earlier — only ever pushes an
 * unready item further out.
 */
export async function deferUnreadySentenceReviews(
  activityTypes: StudyActivityType[],
  options: { now?: Date; minDeferDays?: number } = {},
): Promise<{ deferred: number; checked: number }> {
  const db = getDb();
  const now = options.now ?? new Date();
  const nowIsoValue = now.toISOString();
  const minDeferDays = options.minDeferDays ?? 7;

  const dueSentenceItems = (
    await db.studyItems.where('activityType').anyOf(activityTypes).toArray()
  ).filter((item) => item.subjectType === 'sentence' && item.fsrsState.due <= nowIsoValue);
  if (dueSentenceItems.length === 0) return { deferred: 0, checked: 0 };

  const sentenceIds = [...new Set(dueSentenceItems.map((item) => item.subjectId))];
  const readiness = await getSentenceFullReviewReadiness(sentenceIds);

  const minDueIso = new Date(now.getTime() + minDeferDays * 24 * 60 * 60 * 1000).toISOString();
  const updates: StudyItem[] = [];
  for (const item of dueSentenceItems) {
    if (readiness.get(item.subjectId)) continue;
    if (item.fsrsState.due >= minDueIso) continue;
    updates.push({
      ...item,
      fsrsState: { ...item.fsrsState, due: minDueIso },
      updatedAt: nowIsoValue,
    });
  }
  if (updates.length > 0) {
    await db.studyItems.bulkPut(updates);
    notifySyncMany(
      updates.map((item) => ({ entity: 'study_items' as const, recordId: item.id, payload: item })),
    );
  }
  return { deferred: updates.length, checked: dueSentenceItems.length };
}

/**
 * Passage analogue of deferUnreadySentenceReviews (user request,
 * 2026-09-03): a `reading_in_context` card embeds its target sentence in
 * its reading-order neighbours (buildReadingContextMap — 2 before, 1
 * after). deferUnreadySentenceReviews already defers it on its *own*
 * target sentence's readiness; this additionally defers any currently-due
 * `reading_in_context` item whose surrounding passage contains a sentence
 * that isn't itself full-review-ready (vocab confirmed AND every
 * surface-form vocab item FSRS-proficient), so the learner never reads a
 * passage full of words they haven't confirmed yet. Context is resolved
 * globally (every book, each sentence's most-recently-opened home book),
 * the same way ReviewPage's global-scope queue builds it; a book-scoped
 * session may resolve a slightly different passage, but this only ever
 * pushes a due date later and self-heals after `minDeferDays`. Like the
 * other defer passes it never pulls a due date earlier and is idempotent.
 */
export async function deferUnreadyReadingInContextReviews(
  options: { now?: Date; minDeferDays?: number } = {},
): Promise<{ deferred: number; checked: number }> {
  const db = getDb();
  const now = options.now ?? new Date();
  const nowIsoValue = now.toISOString();
  const minDeferDays = options.minDeferDays ?? 7;

  const dueItems = (
    await db.studyItems.where('activityType').equals('reading_in_context').toArray()
  ).filter((item) => item.subjectType === 'sentence' && item.fsrsState.due <= nowIsoValue);
  if (dueItems.length === 0) return { deferred: 0, checked: 0 };

  const targetSentenceIds = [...new Set(dueItems.map((item) => item.subjectId))];
  const allSentences = await db.sentences.toArray();
  const sentencesById = new Map(allSentences.map((sentence) => [sentence.id, sentence]));
  const contextMap = buildReadingContextMap({
    targetSentenceIds,
    bookSentences: await db.bookSentences.toArray(),
    books: await db.books.toArray(),
    sentencesById,
  });

  // Readiness for every target sentence plus every sentence that appears in
  // one of their passages.
  const relevantSentenceIds = new Set(targetSentenceIds);
  for (const context of contextMap.values()) {
    for (const neighbour of [...context.before, ...context.after]) {
      relevantSentenceIds.add(neighbour.id);
    }
  }
  const readiness = await getSentenceFullReviewReadiness([...relevantSentenceIds]);

  const passageReady = (targetSentenceId: string): boolean => {
    if (!readiness.get(targetSentenceId)) return false;
    const context = contextMap.get(targetSentenceId);
    if (!context) return true;
    return [...context.before, ...context.after].every(
      (neighbour) => readiness.get(neighbour.id) !== false,
    );
  };

  const minDueIso = new Date(now.getTime() + minDeferDays * 24 * 60 * 60 * 1000).toISOString();
  const updates: StudyItem[] = [];
  for (const item of dueItems) {
    if (passageReady(item.subjectId)) continue;
    if (item.fsrsState.due >= minDueIso) continue;
    updates.push({
      ...item,
      fsrsState: { ...item.fsrsState, due: minDueIso },
      updatedAt: nowIsoValue,
    });
  }
  if (updates.length > 0) {
    await db.studyItems.bulkPut(updates);
    notifySyncMany(
      updates.map((item) => ({ entity: 'study_items' as const, recordId: item.id, payload: item })),
    );
  }
  return { deferred: updates.length, checked: dueItems.length };
}

/**
 * Grammar analogue of deferUnreadySentenceReviews (user request,
 * 2026-09-02): a `grammarPattern`-subject `grammar_completion` study item
 * can't render a card unless pickContextSentenceForGrammarPattern finds a
 * linked sentence at all (2026-09-15: no longer gated on that sentence's
 * *other* vocabulary being proficient too — see the "same gate as
 * vocabulary" note on pickContextSentenceForGrammarPattern). This mostly
 * only matters for the edge case of a pattern whose last live
 * `sentence_grammar` link was removed (see removeSentenceGrammar /
 * cascadeRetireSentenceLocal) while its study item lingers — such an item
 * would otherwise read as permanently due: invisible in /review but
 * inflating the session planner's review backlog. This pushes any
 * currently-due grammar item whose pattern has no linked sentence at all
 * out to at least `minDeferDays` from `now`. Like
 * deferUnreadySentenceReviews it only ever pushes a due date later, never
 * earlier, and is idempotent once an item has been deferred.
 */
export async function deferUnreadyGrammarReviews(
  options: { now?: Date; minDeferDays?: number } = {},
): Promise<{ deferred: number; checked: number }> {
  const db = getDb();
  const now = options.now ?? new Date();
  const nowIsoValue = now.toISOString();
  const minDeferDays = options.minDeferDays ?? 7;

  const dueGrammarItems = (
    await db.studyItems.where('subjectType').equals('grammarPattern').toArray()
  ).filter((item) => item.fsrsState.due <= nowIsoValue);
  if (dueGrammarItems.length === 0) return { deferred: 0, checked: 0 };

  const patternIds = [...new Set(dueGrammarItems.map((item) => item.subjectId))];
  const readyPatternIds = new Set<string>();
  await Promise.all(
    patternIds.map(async (patternId) => {
      if (await pickContextSentenceForGrammarPattern(patternId)) readyPatternIds.add(patternId);
    }),
  );

  const minDueIso = new Date(now.getTime() + minDeferDays * 24 * 60 * 60 * 1000).toISOString();
  const updates: StudyItem[] = [];
  for (const item of dueGrammarItems) {
    if (readyPatternIds.has(item.subjectId)) continue;
    if (item.fsrsState.due >= minDueIso) continue;
    updates.push({
      ...item,
      fsrsState: { ...item.fsrsState, due: minDueIso },
      updatedAt: nowIsoValue,
    });
  }
  if (updates.length > 0) {
    await db.studyItems.bulkPut(updates);
    notifySyncMany(
      updates.map((item) => ({ entity: 'study_items' as const, recordId: item.id, payload: item })),
    );
  }
  return { deferred: updates.length, checked: dueGrammarItems.length };
}

export async function recordReview(input: {
  studyItemId: string;
  rating: ReviewRating;
  now?: Date;
  responseRaw?: string;
  expectedAnswer?: string;
  elapsedMs?: number;
  errorClassification?: ErrorClassification;
  assistance?: ReviewAssistance[];
  /** Absent means `scheduled_review` (Phase 7.8, docs brief §9/§16). */
  source?: ReviewSource;
  contextSentenceId?: string;
  /** `pitch_accent` card only — see `Review.pitchExpectedShape`/`pitchChosenShape`. */
  pitchExpectedShape?: string;
  pitchChosenShape?: string;
  /** `reading_in_context` card only — see `Review.comprehensionCheckCorrect`/`comprehensionCheckChosenIndex`. */
  comprehensionCheckCorrect?: boolean;
  comprehensionCheckChosenIndex?: number;
  /** `reading_in_context` card only — the choices as displayed plus the picked one, see `Review.meaningChoice`. */
  meaningChoice?: MeaningChoiceRecord;
  /** `reading_in_context` card only — see `Review.missedReadings`. */
  missedReadings?: string[];
  /** `pitch_accent_production` card only — see `Review.pitchProductionMeasuredCount`/`pitchProductionMismatchCount`. */
  pitchProductionMeasuredCount?: number;
  pitchProductionMismatchCount?: number;
  /** How the card was presented; informational only, never affects scheduling. */
  presentation?: ReviewPresentation;
}): Promise<{ review: Review; studyItem: StudyItem }> {
  const db = getDb();
  const studyItem = await db.studyItems.get(input.studyItemId);
  if (!studyItem) throw new Error('Study item not found');
  const now = input.now ?? new Date();
  const predictedRetrievability =
    studyItem.fsrsState.state !== 'new' && studyItem.fsrsState.lastReview
      ? predictRetrievability(studyItem.fsrsState, now)
      : undefined;
  const { fsrsState } = scheduleReview(studyItem.fsrsState, input.rating, now);
  const updatedStudyItem: StudyItem = {
    ...studyItem,
    fsrsState,
    updatedAt: now.toISOString(),
  };
  const review: Review = {
    id: createId('review'),
    studyItemId: studyItem.id,
    timestamp: now.toISOString(),
    rating: input.rating,
    responseRaw: input.responseRaw,
    expectedAnswer: input.expectedAnswer,
    elapsedMs: input.elapsedMs,
    errorClassification:
      input.errorClassification ??
      classifyReviewError({
        subjectType: studyItem.subjectType,
        activityType: studyItem.activityType,
        rating: input.rating,
        responseRaw: input.responseRaw,
        expectedAnswer: input.expectedAnswer,
        comprehensionCheckCorrect: input.comprehensionCheckCorrect,
      }),
    assistance: input.assistance,
    source: input.source,
    contextSentenceId: input.contextSentenceId,
    pitchExpectedShape: input.pitchExpectedShape,
    pitchChosenShape: input.pitchChosenShape,
    predictedRetrievability,
    comprehensionCheckCorrect: input.comprehensionCheckCorrect,
    comprehensionCheckChosenIndex: input.comprehensionCheckChosenIndex,
    meaningChoice: input.meaningChoice,
    missedReadings: input.missedReadings?.length ? input.missedReadings : undefined,
    pitchProductionMeasuredCount: input.pitchProductionMeasuredCount,
    pitchProductionMismatchCount: input.pitchProductionMismatchCount,
    presentation: input.presentation,
  };
  await db.transaction('rw', db.studyItems, db.reviews, async () => {
    await db.studyItems.put(updatedStudyItem);
    await db.reviews.put(review);
  });
  notifySyncMany([
    {
      entity: 'study_items',
      recordId: updatedStudyItem.id,
      payload: updatedStudyItem,
    },
    { entity: 'reviews', recordId: review.id, payload: review },
  ]);
  if (studyItem.subjectType === 'sentence' && studyItem.activityType === 'reading_in_context') {
    await latchSequentialUnlocksForSentence(studyItem.subjectId).catch(() => undefined);
  }
  return { review, studyItem: updatedStudyItem };
}
