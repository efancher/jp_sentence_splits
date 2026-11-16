
import { openContentReports, type OpenContentReport } from '../lib/contentReports';
import { surfaceReadingFromInline } from '../lib/readingAnswer';
import { MEANING_CHECK_KEY_PREFIX, strugglingWordIds } from '../lib/wordEvidence';
import { findSetExpressions } from '../lib/setExpressions';
import { chapterIdsByEpisodeNumber } from '../lib/chapterEpisodeOrder';
import { grammarPatternStrengths } from '../lib/grammarEvidence';
import { pickAnotherExample, type ExampleParts } from '../lib/grammarExamples';
import {
  evidenceLevel,
  type EvidenceLevel,
  planWeakWordSentences,
  READER_KNOWN_STRENGTH,
} from '../lib/wordStrength';
import { readCheckReason, sentencesDueForReadCheck } from '../lib/readCheck';
import { withoutResetWalkthroughs } from '../lib/sentenceLearning';
import {
  expandToPhrase,
  weakestChunkRange,
  isPhraseRange,
  orderLinksByWeakness,
  orderSuggestedSurfaces,
  phraseShadowTargetKey,
  dropLeadingParticles,
  snapRangeToWordBoundaries,
  phraseTextFromAlignment,
  wordIdsInPhrase,
  type PhraseShadowOutcome,
} from '../lib/phraseShadow';
import { CHAIN_COLD_KEY, chainRungTargetKey } from '../lib/chunkChainSession';
import { explainWeakWordSentences, type WeakWordExplanation } from '../lib/weakWordExplain';
import { buildSentenceLessonReport, type SentenceLessonReport } from '../lib/sentenceLessonReport';
import { parkedSentenceIds } from '../lib/glossSkill';
import { getMeaningBank } from '../lib/meaningChoices';
import {
  computeSequentialStatus,
  type SequentialBookStatus,
  type SequentialSentenceStatus,
} from '../lib/sequentialStudy';
import { buildGrammarDetector, buildReferenceIndex, curatedGrammarByPattern, wordSpansForDetection } from '../lib/grammarReference';
import { grammarLevelCosts, knownGrammarEntries, orderByIPlusOne, type IPlusOneItem } from '../lib/iPlusOne';
import {
  isIPlusOneOrdering,
  iPlusOneStretchEvery,
  isSequentialStudyMode,
} from '../lib/sentenceLed';
import { buildKnownLemmaSet, lemmaKey, partlyMetLemmas, unknownLemmasForSentence, WORD_MIN_EXPOSURES } from '../lib/unknownLemmas';
import { sessionStepCategory } from '../lib/sessionStepCategory';
import { sentencesDueForFreshTry } from '../lib/sentenceJourney';
import { buildEpisodeProgress, type EpisodeProgressRow } from '../lib/episodeProgress';
import { chunksMatchSource } from '../lib/chunking';
import { buildEpisodeFocus, type EpisodeFocus } from '../lib/episodeFocus';
import { parseEpisodePackReply, type PackReplyResult } from '../lib/episodePack';
import { sentencesNeedingWalkthrough } from '../lib/contextWalkthrough';
import { constructionChecked } from '../lib/phraseConstruction';
import {
  type PreparationContext,
  parsePreparationReply,
} from '../lib/episodePreparation';
import type { ReviewDocument } from '../lib/reviewDocument';
import type { BackupPayload } from '../domain/schemas';
import type {
  AlignmentResult,
  SourceReference,
  ConstructionLayer,
  ContextWalkthrough,
  ReviewTroubleLog,
  ReviewTroubleTag,
  SentenceLearningEvent,
  ClauseQuestionFeedback,
  GlossDecision,
  AppSettings,
  Book,
  BookChapter,
  BookSentence,
  MeaningChoiceRecord,
  ErrorClassification,
  FsrsState,
  GrammarPattern,
  GrammarRelationship,
  GrammarRelationshipType,
  ImportBatch,
  PitchDrillAttempt,
  PlannerSession,
  PlannerSessionStep,
  PlannerStepStatus,
  Review,
  ReviewPresentation,
  ReviewAssistance,
  ReviewRating,
  ReviewSource,
  Sentence,
  SentenceAudio,
  SentenceExtras,
  SentenceAnalysis,
  SentenceGrammar,
  SentenceVocabulary,
  SessionBucket,
  StudyActivityType,
  StudyItem,
  StudyStatus,
  StudySubjectType,
  VocabularyConfusion,
  VocabularyConfusionType,
  VocabularyItem,
  VocabularySuggestion,
  EpisodePreparation,
  PreparedTarget,
  PreparedTargetDecision,
  StructureDraftChunk,
} from '../domain/types';
import { ALIGNMENT_VERSION } from '../lib/analysisApi';
import { ANALYSIS_SUMMARY_VERSION } from '../lib/pronunciationHistory';
import {
  buildPronunciationProfile,
  buildShadowingWeakWords,
  type PronunciationProfile,
  type ShadowingWeakWord,
} from '../lib/pronunciationProfile';
import { buildProgressReport, type ProgressReport } from '../lib/progressReport';
import { buildBlindSpots, vocabularyKey, type BlindSpots } from '../lib/blindSpots';
import { buildBookCoverage, type BookCoverage } from '../lib/bookCoverage';
import { buildErrorMix, classificationKey, type ErrorMix } from '../lib/errorMix';
import { buildLeechList, type LeechListReport } from '../lib/leechList';
import {
  buildSentenceMasteryArc,
  rankSentenceMasteryArcs,
  type MasteryRungStatus,
  type SentenceMasteryArc,
} from '../lib/masteryArc';
import { buildSessionRecap, type SessionRecap } from '../lib/sessionRecap';
import {
  buildMinimalPairTrials,
  findMinimalPairContrasts,
  type MinimalPairOccurrence,
  type MinimalPairTrial,
} from '../lib/pitchAccentMinimalPairs';
import type { PitchAccentTarget } from '../lib/pitchAccentObservations';
import {
  trailingBunsetsuParticles,
  type SentencePitchAccentTarget,
} from '../lib/sentencePitchAccent';
import { kanjiumTargetsForSuggestions } from '../lib/kanjiumPitchLookup';
import { loadKanjiumPitchLookup } from '../lib/kanjiumPitchLoader';
import { resolveInflectedPitchAccent } from '../lib/pitchAccentShift';
import {
  mergeSentenceOnReimport,
  type ImportPreview,
} from '../lib/sentenceImport';
import {
  computeGrammarLearnerState,
  computeGrammarPriorityBucket,
  explainGrammarPriority,
  normalizeGrammarPatternKey,
  type GrammarLearnerState,
  type GrammarPriorityBucket,
} from '../lib/grammarPatterns';
import { isPatternListed, isUnreviewedAiLink, visibleGrammarLinks } from '../lib/grammarLinkVisibility';
import {
  canonicalSourceId,
  createId,
  hashString,
  sentenceIdFromNormalizedKey,
} from '../lib/ids';
import { MATURE_MIN_SCHEDULED_DAYS } from '../lib/maturity';
import { inlineReadingFromTokens } from '../lib/inlineReadingFromTokens';
import { nowIso, normalizeSentenceKey } from '../lib/normalize';
import { buildReadingContextMap, type ReadingContext } from '../lib/readingContext';
import {
  isBookInStudyRotation,
  membershipIsShelved,
  sentenceIsSuspendedOnly,
  studyItemIsHeldBackBySuspension,
  type SuspendedBookIndex,
} from '../lib/suspendedBooks';
import { startOfLocalDayIso } from '../lib/dailyPractice';
import { isolatedWordSpans, type IsolatedWordSpans } from '../lib/isolatedWordRange';
import type { TimeRangeMs } from '../lib/recording';
import { inWordShape, isPlausibleClipSpan, type PitchWordClip } from '../lib/pitchWordClip';
import type { TileDictation } from '../lib/earTiles';
import { dueListeningTools } from '../lib/listeningTools';
import { buildStuckSummary, type StuckReason } from '../lib/stuckSentences';
import { readingCheckTile, recentReadingMisses } from '../lib/readingMissSteps';
import { dueWordChecks, pickTransferSentence, transferWordCheckReason, type TransferSentenceOption } from '../lib/wordCheckSteps';
import {
  concatCut,
  type ResegmentPlan,
  type ResegmentPlannedSentence,
} from '../lib/resegmentPlan';
import {
  mergedStatus,
  planStudyItemMoves,
  suggestMergedJapanese,
  suggestMergedTranslation,
  validateMergedJapanese,
  withVideoPosition as withMergedVideoPosition,
} from '../lib/mergeSentences';
import {
  recomputeSuggestionDefaults,
  suggestionsFromTokens,
  type MorphologyToken,
} from '../lib/vocabularySuggestions';
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
} from '../lib/scheduling';
import {
  buildFsrsConfidenceSnapshot,
  type FsrsConfidenceSnapshot,
} from '../lib/fsrsConfidence';
import {
  buildSelfRatingCalibration,
  type CalibrationReviewInput,
  type SelfRatingCalibration,
} from '../lib/selfRatingCalibration';
import { buildSkillCoverage, type SkillCoverage } from '../lib/skillCoverage';
import { buildReviewTroubleReport, type ReviewTroubleReport } from '../lib/reviewTroubleReport';
import { buildStepUsefulness, type StepUsefulnessReport } from '../lib/stepUsefulness';
import { buildFollowUpEffect, parseOffer, type FollowUpEffectReport } from '../lib/followUpEffect';
import { buildListeningAttempts } from '../lib/listeningEvidence';
import {
  parseShadowingPackage,
  type ShadowingImportPreview,
} from '../lib/shadowingImport';
import {
  buildRecommendedSession,
  computeNeglectScores,
  computeRecentActivityDistribution,
  shadowAttemptSummary,
  type ExploreCandidate,
  type ListeningToolCandidate,
  type WordCheckCandidate,
  type ReadCheckCandidate,
  type GrammarNoticingCandidate,
  type RecentActivityEvent,
  type RecommendedSession,
  type ReviewPriorityInput,
  type SessionPlannerInput,
  type ShadowCandidate,
} from '../lib/sessionPlanner';
import { normalizeTroubleTags, routeTroubleTags } from '../lib/reviewTroubleTags';
import { activeShadowSnoozeIds, shadowSnoozeUntil } from '../lib/shadowSnooze';
import {
  EXPLORE_CANDIDATE_LIMIT,
  EXPLORE_REVISITS_PER_BOOK,
  LISTENING_TOOL_CANDIDATE_LIMIT,
  WORD_CHECK_CANDIDATE_LIMIT,
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
} from '../lib/sessionPlannerConfig';
import { buildBackupPayload, type BackupBundle } from '../lib/backup';
import {
  orderBookSentencesFromPaste,
  type PasteOrderResult,
} from '../lib/pasteOrder';
import { ensureSettings, getDb, localDateKey, readSettings } from './database';
import {
  finishSinkAfterCommit,
  notifySync,
  notifySyncMany,
  trackSinkInTransaction,
} from './syncNotify';
import { getBookWithExtras, withChapterExtras } from './sentenceExtras';

export { getBookWithExtras, withChapterExtras };
import type { SyncEntity } from '../sync/types';
export * from './repo/sentenceWrites';
export * from './repo/namedPodcastFeeds';
export * from './repo/miningImports';
export * from './repo/shadowingAttempts';
export * from './repo/vocabularyKanji';
export * from './repo/cardIssueReports';
export * from './repo/syncIssueReports';
export * from './repo/passReads';
export * from './repo/alignmentCaches';
export * from './repo/contextDiversity';
export * from './repo/studyItemExplainability';
export * from './repo/wordReadingStrengths';
import { updateSentenceText } from './repo/sentenceWrites';
import { countAttemptsForSentences } from './repo/shadowingAttempts';
import { mintGetOrCreateId, ensureVocabularyItem, confirmSentenceVocabulary, setSentenceGrammarReviewStatus } from './repo/vocabularyKanji';
import {
  ANY_OF_SCAN_THRESHOLD,
  SMALL_TABLE_ANY_OF_LIMIT,
  allAudioSentenceIds,
  beginPlannerWarming,
  bookSentencesForSentences,
  createPlannerTimer,
  endPlannerPass,
  endPlannerWarming,
  learningEventsForSentences,
  plannerPassActive,
  plannerShared,
  readAllBookSentencesForPass,
  readAllGlossDecisionsForPass,
  readAllLearningEventsForPass,
  readAllSentenceVocabularyForPass,
  readAllStudyItemsForPass,
  readRowsByKeys,
  readSentenceStudyItemsForPass,
  readTileEligibilityForPass,
  readUsableCheckSentenceIdsForPass,
  reviewsForStudyItems,
  rowCount,
  sentenceIdsWithAudioClip,
  traceStep,
} from './repo/passReads';
import {
  getReferenceAlignment,
  saveReferenceAlignment,
} from './repo/alignmentCaches';
import { listStudyItemSummaries } from './repo/studyItemExplainability';
import {
  loadWordReadingStrengths,
  PLANNER_STRENGTH_CACHE_MS,
  READER_STRENGTH_CACHE_MS,
  type WordReadingStrengths,
} from './repo/wordReadingStrengths';



/** New book members go in source order: the position each sentence first appeared at in its import. */
function sortByFirstOccurrence(sentences: Sentence[]): Sentence[] {
  return [...sentences].sort((a, b) => a.firstOccurrenceIndex - b.firstOccurrenceIndex);
}

export async function createBook(input: {
  title: string;
  sourceKey?: string;
  subtitle?: string;
  sourceUrl?: string;
  notes?: string;
}): Promise<Book> {
  const db = getDb();
  const timestamp = nowIso();
  const book: Book = {
    id: createId('book'),
    title: input.title.trim() || 'Untitled book',
    sourceKey: input.sourceKey,
    subtitle: input.subtitle?.trim() || undefined,
    sourceUrl: input.sourceUrl?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    chapters: [],
    collapsedChapterIds: [],
  };
  await db.books.put(book);
  notifySync('books', book.id, book);
  return book;
}

export async function updateBook(
  bookId: string,
  patch: Partial<
    Pick<
      Book,
      | 'title'
      | 'sourceKey'
      | 'subtitle'
      | 'sourceUrl'
      | 'notes'
      | 'archived'
      | 'suspendedAt'
    >
  >,
): Promise<Book> {
  const db = getDb();
  const existing = await db.books.get(bookId);
  if (!existing) throw new Error('Book not found');
  const updated: Book = {
    ...existing,
    ...patch,
    title: patch.title?.trim() || existing.title,
    updatedAt: nowIso(),
  };
  await db.books.put(updated);
  notifySync('books', updated.id, updated);
  return updated;
}

/** How far ahead a resumed book's overdue held-back cards are spread. */
export const RESUME_RESCHEDULE_SPREAD_DAYS = 7;

/**
 * Shelve or un-shelve a book (`Book.suspendedAt`). While suspended it drops out
 * of every session-planner candidate source and its exclusive review cards are
 * held back from the global queue (see `src/lib/suspendedBooks.ts`). Resuming
 * clears the flag and spreads any of the book's now-overdue held-back cards over
 * the next `RESUME_RESCHEDULE_SPREAD_DAYS` days so the learner doesn't face one
 * big overdue pile — the cards were shelved, not failed, so their FSRS state is
 * otherwise untouched.
 */
export async function setBookSuspended(
  bookId: string,
  suspended: boolean,
  now: Date = new Date(),
): Promise<Book> {
  const db = getDb();
  const existing = await db.books.get(bookId);
  if (!existing) throw new Error('Book not found');
  const updated: Book = {
    ...existing,
    suspendedAt: suspended ? (existing.suspendedAt ?? now.toISOString()) : undefined,
    updatedAt: now.toISOString(),
  };
  (globalThis as { __suspendMark?: (label: string) => void }).__suspendMark?.('put-start');
  await db.books.put(updated);
  (globalThis as { __suspendMark?: (label: string) => void }).__suspendMark?.('put-done');
  notifySync('books', updated.id, updated);
  if (!suspended && existing.suspendedAt) {
    const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
    await rescheduleResumedItems(new Set(memberships.map((m) => m.sentenceId)), now);
  }
  return updated;
}

/**
 * Shelve or un-shelve a single chapter (`BookChapter.suspendedAt`) rather than
 * the whole book — e.g. one noisy episode in an otherwise-fine series. Same
 * effect as `setBookSuspended` (see `src/lib/suspendedBooks.ts`), scoped to
 * sentences whose `BookSentence.chapterId` points at this chapter; resuming
 * spreads only *that chapter's* overdue held-back cards.
 */
export async function setChapterSuspended(
  bookId: string,
  chapterId: string,
  suspended: boolean,
  now: Date = new Date(),
): Promise<Book> {
  const db = getDb();
  const existing = await db.books.get(bookId);
  if (!existing) throw new Error('Book not found');
  const chapters = existing.chapters ?? [];
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (chapterIndex < 0) throw new Error('Chapter not found');
  const currentChapter = chapters[chapterIndex]!;
  const updated: Book = {
    ...existing,
    chapters: chapters.map((chapter, index) =>
      index === chapterIndex
        ? {
            ...chapter,
            suspendedAt: suspended ? (chapter.suspendedAt ?? now.toISOString()) : undefined,
          }
        : chapter,
    ),
    updatedAt: now.toISOString(),
  };
  (globalThis as { __suspendMark?: (label: string) => void }).__suspendMark?.('put-start');
  await db.books.put(updated);
  (globalThis as { __suspendMark?: (label: string) => void }).__suspendMark?.('put-done');
  notifySync('books', updated.id, updated);
  if (!suspended && currentChapter.suspendedAt) {
    const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
    const sentenceIds = new Set(
      memberships.filter((m) => m.chapterId === chapterId).map((m) => m.sentenceId),
    );
    await rescheduleResumedItems(sentenceIds, now);
    (globalThis as { __suspendMark?: (label: string) => void }).__suspendMark?.('reschedule-done');
  }
  return updated;
}

/**
 * On resume: pull every overdue study item belonging to these sentences
 * (sentence / vocabularyItem / sentenceVocabulary subjects) forward off "way
 * overdue" and distribute it round-robin across the next
 * `RESUME_RESCHEDULE_SPREAD_DAYS` days. Only ever moves a due date that is
 * already in the past, and only later within the spread window — never earlier
 * than `now`. Idempotent-ish (a second call finds nothing overdue). Shared by
 * `setBookSuspended` (whole book's sentences) and `setChapterSuspended` (just
 * the resumed chapter's).
 */
async function rescheduleResumedItems(sentenceIds: Set<string>, now: Date): Promise<void> {
  const db = getDb();
  const nowIsoValue = now.toISOString();
  if (sentenceIds.size === 0) return;
  const links = await db.sentenceVocabulary
    .where('sentenceId')
    .anyOf([...sentenceIds])
    .toArray();
  const linkIds = new Set(links.map((link) => link.id));
  const vocabularyItemIds = new Set(links.map((link) => link.vocabularyItemId));

  // Indexed lookup by subjectId: scanning the whole table took seconds on a
  // phone with a large library.
  const subjectIds = [...new Set([...sentenceIds, ...linkIds, ...vocabularyItemIds])];
  const candidates = (await db.studyItems.where('subjectId').anyOf(subjectIds).toArray()).filter((item) => {
    if (item.fsrsState.due > nowIsoValue) return false;
    switch (item.subjectType) {
      case 'sentence':
        return sentenceIds.has(item.subjectId);
      case 'vocabularyItem':
        return vocabularyItemIds.has(item.subjectId);
      case 'sentenceVocabulary':
        return linkIds.has(item.subjectId);
      default:
        return false;
    }
  });
  if (candidates.length === 0) return;

  candidates.sort((a, b) => a.fsrsState.due.localeCompare(b.fsrsState.due));
  const dayMs = 24 * 60 * 60 * 1000;
  const perDay = Math.ceil(candidates.length / RESUME_RESCHEDULE_SPREAD_DAYS);
  const updates = candidates.map((item, index) => {
    const dayOffset = Math.floor(index / perDay);
    const due = new Date(now.getTime() + dayOffset * dayMs + (index % perDay) * 60_000);
    return {
      ...item,
      fsrsState: { ...item.fsrsState, due: due.toISOString() },
      updatedAt: nowIsoValue,
    };
  });
  await db.studyItems.bulkPut(updates);
  notifySyncMany(
    updates.map((item) => ({
      entity: 'study_items' as const,
      recordId: item.id,
      payload: item,
    })),
  );
}

/**
 * Builds the index the global review queue and the session planner use to hold
 * back a suspended book's or chapter's exclusive cards. Returns `null` when
 * nothing is suspended — the overwhelmingly common case — so callers pay
 * nothing. When something *is* suspended it reads the whole `bookSentences` +
 * `sentenceVocabulary` tables (a few times per review-init / plan); acceptable
 * at this scale.
 */
export function loadSuspendedBookIndex(): Promise<SuspendedBookIndex | null> {
  // A planning pass asks for this from five places; each ask re-reads two whole tables.
  return plannerShared('suspendedBookIndex', ['books', 'bookSentences', 'sentenceVocabulary'], loadSuspendedBookIndexUncached);
}

async function loadSuspendedBookIndexUncached(): Promise<SuspendedBookIndex | null> {
  const db = getDb();
  const books = await db.books.toArray();
  const suspendedBookIds = new Set(
    books.filter((book) => book.suspendedAt).map((book) => book.id),
  );
  const suspendedChapterIds = new Set(
    books.flatMap((book) =>
      (book.chapters ?? []).filter((chapter) => chapter.suspendedAt).map((chapter) => chapter.id),
    ),
  );
  if (suspendedBookIds.size === 0 && suspendedChapterIds.size === 0) return null;

  const [memberships, links] = await Promise.all([
    readAllBookSentencesForPass(),
    readAllSentenceVocabularyForPass(),
  ]);

  const membershipsBySentenceId = new Map<string, Array<{ bookId: string; chapterId?: string }>>();
  for (const membership of memberships) {
    const entry = { bookId: membership.bookId, chapterId: membership.chapterId };
    const list = membershipsBySentenceId.get(membership.sentenceId);
    if (list) list.push(entry);
    else membershipsBySentenceId.set(membership.sentenceId, [entry]);
  }

  const sentenceIdsByVocabularyItemId = new Map<string, string[]>();
  const sentenceIdByLinkId = new Map<string, string>();
  for (const link of links) {
    sentenceIdByLinkId.set(link.id, link.sentenceId);
    const list = sentenceIdsByVocabularyItemId.get(link.vocabularyItemId);
    if (list) list.push(link.sentenceId);
    else sentenceIdsByVocabularyItemId.set(link.vocabularyItemId, [link.sentenceId]);
  }

  return {
    suspendedBookIds,
    suspendedChapterIds,
    membershipsBySentenceId,
    sentenceIdsByVocabularyItemId,
    sentenceIdByLinkId,
  };
}


/** A book's sentences (in reading order) with the saved vocabulary meanings for their content words; feeds the book-wide gloss pass. */
export async function getBookSentencesForGlossing(
  bookId: string,
): Promise<{ sentences: Sentence[]; savedMeanings: Map<string, string> }> {
  const db = getDb();
  const memberships = await db.bookSentences.where('bookId').equals(bookId).sortBy('position');
  const rows = await db.sentences.bulkGet(memberships.map((member) => member.sentenceId));
  const sentences = rows.filter((row): row is Sentence => Boolean(row));
  const expressions = [...new Set(sentences.flatMap((sentence) => sentence.vocabularySuggestions.map((item) => item.expression)))];
  const { savedMeanings } = await getSavedWordStatus(expressions, { skipStrength: true });
  return { sentences, savedMeanings };
}

/**
 * Replace a sentence's tokenizer-derived `vocabularySuggestions` wholesale.
 * Used by the just-in-time AI glossing on VocabularyReviewPage to persist the
 * `english` it fills in, so a revisit doesn't re-request the same glosses.
 */
export async function updateSentenceVocabularySuggestions(
  sentenceId: string,
  suggestions: VocabularySuggestion[],
): Promise<void> {
  const db = getDb();
  const existing = await db.sentences.get(sentenceId);
  if (!existing) return;
  const updated: Sentence = {
    ...existing,
    vocabularySuggestions: suggestions,
    updatedAt: nowIso(),
  };
  await db.sentences.put(updated);
  notifySync('sentences', updated.id, updated);
}

/**
 * Browser-triggered counterpart to the old Python/GitHub-Actions backfill
 * scripts (`scripts/backfill-vocabulary-suggestions.ts` only fills sentences
 * with *no* suggestions at all — see its doc comment). Re-derives
 * `selectedByDefault` (`recomputeSuggestionDefaults`,
 * `src/lib/vocabularySuggestions.ts`) on every sentence's already-stored
 * `vocabularySuggestions`, so newer `selectedByDefault` rules
 * (`isDemonstrativeLightVerb` etc.) reach sentences mined before the rule
 * existed — nothing does this automatically, since the picker reads the
 * stored snapshot as-is.
 *
 * Only touches a sentence that's still genuinely untouched: no `analyses`
 * row, or one with an empty `vocabularySelections` — the same "still a
 * pristine default, nothing to disturb" condition
 * `refresh-unreviewed-vocabulary-selections.ts` uses for its own backfill,
 * because once a picker visit has saved real selections (even before
 * confirming — `AnalyzePage`'s autosave does this just from opening the
 * page) those are what's shown from then on, not a fresh default derived
 * from `vocabularySuggestions` again.
 */
export async function refreshVocabularySuggestionDefaults(): Promise<{
  sentencesScanned: number;
  sentencesUpdated: number;
  suggestionsChanged: number;
}> {
  const db = getDb();
  const sentences = await db.sentences
    .filter((sentence) => sentence.vocabularySuggestions.length > 0)
    .toArray();
  let sentencesUpdated = 0;
  let suggestionsChanged = 0;
  for (const sentence of sentences) {
    const analysis = await db.analyses.get(sentence.id);
    if (analysis && analysis.vocabularySelections.length > 0) continue;
    const recomputed = recomputeSuggestionDefaults(sentence.vocabularySuggestions);
    const changed = recomputed.filter(
      (suggestion, index) =>
        suggestion.selectedByDefault !== sentence.vocabularySuggestions[index]!.selectedByDefault,
    ).length;
    if (changed === 0) continue;
    await updateSentenceVocabularySuggestions(sentence.id, recomputed);
    sentencesUpdated += 1;
    suggestionsChanged += changed;
  }
  return { sentencesScanned: sentences.length, sentencesUpdated, suggestionsChanged };
}

/**
 * Set or clear the hand-corrected word-audio span on a `SentenceVocabulary`
 * link — `SegmentLoopPlayer`'s "Adjust" editor. `null` reverts to the
 * forced-alignment guess. Rounds to whole ms; no-op if the link is gone.
 */
export async function setSentenceVocabularyAudioRange(
  linkId: string,
  range: { startMs: number; endMs: number } | null,
): Promise<void> {
  const db = getDb();
  const link = await db.sentenceVocabulary.get(linkId);
  if (!link) return;
  const updated: SentenceVocabulary = {
    ...link,
    audioStartMs: range ? Math.round(range.startMs) : undefined,
    audioEndMs: range ? Math.round(range.endMs) : undefined,
    updatedAt: nowIso(),
  };
  await db.sentenceVocabulary.put(updated);
  notifySync('sentence_vocabulary', updated.id, updated);
}


type PendingSyncOp = {
  entity: SyncEntity;
  recordId: string;
  payload: unknown;
  operation?: 'upsert' | 'delete';
};

/**
 * Local cascade for retiring a sentence, run inside an existing `rw`
 * transaction. Appends the matching sync ops to `sink` (fired by the caller
 * after the transaction commits) rather than calling `notifySync` directly,
 * so a caller doing many of these keeps them in one batch.
 *
 * `keepStudyItemIds` holds sentence-subject study items the caller has
 * already repointed onto a replacement sentence — those must survive.
 */
async function cascadeRetireSentenceLocal(
  db: ReturnType<typeof getDb>,
  sentenceId: string,
  sink: PendingSyncOp[],
  keepStudyItemIds: Set<string> = new Set(),
  /** Re-segmentation transfers/retires the clips itself (see
   * `newAudioRecords` / `retiredAudioIds` in `applyResegmentation`), so it
   * opts out to avoid a double `reference_audio` delete for the same id. */
  retireAudio = true,
): Promise<void> {
  const sentence = await db.sentences.get(sentenceId);
  if (!sentence) return;

  const memberships = await db.bookSentences
    .where('sentenceId')
    .equals(sentenceId)
    .toArray();
  for (const membership of memberships) {
    await db.bookSentences.delete(membership.id);
    sink.push({
      entity: 'book_sentences',
      recordId: membership.id,
      payload: { id: membership.id },
      operation: 'delete',
    });
  }

  if (await db.analyses.get(sentenceId)) {
    await db.analyses.delete(sentenceId);
    sink.push({
      entity: 'analyses',
      recordId: sentenceId,
      payload: { sentenceId },
      operation: 'delete',
    });
  }

  const removedSentenceVocabularyIds: string[] = [];
  for (const link of await db.sentenceVocabulary
    .where('sentenceId')
    .equals(sentenceId)
    .toArray()) {
    await db.sentenceVocabulary.delete(link.id);
    removedSentenceVocabularyIds.push(link.id);
    sink.push({
      entity: 'sentence_vocabulary',
      recordId: link.id,
      payload: { id: link.id },
      operation: 'delete',
    });
  }

  const touchedGrammarPatternIds = new Set<string>();
  for (const link of await db.sentenceGrammar
    .where('sentenceId')
    .equals(sentenceId)
    .toArray()) {
    await db.sentenceGrammar.delete(link.id);
    touchedGrammarPatternIds.add(link.grammarPatternId);
    sink.push({
      entity: 'sentence_grammar',
      recordId: link.id,
      payload: { id: link.id },
      operation: 'delete',
    });
  }

  const retireStudyItem = async (item: StudyItem) => {
    await db.studyItems.delete(item.id);
    sink.push({
      entity: 'study_items',
      recordId: item.id,
      payload: { id: item.id },
      operation: 'delete',
    });
  };

  const studyItems = (
    await db.studyItems.where('subjectId').equals(sentenceId).toArray()
  ).filter((item) => item.subjectType === 'sentence' && !keepStudyItemIds.has(item.id));
  for (const item of studyItems) await retireStudyItem(item);

  // Per-occurrence cards keyed off this sentence's now-deleted vocabulary
  // links (word_listening, sentence_transformation) — their subjectId is a
  // SentenceVocabulary.id, so they aren't caught by the subjectId ===
  // sentenceId sweep above and would otherwise sit stuck-due forever
  // (2026-09-02: found ~20 orphaned this way by the After Work / GLIM SPANKY
  // deletes).
  for (const linkId of removedSentenceVocabularyIds) {
    const items = (await db.studyItems.where('subjectId').equals(linkId).toArray()).filter(
      (item) => item.subjectType === 'sentenceVocabulary' && !keepStudyItemIds.has(item.id),
    );
    for (const item of items) await retireStudyItem(item);
  }

  // A tracked grammar pattern whose *last* live occurrence was this sentence
  // can no longer produce any review card (pickContextSentenceForGrammarPattern
  // returns undefined), so retire its study items too. A pattern still
  // referenced by another sentence is left alone — it may recur.
  for (const patternId of touchedGrammarPatternIds) {
    const stillLinked = await db.sentenceGrammar
      .where('grammarPatternId')
      .equals(patternId)
      .count();
    if (stillLinked > 0) continue;
    const items = (await db.studyItems.where('subjectId').equals(patternId).toArray()).filter(
      (item) => item.subjectType === 'grammarPattern' && !keepStudyItemIds.has(item.id),
    );
    for (const item of items) await retireStudyItem(item);
  }

  if (await db.inbox.get(sentenceId)) {
    await db.inbox.delete(sentenceId);
    sink.push({
      entity: 'inbox',
      recordId: sentenceId,
      payload: { sentenceId },
      operation: 'delete',
    });
  }

  // Reference recordings for this sentence — otherwise the row stays live
  // pointing at a deleted sentence (nothing plays it, but it clutters the
  // table and the reference_alignment backfill). Blob in Storage is left;
  // an orphaned object under RLS is harmless and cheap.
  if (retireAudio) {
    for (const clip of await db.sentenceAudio
      .where('sentenceId')
      .equals(sentenceId)
      .toArray()) {
      await db.sentenceAudio.delete(clip.id);
      sink.push({
        entity: 'reference_audio',
        recordId: clip.id,
        payload: { id: clip.id },
        operation: 'delete',
      });
    }
  }

  await db.sentences.delete(sentenceId);
  sink.push({
    entity: 'sentences',
    recordId: sentenceId,
    payload: { id: sentenceId },
    operation: 'delete',
  });
}

/**
 * Retire a sentence and everything that hangs off it (book memberships,
 * analysis, vocabulary/grammar links, sentence-subject study items, inbox
 * entry). The first sentence-delete path in the app — sentences were
 * previously only ever removed by the sync engine applying a *remote*
 * delete. Soft-deletes remotely via the normal queued-`delete` path (never a
 * raw DELETE). `reviews.context_sentence_id` left dangling is harmless (a
 * soft delete never fires the server-side `on delete set null`).
 */
export async function deleteSentenceCascade(sentenceId: string): Promise<void> {
  await deleteSentencesCascade([sentenceId]);
}

/**
 * Drop still-unsettled steps that point at just-deleted sentences from every
 * in-progress planner session, so a deleted ad doesn't linger in the session
 * list as a dead "Go" link. Settled steps (completed/skipped/replaced) are
 * history and stay. A batched step (`sentenceIds`, e.g. grammar noticing)
 * only loses the deleted ids, and is dropped once none remain. A session left
 * with nothing unsettled is marked completed, same as `updatePlannerSessionStep`.
 * Returns the sessions it changed so the caller can notify sync after commit.
 */
async function dropSentencesFromOpenSessionsLocal(
  db: ReturnType<typeof getDb>,
  sentenceIds: Set<string>,
): Promise<PlannerSession[]> {
  const changed: PlannerSession[] = [];
  const sessions = await db.plannerSessions.where('status').equals('in_progress').toArray();
  for (const session of sessions) {
    let touched = false;
    const steps: PlannerSessionStep[] = [];
    for (const step of session.steps) {
      const unsettled = step.status === 'pending' || step.status === 'active';
      const batch = step.sentenceIds?.filter((id) => !sentenceIds.has(id));
      const batchChanged = batch !== undefined && batch.length !== step.sentenceIds!.length;
      const singleDeleted = step.sentenceId !== undefined && sentenceIds.has(step.sentenceId);
      if (!unsettled || (!batchChanged && !singleDeleted)) {
        steps.push(step);
        continue;
      }
      touched = true;
      if (batch !== undefined && batch.length > 0) {
        steps.push({
          ...step,
          sentenceIds: batch,
          sentenceId: batch.includes(step.sentenceId ?? '') ? step.sentenceId : batch[0],
        });
      }
      // else: nothing left for this step to act on — drop it.
    }
    if (!touched) continue;
    const timestamp = nowIso();
    const allSettled = steps.every(
      (step) =>
        step.status === 'completed' || step.status === 'skipped' || step.status === 'replaced',
    );
    const updated: PlannerSession = {
      ...session,
      steps,
      status: allSettled ? 'completed' : session.status,
      endedAt: allSettled ? timestamp : session.endedAt,
      updatedAt: timestamp,
    };
    await db.plannerSessions.put(updated);
    changed.push(updated);
  }
  return changed;
}

/** Batch `deleteSentenceCascade` — one transaction, one sync notification. */
export async function deleteSentencesCascade(sentenceIds: string[]): Promise<void> {
  const db = getDb();
  const sink: PendingSyncOp[] = [];
  let sinkTracked = false;
  let changedSessions: PlannerSession[] = [];
  await db.transaction(
    'rw',
    [
      db.sentences,
      db.bookSentences,
      db.analyses,
      db.sentenceVocabulary,
      db.sentenceGrammar,
      db.studyItems,
      db.inbox,
      db.sentenceAudio,
      db.plannerSessions,
      db.syncMeta,
      db.syncQueue,
      db.syncRecordMeta,
    ],
    async () => {
      for (const sentenceId of sentenceIds) {
        await cascadeRetireSentenceLocal(db, sentenceId, sink);
      }
      changedSessions = await dropSentencesFromOpenSessionsLocal(db, new Set(sentenceIds));
      sinkTracked = await trackSinkInTransaction(sink);
    },
  );
  finishSinkAfterCommit(sink, sinkTracked);
  for (const session of changedSessions) notifySync('planner_sessions', session.id, session);
}

export interface ResegmentSourceSentence {
  id: string;
  japanese: string;
  translation: string;
  startMs: number;
  endMs: number;
  firstOccurrenceIndex: number;
  studyItems: {
    id: string;
    activityType: string;
    fsrsReps: number;
    reviewCount: number;
  }[];
}

export interface ResegmentSourceContext {
  bookTitle: string;
  /** e.g. `source-FkX4A-ZLBrc` — prefix of the shadowing sourceReference cardIds. */
  sourceId: string;
  /** The book's YouTube URL, when set — lets the re-segment page pull a
   *  boundary waveform from the cached source (`fetchSourceAudioRange`). */
  sourceUrl?: string;
  sentences: ResegmentSourceSentence[];
}

const VIDEO_POSITION_RE = /Video position:\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*seconds/;

/**
 * Gather a shadowing book's current sentences (in caption order) plus the
 * sentence-subject study progress on each, for `ResegmentSourcePage`. Only
 * sentences carrying a `SHADOWING` source reference are included — a book
 * could in principle also hold sentences from other imports.
 */
export async function loadResegmentSourceContext(
  bookId: string,
): Promise<ResegmentSourceContext | null> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) return null;
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const rows = (await db.sentences.bulkGet(memberships.map((m) => m.sentenceId)))
    .filter((s): s is Sentence => Boolean(s))
    .map((sentence) => ({
      sentence,
      ref: sentence.sourceReferences.find((r) => r.cardType === 'SHADOWING'),
    }))
    .filter((entry): entry is { sentence: Sentence; ref: NonNullable<typeof entry.ref> } =>
      Boolean(entry.ref),
    );

  rows.sort(
    (a, b) => a.sentence.firstOccurrenceIndex - b.sentence.firstOccurrenceIndex,
  );

  const sourceId = rows[0]?.ref.cardId.split(':')[0] ?? '';
  const sentences: ResegmentSourceSentence[] = [];
  let fallbackMs = 0;
  for (const { sentence, ref } of rows) {
    const match = ref.userNotes?.match(VIDEO_POSITION_RE);
    const startMs = match ? Math.round(Number(match[1]) * 1000) : fallbackMs;
    const endMs = match ? Math.round(Number(match[2]) * 1000) : fallbackMs + 1000;
    fallbackMs = endMs;
    const studyItems = (
      await db.studyItems.where('subjectId').equals(sentence.id).toArray()
    ).filter((item) => item.subjectType === 'sentence');
    sentences.push({
      id: sentence.id,
      japanese: sentence.japanese,
      translation: sentence.translation,
      startMs,
      endMs,
      firstOccurrenceIndex: sentence.firstOccurrenceIndex,
      studyItems: await Promise.all(
        studyItems.map(async (item) => ({
          id: item.id,
          activityType: item.activityType,
          fsrsReps: item.fsrsState.reps,
          reviewCount: await db.reviews
            .where('studyItemId')
            .equals(item.id)
            .count(),
        })),
      ),
    });
  }
  return { bookTitle: book.title, sourceId, sourceUrl: book.sourceUrl, sentences };
}

/**
 * Replace a shadowing source's badly-segmented sentences with the reviewed
 * re-segmentation (`src/lib/resegmentPlan.ts`, `src/pages/ResegmentSourcePage.tsx`):
 * create the new sentences, splice them into the book in place of the old
 * ones, carry study progress across per the plan's `studyItemMoves`, repoint
 * vocabulary links whose surface form survives, and retire the old sentences.
 * Analysis (chunk boundaries) and grammar links are offset-bound and dropped
 * — the new sentences start unanalyzed.
 */
/** Rewrite (or append) the `Video position:` line in a shadowing sentence's
 *  userNotes so a later re-segment reads the *new* per-sentence timing, not
 *  the template fragment's. */
function withVideoPosition(
  notes: string | undefined,
  startMs?: number,
  endMs?: number,
): string | undefined {
  if (startMs == null || endMs == null) return notes;
  const line = `Video position: ${(startMs / 1000).toFixed(3)}–${(endMs / 1000).toFixed(3)} seconds`;
  if (!notes) return line;
  return /Video position:[^\n]*/.test(notes)
    ? notes.replace(/Video position:[^\n]*/, line)
    : `${notes}\n${line}`;
}

type ReclipFn = (
  parentClips: Blob[],
  cuts: { startMs: number; endMs: number }[],
  options?: { trimSilence?: boolean },
) => Promise<{ blob: Blob; durationMs: number }[]>;

type SourceClipFn = (
  url: string,
  cuts: { startMs: number; endMs: number }[],
) => Promise<{ blob: Blob; durationMs: number; mimeType?: string }[]>;

/**
 * Upload freshly cut reference clips to Supabase Storage + queue their
 * metadata. Optional and never blocks (or fails) the local write that made them.
 */
async function uploadNewReferenceAudio(bookId: string, records: SentenceAudio[]): Promise<void> {
  try {
    const { ensureSyncMeta } = await import('../sync/queue');
    const { getSupabase } = await import('../sync/supabaseClient');
    const { uploadReferenceAudio } = await import('../sync/audioSync');
    const { syncLog } = await import('../sync/logger');
    const meta = await ensureSyncMeta();
    if (!meta.syncReferenceAudio) return;
    const supabase = getSupabase();
    const userId = (await supabase?.auth.getSession())?.data.session?.user?.id;
    if (!userId) return;
    for (const record of records) {
      // One clip's upload failing (network blip, transient storage
      // error) must not abort every clip after it in the batch — that
      // silently strands the rest with no local sign anything went
      // wrong (2026-09-27 incident: ~half a podcast episode's clips
      // never reached Storage this way, no error surfaced anywhere).
      try {
        await uploadReferenceAudio({ audio: record, bookId, ownerId: userId });
      } catch (err) {
        syncLog('warn', err instanceof Error ? err.message : String(err), 'AUDIO_UPLOAD_SKIP');
      }
    }
  } catch {
    // Local apply must succeed even if the optional upload fails.
  }
}

export async function applyResegmentation(
  bookId: string,
  plan: ResegmentPlan,
  options: { reclip?: ReclipFn; clipFromSource?: SourceClipFn } = {},
): Promise<{ batchId: string; newSentenceIds: string[] }> {
  const db = getDb();
  const timestamp = nowIso();
  const batchId = createId('batch');
  const sink: PendingSyncOp[] = [];
  let sinkTracked = false;

  const oldSentences = (
    await db.sentences.bulkGet(plan.retiredSentenceIds)
  ).filter((s): s is Sentence => Boolean(s));
  const templateRef =
    oldSentences
      .flatMap((s) => s.sourceReferences)
      .find((ref) => ref.cardType === 'SHADOWING') ??
    oldSentences.flatMap((s) => s.sourceReferences)[0];
  const sourceId = templateRef?.cardId.split(':')[0] ?? `resegment-${bookId}`;

  // tempIndex -> new sentence id
  const newIds: string[] = plan.plannedSentences.map((planned) =>
    sentenceIdFromNormalizedKey(normalizeSentenceKey(planned.japanese)),
  );

  const newSentences: Sentence[] = plan.plannedSentences.map((planned, index) => ({
    id: newIds[index]!,
    normalizedKey: normalizeSentenceKey(planned.japanese),
    japanese: planned.japanese,
    readingOnly: planned.readingOnly,
    inlineReading:
      planned.inlineReading ||
      inlineReadingFromTokens(planned.japanese, planned.tokens),
    translation: planned.translation,
    targetVocabulary: [],
    vocabularySuggestions: suggestionsFromTokens(planned.japanese, planned.tokens),
    sourceReferences: [
      {
        cardId: `${sourceId}:reseg-${String(index).padStart(3, '0')}`,
        cardType: 'SHADOWING',
        contextNumber: 1,
        userNotes: withVideoPosition(
          templateRef?.userNotes,
          planned.startMs,
          planned.endMs,
        ),
        importBatchId: batchId,
      },
    ],
    conflicts: [],
    firstOccurrenceIndex: planned.firstOccurrenceIndex,
    importBatchIds: [batchId],
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const keepStudyItemIds = new Set(
    plan.studyItemMoves
      .filter((move) => move.targetIndex !== null)
      .map((move) => move.studyItemId),
  );
  const mappingByOld = new Map(
    plan.sentenceMapping.map((m) => [m.oldSentenceId, m.targetIndex]),
  );
  const dedupedNewIds = new Set(newIds);

  // Re-cut reference audio onto the new sentence boundaries (network — must
  // happen before the write transaction). Best-effort: a re-segmentation
  // still lands if the mining service is unreachable, exactly as before this
  // feature existed.
  const newAudioRecords: SentenceAudio[] = [];
  const retiredAudioIds: string[] = [];
  try {
    const oldAudio = (
      await db.sentenceAudio
        .where('sentenceId')
        .anyOf(plan.retiredSentenceIds)
        .toArray()
    )
      .filter((row) => row.blob != null && row.blob.size !== 0)
      .sort((a, b) => a.startMs - b.startMs);

    const timedPlanned = plan.plannedSentences
      .map((planned, index) => ({ planned, newId: newIds[index]! }))
      .filter(
        (entry): entry is { planned: ResegmentPlannedSentence; newId: string } =>
          entry.planned.startMs != null &&
          entry.planned.endMs != null &&
          entry.planned.endMs > entry.planned.startMs,
      );

    const audioTemplate = oldAudio[0];
    const sourceUrl =
      oldAudio.find((row) => row.sourceUrl)?.sourceUrl ??
      (await db.books.get(bookId))?.sourceUrl;

    const pushRecord = (
      newId: string,
      planned: ResegmentPlannedSentence,
      clip: { blob: Blob; durationMs: number },
      template: SentenceAudio,
    ) => {
      newAudioRecords.push({
        id: `audio_reseg_${hashString(`${template.sourceId}:${newId}`)}`,
        sentenceId: newId,
        sourceId: template.sourceId,
        sourceSentenceId: `${template.sourceId}:reseg-${newId}`,
        sourceTitle: template.sourceTitle,
        sourceUrl: template.sourceUrl ?? sourceUrl,
        mimeType: 'audio/mp4',
        durationMs: clip.durationMs,
        startMs: planned.startMs!,
        endMs: planned.endMs!,
        blob: clip.blob,
        importedAt: timestamp,
      });
    };

    // Preferred: cut each new sentence straight from the pristine source at
    // its absolute video-timeline span (needs a reachable `sourceUrl`). Falls
    // back to concatenating the old fragment clips — which relies on
    // `concatCut`'s "fragment file duration == its video span" assumption and
    // caused the 2026-08-30 truncation bug.
    let cutFromSource = false;
    if (sourceUrl && audioTemplate && timedPlanned.length > 0) {
      try {
        const clipFromSource: SourceClipFn =
          options.clipFromSource ??
          (async (...args) =>
            (await import('../lib/miningApi')).clipFromSource(...args));
        const clips = await clipFromSource(
          sourceUrl,
          timedPlanned.map(({ planned }) => ({
            startMs: planned.startMs!,
            endMs: planned.endMs!,
          })),
        );
        timedPlanned.forEach(({ planned, newId }, i) => {
          const clip = clips[i];
          if (clip) pushRecord(newId, planned, clip, audioTemplate);
        });
        cutFromSource = newAudioRecords.length === timedPlanned.length;
        if (!cutFromSource) newAudioRecords.length = 0;
      } catch (error) {
        console.warn(
          'Re-segmentation: cut from source failed, falling back to fragments:',
          error,
        );
        newAudioRecords.length = 0;
      }
    }

    if (!cutFromSource) {
      const reclip: ReclipFn =
        options.reclip ??
        (async (...args) =>
          (await import('../lib/miningApi')).reclipResegmentedAudio(...args));
      for (const { planned, newId } of timedPlanned) {
        // A split assigns `inheritsFrom` only to the largest piece, so pick
        // parent clips by video-timeline overlap: any old clip whose source
        // range intersects this new sentence's span.
        const parents = oldAudio.filter(
          (row) => row.endMs > planned.startMs! && row.startMs < planned.endMs!,
        );
        if (parents.length === 0) continue;
        const cut = concatCut(planned.startMs!, planned.endMs!, parents);
        if (cut.endMs <= cut.startMs) continue;
        const [result] = await reclip(
          parents.map((row) => row.blob),
          [cut],
          { trimSilence: true },
        );
        if (result) pushRecord(newId, planned, result, parents[0]!);
      }
    }

    for (const row of oldAudio) {
      if (dedupedNewIds.has(row.sentenceId)) continue; // byte-identical id survives
      retiredAudioIds.push(row.id);
    }
  } catch (error) {
    console.warn('Re-segmentation audio re-cut skipped:', error);
    newAudioRecords.length = 0;
    retiredAudioIds.length = 0;
  }

  await db.transaction(
    'rw',
    [
      db.sentences,
      db.bookSentences,
      db.analyses,
      db.sentenceVocabulary,
      db.sentenceGrammar,
      db.studyItems,
      db.inbox,
      db.books,
      db.importBatches,
      db.sentenceAudio,
      db.syncMeta,
      db.syncQueue,
      db.syncRecordMeta,
    ],
    async () => {
      // 1. New sentences (dedupe if two segments normalize equal).
      const seen = new Set<string>();
      for (const sentence of newSentences) {
        if (seen.has(sentence.id)) continue;
        seen.add(sentence.id);
        await db.sentences.put(sentence);
        sink.push({ entity: 'sentences', recordId: sentence.id, payload: sentence });
      }

      // 2. Carry study progress across.
      const studyItems = await db.studyItems.bulkGet(
        plan.studyItemMoves.map((move) => move.studyItemId),
      );
      for (let i = 0; i < plan.studyItemMoves.length; i += 1) {
        const move = plan.studyItemMoves[i]!;
        const item = studyItems[i];
        if (!item) continue;
        if (move.targetIndex === null) {
          await db.studyItems.delete(item.id);
          sink.push({
            entity: 'study_items',
            recordId: item.id,
            payload: { id: item.id },
            operation: 'delete',
          });
          continue;
        }
        const updated: StudyItem = {
          ...item,
          subjectId: newIds[move.targetIndex]!,
          updatedAt: timestamp,
        };
        await db.studyItems.put(updated);
        sink.push({ entity: 'study_items', recordId: updated.id, payload: updated });
      }

      // 3. Repoint vocabulary links whose surface form survives the re-split.
      const repointed = new Set<string>();
      for (const oldId of plan.retiredSentenceIds) {
        const targetIndex = mappingByOld.get(oldId) ?? null;
        for (const link of await db.sentenceVocabulary
          .where('sentenceId')
          .equals(oldId)
          .toArray()) {
          const newSentence =
            targetIndex === null ? undefined : newSentences[targetIndex];
          const survives =
            newSentence &&
            (!link.surfaceForm || newSentence.japanese.includes(link.surfaceForm));
          const dedupeKey = newSentence
            ? `${newSentence.id}:${link.vocabularyItemId}`
            : '';
          if (survives && !repointed.has(dedupeKey)) {
            repointed.add(dedupeKey);
            const moved: SentenceVocabulary = {
              ...link,
              sentenceId: newSentence!.id,
            };
            await db.sentenceVocabulary.delete(link.id);
            await db.sentenceVocabulary.put(moved);
            sink.push({
              entity: 'sentence_vocabulary',
              recordId: moved.id,
              payload: moved,
            });
          }
          // links that don't survive are removed by cascadeRetireSentenceLocal
        }
      }

      // 4. Retire the old sentences. A new segment whose text is byte-identical
      //    to an old one derives the *same* id (`sentenceIdFromNormalizedKey`)
      //    — that row was just overwritten in step 1 and must NOT be deleted;
      //    only its now-stale analysis/grammar links are cleared.
      const newIdSet = new Set(seen);
      for (const oldId of plan.retiredSentenceIds) {
        if (newIdSet.has(oldId)) {
          if (await db.analyses.get(oldId)) {
            await db.analyses.delete(oldId);
            sink.push({
              entity: 'analyses',
              recordId: oldId,
              payload: { sentenceId: oldId },
              operation: 'delete',
            });
          }
          for (const link of await db.sentenceGrammar
            .where('sentenceId')
            .equals(oldId)
            .toArray()) {
            await db.sentenceGrammar.delete(link.id);
            sink.push({
              entity: 'sentence_grammar',
              recordId: link.id,
              payload: { id: link.id },
              operation: 'delete',
            });
          }
          continue;
        }
        await cascadeRetireSentenceLocal(db, oldId, sink, keepStudyItemIds, false);
      }

      // 5. Rebuild this source's slice of the book in segment order. Every
      //    membership for a sentence in the source (retired or reused) is
      //    dropped; the new set is added first, other books' sentences follow.
      const sourceSentenceIds = new Set([
        ...plan.retiredSentenceIds,
        ...newIdSet,
      ]);
      const allMemberships = await db.bookSentences
        .where('bookId')
        .equals(bookId)
        .sortBy('position');
      for (const membership of allMemberships) {
        if (!sourceSentenceIds.has(membership.sentenceId)) continue;
        await db.bookSentences.delete(membership.id);
        sink.push({
          entity: 'book_sentences',
          recordId: membership.id,
          payload: { id: membership.id },
          operation: 'delete',
        });
      }
      const additions = [...seen].map((sentenceId, index) => ({
        id: createId('bs'),
        bookId,
        sentenceId,
        position: index,
        status: 'unstarted' as StudyStatus,
        addedAt: timestamp,
      }));
      const repositioned = allMemberships
        .filter((item) => !sourceSentenceIds.has(item.sentenceId))
        .map((item, index) => ({ ...item, position: additions.length + index }));
      await db.bookSentences.bulkPut([...additions, ...repositioned]);
      for (const row of [...additions, ...repositioned]) {
        sink.push({ entity: 'book_sentences', recordId: row.id, payload: row });
      }

      // 6. Import batch + book bump.
      const batch: ImportBatch = {
        id: batchId,
        filename: `resegment:${sourceId}`,
        batchName: `Re-segmented ${new Date(timestamp).toLocaleDateString()}`,
        importedAt: timestamp,
        counts: {
          totalRows: newSentences.length,
          contextOccurrences: 0,
          uniqueSentences: seen.size,
          newSentences: seen.size,
          updatedSentences: 0,
          exactDuplicatesIgnored: 0,
          newVocabularyAssociations: 0,
          rowsSkipped: 0,
          warningCount: 0,
          conflictCount: 0,
        },
        warnings: [],
      };
      await db.importBatches.put(batch);
      sink.push({ entity: 'import_batches', recordId: batch.id, payload: batch });

      const book = await db.books.get(bookId);
      if (book) {
        const updatedBook = { ...book, updatedAt: timestamp };
        await db.books.put(updatedBook);
        sink.push({ entity: 'books', recordId: book.id, payload: updatedBook });
      }

      // 7. Reference audio: retire the gone fragments' clips, store the
      //    freshly re-cut clips for the new sentences.
      if (retiredAudioIds.length) {
        await db.sentenceAudio.bulkDelete(retiredAudioIds);
        for (const id of retiredAudioIds) {
          sink.push({
            entity: 'reference_audio',
            recordId: id,
            payload: { id },
            operation: 'delete',
          });
        }
      }
      for (const record of newAudioRecords) {
        await db.sentenceAudio.put(record);
      }
      sinkTracked = await trackSinkInTransaction(sink);
    },
  );

  finishSinkAfterCommit(sink, sinkTracked);

  // Upload the re-cut clips to Supabase Storage + queue their metadata, the
  // same optional/never-block way the shadowing import does.
  if (newAudioRecords.length) void uploadNewReferenceAudio(bookId, newAudioRecords);

  return { batchId, newSentenceIds: [...new Set(newIds)] };
}

export interface MergeAdjacentSentencesOptions {
  /** Merged Japanese; defaults to the two sentences joined with 、. */
  japanese?: string;
  /** Merged English; defaults to the two translations joined. */
  translation?: string;
  /** Test seams — default to the mining service. */
  annotate?: typeof import('../lib/miningApi').resegmentSentences;
  clipFromSource?: SourceClipFn;
}

export interface MergeAdjacentSentencesResult {
  sentenceId: string;
  /** Readings/morphology came from the mining service (else the two halves' were stitched). */
  annotated: boolean;
  /** A new reference clip spanning both sentences was cut. */
  audioRecut: boolean;
}

/**
 * Merge two neighbouring sentences of one book into a single new sentence
 * (a caption split at a pause, a drama line cut mid-clause). The merged
 * sentence takes the first one's place, inherits the most advanced book
 * status, the better-reviewed study card per activity type, and vocabulary
 * links whose surface survives; both originals are retired with everything
 * offset-bound to them (analysis, grammar links, inbox, clips). Learning
 * events stay on the old ids as history. Mirrors
 * `scripts/merge-adjacent-sentences.ts`, run locally instead of on the box.
 *
 * The audio re-cut is network-bound, so it happens before the write
 * transaction; if both sentences have clips and the span can't be cut, the
 * merge is refused rather than silently losing the audio.
 */
export async function mergeAdjacentSentences(
  bookId: string,
  firstId: string,
  secondId: string,
  options: MergeAdjacentSentencesOptions = {},
): Promise<MergeAdjacentSentencesResult> {
  const db = getDb();
  const timestamp = nowIso();

  const [a, b] = await db.sentences.bulkGet([firstId, secondId]);
  if (!a || !b || firstId === secondId) throw new Error('Both sentences must exist.');

  const memberships = await db.bookSentences.where('bookId').equals(bookId).sortBy('position');
  const indexA = memberships.findIndex((m) => m.sentenceId === firstId);
  const indexB = memberships.findIndex((m) => m.sentenceId === secondId);
  if (indexA < 0 || indexB < 0) throw new Error('Both sentences must be in this book.');
  if (indexB !== indexA + 1) {
    throw new Error('Only neighbouring sentences can be merged (first, then the one right after it).');
  }
  for (const id of [firstId, secondId]) {
    if ((await db.bookSentences.where('sentenceId').equals(id).count()) > 1) {
      throw new Error('A sentence that is in more than one book cannot be merged.');
    }
  }
  const memberA = memberships[indexA]!;
  const memberB = memberships[indexB]!;

  const japanese = (options.japanese ?? suggestMergedJapanese(a.japanese, b.japanese)).trim();
  const translation = (options.translation ?? suggestMergedTranslation(a.translation, b.translation)).trim();
  const valid = validateMergedJapanese(a.japanese, b.japanese, japanese);
  if (!valid.ok) throw new Error(valid.reason);
  const normalizedKey = normalizeSentenceKey(japanese);
  const newId = sentenceIdFromNormalizedKey(normalizedKey);
  if (await db.sentences.get(newId)) throw new Error('A sentence with that exact text already exists.');

  // Audio: one clip over the combined span, cut from the pristine source.
  const oldAudio = (await db.sentenceAudio.where('sentenceId').anyOf([firstId, secondId]).toArray()).filter(
    (row) => row.blob != null && row.blob.size !== 0,
  );
  const audioA = oldAudio.find((row) => row.sentenceId === firstId);
  const audioB = oldAudio.find((row) => row.sentenceId === secondId);
  let newAudio: SentenceAudio | undefined;
  if (audioA && audioB) {
    const sourceUrl = audioA.sourceUrl ?? audioB.sourceUrl ?? (await db.books.get(bookId))?.sourceUrl;
    if (!sourceUrl || audioA.sourceId !== audioB.sourceId) {
      throw new Error("These sentences' clips come from different sources, so the audio can't be re-cut.");
    }
    const startMs = Math.min(audioA.startMs, audioB.startMs);
    const endMs = Math.max(audioA.endMs, audioB.endMs);
    const clipFromSource: SourceClipFn =
      options.clipFromSource ?? (async (...args) => (await import('../lib/miningApi')).clipFromSource(...args));
    let clip: Awaited<ReturnType<SourceClipFn>>[number] | undefined;
    try {
      [clip] = await clipFromSource(sourceUrl, [{ startMs, endMs }]);
    } catch (error) {
      throw new Error(
        `Couldn't re-cut the audio (is the mining service reachable?): ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!clip || !(clip.durationMs >= (endMs - startMs) * 0.8)) {
      throw new Error("Couldn't re-cut the audio: the clip came back missing or too short.");
    }
    newAudio = {
      id: `audio_merge_${hashString(`${audioA.sourceId}:${newId}`)}`,
      sentenceId: newId,
      sourceId: audioA.sourceId,
      sourceSentenceId: `${audioA.sourceId}:merge-${newId}`,
      sourceTitle: audioA.sourceTitle,
      sourceUrl,
      mimeType: 'audio/mp4',
      durationMs: clip.durationMs,
      startMs,
      endMs,
      blob: clip.blob,
      importedAt: timestamp,
    };
  }

  // Readings + morphology for the merged text (annotate only — no merge/split).
  let annotated = false;
  let readingOnly: string;
  let inlineReading: string;
  let vocabularySuggestions: VocabularySuggestion[];
  try {
    const annotate =
      options.annotate ?? (async (...args) => (await import('../lib/miningApi')).resegmentSentences(...args));
    const [cue] = await annotate(
      [{ japanese, startMs: newAudio?.startMs ?? 0, endMs: newAudio?.endMs ?? 0 }],
      { merge: false, split: false, generateKana: true },
    );
    if (!cue || cue.japanese.replace(/\s/g, '') !== japanese.replace(/\s/g, '')) {
      throw new Error('annotate returned different text');
    }
    const tokens = (cue.tokens ?? []) as MorphologyToken[];
    readingOnly = String(cue.reading ?? '').trim();
    inlineReading = inlineReadingFromTokens(japanese, tokens);
    vocabularySuggestions = suggestionsFromTokens(japanese, tokens);
    annotated = true;
  } catch {
    // Mining service unavailable: stitch the halves' readings and shift the
    // second half's suggestion offsets into the merged text.
    readingOnly = `${a.readingOnly}${b.readingOnly}`;
    inlineReading = `${a.inlineReading}${b.inlineReading}`;
    const headLength = a.japanese.trim().replace(/[。．.！？!?\s]+$/, '').length;
    const shift = japanese.length - b.japanese.trim().length;
    vocabularySuggestions = [
      ...a.vocabularySuggestions.filter((s) => s.end <= headLength),
      ...b.vocabularySuggestions.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift })),
    ];
  }

  const shadowingRef = a.sourceReferences.find((ref) => ref.cardType === 'SHADOWING');
  const sourceReferences: SourceReference[] =
    shadowingRef && newAudio
      ? [
          {
            ...shadowingRef,
            cardId: `${shadowingRef.cardId.split(':')[0]}:merge-${newId}`,
            userNotes: withMergedVideoPosition(shadowingRef.userNotes, newAudio.startMs, newAudio.endMs),
          },
        ]
      : [...a.sourceReferences, ...b.sourceReferences];

  const merged: Sentence = {
    id: newId,
    normalizedKey,
    japanese,
    readingOnly,
    inlineReading,
    translation,
    targetVocabulary: [],
    vocabularySuggestions,
    sourceReferences,
    conflicts: [],
    firstOccurrenceIndex: a.firstOccurrenceIndex,
    importBatchIds: [...new Set([...a.importBatchIds, ...b.importBatchIds])],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const sink: PendingSyncOp[] = [];
  let sinkTracked = false;
  let changedSessions: PlannerSession[] = [];
  await db.transaction(
    'rw',
    [
      db.sentences,
      db.bookSentences,
      db.analyses,
      db.sentenceVocabulary,
      db.sentenceGrammar,
      db.studyItems,
      db.reviews,
      db.inbox,
      db.books,
      db.sentenceAudio,
      db.plannerSessions,
      db.syncMeta,
      db.syncQueue,
      db.syncRecordMeta,
    ],
    async () => {
      await db.sentences.put(merged);
      sink.push({ entity: 'sentences', recordId: merged.id, payload: merged });

      // Study cards: the better-reviewed one per activity type moves across.
      const cards = (
        await db.studyItems.where('subjectId').anyOf([firstId, secondId]).toArray()
      ).filter((item) => item.subjectType === 'sentence');
      const summaries = await Promise.all(
        cards.map(async (item) => ({
          id: item.id,
          subjectId: item.subjectId,
          activityType: item.activityType,
          fsrsReps: item.fsrsState.reps,
          reviewCount: await db.reviews.where('studyItemId').equals(item.id).count(),
        })),
      );
      const { move } = planStudyItemMoves(summaries);
      const keepStudyItemIds = new Set(move.map((m) => m.id));
      for (const m of move) {
        const item = cards.find((c) => c.id === m.id)!;
        const updated: StudyItem = { ...item, subjectId: newId, updatedAt: timestamp };
        await db.studyItems.put(updated);
        sink.push({ entity: 'study_items', recordId: updated.id, payload: updated });
      }

      // Vocabulary links whose surface survives move across (deduped by word);
      // the rest go with the cascade, taking their per-occurrence cards.
      const linked = new Set<string>();
      for (const id of [firstId, secondId]) {
        for (const link of await db.sentenceVocabulary.where('sentenceId').equals(id).toArray()) {
          const survives = !link.surfaceForm || japanese.includes(link.surfaceForm);
          if (!survives || linked.has(link.vocabularyItemId)) continue;
          linked.add(link.vocabularyItemId);
          const moved: SentenceVocabulary = { ...link, sentenceId: newId };
          await db.sentenceVocabulary.put(moved);
          sink.push({ entity: 'sentence_vocabulary', recordId: moved.id, payload: moved });
        }
      }

      for (const id of [firstId, secondId]) {
        await cascadeRetireSentenceLocal(db, id, sink, keepStudyItemIds);
      }
      changedSessions = await dropSentencesFromOpenSessionsLocal(db, new Set([firstId, secondId]));

      // The merged sentence takes the first one's place; renumber to close the gap.
      const remaining = memberships.filter((m) => m.id !== memberA.id && m.id !== memberB.id);
      const membership: BookSentence = {
        id: createId('bs'),
        bookId,
        sentenceId: newId,
        position: memberA.position,
        status: mergedStatus(memberA.status, memberB.status),
        addedAt: memberA.addedAt,
        lastStudiedAt: memberA.lastStudiedAt ?? memberB.lastStudiedAt,
        note: memberA.note,
        chapterId: memberA.chapterId,
      };
      const ordered = [...remaining, membership].sort((x, y) => x.position - y.position);
      const rows = ordered.map((row, index) => ({ ...row, position: index }));
      await db.bookSentences.bulkPut(rows);
      const oldPositions = new Map(remaining.map((r) => [r.id, r.position]));
      for (const row of rows) {
        if (row.id === membership.id || row.position !== oldPositions.get(row.id)) {
          sink.push({ entity: 'book_sentences', recordId: row.id, payload: row });
        }
      }

      const book = await db.books.get(bookId);
      if (book) {
        const updatedBook = { ...book, updatedAt: timestamp };
        await db.books.put(updatedBook);
        sink.push({ entity: 'books', recordId: book.id, payload: updatedBook });
      }

      if (newAudio) await db.sentenceAudio.put(newAudio);
      sinkTracked = await trackSinkInTransaction(sink);
    },
  );

  finishSinkAfterCommit(sink, sinkTracked);
  for (const session of changedSessions) notifySync('planner_sessions', session.id, session);
  if (newAudio) void uploadNewReferenceAudio(bookId, [newAudio]);

  return { sentenceId: newId, annotated, audioRecut: Boolean(newAudio) };
}

/**
 * Pushes a `sentenceAudio` row's current metadata (never blocks the caller
 * on failure). `reference_audio`'s push path needs the *full* row —
 * `storagePath`/`sizeBytes` aren't stored locally, only reconstructable via
 * `uploadReferenceAudio` — so any local-only metadata edit (trim range,
 * re-cut) re-uploads the (usually unchanged) blob alongside it rather than
 * risking a partial update that nulls out those columns for every other
 * device. Looks up the owning book itself since callers only have the audio row.
 */
async function pushReferenceAudioUpdate(audio: SentenceAudio): Promise<void> {
  try {
    const db = getDb();
    const { ensureSyncMeta } = await import('../sync/queue');
    const { getSupabase } = await import('../sync/supabaseClient');
    const { uploadReferenceAudio } = await import('../sync/audioSync');
    const meta = await ensureSyncMeta();
    if (!meta.syncReferenceAudio) return;
    const supabase = getSupabase();
    const userId = (await supabase?.auth.getSession())?.data.session?.user?.id;
    if (!userId) return;
    const membership = await db.bookSentences.where('sentenceId').equals(audio.sentenceId).first();
    await uploadReferenceAudio({ audio, bookId: membership?.bookId, ownerId: userId });
  } catch {
    // Local edit must stand even if the push fails.
  }
}

/**
 * Hand-corrects the playback trim within one sentence's reference clip — the
 * "Adjust" editor on `NativeAudioButton`, for room tone/bleed at the clip's
 * own edges without re-cutting from source (works offline, no `sourceUrl`
 * needed). `null` clears the override back to playing the whole blob.
 */
export async function setSentenceAudioTrimRange(
  audioId: string,
  range: { startMs: number; endMs: number } | null,
): Promise<void> {
  const db = getDb();
  const audio = await db.sentenceAudio.get(audioId);
  if (!audio) return;
  const updated: SentenceAudio = {
    ...audio,
    trimStartMs: range ? Math.round(range.startMs) : undefined,
    trimEndMs: range ? Math.round(range.endMs) : undefined,
  };
  await db.sentenceAudio.put(updated);
  void pushReferenceAudioUpdate(updated);
}

/**
 * Re-cut one sentence's reference clip from the pristine YouTube source to a
 * new `[startMs, endMs]` span — the per-sentence timing fix on `AnalyzePage`,
 * for when the mining boundary was a touch off and you don't want a
 * book-wide re-segment (which drops chunk/grammar analysis). Only the one
 * `sentenceAudio` row changes; sentence text, study progress, and analysis
 * are untouched. Needs the audio row (or its book) to still carry a
 * `sourceUrl`. Returns the new clip's duration.
 */
export async function recutSentenceAudioFromSource(
  sentenceAudioId: string,
  span: { startMs: number; endMs: number },
  options: { clipFromSource?: SourceClipFn } = {},
): Promise<{ durationMs: number }> {
  if (span.endMs <= span.startMs) throw new Error('endMs must be greater than startMs');
  const db = getDb();
  const audio = await db.sentenceAudio.get(sentenceAudioId);
  if (!audio) throw new Error('That reference clip no longer exists.');

  const membership = await db.bookSentences
    .where('sentenceId')
    .equals(audio.sentenceId)
    .first();
  const sourceUrl =
    audio.sourceUrl ??
    (membership ? (await db.books.get(membership.bookId))?.sourceUrl : undefined);
  if (!sourceUrl) {
    throw new Error('No source URL for this clip — a book-wide re-segment is the only option.');
  }

  const clipFromSource: SourceClipFn =
    options.clipFromSource ??
    (async (...args) => (await import('../lib/miningApi')).clipFromSource(...args));
  const [clip] = await clipFromSource(sourceUrl, [
    { startMs: Math.round(span.startMs), endMs: Math.round(span.endMs) },
  ]);
  if (!clip) throw new Error('The source re-cut returned nothing.');

  const updated: SentenceAudio = {
    ...audio,
    startMs: Math.round(span.startMs),
    endMs: Math.round(span.endMs),
    durationMs: clip.durationMs,
    blob: clip.blob,
    mimeType: clip.mimeType ?? 'audio/mp4',
    importedAt: nowIso(),
    // A trim override was measured against the old blob's own timeline —
    // carrying it over would clip the wrong part of the freshly re-cut audio.
    trimStartMs: undefined,
    trimEndMs: undefined,
  };
  await db.transaction(
    'rw',
    db.sentenceAudio,
    db.referenceAlignments,
    db.referencePitchTracks,
    async () => {
      await db.sentenceAudio.put(updated);
      // Derived caches are keyed by audio id, so they'd otherwise keep
      // describing the old cut (stale pitch chart + kana ruler).
      await db.referenceAlignments.delete(sentenceAudioId);
      await db.referencePitchTracks.delete(sentenceAudioId);
    },
  );
  void pushReferenceAudioUpdate(updated);

  return { durationMs: clip.durationMs };
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = getDb();
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .toArray();
  await db.transaction('rw', db.books, db.bookSentences, async () => {
    await db.bookSentences.where('bookId').equals(bookId).delete();
    await db.books.delete(bookId);
  });
  notifySyncMany([
    ...memberships.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: { id: item.id },
      operation: 'delete' as const,
    })),
    {
      entity: 'books',
      recordId: bookId,
      payload: { id: bookId },
      operation: 'delete',
    },
  ]);
}

/**
 * Delete a book and retire every sentence that would be left orphaned by its
 * removal — i.e. sentences whose only book membership is this one. Sentences
 * shared with another book are kept; only their membership in this book is
 * dropped (same as `deleteBook`). Each orphan goes through the same cascade as
 * `deleteSentenceCascade` (analysis, vocab/grammar links, sentence-subject
 * study items, inbox entry), all soft-deleted via the normal queued `delete`.
 */
export async function deleteBookCascade(bookId: string): Promise<void> {
  const db = getDb();
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .toArray();

  const orphanSentenceIds: string[] = [];
  const sharedMembershipIds: string[] = [];
  for (const membership of memberships) {
    const all = await db.bookSentences
      .where('sentenceId')
      .equals(membership.sentenceId)
      .toArray();
    if (all.some((item) => item.bookId !== bookId)) {
      sharedMembershipIds.push(membership.id);
    } else {
      orphanSentenceIds.push(membership.sentenceId);
    }
  }

  const sink: PendingSyncOp[] = [];
  let sinkTracked = false;
  let changedSessions: PlannerSession[] = [];
  await db.transaction(
    'rw',
    [
      db.books,
      db.sentences,
      db.bookSentences,
      db.analyses,
      db.sentenceVocabulary,
      db.sentenceGrammar,
      db.studyItems,
      db.inbox,
      db.sentenceAudio,
      db.plannerSessions,
      db.syncMeta,
      db.syncQueue,
      db.syncRecordMeta,
    ],
    async () => {
      for (const sentenceId of orphanSentenceIds) {
        await cascadeRetireSentenceLocal(db, sentenceId, sink);
      }
      changedSessions = await dropSentencesFromOpenSessionsLocal(db, new Set(orphanSentenceIds));
      // Shared sentences survive — just drop this book's membership.
      for (const membershipId of sharedMembershipIds) {
        await db.bookSentences.delete(membershipId);
        sink.push({
          entity: 'book_sentences',
          recordId: membershipId,
          payload: { id: membershipId },
          operation: 'delete',
        });
      }
      await db.books.delete(bookId);
      sink.push({
        entity: 'books',
        recordId: bookId,
        payload: { id: bookId },
        operation: 'delete',
      });
      sinkTracked = await trackSinkInTransaction(sink);
    },
  );
  finishSinkAfterCommit(sink, sinkTracked);
  for (const session of changedSessions) notifySync('planner_sessions', session.id, session);
}

export async function duplicateBookOrdering(bookId: string): Promise<Book> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found');
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const copy = await createBook({
    title: `${book.title} (copy)`,
    subtitle: book.subtitle,
    sourceUrl: book.sourceUrl,
    notes: book.notes,
  });
  const chapterIdMap = new Map(
    (book.chapters ?? []).map((chapter) => [
      chapter.id,
      createId('chapter'),
    ]),
  );
  copy.chapters = (book.chapters ?? []).map((chapter) => ({
    ...chapter,
    id: chapterIdMap.get(chapter.id)!,
  }));
  await db.books.put(copy);
  const timestamp = nowIso();
  const copies = memberships.map((item) => ({
    ...item,
    id: createId('bs'),
    bookId: copy.id,
    addedAt: timestamp,
    lastStudiedAt: undefined,
    chapterId: item.chapterId
      ? chapterIdMap.get(item.chapterId)
      : undefined,
  }));
  await db.bookSentences.bulkPut(copies);
  notifySync('books', copy.id, copy);
  notifySyncMany(
    copies.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
  );
  return copy;
}

export async function createBookChapter(
  bookId: string,
  title: string,
): Promise<BookChapter> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found');
  const chapters = book.chapters ?? [];
  const chapter: BookChapter = {
    id: createId('chapter'),
    title: title.trim() || `Chapter ${chapters.length + 1}`,
    position: chapters.length,
  };
  await db.books.put({
    ...book,
    chapters: [...chapters, chapter],
    updatedAt: nowIso(),
  });
  const updated = await db.books.get(bookId);
  if (updated) notifySync('books', updated.id, updated);
  return chapter;
}

/**
 * Give a chapterless book one real "Whole book" chapter and move every
 * sentence into it, so episode preparation (which is chapter-scoped) works for
 * it. Deliberately does nothing to a book that already has chapters — its
 * unassigned sentences stay as the user left them.
 */
export async function ensureDefaultBookChapter(bookId: string): Promise<string | undefined> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found');
  if ((book.chapters ?? []).length > 0) return undefined;
  const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
  if (memberships.length === 0) return undefined;
  const chapter = await createBookChapter(bookId, 'Whole book');
  await assignBookSentencesToChapter(bookId, memberships.map((item) => item.sentenceId), chapter.id);
  return chapter.id;
}

/** Reorders a book's chapters by the episode number in their titles. Returns how many chapters changed position. */
export async function sortBookChaptersByEpisodeNumber(bookId: string): Promise<number> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found');
  const chapters = book.chapters ?? [];
  const orderedIds = chapterIdsByEpisodeNumber(chapters);
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const reordered = orderedIds.map((id, position) => ({ ...byId.get(id)!, position }));
  const changed = reordered.filter((chapter) => byId.get(chapter.id)!.position !== chapter.position).length;
  if (changed === 0) return 0;
  await db.books.put({ ...book, chapters: reordered, updatedAt: nowIso() });
  const updated = await db.books.get(bookId);
  if (updated) notifySync('books', updated.id, updated);
  return changed;
}

export async function updateBookChapter(
  bookId: string,
  chapterId: string,
  patch: { title?: string; position?: number },
): Promise<void> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found');
  const chapters = [...(book.chapters ?? [])];
  const currentIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (currentIndex < 0) throw new Error('Chapter not found');
  const current = chapters[currentIndex]!;
  const requestedPosition = patch.position ?? current.position;
  const targetPosition = Math.max(
    0,
    Math.min(chapters.length - 1, requestedPosition),
  );
  const updated = {
    ...current,
    title: patch.title?.trim() || current.title,
  };
  chapters.splice(currentIndex, 1);
  chapters.splice(targetPosition, 0, updated);
  await db.books.put({
    ...book,
    chapters: chapters.map((chapter, position) => ({ ...chapter, position })),
    updatedAt: nowIso(),
  });
  const updatedBook = await getDb().books.get(bookId);
  if (updatedBook) notifySync('books', updatedBook.id, updatedBook);
}

export async function deleteBookChapter(
  bookId: string,
  chapterId: string,
): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.books, db.bookSentences, async () => {
    const book = await db.books.get(bookId);
    if (!book) throw new Error('Book not found');
    const chapters = (book.chapters ?? [])
      .filter((chapter) => chapter.id !== chapterId)
      .map((chapter, position) => ({ ...chapter, position }));
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .toArray();
    await db.bookSentences.bulkPut(
      memberships
        .filter((item) => item.chapterId === chapterId)
        .map((item) => ({ ...item, chapterId: undefined })),
    );
    await db.books.put({
      ...book,
      chapters,
      collapsedChapterIds: (book.collapsedChapterIds ?? []).filter(
        (id) => id !== chapterId,
      ),
      updatedAt: nowIso(),
    });
  });
  const updated = await getDb().books.get(bookId);
  if (updated) notifySync('books', updated.id, updated);
  const cleared = await getDb()
    .bookSentences.where('bookId')
    .equals(bookId)
    .toArray();
  notifySyncMany(
    cleared.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
  );
}

/** Persist which chapter/episode sections are folded on the book list. */
export async function setBookCollapsedChapterIds(
  bookId: string,
  collapsedChapterIds: readonly string[],
): Promise<void> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found');
  const unique = [...new Set(collapsedChapterIds)];
  await db.books.put({
    ...book,
    collapsedChapterIds: unique,
    updatedAt: nowIso(),
  });
  const updated = await db.books.get(bookId);
  if (updated) notifySync('books', updated.id, updated);
}

/**
 * Attaches `sentenceIds` to `chapterId` within `bookId` as part of an
 * import — distinct from `assignBookSentencesToChapter` below (the
 * user-facing "move to a different chapter" action on `BookDetailPage`),
 * which unconditionally reassigns every named sentence's single membership
 * row. That's correct for a deliberate user move, but wrong here: a
 * sentence reused verbatim across podcast episodes (a boilerplate
 * intro/outro line) already has some *other* episode's chapter on its one
 * BookSentence row, and reassigning it would silently steal the line out of
 * whichever episode already claims it. Instead: a sentence with no chapter
 * yet (freshly added by `addSentencesToBook` moments ago, or an old
 * chapterless row) gets assigned in place; one that already fully belongs
 * to a *different* chapter gets its own new row for this chapter, so both
 * episodes keep their copy of the line. The database has no uniqueness
 * constraint on (book_id, sentence_id), so this doesn't need a migration —
 * but `reorderBookSentences`/`reorderChaptersChronologically` had to learn
 * to disambiguate rows by id instead of assuming one row per sentenceId.
 */
async function attachSentencesToChapterForImport(
  bookId: string,
  sentenceIds: string[],
  chapterId: string,
): Promise<void> {
  const db = getDb();
  const timestamp = nowIso();
  await db.transaction('rw', db.bookSentences, db.books, async () => {
    const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
    const rowsBySentence = new Map<string, BookSentence[]>();
    for (const item of memberships) {
      const list = rowsBySentence.get(item.sentenceId);
      if (list) list.push(item);
      else rowsBySentence.set(item.sentenceId, [item]);
    }
    let nextPosition =
      memberships.reduce((max, item) => Math.max(max, item.position), -1) + 1;
    const toUpdate: BookSentence[] = [];
    const toCreate: BookSentence[] = [];
    for (const sentenceId of sentenceIds) {
      const rows = rowsBySentence.get(sentenceId) ?? [];
      if (rows.some((row) => row.chapterId === chapterId)) continue; // already here
      const unassigned = rows.find((row) => !row.chapterId);
      if (unassigned) {
        toUpdate.push({ ...unassigned, chapterId });
        continue;
      }
      // No row at all, or every existing row belongs to a different
      // chapter — either way this chapter needs its own.
      toCreate.push({
        id: createId('bs'),
        bookId,
        sentenceId,
        chapterId,
        position: nextPosition++,
        status: 'unstarted',
        addedAt: timestamp,
      });
    }
    if (toUpdate.length) await db.bookSentences.bulkPut(toUpdate);
    if (toCreate.length) await db.bookSentences.bulkPut(toCreate);
    const book = await db.books.get(bookId);
    if (book) await db.books.put({ ...book, updatedAt: timestamp });
  });
  const updated = await getDb().bookSentences.where('bookId').equals(bookId).toArray();
  const touchedIds = new Set(sentenceIds);
  notifySyncMany(
    updated
      .filter((item) => touchedIds.has(item.sentenceId))
      .map((item) => ({
        entity: 'book_sentences' as const,
        recordId: item.id,
        payload: item,
      })),
  );
}

export async function assignBookSentencesToChapter(
  bookId: string,
  sentenceIds: string[],
  chapterId?: string,
): Promise<void> {
  const db = getDb();
  const selectedIds = new Set(sentenceIds);
  await db.transaction('rw', db.books, db.bookSentences, async () => {
    const book = await db.books.get(bookId);
    if (!book) throw new Error('Book not found');
    if (
      chapterId &&
      !(book.chapters ?? []).some((chapter) => chapter.id === chapterId)
    ) {
      throw new Error('Chapter not found');
    }
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .toArray();
    await db.bookSentences.bulkPut(
      memberships
        .filter((item) => selectedIds.has(item.sentenceId))
        .map((item) => ({ ...item, chapterId })),
    );
    await db.books.put({ ...book, updatedAt: nowIso() });
  });
  const updatedMemberships = await getDb()
    .bookSentences.where('bookId')
    .equals(bookId)
    .toArray();
  notifySyncMany(
    updatedMemberships
      .filter((item) => selectedIds.has(item.sentenceId))
      .map((item) => ({
        entity: 'book_sentences' as const,
        recordId: item.id,
        payload: item,
      })),
  );
}

export async function touchBookOpened(bookId: string): Promise<void> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) return;
  const timestamp = nowIso();
  await db.books.put({
    ...book,
    lastOpenedAt: timestamp,
    updatedAt: timestamp,
  });
  const settings = await ensureSettings(db);
  await db.settings.put({ ...settings, lastOpenedBookId: bookId });
}

export async function addSentencesToBook(
  bookId: string,
  sentenceIds: string[],
): Promise<void> {
  const db = getDb();
  const existing = await db.bookSentences.where('bookId').equals(bookId).toArray();
  const existingIds = new Set(existing.map((item) => item.sentenceId));
  const toAddIds = sentenceIds.filter((id) => !existingIds.has(id));
  if (!toAddIds.length) return;

  const sentences = await db.sentences.bulkGet(toAddIds);
  const ordered = sortByFirstOccurrence(sentences.filter((item): item is Sentence => Boolean(item)));
  const maxPosition = existing.reduce(
    (max, item) => Math.max(max, item.position),
    -1,
  );
  const timestamp = nowIso();
  const additions = ordered.map((sentence, index) => ({
    id: createId('bs'),
    bookId,
    sentenceId: sentence.id,
    position: maxPosition + 1 + index,
    status: 'unstarted' as StudyStatus,
    addedAt: timestamp,
  }));
  await db.bookSentences.bulkPut(additions);
  await db.inbox.bulkDelete(toAddIds);
  const book = await db.books.get(bookId);
  if (book) {
    await db.books.put({ ...book, updatedAt: timestamp });
    notifySync('books', book.id, { ...book, updatedAt: timestamp });
  }
  notifySyncMany([
    ...additions.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
    ...toAddIds.map((id) => ({
      entity: 'inbox' as const,
      recordId: id,
      payload: { sentenceId: id },
      operation: 'delete' as const,
    })),
  ]);
}

export async function removeSentencesFromBook(
  bookId: string,
  sentenceIds: string[],
): Promise<BookSentence[]> {
  const db = getDb();
  const snapshot = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  await db.transaction('rw', db.bookSentences, db.books, async () => {
    for (const sentenceId of sentenceIds) {
      await db.bookSentences
        .where('[bookId+sentenceId]')
        .equals([bookId, sentenceId])
        .delete();
    }
    const remaining = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .sortBy('position');
    await db.bookSentences.bulkPut(
      remaining.map((item, index) => ({ ...item, position: index })),
    );
    const book = await db.books.get(bookId);
    if (book) {
      await db.books.put({ ...book, updatedAt: nowIso() });
    }
  });
  const removed = snapshot.filter((item) => sentenceIds.includes(item.sentenceId));
  const remaining = await getDb()
    .bookSentences.where('bookId')
    .equals(bookId)
    .toArray();
  notifySyncMany([
    ...removed.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: { id: item.id },
      operation: 'delete' as const,
    })),
    ...remaining.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
  ]);
  return snapshot;
}

export async function restoreBookSentenceSnapshot(
  bookId: string,
  snapshot: BookSentence[],
): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.bookSentences, db.books, async () => {
    await db.bookSentences.where('bookId').equals(bookId).delete();
    await db.bookSentences.bulkPut(
      snapshot.map((item, position) => ({ ...item, position })),
    );
    const book = await db.books.get(bookId);
    if (book) {
      await db.books.put({ ...book, updatedAt: nowIso() });
    }
  });
}

export async function transferBookSentences(options: {
  sourceBookId: string;
  destinationBookId: string;
  sentenceIds: string[];
  mode: 'copy' | 'move';
}): Promise<void> {
  const db = getDb();
  if (options.sourceBookId === options.destinationBookId) return;
  const selectedIds = new Set(options.sentenceIds);
  const timestamp = nowIso();

  await db.transaction('rw', db.bookSentences, db.books, async () => {
    const [source, destination] = await Promise.all([
      db.bookSentences
        .where('bookId')
        .equals(options.sourceBookId)
        .sortBy('position'),
      db.bookSentences
        .where('bookId')
        .equals(options.destinationBookId)
        .sortBy('position'),
    ]);
    const destinationIds = new Set(destination.map((item) => item.sentenceId));
    const selectedMemberships = source.filter((item) =>
      selectedIds.has(item.sentenceId),
    );
    const additions = selectedMemberships
      .filter((item) => !destinationIds.has(item.sentenceId))
      .map((item, index) => ({
        ...item,
        id: createId('bs'),
        bookId: options.destinationBookId,
        position: destination.length + index,
        addedAt: timestamp,
        chapterId: undefined,
      }));
    if (additions.length) {
      await db.bookSentences.bulkPut(additions);
    }

    if (options.mode === 'move') {
      await db.bookSentences.bulkDelete(
        selectedMemberships.map((item) => item.id),
      );
      const remaining = source.filter(
        (item) => !selectedIds.has(item.sentenceId),
      );
      await db.bookSentences.bulkPut(
        remaining.map((item, position) => ({ ...item, position })),
      );
    }

    const touchedBooks = await db.books.bulkGet([
      options.sourceBookId,
      options.destinationBookId,
    ]);
    await db.books.bulkPut(
      touchedBooks
        .filter((book): book is Book => Boolean(book))
        .map((book) => ({ ...book, updatedAt: timestamp })),
    );
  });
}

/**
 * Absorb a whole book into another book as a new chapter, preserving study
 * progress (it lives on study_items keyed by sentence, not on book_sentences,
 * so repointing bookId/chapterId in place carries it across untouched), then
 * delete the now-empty source book. UI counterpart of
 * scripts/merge-book-into-chapter.ts, for e.g. a standalone shadowing-package
 * episode import that should have joined an existing series book.
 *
 * The source's own chapters travel with it: a source holding several episode
 * chapters lands as the same several chapters (titles, source ids and dates
 * kept), and a single-chapter source lands under that chapter's title rather
 * than the book's — an imported podcast book is titled after the series, not
 * the episode. Only a source with no real chapter falls back to the book title.
 *
 * If a source sentence already exists in the target book, the source's
 * membership is dropped instead of moved (the target's copy wins), promoting
 * the target's status only if it was still 'unstarted'.
 */
export async function mergeBookIntoChapter(options: {
  sourceBookId: string;
  targetBookId: string;
  chapterTitle?: string;
  /** Fill this existing chapter of the target instead of adding a new one. */
  intoChapterId?: string;
}): Promise<{
  chapterId: string;
  chapterCount: number;
  movedCount: number;
  collisionCount: number;
  reusedChapter: boolean;
}> {
  const db = getDb();
  const { sourceBookId, targetBookId } = options;
  if (sourceBookId === targetBookId) {
    throw new Error('Source and target book are the same.');
  }
  const timestamp = nowIso();

  let plans: MergeChapterPlan[] = [];
  let updatedTarget: Book | undefined;
  let movedMemberships: BookSentence[] = [];
  let promotedTargets: BookSentence[] = [];
  let collisions: BookSentence[] = [];
  let repointedExtras: SentenceExtras[] = [];

  await db.transaction('rw', db.books, db.bookSentences, db.sentenceExtras, async () => {
    const [source, target] = await Promise.all([
      db.books.get(sourceBookId),
      db.books.get(targetBookId),
    ]);
    if (!source) throw new Error('Source book not found');
    if (!target) throw new Error('Target book not found');

    const [sourceMemberships, targetMemberships] = await Promise.all([
      db.bookSentences.where('bookId').equals(sourceBookId).sortBy('position'),
      db.bookSentences.where('bookId').equals(targetBookId).sortBy('position'),
    ]);
    const targetBySentenceId = new Map(
      targetMemberships.map((item) => [item.sentenceId, item]),
    );
    const maxTargetPosition = targetMemberships.reduce(
      (max, item) => Math.max(max, item.position),
      -1,
    );

    const toMove = sourceMemberships.filter(
      (item) => !targetBySentenceId.has(item.sentenceId),
    );
    collisions = sourceMemberships.filter((item) =>
      targetBySentenceId.has(item.sentenceId),
    );

    plans = planMergedChapters({
      source,
      sourceMemberships,
      targetChapters: target.chapters ?? [],
      targetMemberships,
      chapterTitle: options.chapterTitle,
      intoChapterId: options.intoChapterId,
    });
    const firstChapterId = plans[0]!.chapter.id;
    const planBySourceChapterId = new Map(
      plans.flatMap((plan) => (plan.sourceChapterId ? [[plan.sourceChapterId, plan] as const] : [])),
    );
    const chapterIdFor = (item: BookSentence): string | undefined =>
      plans.length > 1
        ? planBySourceChapterId.get(item.chapterId ?? '')?.chapter.id
        : firstChapterId;

    movedMemberships = toMove.map((item, index) => {
      const { chapterId: _previous, ...rest } = item;
      const chapterId = chapterIdFor(item);
      return {
        ...rest,
        ...(chapterId ? { chapterId } : {}),
        bookId: targetBookId,
        position: maxTargetPosition + 1 + index,
        addedAt: timestamp,
      };
    });
    if (movedMemberships.length) {
      await db.bookSentences.bulkPut(movedMemberships);
    }

    promotedTargets = collisions
      .map((item) => targetBySentenceId.get(item.sentenceId)!)
      .filter((targetItem, index) => {
        const sourceItem = collisions[index]!;
        return (
          targetItem.status === 'unstarted' &&
          sourceItem.status !== 'unstarted'
        );
      });
    if (promotedTargets.length) {
      const promotedBySentenceId = new Map(
        collisions.map((item) => [item.sentenceId, item.status]),
      );
      promotedTargets = promotedTargets.map((item) => ({
        ...item,
        status: promotedBySentenceId.get(item.sentenceId)!,
      }));
      await db.bookSentences.bulkPut(promotedTargets);
    }
    if (collisions.length) {
      await db.bookSentences.bulkDelete(collisions.map((item) => item.id));
    }

    // AI chunk/walkthrough drafts live in sentence_extras stamped with the book
    // and chapter they were made for; without repointing, they'd be orphaned
    // under the deleted source book and the target would show them as missing.
    const chapterBySentenceId = new Map<string, string | undefined>([
      ...collisions.map((item) => [item.sentenceId, targetBySentenceId.get(item.sentenceId)?.chapterId] as const),
      ...movedMemberships.map((item) => [item.sentenceId, item.chapterId] as const),
    ]);
    const sourceExtras = await db.sentenceExtras.where('bookId').equals(sourceBookId).toArray();
    repointedExtras = sourceExtras.map((row) => ({
      ...row,
      bookId: targetBookId,
      chapterId: chapterBySentenceId.get(row.id) ?? plans[0]!.chapter.id,
      updatedAt: timestamp,
    }));
    if (repointedExtras.length) await db.sentenceExtras.bulkPut(repointedExtras);

    updatedTarget = {
      ...target,
      chapters: [
        ...(target.chapters ?? []),
        ...plans.filter((plan) => !plan.reused).map((plan) => plan.chapter),
      ],
      updatedAt: timestamp,
    };
    await db.books.put(updatedTarget);
    await db.books.delete(sourceBookId);
  });

  notifySyncMany([
    ...movedMemberships.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
    ...promotedTargets.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
    ...collisions.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: { id: item.id },
      operation: 'delete' as const,
    })),
  ]);
  for (const row of repointedExtras) notifySync('sentence_extras', row.id, row);
  if (updatedTarget) notifySync('books', targetBookId, updatedTarget);
  notifySync('books', sourceBookId, { id: sourceBookId }, 'delete');

  return {
    chapterId: plans[0]!.chapter.id,
    chapterCount: plans.length,
    movedCount: movedMemberships.length,
    collisionCount: collisions.length,
    reusedChapter: plans.every((plan) => plan.reused),
  };
}

export interface MergeChapterPlan {
  chapter: BookChapter;
  /** The target's existing empty chapter being filled, rather than a new one. */
  reused: boolean;
  /** Source chapter whose sentences land here (unset for explicit/single-chapter plans). */
  sourceChapterId?: string;
}

/**
 * Decides which target chapter(s) a merged-in book's sentences land in.
 * Pure so the title/chapter rules are testable without Dexie.
 */
export function planMergedChapters(input: {
  source: Pick<Book, 'title' | 'sourceUrl' | 'sourceKey' | 'createdAt' | 'chapters'>;
  sourceMemberships: readonly Pick<BookSentence, 'chapterId'>[];
  targetChapters: readonly BookChapter[];
  targetMemberships: readonly Pick<BookSentence, 'chapterId'>[];
  chapterTitle?: string;
  intoChapterId?: string;
}): MergeChapterPlan[] {
  const { source, targetChapters } = input;
  if (input.intoChapterId) {
    const chapter = targetChapters.find((item) => item.id === input.intoChapterId);
    if (!chapter) throw new Error('Chapter not found in the target book');
    return [{ chapter, reused: true }];
  }

  const used = new Set(input.sourceMemberships.map((item) => item.chapterId));
  const populated = (source.chapters ?? [])
    .filter((item) => used.has(item.id))
    .sort((a, b) => a.position - b.position);
  const fallbackSourceId = source.sourceUrl ?? source.sourceKey ?? undefined;
  const claimed: BookChapter[] = [];
  let added = 0;
  const taken = [...input.targetMemberships];
  const place = (template: BookChapter | undefined, title: string, sourceChapterId?: string): MergeChapterPlan => {
    const sourceId = template?.sourceId ?? fallbackSourceId;
    const reusable = findReusableChapter(
      targetChapters.filter((item) => !claimed.includes(item)),
      taken,
      { title, sourceId },
    );
    if (reusable) {
      claimed.push(reusable);
      return { chapter: reusable, reused: true, sourceChapterId };
    }
    const sourceDate = template?.sourceDate ?? source.createdAt;
    const chapter: BookChapter = {
      ...(template ?? {}),
      id: createId('chapter'),
      title,
      position: targetChapters.length + added,
      ...(sourceId ? { sourceId } : {}),
      ...(sourceDate ? { sourceDate } : {}),
    };
    added += 1;
    claimed.push(chapter);
    return { chapter, reused: false, sourceChapterId };
  };

  if (populated.length > 1) {
    return populated.map((item) => place(item, item.title.trim() || source.title, item.id));
  }
  // The dialog pre-fills the book title; treat that as "no override" so the
  // episode's own chapter title wins.
  const override = input.chapterTitle?.trim();
  const only = populated[0];
  const title =
    (override && override !== source.title.trim() ? override : only?.title.trim() || source.title.trim()) ||
    `Chapter ${targetChapters.length + 1}`;
  return [place(only, title, only?.id)];
}

/**
 * An empty chapter of the target that the incoming book was meant to fill —
 * typically the placeholder a feed listing created for an episode that was then
 * imported as a standalone book. Matches by source id first, then by exact
 * title, and only when exactly one candidate matches (never guesses).
 */
export function findReusableChapter(
  chapters: readonly BookChapter[],
  memberships: readonly Pick<BookSentence, 'chapterId'>[],
  incoming: { title: string; sourceId?: string },
): BookChapter | undefined {
  const used = new Set(memberships.map((item) => item.chapterId));
  const empty = chapters.filter((chapter) => !used.has(chapter.id));
  const bySource = incoming.sourceId ? empty.filter((chapter) => chapter.sourceId === incoming.sourceId) : [];
  if (bySource.length) return bySource.length === 1 ? bySource[0] : undefined;
  const byTitle = empty.filter((chapter) => chapter.title.trim() === incoming.title);
  return byTitle.length === 1 ? byTitle[0] : undefined;
}

export async function reorderBookSentences(
  bookId: string,
  orderedSentenceIds: string[],
  options: {
    /**
     * Scope matching to one chapter's own membership row for each
     * sentenceId — needed once a sentence can have more than one
     * BookSentence row in the same book (one per chapter it's reused in,
     * see attachSentencesToChapterForImport). Without this, a shared
     * sentenceId would resolve to an arbitrary one of its rows and the
     * other would get silently shoved to the end as a "leftover."
     */
    chapterId?: string;
    /**
     * The caller queues the sync itself (see `notifyMovedBookSentences`), e.g.
     * because a second reorder follows and most rows end where they started.
     */
    skipSync?: boolean;
  } = {},
): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.bookSentences, db.books, async () => {
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .toArray();
    const inScope = (item: BookSentence) =>
      options.chapterId === undefined || item.chapterId === options.chapterId;
    const bySentence = new Map<string, BookSentence>();
    for (const item of memberships) {
      if (inScope(item)) bySentence.set(item.sentenceId, item);
    }
    const usedRowIds = new Set<string>();
    const ordered: BookSentence[] = [];
    for (const sentenceId of orderedSentenceIds) {
      const row = bySentence.get(sentenceId);
      if (!row || usedRowIds.has(row.id)) continue;
      usedRowIds.add(row.id);
      ordered.push(row);
    }
    // Keep any memberships missing from the payload at the end (prior
    // relative order) — includes every row outside the chapter scope, so
    // an in-scope duplicate's sibling row elsewhere is never touched here.
    const leftovers = memberships
      .filter((item) => !usedRowIds.has(item.id))
      .sort((a, b) => a.position - b.position);
    const fullOrder = [...ordered, ...leftovers];
    const updates = fullOrder.map((row, index) => ({
      ...row,
      position: index,
    }));
    await db.bookSentences.bulkPut(updates);
    const book = await db.books.get(bookId);
    if (book) {
      await db.books.put({ ...book, updatedAt: nowIso() });
    }
  });
  if (options.skipSync) return;
  const memberships = await getDb()
    .bookSentences.where('bookId')
    .equals(bookId)
    .toArray();
  notifySyncMany(
    memberships.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
  );
}

/**
 * Queues only the membership rows whose position differs from `before` (an
 * id → position snapshot). A series import re-sorts the whole book twice
 * (`reorderBookSentences` then `reorderChaptersChronologically`) and used to
 * queue every row each time: importing a dozen episodes out of date order left
 * 2000+ pushes that stalled on a phone (2026-11-06).
 */
async function notifyMovedBookSentences(
  bookId: string,
  before: Map<string, number>,
): Promise<void> {
  const memberships = await getDb().bookSentences.where('bookId').equals(bookId).toArray();
  notifySyncMany(
    memberships
      .filter((item) => before.get(item.id) !== item.position)
      .map((item) => ({
        entity: 'book_sentences' as const,
        recordId: item.id,
        payload: item,
      })),
  );
}

export async function previewBookOrderFromPaste(
  bookId: string,
  paste: string,
): Promise<
  PasteOrderResult & {
    matchedJapanese: string[];
    unmatchedJapanese: string[];
  }
> {
  const db = getDb();
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const sentences = await db.sentences.bulkGet(
    memberships.map((item) => item.sentenceId),
  );
  const orderedInput = memberships.map((membership, index) => {
    const sentence = sentences[index];
    return {
      id: membership.sentenceId,
      japanese: sentence?.japanese ?? '',
    };
  });
  const result = orderBookSentencesFromPaste(paste, orderedInput);
  const byId = new Map(
    orderedInput.map((sentence) => [sentence.id, sentence.japanese]),
  );
  return {
    ...result,
    matchedJapanese: result.matchedIds.map((id) => byId.get(id) ?? ''),
    unmatchedJapanese: result.unmatchedIds.map((id) => byId.get(id) ?? ''),
  };
}

export async function reorderBookFromPaste(
  bookId: string,
  paste: string,
): Promise<
  PasteOrderResult & {
    matchedJapanese: string[];
    unmatchedJapanese: string[];
  }
> {
  const preview = await previewBookOrderFromPaste(bookId, paste);
  if (preview.matchedIds.length) {
    await reorderBookSentences(bookId, preview.orderedIds);
  }
  return preview;
}

export async function moveBookSentence(
  bookId: string,
  sentenceId: string,
  action: 'up' | 'down' | 'top' | 'bottom' | number,
): Promise<void> {
  const db = getDb();
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const ids = memberships.map((item) => item.sentenceId);
  const from = ids.indexOf(sentenceId);
  if (from < 0) return;
  let to = from;
  if (action === 'up') to = Math.max(0, from - 1);
  else if (action === 'down') to = Math.min(ids.length - 1, from + 1);
  else if (action === 'top') to = 0;
  else if (action === 'bottom') to = ids.length - 1;
  else to = Math.max(0, Math.min(ids.length - 1, action - 1));
  if (to === from) return;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, sentenceId);
  await reorderBookSentences(bookId, next);
}

export async function setBookSentenceStatus(
  bookId: string,
  sentenceId: string,
  status: StudyStatus,
): Promise<void> {
  const db = getDb();
  const item = await db.bookSentences
    .where('[bookId+sentenceId]')
    .equals([bookId, sentenceId])
    .first();
  if (!item) return;
  await db.bookSentences.put({
    ...item,
    status,
    lastStudiedAt: nowIso(),
  });
  const updated = await db.bookSentences.get(item.id);
  if (updated) notifySync('book_sentences', updated.id, updated);
  // Intentionally does not touch session steps — see confirmSentenceVocabulary
  // for why settlement is explicit-only (2026-08-27).
}


export interface RoleOccurrenceStats {
  count: number;
  firstSentenceId: string;
  mostRecentSentenceId: string;
}

/**
 * How many times each `AnalysisChunk.role` has been used across every
 * authored sentence, plus the first and most-recently-authored sentence
 * that used it — feeds the "you've seen this role before" fading callback
 * on `AnalyzePage` (Cure Dolly's "we saw this in lesson 3" callback
 * texture). Ordered by `SentenceAnalysis.createdAt` (when the chunk was
 * first authored, stable across later edits — `updatedAt` would misdate
 * "most recent" whenever an old sentence gets a correction), which tracks
 * the learner's actual authoring/encounter order well enough for a UI
 * nicety without needing real reading-order data.
 *
 * Full scan of `db.analyses`, not an indexed query — `role` lives embedded
 * inside each row's `chunks` array, not as its own indexed column. Cheap at
 * this corpus's scale (thousands of sentences); revisit with real
 * aggregation if it ever shows up as slow.
 */
export async function getRoleOccurrenceStats(
  excludeSentenceId?: string,
): Promise<Map<string, RoleOccurrenceStats>> {
  const db = getDb();
  const analyses = (await db.analyses.toArray())
    .filter((analysis) => analysis.sentenceId !== excludeSentenceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const stats = new Map<string, RoleOccurrenceStats>();
  for (const analysis of analyses) {
    for (const chunk of analysis.chunks) {
      const role = chunk.role.trim();
      if (!role) continue;
      const existing = stats.get(role);
      if (!existing) {
        stats.set(role, {
          count: 1,
          firstSentenceId: analysis.sentenceId,
          mostRecentSentenceId: analysis.sentenceId,
        });
      } else {
        existing.count += 1;
        existing.mostRecentSentenceId = analysis.sentenceId;
      }
    }
  }
  return stats;
}

export async function commitImport(options: {
  preview: ImportPreview;
  selectedIds: string[];
  destination: 'inbox' | 'new_book' | 'existing_book';
  bookId?: string;
  newBookTitle?: string;
  /** Assign imported sentences to this existing chapter on the target book. */
  chapterId?: string;
  /** Create a chapter with this title on the target book, then assign. */
  newChapterTitle?: string;
}): Promise<{ batchId: string; bookId?: string; chapterId?: string }> {
  const db = getDb();
  const batchId = createId('batch');
  const timestamp = nowIso();
  const selected = options.preview.drafts.filter((item) =>
    options.selectedIds.includes(item.proposedId),
  );

  const importSink: PendingSyncOp[] = [];
  let importSinkTracked = false;
  await db.transaction(
    'rw',
    [
      db.sentences,
      db.importBatches,
      db.inbox,
      db.books,
      db.bookSentences,
      db.syncMeta,
      db.syncQueue,
      db.syncRecordMeta,
    ],
    async () => {
      const sentenceIds: string[] = [];
      for (const item of selected) {
        const existing = await db.sentences
          .where('normalizedKey')
          .equals(item.draft.normalizedKey)
          .first();
        if (!existing) {
          const sentence: Sentence = {
            id: item.proposedId || sentenceIdFromNormalizedKey(item.draft.normalizedKey),
            ...item.draft,
            vocabularySuggestions: item.draft.vocabularySuggestions ?? [],
            sourceReferences: item.draft.sourceReferences.map((ref) => ({
              ...ref,
              importBatchId: batchId,
            })),
            importBatchIds: [batchId],
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await db.sentences.put(sentence);
          importSink.push({ entity: 'sentences', recordId: sentence.id, payload: sentence });
          sentenceIds.push(sentence.id);
        } else {
          const merged = mergeSentenceOnReimport(
            existing,
            item.draft,
            batchId,
          );
          const sentence: Sentence = {
            ...existing,
            ...merged,
            createdAt: existing.createdAt,
            updatedAt: timestamp,
          };
          await db.sentences.put(sentence);
          importSink.push({ entity: 'sentences', recordId: sentence.id, payload: sentence });
          sentenceIds.push(sentence.id);
        }
      }

      const batch: ImportBatch = {
        id: batchId,
        filename: options.preview.filename,
        batchName: options.preview.batchName,
        importedAt: timestamp,
        counts: {
          ...options.preview.counts,
          newSentences: selected.filter((item) => item.isNew).length,
          updatedSentences: selected.filter((item) => item.willUpdate).length,
        },
        warnings: options.preview.warnings.map((item) => item.message),
      };
      await db.importBatches.put(batch);
      importSink.push({ entity: 'import_batches', recordId: batch.id, payload: batch });

      if (options.destination === 'inbox') {
        const inboxRows = sentenceIds.map((sentenceId) => ({
          sentenceId,
          importBatchId: batchId,
          addedAt: timestamp,
        }));
        await db.inbox.bulkPut(inboxRows);
        for (const row of inboxRows) {
          importSink.push({ entity: 'inbox', recordId: row.sentenceId, payload: row });
        }
      }
      // Queue the sync rows in this transaction: sentences committed here used to
      // be enqueued many awaits later (after book/membership writes), and a
      // suspend in between stranded them unqueued.
      importSinkTracked = await trackSinkInTransaction(importSink);
    },
  );
  finishSinkAfterCommit(importSink, importSinkTracked);

  let bookId = options.bookId;
  const sentenceIds = selected.map((item) => item.proposedId);
  if (options.destination === 'new_book') {
    const book = await createBook({
      title: options.newBookTitle || options.preview.batchName,
    });
    bookId = book.id;
    await addSentencesToBook(
      book.id,
      sentenceIds,
    );
  } else if (options.destination === 'existing_book' && bookId) {
    await addSentencesToBook(
      bookId,
      sentenceIds,
    );
  }

  let chapterId = options.chapterId;
  const newChapterTitle = options.newChapterTitle?.trim();
  if (bookId && newChapterTitle) {
    const chapter = await createBookChapter(bookId, newChapterTitle);
    chapterId = chapter.id;
  }
  if (bookId && chapterId) {
    await attachSentencesToChapterForImport(bookId, sentenceIds, chapterId);
  }

  return { batchId, bookId, chapterId };
}

export async function previewShadowingPackageFile(
  file: File,
): Promise<ShadowingImportPreview> {
  const existing = await getDb().sentences.toArray();
  return parseShadowingPackage(file, existing);
}

/**
 * Import an entire shadowing project into one source-linked book.
 *
 * Reimporting the same source refreshes sentence metadata/audio and adds newly
 * mined sentences to the existing book. Existing analysis, study status, and
 * manual book ordering are preserved.
 */
export async function commitShadowingPackageImport(
  preview: ShadowingImportPreview,
): Promise<{ batchId: string; bookId: string; chapterId?: string; refreshed: boolean }> {
  const db = getDb();
  const sourceKey = `shadowing:${preview.source.id}`;
  const existingBook = await db.books
    .where('sourceKey')
    .equals(sourceKey)
    .first();
  const selectedIds = preview.drafts.map((item) => item.proposedId);

  const result = await commitImport({
    preview,
    selectedIds,
    destination: existingBook ? 'existing_book' : 'new_book',
    bookId: existingBook?.id,
    newBookTitle: preview.source.title,
    // A new book gets one chapter: per-sentence AI extras (chunking, walkthroughs) are
    // stored per chapter, so a chapterless book silently drops them.
    ...(existingBook ? {} : { newChapterTitle: preview.source.title }),
  });
  if (!result.bookId) throw new Error('Shadowing import did not create a book.');

  await updateBook(result.bookId, {
    sourceKey,
    title: preview.source.title,
    subtitle: preview.source.channel,
    sourceUrl: preview.source.url,
    notes: [
      'Imported from a japanese-shadowing-package project.',
      `Source project ID: ${preview.source.id}`,
      `Package generator: ${preview.manifest.generator.name} ${preview.manifest.generator.version}`,
    ].join('\n'),
  });

  // The shadowing package's video/extraction order is authoritative. Rewrite
  // membership positions to match it on every import, including reimports where
  // the book was previously reordered by hand. Analysis, status, chapters, and
  // notes are untouched because only bookSentences.position changes.
  await reorderBookSentences(result.bookId, selectedIds);

  await applySentenceAudioForPreview(result.bookId, preview);

  return {
    batchId: result.batchId,
    bookId: result.bookId,
    ...(result.chapterId ? { chapterId: result.chapterId } : {}),
    refreshed: Boolean(existingBook),
  };
}

/**
 * Write/refresh a preview's native audio clips as `SentenceAudio` rows
 * (keyed by `preview.source.id`, so re-committing the same episode/video
 * replaces its own clips without touching another episode's in a shared
 * book) and, if cloud audio sync is on, opportunistically upload them.
 * Shared by `commitShadowingPackageImport` (one book per source) and
 * `commitSeriesEpisodeImport` (one shared book per podcast/NHK-Easy series,
 * one chapter per episode/article) — the audio provenance is always
 * per-episode even when the book isn't.
 */
async function applySentenceAudioForPreview(
  bookId: string,
  preview: ShadowingImportPreview,
): Promise<void> {
  const db = getDb();
  const sentenceByKey = new Map(
    (await db.sentences.toArray()).map((sentence) => [
      sentence.normalizedKey,
      sentence,
    ]),
  );
  const importedAt = nowIso();
  const audioRecords = preview.audioDrafts
    .map((audio): SentenceAudio | null => {
      const sentence = sentenceByKey.get(audio.normalizedKey);
      if (!sentence) return null;
      return {
        id: `audio_${hashString(
          `${preview.source.id}:${audio.sourceSentenceId}`,
        )}`,
        sentenceId: sentence.id,
        sourceId: preview.source.id,
        sourceSentenceId: audio.sourceSentenceId,
        sourceTitle: preview.source.title,
        sourceUrl: preview.source.url,
        mimeType: audio.mimeType,
        durationMs: audio.durationMs,
        startMs: audio.startMs,
        endMs: audio.endMs,
        blob: audio.blob,
        importedAt,
      };
    })
    .filter((audio): audio is SentenceAudio => Boolean(audio));
  await db.transaction('rw', db.sentenceAudio, async () => {
    const existingAudio = await db.sentenceAudio
      .where('sourceId')
      .equals(preview.source.id)
      .toArray();
    const nextIds = new Set(audioRecords.map((audio) => audio.id));
    await db.sentenceAudio.bulkDelete(
      existingAudio
        .filter((audio) => !nextIds.has(audio.id))
        .map((audio) => audio.id),
    );
    await db.sentenceAudio.bulkPut(audioRecords);
  });

  // Optionally enqueue reference-audio metadata when cloud audio sync is on.
  void (async () => {
    try {
      const { ensureSyncMeta } = await import('../sync/queue');
      const { getSupabase } = await import('../sync/supabaseClient');
      const { uploadReferenceAudio } = await import('../sync/audioSync');
      const { syncLog } = await import('../sync/logger');
      const meta = await ensureSyncMeta();
      if (!meta.syncReferenceAudio) return;
      const supabase = getSupabase();
      const userId = (await supabase?.auth.getSession())?.data.session?.user
        ?.id;
      if (!userId) return;
      for (const audio of audioRecords) {
        // Isolate each clip's upload — one failure (network blip, transient
        // storage error) must not silently strand every clip after it in a
        // long import with no error surfaced anywhere (2026-09-27: ~half a
        // podcast episode's clips never reached Storage this way).
        try {
          await uploadReferenceAudio({ audio, bookId, ownerId: userId });
        } catch (err) {
          syncLog('warn', err instanceof Error ? err.message : String(err), 'AUDIO_UPLOAD_SKIP');
        }
      }
    } catch {
      // Local import must succeed even if optional audio upload fails.
    }
  })();
}

/**
 * Add one podcast episode's or NHK Easy article's sentences into a shared
 * per-series book (docs/ROADMAP.md "one book per podcast, one book overall
 * for NHK Easy") — every call sharing the same `seriesId` lands in the same
 * book, each as its own new chapter, chronologically ordered by
 * `sourceDate` regardless of import-click order (see
 * `reorderChaptersChronologically`).
 */
export async function commitSeriesEpisodeImport(options: {
  /** Stable id for the whole series (e.g. a hash of the podcast feed URL,
   * or a fixed constant for NHK Easy) — every episode/article with the same
   * seriesId lands in the same book. */
  seriesId?: string;
  seriesTitle?: string;
  seriesUrl?: string;
  /**
   * Add the episode to this existing book instead of finding/creating the
   * series book by `seriesId`. The book's own key, title and URL are left
   * as they are (it may be hand-made, with no `sourceKey` at all).
   */
  targetBookId?: string;
  episodeTitle: string;
  /**
   * The episode/article's identity within the series — the caller's own
   * as-picked feed URL, not the mining job's derived `preview.source.id`
   * (which depends on yt-dlp's internal id scheme and, for a podcast, can
   * differ from the feed's enclosure URL after redirect resolution). Used
   * both to dedup chapters on re-import and, by
   * `getSeriesImportedSourceIds`, to show an "already imported" mark on a
   * feed's episode/article picker before anything is fetched.
   */
  sourceId: string;
  /** Anything `Date.parse`-able (an RSS pubDate works as-is) — chapters
   * sort by this, not by import order. */
  sourceDate: string;
  preview: ShadowingImportPreview;
}): Promise<{ bookId: string; chapterId: string }> {
  const db = getDb();
  if (!options.targetBookId && !(options.seriesId && options.seriesTitle)) {
    throw new Error('Series episode import needs a target book or a series id and title.');
  }
  const sourceKey = `shadowing:${options.seriesId}`;
  const existingBook = options.targetBookId
    ? await db.books.get(options.targetBookId)
    : await db.books.where('sourceKey').equals(sourceKey).first();
  if (options.targetBookId && !existingBook) throw new Error('Target book not found.');
  // Match by the episode/article's own source id, not title — a title can
  // be edited upstream or, rarely, collide between two different episodes;
  // sourceId is what actually identifies "this is the same episode again."
  const existingChapter = existingBook?.chapters.find(
    (chapter) =>
      chapter.sourceId &&
      canonicalSourceId(chapter.sourceId) === canonicalSourceId(options.sourceId),
  );
  const selectedIds = options.preview.drafts.map((item) => item.proposedId);

  const result = await commitImport({
    preview: options.preview,
    selectedIds,
    destination: existingBook ? 'existing_book' : 'new_book',
    bookId: existingBook?.id,
    newBookTitle: options.seriesTitle ?? '',
    ...(existingChapter
      ? { chapterId: existingChapter.id }
      : { newChapterTitle: options.episodeTitle }),
  });
  if (!result.bookId || !result.chapterId) {
    throw new Error('Series episode import did not create a book/chapter.');
  }

  if (!options.targetBookId) {
    await updateBook(result.bookId, {
      sourceKey,
      title: options.seriesTitle!,
      ...(options.seriesUrl ? { sourceUrl: options.seriesUrl } : {}),
    });
  }
  const parsedDate = new Date(options.sourceDate);
  const sourceDate = Number.isNaN(parsedDate.getTime())
    ? nowIso()
    : parsedDate.toISOString();
  const book = await db.books.get(result.bookId);
  if (book) {
    await db.books.put({
      ...book,
      chapters: book.chapters.map((chapter) =>
        chapter.id === result.chapterId
          ? {
              ...chapter,
              title: options.episodeTitle,
              sourceId: options.sourceId,
              sourceDate,
            }
          : chapter,
      ),
      updatedAt: nowIso(),
    });
    const updated = await db.books.get(result.bookId);
    if (updated) notifySync('books', updated.id, updated);
  }

  // Fix this episode's own within-chapter order before the chronological
  // chapter cascade below, which only preserves each chapter's *existing*
  // relative order rather than re-deriving it. Needed because `commitImport`'s
  // initial `first_occurrence` sort trusts each Sentence's persisted
  // `firstOccurrenceIndex` — correct only the first time that exact text was
  // ever imported. A line reused verbatim across episodes (a podcast's
  // boilerplate intro/outro) keeps whichever episode's index it got *first*,
  // scrambling every later episode that reuses it. `selectedIds` is this
  // episode's own freshly-parsed, correctly-ordered draft list (mirrors
  // `commitShadowingPackageImport`'s identical fix below). Scoped to this
  // chapter: a reused sentenceId now has its own row per chapter (see
  // attachSentencesToChapterForImport), so an unscoped reorder could grab
  // the wrong one.
  const positionsBefore = new Map(
    (await db.bookSentences.where('bookId').equals(result.bookId).toArray()).map(
      (item) => [item.id, item.position] as const,
    ),
  );
  await reorderBookSentences(result.bookId, selectedIds, {
    chapterId: result.chapterId,
    skipSync: true,
  });
  // A hand-made target may hold undated chapters, which the date sort would push
  // behind the new episode; leave its order alone unless every chapter is dated.
  const targetChapters = (await db.books.get(result.bookId))?.chapters ?? [];
  if (!options.targetBookId || targetChapters.every((chapter) => chapter.sourceDate)) {
    await reorderChaptersChronologically(result.bookId, { skipSync: true });
  }
  await notifyMovedBookSentences(result.bookId, positionsBefore);
  await applySentenceAudioForPreview(result.bookId, options.preview);

  return { bookId: result.bookId, chapterId: result.chapterId };
}

/**
 * Every episode/article URL (canonicalised via `canonicalSourceId`; look up with it) already imported under this series (see
 * `commitSeriesEpisodeImport`), or an empty set if the series has no book
 * yet — lets a feed's episode/article picker show "already imported"
 * against its own as-listed URLs without fetching anything.
 *
 * Also matches any standalone book's `sourceUrl` (not just the series
 * book's chapters): episodes/articles imported before
 * `commitSeriesEpisodeImport` existed (01fa81a, 2026-09-13) landed as
 * their own single-chapter book instead of a chapter in the shared series
 * book, and were never retroactively merged ("Known gap" in that commit).
 * A standalone book's `sourceUrl` is exactly the enclosure/article URL the
 * picker already keys episodes by, so exact-string matching against it is
 * safe — a collision would mean two different podcasts serving the same
 * media file URL.
 */
export async function getSeriesImportedSourceIds(
  seriesId: string,
): Promise<Set<string>> {
  const db = getDb();
  const [seriesBook, allBooks, committedImports] = await Promise.all([
    db.books.where('sourceKey').equals(`shadowing:${seriesId}`).first(),
    db.books.toArray(),
    db.miningImports.where('status').equals('committed').toArray(),
  ]);
  const sourceIds = new Set(
    (seriesBook?.chapters ?? [])
      .map((chapter) => chapter.sourceId)
      .filter((sourceId): sourceId is string => Boolean(sourceId))
      .map(canonicalSourceId),
  );
  for (const book of allBooks) {
    if (book.sourceUrl) sourceIds.add(canonicalSourceId(book.sourceUrl));
  }
  // A committed tracking row survives a book being deleted, merged or not yet
  // synced to this device, any of which hides the episode from the checks above.
  for (const record of committedImports) sourceIds.add(canonicalSourceId(record.sourceId));
  return sourceIds;
}

/**
 * Re-sort a book's chapters by their `sourceDate` (oldest first) and cascade
 * that into `bookSentences.position` — chapter-major, each chapter's own
 * sentences kept in their existing relative order — so importing episode 3
 * after episode 5 still lands episode 3's chapter before episode 5's.
 * Chapters with no `sourceDate` (hand-created chapters in an unrelated book)
 * sort last, in their prior relative order — this is only ever called on
 * books `commitSeriesEpisodeImport` manages, where every chapter it created
 * has one.
 */
async function reorderChaptersChronologically(
  bookId: string,
  options: { skipSync?: boolean } = {},
): Promise<void> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) return;

  const withDate = book.chapters.filter((chapter) => chapter.sourceDate);
  const withoutDate = book.chapters.filter((chapter) => !chapter.sourceDate);
  withDate.sort((a, b) => a.sourceDate!.localeCompare(b.sourceDate!));
  const sortedChapters = [...withDate, ...withoutDate];
  const nextChapters = sortedChapters.map((chapter, position) => ({
    ...chapter,
    position,
  }));
  await db.books.put({ ...book, chapters: nextChapters, updatedAt: nowIso() });
  const updated = await db.books.get(bookId);
  if (updated) notifySync('books', updated.id, updated);

  const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
  const byChapter = new Map<string, BookSentence[]>();
  const unassigned: BookSentence[] = [];
  for (const membership of memberships) {
    if (!membership.chapterId) {
      unassigned.push(membership);
      continue;
    }
    const arr = byChapter.get(membership.chapterId);
    if (arr) arr.push(membership);
    else byChapter.set(membership.chapterId, [membership]);
  }
  // Built from the actual row objects (not sentenceId strings) so a sentence
  // reused across two chapters — each with its own BookSentence row since
  // attachSentencesToChapterForImport — repositions both rows correctly
  // instead of one shadowing the other.
  const orderedRows: BookSentence[] = [];
  for (const chapter of nextChapters) {
    const inChapter = (byChapter.get(chapter.id) ?? []).sort(
      (a, b) => a.position - b.position,
    );
    orderedRows.push(...inChapter);
  }
  unassigned.sort((a, b) => a.position - b.position);
  orderedRows.push(...unassigned);
  await db.bookSentences.bulkPut(
    orderedRows.map((row, index) => ({ ...row, position: index })),
  );
  if (options.skipSync) return;
  const updatedMemberships = await getDb()
    .bookSentences.where('bookId')
    .equals(bookId)
    .toArray();
  notifySyncMany(
    updatedMemberships.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: item,
    })),
  );
}

export async function renameImportBatch(
  batchId: string,
  batchName: string,
): Promise<void> {
  const db = getDb();
  const batch = await db.importBatches.get(batchId);
  if (!batch) throw new Error('Import batch not found');
  await db.importBatches.put({
    ...batch,
    batchName: batchName.trim() || batch.batchName,
  });
  const updated = await db.importBatches.get(batchId);
  if (updated) notifySync('import_batches', updated.id, updated);
}

export async function exportFullBackup(): Promise<BackupPayload> {
  const db = getDb();
  const settings = await ensureSettings(db);
  const bundle: BackupBundle = {
    books: await Promise.all((await db.books.toArray()).map((book) => withChapterExtras(book))),
    sentences: await db.sentences.toArray(),
    bookSentences: await db.bookSentences.toArray(),
    analyses: await db.analyses.toArray(),
    importBatches: await db.importBatches.toArray(),
    inbox: await db.inbox.toArray(),
    studyItems: await db.studyItems.toArray(),
    reviews: await db.reviews.toArray(),
    vocabularyItems: await db.vocabularyItems.toArray(),
    sentenceVocabulary: await db.sentenceVocabulary.toArray(),
    kanji: await db.kanji.toArray(),
    vocabularyKanji: await db.vocabularyKanji.toArray(),
    grammarPatterns: await db.grammarPatterns.toArray(),
    sentenceGrammar: await db.sentenceGrammar.toArray(),
    grammarRelationships: await db.grammarRelationships.toArray(),
    plannerSessions: await db.plannerSessions.toArray(),
    settings,
  };
  return buildBackupPayload(bundle);
}

export async function exportBookBackup(bookId: string): Promise<BackupPayload> {
  const full = await exportFullBackup();
  const book = full.books.find((item) => item.id === bookId);
  if (!book) throw new Error('Book not found');
  const memberships = full.bookSentences.filter((item) => item.bookId === bookId);
  const sentenceIds = new Set(memberships.map((item) => item.sentenceId));
  const studyItems = full.studyItems.filter(
    (item) => item.subjectType === 'sentence' && sentenceIds.has(item.subjectId),
  );
  const studyItemIds = new Set(studyItems.map((item) => item.id));
  const sentenceVocabulary = full.sentenceVocabulary.filter((item) =>
    sentenceIds.has(item.sentenceId),
  );
  const vocabularyItemIds = new Set(
    sentenceVocabulary.map((item) => item.vocabularyItemId),
  );
  const vocabularyItems = full.vocabularyItems.filter((item) =>
    vocabularyItemIds.has(item.id),
  );
  const vocabularyKanji = full.vocabularyKanji.filter((item) =>
    vocabularyItemIds.has(item.vocabularyItemId),
  );
  const kanjiIds = new Set(vocabularyKanji.map((item) => item.kanjiId));
  const kanji = full.kanji.filter((item) => kanjiIds.has(item.id));
  const sentenceGrammar = full.sentenceGrammar.filter((item) =>
    sentenceIds.has(item.sentenceId),
  );
  const grammarPatternIds = new Set(
    sentenceGrammar.map((item) => item.grammarPatternId),
  );
  const grammarPatterns = full.grammarPatterns.filter((item) =>
    grammarPatternIds.has(item.id),
  );
  return buildBackupPayload({
    books: [book],
    sentences: full.sentences.filter((item) => sentenceIds.has(item.id)),
    bookSentences: memberships,
    analyses: full.analyses.filter((item) => sentenceIds.has(item.sentenceId)),
    importBatches: full.importBatches,
    inbox: [],
    studyItems,
    reviews: full.reviews.filter((item) => studyItemIds.has(item.studyItemId)),
    vocabularyItems,
    sentenceVocabulary,
    kanji,
    vocabularyKanji,
    // grammarRelationships excluded from book scope — corpus-wide, spans
    // patterns not necessarily both encountered within this one book.
    grammarPatterns,
    sentenceGrammar,
    grammarRelationships: [],
    // Not book-scoped, same reasoning as grammarRelationships above.
    plannerSessions: [],
    settings: full.settings,
  });
}

export async function restoreBackup(
  payload: BackupPayload,
  mode: 'merge' | 'replace',
): Promise<void> {
  const db = getDb();
  const tables = [
    db.books,
    db.sentences,
    db.bookSentences,
    db.analyses,
    db.importBatches,
    db.inbox,
    db.studyItems,
    db.reviews,
    db.vocabularyItems,
    db.sentenceVocabulary,
    db.kanji,
    db.vocabularyKanji,
    db.grammarPatterns,
    db.sentenceGrammar,
    db.grammarRelationships,
    db.plannerSessions,
    db.settings,
    db.sentenceAudio,
  ] as const;

  if (mode === 'replace') {
    await db.transaction('rw', [...tables], async () => {
      await Promise.all([
        db.books.clear(),
        db.sentences.clear(),
        db.bookSentences.clear(),
        db.analyses.clear(),
        db.importBatches.clear(),
        db.inbox.clear(),
        db.studyItems.clear(),
        db.reviews.clear(),
        db.vocabularyItems.clear(),
        db.sentenceVocabulary.clear(),
        db.kanji.clear(),
        db.vocabularyKanji.clear(),
        db.grammarPatterns.clear(),
        db.sentenceGrammar.clear(),
        db.grammarRelationships.clear(),
        db.plannerSessions.clear(),
      ]);
      await db.books.bulkPut(payload.books);
      await db.sentences.bulkPut(payload.sentences);
      await db.bookSentences.bulkPut(payload.bookSentences);
      await db.analyses.bulkPut(payload.analyses);
      await db.importBatches.bulkPut(payload.importBatches);
      await db.inbox.bulkPut(payload.inbox);
      await db.studyItems.bulkPut(payload.studyItems);
      await db.reviews.bulkPut(payload.reviews);
      await db.kanji.bulkPut(payload.kanji);
      await db.vocabularyItems.bulkPut(payload.vocabularyItems);
      await db.sentenceVocabulary.bulkPut(payload.sentenceVocabulary);
      await db.vocabularyKanji.bulkPut(payload.vocabularyKanji);
      await db.grammarPatterns.bulkPut(payload.grammarPatterns);
      await db.sentenceGrammar.bulkPut(payload.sentenceGrammar);
      await db.grammarRelationships.bulkPut(payload.grammarRelationships);
      await db.plannerSessions.bulkPut(payload.plannerSessions);
      await db.settings.put(payload.settings);
      // Backups carry no audio, so keep the local clips of every restored
      // sentence; only clips whose sentence is gone after the replace are dropped.
      const restoredSentenceIds = new Set(payload.sentences.map((sentence) => sentence.id));
      await db.sentenceAudio.filter((clip) => !restoredSentenceIds.has(clip.sentenceId)).delete();
    });
    return;
  }

  await db.transaction('rw', [...tables], async () => {
      for (const book of payload.books) {
        const existing = await db.books.get(book.id);
        if (!existing || book.updatedAt >= existing.updatedAt) {
          await db.books.put(book);
        }
      }
      for (const sentence of payload.sentences) {
        const existing = await db.sentences.get(sentence.id);
        if (!existing) {
          await db.sentences.put(sentence);
        } else {
          const merged = mergeSentenceOnReimport(
            existing,
            sentence,
            sentence.importBatchIds[0] ?? 'backup',
          );
          await db.sentences.put({
            ...existing,
            ...merged,
            createdAt: existing.createdAt,
            updatedAt: nowIso(),
          });
        }
      }
      for (const membership of payload.bookSentences) {
        const existing = await db.bookSentences
          .where('[bookId+sentenceId]')
          .equals([membership.bookId, membership.sentenceId])
          .first();
        if (!existing) {
          await db.bookSentences.put(membership);
        }
      }
      for (const analysis of payload.analyses) {
        const existing = await db.analyses.get(analysis.sentenceId);
        if (!existing || analysis.updatedAt >= existing.updatedAt) {
          await db.analyses.put(analysis);
        }
      }
      await db.importBatches.bulkPut(payload.importBatches);
      for (const item of payload.inbox) {
        const existing = await db.inbox.get(item.sentenceId);
        if (!existing) await db.inbox.put(item);
      }
      for (const studyItem of payload.studyItems) {
        const existing = await db.studyItems.get(studyItem.id);
        if (!existing || studyItem.updatedAt >= existing.updatedAt) {
          await db.studyItems.put(studyItem);
        }
      }
      for (const review of payload.reviews) {
        const existing = await db.reviews.get(review.id);
        if (!existing) await db.reviews.put(review);
      }
      for (const kanjiRow of payload.kanji) {
        const existing = await db.kanji.get(kanjiRow.id);
        if (!existing || kanjiRow.updatedAt >= existing.updatedAt) {
          await db.kanji.put(kanjiRow);
        }
      }
      for (const item of payload.vocabularyItems) {
        const existing = await db.vocabularyItems.get(item.id);
        if (!existing || item.updatedAt >= existing.updatedAt) {
          await db.vocabularyItems.put(item);
        }
      }
      for (const link of payload.sentenceVocabulary) {
        const existing = await db.sentenceVocabulary.get(link.id);
        if (!existing) await db.sentenceVocabulary.put(link);
      }
      for (const link of payload.vocabularyKanji) {
        const existing = await db.vocabularyKanji.get(link.id);
        if (!existing) await db.vocabularyKanji.put(link);
      }
      for (const pattern of payload.grammarPatterns) {
        const existing = await db.grammarPatterns.get(pattern.id);
        if (!existing || pattern.updatedAt >= existing.updatedAt) {
          await db.grammarPatterns.put(pattern);
        }
      }
      for (const link of payload.sentenceGrammar) {
        const existing = await db.sentenceGrammar.get(link.id);
        if (!existing) await db.sentenceGrammar.put(link);
      }
      for (const relationship of payload.grammarRelationships) {
        const existing = await db.grammarRelationships.get(relationship.id);
        if (!existing || relationship.updatedAt >= existing.updatedAt) {
          await db.grammarRelationships.put(relationship);
        }
      }
      for (const session of payload.plannerSessions) {
        const existing = await db.plannerSessions.get(session.id);
        if (!existing) await db.plannerSessions.put(session);
      }
      const settings = await ensureSettings(db);
      await db.settings.put({ ...settings, ...payload.settings, id: 'settings' });
  });
}

export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const db = getDb();
  const current = await ensureSettings(db);
  const next = { ...current, ...patch, id: 'settings' as const };
  await db.settings.put(next);
  return next;
}

const RECENT_FEED_URL_LIMIT = 8;

function withRecentUrl(list: string[] | undefined, url: string): string[] {
  return [url, ...(list ?? []).filter((existing) => existing !== url)].slice(
    0,
    RECENT_FEED_URL_LIMIT,
  );
}

/** Remembers a podcast RSS feed URL for YouTubeMinePage's datalist. */
export async function rememberPodcastFeedUrl(url: string): Promise<void> {
  const current = await ensureSettings();
  await updateSettings({
    recentPodcastFeedUrls: withRecentUrl(current.recentPodcastFeedUrls, url),
  });
}

/** Remembers an nhkeasier.com-mirror feed URL for NhkEasyImportPage's datalist. */
export async function rememberNhkEasyFeedUrl(url: string): Promise<void> {
  const current = await ensureSettings();
  await updateSettings({
    recentNhkEasyFeedUrls: withRecentUrl(current.recentNhkEasyFeedUrls, url),
  });
}

// ---------------------------------------------------------------------------
// Progress and diagnostics readers (pronunciation profile, leech lists, blind
// spots, "What's stuck") built on the attempt/alignment caches now in
// `repo/alignmentCaches.ts` and the FSRS state below.
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
 * Cross-attempt "weak words" (`buildShadowingWeakWords`) — surface forms
 * flagged with a per-word pitch-accent mismatch in more than one analyzed
 * shadowing attempt. Read-only; feeds the `/progress` "What to work on"
 * pronunciation block. Version-filtered like `getPronunciationProfile`.
 */
export async function getShadowingWeakWords(
  options: { minAttempts?: number } = {},
): Promise<ShadowingWeakWord[]> {
  const db = getDb();
  const rows = (await db.attemptAnalysisSummaries.toArray()).filter(
    (row) => row.analysisSummaryVersion === ANALYSIS_SUMMARY_VERSION,
  );
  return buildShadowingWeakWords(
    rows.map((row) => ({ createdAt: row.createdAt, wordIssues: row.wordIssues })),
    options,
  );
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

// ---------------------------------------------------------------------------
// FSRS-scheduled review (docs/UNIFIED_APP_ARCHITECTURE.md §10, Phase 4).
// study_items are created lazily the first time a subject is encountered in
// a review session (confirmed with the user — no batch seeding step).
// reviews are append-only; studyItems.fsrsState is the only thing ever
// updated after insert.
// ---------------------------------------------------------------------------

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
async function filterVocabularyItemIdsByActivity(
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

async function getIntroducedSentenceIds(sentenceIds: string[]): Promise<Set<string>> {
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

// ---------------------------------------------------------------------------
// Evidence-model foundation (Phase 7.1, docs/STATUS.md). Additive only — no
// existing review flow is touched. StudyItem.subjectType already supports
// 'vocabularyItem' (Phase 1); these helpers are the first callers of that
// capability, so word-level (not just sentence-level) FSRS state becomes
// usable by a future review UI without any further schema change.
// ---------------------------------------------------------------------------

/** Get-or-create a vocabulary-item-level study item for a given dimension (activityType). */
export async function ensureVocabularyStudyItem(
  vocabularyItemId: string,
  activityType: StudyActivityType,
): Promise<StudyItem> {
  return ensureStudyItem('vocabularyItem', vocabularyItemId, activityType);
}

/**
 * Records evidence from an unprompted, opportunistic recognition of a
 * vocabulary item while reading (Phase 7.8, docs brief §9/§16) — as
 * opposed to a scheduled review-queue card. Always targets the word's
 * `reading_retrieval` study item (get-or-create, same as the formal card),
 * so natural-encounter evidence feeds the same FSRS schedule a learner
 * would otherwise only advance via ReviewPage — just from a different
 * sentence than whichever one originally seeded that study item, recorded
 * via `contextSentenceId`.
 */
export async function recordNaturalEncounter(input: {
  vocabularyItemId: string;
  sentenceId: string;
  rating: ReviewRating;
}): Promise<{ review: Review; studyItem: StudyItem }> {
  const studyItem = await ensureVocabularyStudyItem(
    input.vocabularyItemId,
    'reading_retrieval',
  );
  return recordReview({
    studyItemId: studyItem.id,
    rating: input.rating,
    source: 'natural_encounter',
    contextSentenceId: input.sentenceId,
  });
}

// ---------------------------------------------------------------------------
// Sentence-led flow: meaning-choice history and sequential episode progression
// (src/lib/meaningChoices.ts, src/lib/sequentialStudy.ts).
// ---------------------------------------------------------------------------

export interface SentenceReviewHistory {
  /** Oldest first, so meaning-choice distractors can rotate between attempts. */
  meaningChoices: MeaningChoiceRecord[];
  /** Latest reading-in-context review only; a later unflagged review clears this. */
  missedReadings: string[];
}

/**
 * Read the active sentence's history through the existing compound/item indexes.
 * Queue eligibility doesn't depend on this evidence: fetching it for every
 * queued sentence made opening Review scale with the entire review history.
 * One snapshot supplies both the meaning choices and the missed-reading prompt.
 */
export async function getSentenceReviewHistory(sentenceId: string): Promise<SentenceReviewHistory> {
  const db = getDb();
  return db.transaction('r', db.studyItems, db.reviews, async () => {
    const items = await db.studyItems
      .where('[subjectType+subjectId+activityType]')
      .equals(['sentence', sentenceId, 'reading_in_context'])
      .toArray();
    if (items.length === 0) return { meaningChoices: [], missedReadings: [] };
    const query = db.reviews.where('studyItemId');
    // Normally one item; retain history from duplicate items in older imports.
    const reviews = await (items.length === 1
      ? query.equals(items[0]!.id)
      : query.anyOf(items.map((item) => item.id))).toArray();
    reviews.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      meaningChoices: reviews.flatMap((review) => review.meaningChoice ? [review.meaningChoice] : []),
      missedReadings: reviews.at(-1)?.missedReadings ?? [],
    };
  });
}

/**
 * Per-sentence access for one book under sequential study mode, in episode
 * order. Read-only (safe inside a live query); `latchSequentialUnlocks`
 * persists the result so unlocks never revert.
 */
export async function getSequentialBookStatus(
  bookId: string,
  knownMemberships?: BookSentence[],
): Promise<SequentialBookStatus> {
  const db = getDb();
  const memberships = knownMemberships ?? (await db.bookSentences.where('bookId').equals(bookId).toArray());
  const sentenceIds = memberships.map((item) => item.sentenceId);
  const [settings, analyses, events, studyItems] = await Promise.all([
    readSettings(),
    plannerPassActive()
      ? Promise.resolve([] as Array<SentenceAnalysis | undefined>)
      : traceStep('sequential: analyses.bulkGet', () => db.analyses.bulkGet(sentenceIds), rowCount),
    traceStep('sequential: book events', () => listSentenceLearningEvents(bookId), rowCount),
    traceStep('sequential: reading_in_context items', () =>
      plannerShared('readingInContextItems', ['studyItems'], async () =>
        (await readAllStudyItemsForPass()).filter(
          (item) => item.activityType === 'reading_in_context' && item.subjectType === 'sentence',
        ),
      ),
      rowCount,
    ),
  ]);
  const itemBySentence = new Map(studyItems.map((item) => [item.subjectId, item]));
  const reviewItemIds = sentenceIds.flatMap((id) => (itemBySentence.get(id) ? [itemBySentence.get(id)!.id] : []));
  const reviews = reviewItemIds.length
    ? await traceStep('sequential: reviews', () => reviewsForStudyItems(reviewItemIds), rowCount)
    : [];
  const reviewsByItem = new Map<string, Review[]>();
  for (const review of reviews) {
    const list = reviewsByItem.get(review.studyItemId);
    if (list) list.push(review);
    else reviewsByItem.set(review.studyItemId, [review]);
  }
  const walked = new Set(
    events.filter((event) => event.action === 'walkthrough_completed').map((event) => event.sentenceId),
  );
  // Planner passes ask this for every book; the stored list of usable checks replaces reading each analysis.
  const usableChecks = plannerPassActive()
    ? await traceStep('sequential: usable checks', () => readUsableCheckSentenceIdsForPass(), (ids) => ids.size)
    : null;
  return computeSequentialStatus(
    memberships.map((membership, index) => {
      const item = itemBySentence.get(membership.sentenceId);
      const bank = usableChecks ? null : getMeaningBank(analyses[index]?.comprehensionCheck);
      return {
        sentenceId: membership.sentenceId,
        position: membership.position,
        hasUsableCheck: usableChecks ? usableChecks.has(membership.sentenceId) : (bank?.distractors.length ?? 0) > 0,
        reviews: item ? (reviewsByItem.get(item.id) ?? []) : [],
        // Sentences already worked on before the mode was enabled stay open.
        introduced: membership.status !== 'unstarted' || walked.has(membership.sentenceId),
        // Each chapter is its own episode; chapterless sentences share one.
        ...(membership.chapterId ? { groupId: membership.chapterId } : {}),
      };
    }),
    new Set(settings.sequentialUnlockOverrides ?? []),
  );
}

/** Persist newly reached unlocks (settings.sequentialUnlockOverrides) so they can never revert. */
export async function latchSequentialUnlocks(bookId: string): Promise<string[]> {
  const settings = await readSettings();
  if (!isSequentialStudyMode(settings)) return [];
  const { newlyLatched } = await getSequentialBookStatus(bookId);
  if (newlyLatched.length === 0) return [];
  await updateSettings({
    sequentialUnlockOverrides: [...new Set([...(settings.sequentialUnlockOverrides ?? []), ...newlyLatched])],
  });
  return newlyLatched;
}

export interface SequentialSentenceView {
  book: SequentialBookStatus;
  current?: SequentialSentenceStatus;
  previous?: SequentialSentenceStatus;
  next?: SequentialSentenceStatus;
}

/** Undefined when sequential study mode is off. Read-only, safe in a live query. */
export async function getSequentialSentenceView(
  bookId: string,
  sentenceId?: string,
): Promise<SequentialSentenceView | undefined> {
  if (!isSequentialStudyMode(await readSettings())) return undefined;
  const book = await getSequentialBookStatus(bookId);
  const index = sentenceId ? book.sentences.findIndex((s) => s.sentenceId === sentenceId) : -1;
  return {
    book,
    current: index >= 0 ? book.sentences[index] : undefined,
    previous: index > 0 ? book.sentences[index - 1] : undefined,
    next: index >= 0 ? book.sentences[index + 1] : undefined,
  };
}

async function latchSequentialUnlocksForSentence(sentenceId: string): Promise<void> {
  if (!isSequentialStudyMode(await readSettings())) return;
  const memberships = await getDb().bookSentences.where('sentenceId').equals(sentenceId).toArray();
  for (const bookId of new Set(memberships.map((membership) => membership.bookId))) {
    await latchSequentialUnlocks(bookId);
  }
}

/** Manual escape hatch: open one locked sentence (e.g. a check the learner finds unusable). */
export async function unlockSentenceManually(sentenceId: string): Promise<void> {
  const settings = await readSettings();
  await updateSettings({
    sequentialUnlockOverrides: [...new Set([...(settings.sequentialUnlockOverrides ?? []), sentenceId])],
  });
}

/**
 * Drop persisted unlocks for sentences that are still unstarted, so the current
 * rules decide again. Started sentences stay open on their own status.
 * Returns how many were dropped.
 */
export async function resetUnstartedSequentialUnlocks(): Promise<number> {
  const settings = await readSettings();
  const overrides = settings.sequentialUnlockOverrides ?? [];
  if (overrides.length === 0) return 0;
  const db = getDb();
  const memberships = await db.bookSentences.where('sentenceId').anyOf(overrides).toArray();
  const started = new Set(memberships.filter((m) => m.status !== 'unstarted').map((m) => m.sentenceId));
  const unstarted = new Set(memberships.filter((m) => m.status === 'unstarted').map((m) => m.sentenceId));
  const keep = overrides.filter((id) => started.has(id) || !unstarted.has(id));
  if (keep.length === overrides.length) return 0;
  await updateSettings({ sequentialUnlockOverrides: keep });
  return overrides.length - keep.length;
}

/**
 * Bridge from shadowing to the SRS: a close A/B-rated shadow of a sentence
 * ("better"/"same" vs the reference) is real evidence the learner can read
 * and parse that whole sentence, so it logs one `natural_encounter` review
 * (rating `good`) against the sentence's `reading_in_context` study item —
 * the same mechanism `recordNaturalEncounter` uses for the "Recognized this
 * without hints?" panel on `/practice`.
 *
 * Deliberately narrow:
 * - Only the sentence-level `reading_in_context` card, never the individual
 *   word cards — caps the schedule impact at one row per shadowed sentence.
 * - **No-op if that study item doesn't already exist.** Creating one would
 *   bypass the passage-readiness gate (`ReviewPage`'s `activityIsReady`),
 *   which shadowing evidence has no business doing.
 * - Deduped: skipped if a `natural_encounter` review already landed on this
 *   item since its last scheduled review, so re-rating the same take (or
 *   rating several takes of one sitting) doesn't ratchet the interval.
 *
 * Returns the recorded review, or null when it no-opped.
 */
export async function recordShadowingEncounter(
  sentenceId: string,
): Promise<{ review: Review; studyItem: StudyItem } | null> {
  const db = getDb();
  const studyItem = await db.studyItems
    .where('[subjectType+subjectId+activityType]')
    .equals(['sentence', sentenceId, 'reading_in_context'])
    .first();
  if (!studyItem) return null;

  const reviews = await db.reviews.where('studyItemId').equals(studyItem.id).toArray();
  const lastScheduledAt = reviews
    .filter((review) => review.source !== 'natural_encounter')
    .map((review) => review.timestamp)
    .sort()
    .at(-1);
  const alreadyCounted = reviews.some(
    (review) =>
      review.source === 'natural_encounter' &&
      (lastScheduledAt === undefined || review.timestamp > lastScheduledAt),
  );
  if (alreadyCounted) return null;

  return recordReview({
    studyItemId: studyItem.id,
    rating: 'good',
    source: 'natural_encounter',
    contextSentenceId: sentenceId,
  });
}

/**
 * Pick a sentence to display when reviewing a vocabulary item directly —
 * the most recently linked sentence that still exists — along with that
 * specific link's `surfaceForm` (Phase 7.2), if it has one. Returns
 * undefined if the vocabulary item has no surviving sentence link
 * (shouldn't normally happen, since links are only removed when a confirm
 * deselects a word, not when the word itself is deleted).
 */
export async function pickContextSentenceForVocabularyItem(
  vocabularyItemId: string,
): Promise<{ sentence: Sentence; surfaceForm?: string } | undefined> {
  const db = getDb();
  const links = await db.sentenceVocabulary
    .where('vocabularyItemId')
    .equals(vocabularyItemId)
    .toArray();
  if (links.length === 0) return undefined;
  const sorted = [...links].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  for (const link of sorted) {
    const sentence = await db.sentences.get(link.sentenceId);
    if (sentence) return { sentence, surfaceForm: link.surfaceForm };
  }
  return undefined;
}

export interface VocabularyTargetCandidate {
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  /** The link this candidate was chosen from — carries any manual
   * word-audio range (`audioStartMs`/`audioEndMs`). */
  link?: SentenceVocabulary;
}

/**
 * Vocabulary items, restricted to `sentenceIds`, that have a
 * `surfaceForm`-bearing link and are therefore eligible targets for any
 * review experience that highlights or blanks a specific occurrence of a
 * word in its sentence — reading retrieval (Phase 7.2) and cloze (Phase
 * 7.3) both consume this, since they share the same eligibility condition
 * and only differ in how the target is rendered. One candidate per
 * distinct vocabulary item (first qualifying link found, preferring one
 * whose sentence isn't suspended-book-only over one that is — 2026-09-24,
 * see below), not one per sentence×word pair, so seeding stays bounded by
 * vocabulary size, not sentence count.
 *
 * `sentenceIds` is normally already suspension-filtered by the caller
 * (ReviewPage's global scope), but that filtering happens once per queue
 * build and can go stale for a long-lived session; this function also
 * checks directly so a shared word never lands on a since-suspended
 * sentence as its representative — that sentence's reading-context
 * neighbours are held back too, so the card ends up with no passage at all
 * (card issue report, 2026-09-23: 楽しい picked え、楽しかったね。, whose only
 * book had been suspended, when the word also has links in active books).
 *
 * Returned in `sentenceIds` order (each word's representative sentence's
 * position in the caller's reading order) — `.anyOf()` returns rows sorted
 * by the indexed `sentenceId` itself, not by `sentenceIds` order, so without
 * this the new-word queue effectively randomized which sentence's words
 * came up together instead of clustering by sentence (user request,
 * 2026-09-24: introduce a sentence's vocabulary together so its
 * reading_in_context card unlocks sooner, rather than trickling in a word
 * at a time from unrelated sentences).
 */
export async function getVocabularyTargetCandidates(
  sentenceIds: string[],
): Promise<VocabularyTargetCandidate[]> {
  if (sentenceIds.length === 0) return [];
  const db = getDb();
  const [links, suspendedIndex] = await Promise.all([
    db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray(),
    loadSuspendedBookIndex(),
  ]);
  const bestLinkByItemId = new Map<string, SentenceVocabulary>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    const existing = bestLinkByItemId.get(link.vocabularyItemId);
    if (!existing) {
      bestLinkByItemId.set(link.vocabularyItemId, link);
      continue;
    }
    if (
      suspendedIndex &&
      sentenceIsSuspendedOnly(existing.sentenceId, suspendedIndex) &&
      !sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)
    ) {
      bestLinkByItemId.set(link.vocabularyItemId, link);
    }
  }
  if (bestLinkByItemId.size === 0) return [];

  const entries = [...bestLinkByItemId.entries()];
  const [vocabularyItems, sentences] = await Promise.all([
    db.vocabularyItems.bulkGet(entries.map(([itemId]) => itemId)),
    db.sentences.bulkGet(entries.map(([, link]) => link.sentenceId)),
  ]);

  const candidates: VocabularyTargetCandidate[] = [];
  entries.forEach(([, link], index) => {
    const vocabularyItem = vocabularyItems[index];
    const sentence = sentences[index];
    if (!vocabularyItem || !sentence || !link.surfaceForm) return;
    candidates.push({ vocabularyItem, sentence, surfaceForm: link.surfaceForm, link });
  });
  const sentenceOrder = new Map(sentenceIds.map((id, index) => [id, index]));
  candidates.sort(
    (a, b) =>
      (sentenceOrder.get(a.sentence.id) ?? 0) - (sentenceOrder.get(b.sentence.id) ?? 0),
  );
  return candidates;
}

export interface PitchAccentDrillSentence {
  sentence: Sentence;
  /** The sentence's confirmed words that carry dictionary pitch-accent data. */
  targets: PitchAccentTarget[];
  /**
   * `target.surfaceForm` → vocabulary item id, for logging drill attempts
   * (`logPitchDrillAttempt`) without threading an id through the shared
   * `PitchAccentTarget` type (used well beyond this drill).
   */
  targetVocabularyItemIds: Record<string, string>;
}

/**
 * Sentences eligible for the audio-less pitch-accent production drill
 * (docs/ROADMAP.md): confirmed vocabulary with dictionary
 * `pitchAccentPositions` and **no** reference recording — so the majority
 * of the Satori corpus, which the reference-audio-gated `pitch_accent` SRS
 * card and the shadowing analysis can't reach. Scoring only needs the
 * learner's own forced alignment + pitch (`buildPitchAccentShapeObservations`),
 * never a reference clip.
 *
 * Gated on the same full-review readiness rule as shadowing candidates
 * (`getSentenceFullReviewReadiness`) — pronunciation practice shouldn't
 * compete for attention with vocabulary the learner hasn't shown recall of
 * yet (see the `findShadowCandidates` precedent / the vocab-before-glossing
 * stance).
 */
export async function getPitchAccentDrillSentences(): Promise<PitchAccentDrillSentence[]> {
  const db = getDb();
  const links = (await db.sentenceVocabulary.toArray()).filter((link) => !!link.surfaceForm);
  const linksBySentence = new Map<string, SentenceVocabulary[]>();
  for (const link of links) {
    const list = linksBySentence.get(link.sentenceId) ?? [];
    list.push(link);
    linksBySentence.set(link.sentenceId, list);
  }
  const sentenceIds = [...linksBySentence.keys()];
  if (sentenceIds.length === 0) return [];

  const [sentences, audioRows, vocabularyItems, readiness] = await Promise.all([
    db.sentences.bulkGet(sentenceIds),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    getSentenceFullReviewReadiness(sentenceIds),
  ]);
  const audioSentenceIds = new Set(audioRows.map((row) => row.sentenceId));
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const vocabularyItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const result: PitchAccentDrillSentence[] = [];
  for (const [sentenceId, sentenceLinks] of linksBySentence) {
    if (audioSentenceIds.has(sentenceId)) continue;
    if (readiness.get(sentenceId) !== true) continue;
    const sentence = sentenceById.get(sentenceId);
    if (!sentence) continue;
    const targets: PitchAccentTarget[] = [];
    const targetVocabularyItemIds: Record<string, string> = {};
    for (const link of sentenceLinks) {
      const item = vocabularyItemById.get(link.vocabularyItemId);
      if (!link.surfaceForm || !item) continue;
      const resolved = resolveInflectedPitchAccent({
        vocabularyItem: item,
        sentence,
        surfaceForm: link.surfaceForm,
      });
      if (!resolved) continue;
      // The resolver's own full conjugated surface, not the possibly-
      // truncated stored link.surfaceForm (言い for 言います) — keeps the
      // highlighted span and "what follows" lookup aligned with the reading/
      // position above, which already cover the whole conjugated word.
      const { surfaceForm } = resolved;
      const occurrence = sentence.japanese.indexOf(surfaceForm);
      targets.push({
        surfaceForm,
        reading: resolved.reading,
        pitchAccentPositions: [resolved.position],
        followingMora:
          occurrence >= 0
            ? trailingBunsetsuParticles(sentence.japanese, occurrence + surfaceForm.length)
            : '',
      });
      targetVocabularyItemIds[surfaceForm] = link.vocabularyItemId;
    }
    if (targets.length === 0) continue;
    result.push({ sentence, targets, targetVocabularyItemIds });
  }
  result.sort(
    (a, b) => a.sentence.firstOccurrenceIndex - b.sentence.firstOccurrenceIndex,
  );
  return result;
}

export interface PitchAccentDrillWord {
  vocabularyItem: VocabularyItem;
  /** An example sentence containing the word — shown as context under the drill. */
  sentence: Sentence;
  /** The word's surface form as it appears in that sentence. */
  surfaceForm: string;
  /**
   * The run of single-kana bunsetsu particles that follows the word in that
   * sentence (`は`/`が`/`を`/… — `trailingBunsetsuParticles`), or `''`. The
   * particle carries the tail of the word's accent phrase, so it's the only
   * place a phrase-final heiban/odaka fall is audible — the drill shows and
   * records `surfaceForm + followingParticle`.
   */
  followingParticle: string;
}

/**
 * Words eligible for the single-word variant of the audio-less pitch-accent
 * drill: every confirmed vocabulary item the learner has reviewed to
 * proficiency (`getProficientVocabularyItemIds`, the same "shown recall"
 * bar as `getPitchAccentDrillSentences`) that carries dictionary
 * `pitchAccentPositions`, paired with one example sentence for context.
 *
 * Deliberately *not* gated on the example sentence lacking reference audio,
 * unlike `getPitchAccentDrillSentences` — you're drilling the word in
 * isolation, not the sentence, so the overlap with the reference-audio-gated
 * `pitch_accent` SRS card doesn't apply. That also makes the pool much
 * larger. One entry per distinct word; the example occurrence is picked to
 * prefer (1) one with a trailing bunsetsu particle (so a phrase-final fall
 * is audible), then (2) the word's dictionary form, then (3) the earliest.
 */
interface ExampleOccurrence {
  sentence: Sentence;
  surfaceForm: string;
  followingParticle: string;
}

/**
 * Best example occurrence per vocabulary item id among `links`, restricted
 * to `itemIds`: prefers (1) an occurrence with a trailing bunsetsu particle
 * (so a phrase-final heiban/odaka fall is audible), then (2) the word's
 * dictionary form, then (3) the earliest sentence. Shared by
 * `getPitchAccentDrillWords` and `getPitchAccentFocusWords`.
 */
function bestExampleOccurrencesByItemId(
  links: SentenceVocabulary[],
  sentenceById: Map<string, Sentence>,
  itemById: Map<string, VocabularyItem>,
  itemIds: Set<string>,
): Map<string, ExampleOccurrence> {
  interface Candidate extends ExampleOccurrence {
    score: number;
  }
  const bestByItemId = new Map<string, Candidate>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    if (!itemIds.has(link.vocabularyItemId)) continue;
    const item = itemById.get(link.vocabularyItemId);
    if (!item) continue;
    const sentence = sentenceById.get(link.sentenceId);
    if (!sentence) continue;

    const occurrence = sentence.japanese.indexOf(link.surfaceForm);
    const followingParticle =
      occurrence >= 0
        ? trailingBunsetsuParticles(sentence.japanese, occurrence + link.surfaceForm.length)
        : '';
    const score =
      (followingParticle ? 2 : 0) + (link.surfaceForm === item.expression ? 1 : 0);

    const current = bestByItemId.get(link.vocabularyItemId);
    if (
      !current ||
      score > current.score ||
      (score === current.score &&
        sentence.firstOccurrenceIndex < current.sentence.firstOccurrenceIndex)
    ) {
      bestByItemId.set(link.vocabularyItemId, {
        sentence,
        surfaceForm: link.surfaceForm,
        followingParticle,
        score,
      });
    }
  }
  return bestByItemId;
}

export async function getPitchAccentDrillWords(): Promise<PitchAccentDrillWord[]> {
  const db = getDb();
  const links = (await db.sentenceVocabulary.toArray()).filter((link) => !!link.surfaceForm);
  if (links.length === 0) return [];

  const vocabularyItems = await db.vocabularyItems.bulkGet([
    ...new Set(links.map((link) => link.vocabularyItemId)),
  ]);
  const pitchCarryingItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  if (pitchCarryingItemById.size === 0) return [];

  const proficientIds = await getProficientVocabularyItemIds([...pitchCarryingItemById.keys()]);
  if (proficientIds.size === 0) return [];

  const sentenceById = new Map(
    (await db.sentences.bulkGet([...new Set(links.map((link) => link.sentenceId))]))
      .filter((row): row is Sentence => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const bestByItemId = bestExampleOccurrencesByItemId(
    links,
    sentenceById,
    pitchCarryingItemById,
    proficientIds,
  );

  const result: PitchAccentDrillWord[] = [];
  for (const [itemId, { sentence, surfaceForm, followingParticle }] of bestByItemId) {
    result.push({
      vocabularyItem: pitchCarryingItemById.get(itemId)!,
      sentence,
      surfaceForm,
      followingParticle,
    });
  }
  result.sort((a, b) => a.sentence.firstOccurrenceIndex - b.sentence.firstOccurrenceIndex);
  return result;
}

/**
 * Words whose `pitch_accent` SRS card has been missed twice in a row (last 2
 * reviews both rated `again` or `hard`) and haven't had a free-drill attempt
 * logged since — the "extra practice" focus queue surfaced on
 * `PitchAccentDrillPage`. Deliberately not FSRS-driven: this never touches
 * the SRS card's own scheduling, only reads its review history. Clears the
 * moment any drill attempt is logged for the word (`logPitchDrillAttempt`,
 * either mode, any outcome) — it's extra practice, not a retest gate — and
 * reappears only if the SRS card is missed twice again afterward.
 */
export async function getPitchAccentFocusWords(): Promise<PitchAccentDrillWord[]> {
  const db = getDb();
  const pitchAccentStudyItems = await db.studyItems
    .where('activityType')
    .equals('pitch_accent')
    .toArray();
  if (pitchAccentStudyItems.length === 0) return [];
  const studyItemById = new Map(pitchAccentStudyItems.map((item) => [item.id, item]));

  const reviews = await db.reviews
    .where('studyItemId')
    .anyOf([...studyItemById.keys()])
    .sortBy('timestamp');
  const reviewsByStudyItem = new Map<string, Review[]>();
  for (const review of reviews) {
    const list = reviewsByStudyItem.get(review.studyItemId) ?? [];
    list.push(review);
    reviewsByStudyItem.set(review.studyItemId, list);
  }

  // vocabularyItemId -> timestamp of the 2nd consecutive miss.
  const missedAt = new Map<string, string>();
  for (const [studyItemId, itemReviews] of reviewsByStudyItem) {
    if (itemReviews.length < 2) continue;
    const lastTwo = itemReviews.slice(-2);
    if (lastTwo.every((review) => review.rating === 'again' || review.rating === 'hard')) {
      const studyItem = studyItemById.get(studyItemId)!;
      missedAt.set(studyItem.subjectId, lastTwo[1]!.timestamp);
    }
  }
  if (missedAt.size === 0) return [];

  const attempts = await db.pitchDrillAttempts
    .where('vocabularyItemId')
    .anyOf([...missedAt.keys()])
    .toArray();
  const latestAttemptAt = new Map<string, string>();
  for (const attempt of attempts) {
    if (!attempt.vocabularyItemId) continue;
    const current = latestAttemptAt.get(attempt.vocabularyItemId);
    if (!current || attempt.timestamp > current) {
      latestAttemptAt.set(attempt.vocabularyItemId, attempt.timestamp);
    }
  }

  const focusIds = new Set(
    [...missedAt.entries()]
      .filter(([id, missedTimestamp]) => {
        const practicedAt = latestAttemptAt.get(id);
        return !practicedAt || practicedAt < missedTimestamp;
      })
      .map(([id]) => id),
  );
  if (focusIds.size === 0) return [];

  const [vocabularyItems, links] = await Promise.all([
    db.vocabularyItems.bulkGet([...focusIds]),
    db.sentenceVocabulary.where('vocabularyItemId').anyOf([...focusIds]).toArray(),
  ]);
  const itemById = new Map(
    vocabularyItems.filter((row): row is VocabularyItem => Boolean(row)).map((row) => [row.id, row]),
  );
  const sentenceById = new Map(
    (await db.sentences.bulkGet([...new Set(links.map((link) => link.sentenceId))]))
      .filter((row): row is Sentence => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const bestByItemId = bestExampleOccurrencesByItemId(links, sentenceById, itemById, focusIds);

  const result: PitchAccentDrillWord[] = [];
  for (const [itemId, { sentence, surfaceForm, followingParticle }] of bestByItemId) {
    const item = itemById.get(itemId);
    if (!item) continue;
    result.push({ vocabularyItem: item, sentence, surfaceForm, followingParticle });
  }
  // Most recently missed first.
  result.sort((a, b) => {
    const aMissed = missedAt.get(a.vocabularyItem.id) ?? '';
    const bMissed = missedAt.get(b.vocabularyItem.id) ?? '';
    return bMissed.localeCompare(aMissed);
  });
  return result;
}

/**
 * Words flagged with a recurring pitch-accent mismatch across shadowing
 * attempts (`getShadowingWeakWords`, `SHADOWING_WEAK_WORD_MIN_ATTEMPTS`+) —
 * the shadowing-side sibling of `getPitchAccentFocusWords`' SRS-miss queue,
 * same "extra practice" slot on `PitchAccentDrillPage`. `wordIssues` only
 * stores a surface form, not a vocabulary item id, so this resolves each
 * weak surface form back to its (confirmed, proficient, pitch-carrying)
 * vocabulary item via `sentenceVocabulary`, then picks the same
 * dictionary-form-preferring example occurrence `getPitchAccentFocusWords`
 * does. Never clears itself the way the review-miss queue does (no
 * "practiced since the miss" signal exists on the shadowing side) — it's a
 * live reflection of `getShadowingWeakWords`, so it shrinks only once new
 * attempts stop reproducing the mismatch.
 */
export async function getPitchAccentShadowingFocusWords(): Promise<PitchAccentDrillWord[]> {
  const weakWords = await getShadowingWeakWords();
  if (weakWords.length === 0) return [];
  const lastSeenBySurfaceForm = new Map(weakWords.map((word) => [word.surfaceForm, word.lastSeenAt]));

  const db = getDb();
  const matchingLinks = (await db.sentenceVocabulary.toArray()).filter(
    (link) => link.surfaceForm && lastSeenBySurfaceForm.has(link.surfaceForm),
  );
  if (matchingLinks.length === 0) return [];
  const candidateItemIds = new Set(matchingLinks.map((link) => link.vocabularyItemId));

  const vocabularyItems = await db.vocabularyItems.bulkGet([...candidateItemIds]);
  const pitchCarryingItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  if (pitchCarryingItemById.size === 0) return [];

  const proficientIds = await getProficientVocabularyItemIds([...pitchCarryingItemById.keys()]);
  if (proficientIds.size === 0) return [];

  // Most recent weak-attempt timestamp among this item's flagged surface forms.
  const lastSeenByItemId = new Map<string, string>();
  for (const link of matchingLinks) {
    if (!proficientIds.has(link.vocabularyItemId)) continue;
    const lastSeenAt = lastSeenBySurfaceForm.get(link.surfaceForm!);
    if (!lastSeenAt) continue;
    const current = lastSeenByItemId.get(link.vocabularyItemId);
    if (!current || lastSeenAt > current) lastSeenByItemId.set(link.vocabularyItemId, lastSeenAt);
  }

  const links = await db.sentenceVocabulary
    .where('vocabularyItemId')
    .anyOf([...proficientIds])
    .toArray();
  const sentenceById = new Map(
    (await db.sentences.bulkGet([...new Set(links.map((link) => link.sentenceId))]))
      .filter((row): row is Sentence => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const bestByItemId = bestExampleOccurrencesByItemId(
    links,
    sentenceById,
    pitchCarryingItemById,
    proficientIds,
  );

  const result: PitchAccentDrillWord[] = [];
  for (const [itemId, { sentence, surfaceForm, followingParticle }] of bestByItemId) {
    const item = pitchCarryingItemById.get(itemId);
    if (!item) continue;
    result.push({ vocabularyItem: item, sentence, surfaceForm, followingParticle });
  }
  // Most recently flagged first, same convention as `getPitchAccentFocusWords`.
  result.sort((a, b) => {
    const aSeen = lastSeenByItemId.get(a.vocabularyItem.id) ?? '';
    const bSeen = lastSeenByItemId.get(b.vocabularyItem.id) ?? '';
    return bSeen.localeCompare(aSeen);
  });
  return result;
}

export interface PitchAccentMinimalPairOccurrence extends MinimalPairOccurrence {
  expression: string;
  meaning: string;
  surfaceForm: string;
  sentence: Sentence;
  audio: SentenceAudio;
}

/**
 * Every audio-backed occurrence eligible for the "real-audio pitch-
 * perception bridge" same/different warm-up (docs/ROADMAP.md): a confirmed
 * (vocab picker, `vocabularyReviewStatus === 'confirmed'`) word with
 * dictionary `pitchAccentPositions`, restricted to a sentence that both has
 * reference audio *and* uses the word's exact citation form
 * (`link.surfaceForm === expression`) — near-minimal accent pairs are almost
 * always nouns, and skipping inflected occurrences avoids resolving
 * `pitchAccentPositions` (a citation-form value) against a conjugated
 * surface. Deliberately perception-only: this is a listening-discrimination task with the
 * answer shown right after, not a recall/production check, so it doesn't
 * need `getProficientVocabularyItemIds`'s FSRS-reviewed bar. Sentences that
 * live only in suspended books/chapters are skipped (and `bookId` is taken
 * from a non-shelved membership).
 * `bookId` doubles as a "same speaker" proxy: a book is
 * normally one show/narrator or one consistent cast, so two occurrences
 * sharing a `bookId` are treated as same-speaker and two differing ones as
 * cross-speaker (`STATUS.md`) — an approximation, not a verified per-clip
 * speaker identity, since none exists in this corpus.
 */
export async function getPitchAccentMinimalPairOccurrences(): Promise<
  PitchAccentMinimalPairOccurrence[]
> {
  const db = getDb();
  const [allLinks, suspendedIndex] = await Promise.all([
    db.sentenceVocabulary.toArray(),
    loadSuspendedBookIndex(),
  ]);
  let links = allLinks.filter(
    (link) =>
      !!link.surfaceForm &&
      !(suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)),
  );
  if (links.length > 0) {
    const introduced = await filterToIntroducedSentenceIds(links.map((link) => link.sentenceId));
    links = links.filter((link) => introduced.has(link.sentenceId));
  }
  if (links.length === 0) return [];

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const [audioRows, vocabularyItems, sentences, bookSentences, analyses] = await Promise.all([
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    db.sentences.bulkGet(sentenceIds),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.analyses.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  if (audioRows.length === 0) return [];

  const confirmedSentenceIds = new Set(
    analyses
      .filter((analysis) => analysis.vocabularyReviewStatus === 'confirmed')
      .map((analysis) => analysis.sentenceId),
  );
  if (confirmedSentenceIds.size === 0) return [];

  const audioBySentenceId = new Map<string, SentenceAudio>();
  for (const audio of audioRows) {
    if (!audioBySentenceId.has(audio.sentenceId)) audioBySentenceId.set(audio.sentenceId, audio);
  }

  const bookIdBySentenceId = new Map<string, string>();
  for (const membership of bookSentences) {
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!bookIdBySentenceId.has(membership.sentenceId)) {
      bookIdBySentenceId.set(membership.sentenceId, membership.bookId);
    }
  }

  const pitchCarryingItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  if (pitchCarryingItemById.size === 0) return [];

  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );

  const result: PitchAccentMinimalPairOccurrence[] = [];
  for (const link of links) {
    if (!link.surfaceForm || !confirmedSentenceIds.has(link.sentenceId)) continue;
    const item = pitchCarryingItemById.get(link.vocabularyItemId);
    if (!item || link.surfaceForm !== item.expression) continue;
    const audio = audioBySentenceId.get(link.sentenceId);
    const sentence = sentenceById.get(link.sentenceId);
    const bookId = bookIdBySentenceId.get(link.sentenceId);
    if (!audio || !sentence || !bookId) continue;
    result.push({
      vocabularyItemId: item.id,
      expression: item.expression,
      reading: item.reading,
      meaning: item.meaning,
      position: item.pitchAccentPositions![0]!,
      surfaceForm: link.surfaceForm,
      sentence,
      audio,
      bookId,
    });
  }
  return result;
}

/**
 * Up to 5 playable same/different near-minimal-pair trials
 * (`findMinimalPairContrasts`/`buildMinimalPairTrials`) built from
 * `getPitchAccentMinimalPairOccurrences`. Thin composition kept separate
 * from the pure builder so the matching logic stays unit-testable without
 * Dexie.
 */
export async function getPitchAccentMinimalPairTrials(): Promise<
  MinimalPairTrial<PitchAccentMinimalPairOccurrence>[]
> {
  const occurrences = await getPitchAccentMinimalPairOccurrences();
  if (occurrences.length === 0) return [];
  const contrasts = findMinimalPairContrasts(occurrences);
  return buildMinimalPairTrials(contrasts, occurrences);
}


/**
 * Logs one take on the free, ungated pitch-accent production drill
 * (`PitchAccentDrillPage`) — one row per scored target word per recording.
 * Append-only, sync-conflict-free like `recordReview`. Purely a
 * usage/effectiveness log: never gates or reorders the drill itself.
 */
export async function logPitchDrillAttempt(input: {
  mode: 'sentence' | 'word';
  vocabularyItemId?: string;
  surfaceForm: string;
  reading: string;
  contextSentenceId: string;
  measured: boolean;
  mismatch: boolean;
  confidence?: 'low' | 'medium' | 'high';
  expectedShape?: string;
  measuredShape?: string;
  focusTriggered: boolean;
  fallTimingErrorMorae?: number;
  fallMagnitudeRatio?: number;
  now?: Date;
}): Promise<PitchDrillAttempt> {
  const db = getDb();
  const attempt: PitchDrillAttempt = {
    id: createId('pitch_drill'),
    timestamp: (input.now ?? new Date()).toISOString(),
    mode: input.mode,
    vocabularyItemId: input.vocabularyItemId,
    surfaceForm: input.surfaceForm,
    reading: input.reading,
    contextSentenceId: input.contextSentenceId,
    measured: input.measured,
    mismatch: input.mismatch,
    confidence: input.confidence,
    expectedShape: input.expectedShape,
    measuredShape: input.measuredShape,
    focusTriggered: input.focusTriggered,
    fallTimingErrorMorae: input.fallTimingErrorMorae,
    fallMagnitudeRatio: input.fallMagnitudeRatio,
  };
  await db.pitchDrillAttempts.put(attempt);
  notifySyncMany([
    { entity: 'pitch_drill_attempts', recordId: attempt.id, payload: attempt },
  ]);
  return attempt;
}


/**
 * What today's "Daily practice" panel counts (`src/lib/dailyPractice.ts`):
 * scored pitch-drill words and finished game rounds since local midnight.
 * Both are logs the activities already write, so the panel needs no state of
 * its own. Both `gameRounds` and `pitchDrillAttempts` sync, so the counts
 * include rounds from other devices once they have arrived.
 */
export async function getDailyPracticeCounts(
  now: Date = new Date(),
): Promise<{ pitchDrillTakes: number }> {
  const start = startOfLocalDayIso(now);
  return { pitchDrillTakes: await getDb().pitchDrillAttempts.where('timestamp').aboveOrEqual(start).count() };
}


/**
 * Alignments for many recordings at once: the local Dexie cache first, then
 * one bulk Supabase query for whatever's missing (written back locally, so
 * this is a one-off cost per device). Never throws; ids with no usable
 * alignment are simply absent from the result. Unlike `loadOrComputeAlignment`
 * this never falls through to the tailnet MFA service — that needs the audio
 * blob and would mean aligning dozens of clips just to size a game's pool.
 */
export async function loadAlignmentsBulk(audioIds: string[]): Promise<Map<string, AlignmentResult>> {
  const db = getDb();
  const found = new Map<string, AlignmentResult>();
  if (audioIds.length === 0) return found;
  const rows = await db.referenceAlignments.bulkGet(audioIds);
  const missing: string[] = [];
  audioIds.forEach((id, index) => {
    const row = rows[index];
    if (row && row.alignmentVersion === ALIGNMENT_VERSION) found.set(id, row.result);
    else missing.push(id);
  });
  if (missing.length === 0) return found;
  try {
    const { fetchRemoteAlignments } = await import('../sync/alignmentRemote');
    const remote = await fetchRemoteAlignments(missing);
    for (const [id, result] of remote) {
      found.set(id, result);
      await saveReferenceAlignment(id, result);
    }
  } catch {
    // Offline / Supabase not configured — play with what's cached.
  }
  return found;
}

/**
 * A noun never inflects, so if `isolatedWordSpans` had to widen the match
 * past the citation form's own characters (`!tokenExact`), the extra content
 * is a fused neighbour the aligner's dictionary never learned to split off —
 * an honorific suffix glued to a name/noun (皆さん for a 皆-only link), a
 * compound — not legitimately part of this word's audio (card issue: a 皆
 * citation-form clip played the whole "みなさん", not "みな"). Verbs and
 * adjectives deliberately keep the wider token (their conjugated ending
 * carries the pitch cue this game/drill is testing), so this only tightens
 * the check for confirmed nouns.
 */
function isTrustworthyCitationSpan(item: VocabularyItem, spans: IsolatedWordSpans): boolean {
  if (!item.partOfSpeech?.startsWith('名詞')) return true;
  return spans.tokenExact;
}

export interface PitchWordClipWithAudio extends PitchWordClip {
  audio: SentenceAudio;
  sentence: Sentence;
  surfaceForm: string;
}

/**
 * Word-only pitch clips for the pitch drill and contrast examples: a confirmed,
 * citation-form occurrence of a word with a dictionary pitch position and 2+
 * morae, whose *word alone* can be cut out of its reference recording by a
 * **current-version** forced alignment (manual/backfilled `audioStartMs/EndMs`
 * ranges are ignored — they usually include the following particle; a
 * hand-corrected `wordOnlyStartMs/EndMs` is used instead when present) with a
 * plausible length. One clip per word per book, skipping sentences that live
 * only in suspended books. A sentence with a digit+日/月 date plays normally —
 * the aligner's date expansion is accounted for in the span mapping (see
 * `alignerView`). Read-only apart from caching alignments locally.
 * Proficiency is deliberately not required.
 */
export async function getPitchWordClips(): Promise<{ clips: PitchWordClipWithAudio[] }> {
  const db = getDb();
  const [allLinks, suspendedIndex] = await Promise.all([db.sentenceVocabulary.toArray(), loadSuspendedBookIndex()]);
  let links = allLinks.filter(
    (link) =>
      !!link.surfaceForm &&
      !(suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)),
  );
  if (links.length > 0) {
    const introduced = await filterToIntroducedSentenceIds(links.map((link) => link.sentenceId));
    links = links.filter((link) => introduced.has(link.sentenceId));
  }
  if (links.length === 0) return { clips: [] };

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const [items, sentences, audioRows, memberships] = await Promise.all([
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    db.sentences.bulkGet(sentenceIds),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  const itemById = new Map(
    items
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const audioBySentenceId = new Map<string, SentenceAudio>();
  for (const audio of audioRows) {
    if (!audioBySentenceId.has(audio.sentenceId)) audioBySentenceId.set(audio.sentenceId, audio);
  }
  const membershipBySentenceId = new Map<string, BookSentence>();
  for (const membership of memberships) {
    const current = membershipBySentenceId.get(membership.sentenceId);
    const shelved = suspendedIndex ? membershipIsShelved(membership, suspendedIndex) : false;
    if (!current || (!shelved && suspendedIndex && membershipIsShelved(current, suspendedIndex))) {
      membershipBySentenceId.set(membership.sentenceId, membership);
    }
  }

  // One occurrence per (word, book), citation form only, with audio.
  const chosen = new Map<string, { link: SentenceVocabulary; item: VocabularyItem }>();
  for (const link of links) {
    const item = itemById.get(link.vocabularyItemId);
    const bookId = membershipBySentenceId.get(link.sentenceId)?.bookId;
    if (!item || !bookId || link.surfaceForm !== item.expression) continue;
    if (!audioBySentenceId.has(link.sentenceId) || !sentenceById.has(link.sentenceId)) continue;
    const key = `${item.id}:${bookId}`;
    if (!chosen.has(key)) chosen.set(key, { link, item });
  }

  const alignments = await loadAlignmentsBulk(
    [...chosen.values()].map(({ link }) => audioBySentenceId.get(link.sentenceId)!.id),
  );

  const clips: PitchWordClipWithAudio[] = [];
  for (const [key, { link, item }] of chosen) {
    const audio = audioBySentenceId.get(link.sentenceId)!;
    const sentence = sentenceById.get(link.sentenceId)!;
    const shape = inWordShape(item.reading, item.pitchAccentPositions![0]!);
    if (!shape) continue;
    // Deliberately NOT `link.audioStartMs/EndMs`: those overrides are meant for
    // the pitch/word-listening cards, and the boundary backfill
    // (`backfill-word-audio-range.ts`) writes the aligner's raw match, which
    // *includes a following particle* (71 of the 92 comparable overrides in
    // prod end at word+particle). A clip with the particle in it carries the
    // heiban/odaka cue a word-only clip must leave out, so only the strict
    // word-only span from a current-version alignment — or a hand-corrected
    // `wordOnlyStartMs/EndMs` — is safe here.
    const wordOnlyOverride =
      link.wordOnlyStartMs != null && link.wordOnlyEndMs != null
        ? { startMs: link.wordOnlyStartMs, endMs: link.wordOnlyEndMs }
        : null;
    const alignment = alignments.get(audio.id);
    const spans = wordOnlyOverride
      ? { wordOnly: wordOnlyOverride, withParticle: null, tokenExact: true }
      : alignment
        ? isolatedWordSpans(alignment.words, sentence.japanese, link.surfaceForm!)
        : null;
    const span: TimeRangeMs | null =
      spans && isTrustworthyCitationSpan(item, spans) ? spans.wordOnly : null;
    if (!span || !isPlausibleClipSpan(span)) continue;
    clips.push({
      linkId: link.id,
      vocabularyItemId: item.id,
      expression: item.expression,
      reading: item.reading,
      meaning: item.meaning ?? '',
      position: item.pitchAccentPositions![0]!,
      moraCount: shape.moraCount,
      shape: shape.shape,
      bookId: key.slice(item.id.length + 1),
      span,
      audio,
      sentence,
      surfaceForm: link.surfaceForm!,
    });
  }
  return { clips };
}

export interface PitchAccentSpeakerClip {
  bookId: string;
  bookTitle: string;
  audio: SentenceAudio;
  sentence: Sentence;
  span: TimeRangeMs;
}

export interface PitchAccentSpeakerComparison {
  vocabularyItem: VocabularyItem;
  clips: PitchAccentSpeakerClip[];
}

/**
 * Words with a dictionary pitch-accent position that were also mined, in
 * citation form, out of 2+ distinct books — the app's "same speaker" proxy
 * (see `getPitchAccentMinimalPairOccurrences`'s doc: a book is normally one
 * show/narrator, not verified per-clip identity). Lets a learner compare how
 * different recordings realize the same word's accent, side by side against
 * the dictionary pattern, rather than drilling one clip in isolation.
 *
 * Same eligibility rule as `getPitchWordClips` (citation-form link, current-
 * version forced alignment, plausible word-only span, non-suspended book),
 * minus its accent-shape/mora-count restriction — this is a browse tool, not a drill, so single-mora and
 * shapeless words are still worth showing.
 */
export async function getPitchAccentSpeakerComparisons(): Promise<PitchAccentSpeakerComparison[]> {
  const db = getDb();
  const [allLinks, suspendedIndex, books] = await Promise.all([
    db.sentenceVocabulary.toArray(),
    loadSuspendedBookIndex(),
    db.books.toArray(),
  ]);
  let links = allLinks.filter(
    (link) =>
      !!link.surfaceForm &&
      !(suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)),
  );
  if (links.length > 0) {
    const introduced = await filterToIntroducedSentenceIds(links.map((link) => link.sentenceId));
    links = links.filter((link) => introduced.has(link.sentenceId));
  }
  if (links.length === 0) return [];

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const [items, sentences, audioRows, memberships] = await Promise.all([
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    db.sentences.bulkGet(sentenceIds),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  const itemById = new Map(
    items
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const audioBySentenceId = new Map<string, SentenceAudio>();
  for (const audio of audioRows) {
    if (!audioBySentenceId.has(audio.sentenceId)) audioBySentenceId.set(audio.sentenceId, audio);
  }
  const membershipBySentenceId = new Map<string, BookSentence>();
  for (const membership of memberships) {
    const current = membershipBySentenceId.get(membership.sentenceId);
    const shelved = suspendedIndex ? membershipIsShelved(membership, suspendedIndex) : false;
    if (!current || (!shelved && suspendedIndex && membershipIsShelved(current, suspendedIndex))) {
      membershipBySentenceId.set(membership.sentenceId, membership);
    }
  }
  const bookTitleById = new Map(books.map((book) => [book.id, book.title]));

  // One occurrence per (word, book), citation form only, with audio.
  const chosen = new Map<string, { link: SentenceVocabulary; item: VocabularyItem; bookId: string }>();
  for (const link of links) {
    const item = itemById.get(link.vocabularyItemId);
    const bookId = membershipBySentenceId.get(link.sentenceId)?.bookId;
    if (!item || !bookId || link.surfaceForm !== item.expression) continue;
    if (!audioBySentenceId.has(link.sentenceId) || !sentenceById.has(link.sentenceId)) continue;
    const key = `${item.id}:${bookId}`;
    if (!chosen.has(key)) chosen.set(key, { link, item, bookId });
  }

  const alignments = await loadAlignmentsBulk(
    [...chosen.values()].map(({ link }) => audioBySentenceId.get(link.sentenceId)!.id),
  );

  const clipsByItem = new Map<string, PitchAccentSpeakerClip[]>();
  const itemsSeen = new Map<string, VocabularyItem>();
  for (const { link, item, bookId } of chosen.values()) {
    const audio = audioBySentenceId.get(link.sentenceId)!;
    const sentence = sentenceById.get(link.sentenceId)!;
    // Same strict word-only span as `getPitchWordClips` (comparing accent shapes
    // across speakers also breaks if a particle sneaks in), so an existing
    // hand-corrected word-only span carries over here too.
    const wordOnlyOverride =
      link.wordOnlyStartMs != null && link.wordOnlyEndMs != null
        ? { startMs: link.wordOnlyStartMs, endMs: link.wordOnlyEndMs }
        : null;
    const alignment = alignments.get(audio.id);
    const spans = wordOnlyOverride
      ? { wordOnly: wordOnlyOverride, withParticle: null, tokenExact: true }
      : alignment
        ? isolatedWordSpans(alignment.words, sentence.japanese, link.surfaceForm!)
        : null;
    const span: TimeRangeMs | null =
      spans && isTrustworthyCitationSpan(item, spans) ? spans.wordOnly : null;
    if (!span || !isPlausibleClipSpan(span)) continue;
    const list = clipsByItem.get(item.id) ?? [];
    list.push({ bookId, bookTitle: bookTitleById.get(bookId) ?? 'Unknown book', audio, sentence, span });
    clipsByItem.set(item.id, list);
    itemsSeen.set(item.id, item);
  }

  const result: PitchAccentSpeakerComparison[] = [];
  for (const [itemId, clips] of clipsByItem) {
    if (new Set(clips.map((clip) => clip.bookId)).size < 2) continue;
    clips.sort((a, b) => a.bookTitle.localeCompare(b.bookTitle));
    result.push({ vocabularyItem: itemsSeen.get(itemId)!, clips });
  }
  result.sort(
    (a, b) =>
      b.clips.length - a.clips.length ||
      a.vocabularyItem.expression.localeCompare(b.vocabularyItem.expression, 'ja'),
  );
  return result;
}


export interface VocabularyOccurrenceCandidate {
  link: SentenceVocabulary;
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
}

/**
 * Like `getVocabularyTargetCandidates`, but one entry per *occurrence* (per
 * `surfaceForm`-bearing `sentence_vocabulary` link) rather than one per
 * distinct word. The contextual conjugation card (docs/STATUS.md) schedules
 * a separate study item for each occurrence — a verb read in three sentences
 * is three cards — so it needs every link, not just the first per word.
 * Still bounded: only surface-form-bearing links, only within `sentenceIds`.
 */
export async function getVocabularyOccurrenceCandidates(
  sentenceIds: string[],
): Promise<VocabularyOccurrenceCandidate[]> {
  if (sentenceIds.length === 0) return [];
  const db = getDb();
  const links = (
    await db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray()
  ).filter((link) => !!link.surfaceForm);
  if (links.length === 0) return [];

  const [vocabularyItems, sentences] = await Promise.all([
    db.vocabularyItems.bulkGet(links.map((link) => link.vocabularyItemId)),
    db.sentences.bulkGet(links.map((link) => link.sentenceId)),
  ]);

  const candidates: VocabularyOccurrenceCandidate[] = [];
  links.forEach((link, index) => {
    const vocabularyItem = vocabularyItems[index];
    const sentence = sentences[index];
    if (!vocabularyItem || !sentence || !link.surfaceForm) return;
    candidates.push({ link, vocabularyItem, sentence, surfaceForm: link.surfaceForm });
  });
  return candidates;
}

/**
 * Per-word pitch-accent targets for the ambient "H/L marks" display
 * (SentencePitchAccentRow, AnalysisPanel, SyncedShadowText) — like
 * getVocabularyTargetCandidates but inflection-aware: each occurrence goes
 * through resolveInflectedPitchAccent (src/lib/pitchAccentShift.ts) so a
 * word appearing inflected (走らない for 走る) contributes the *conjugated*
 * reading/position it's actually pronounced with, not the dictionary one.
 * An occurrence resolveInflectedPitchAccent can't confidently place (no
 * accent data, or an inflected form outside its narrow coverage) is
 * dropped rather than shown with a wrong contour — same "skip, don't
 * guess" stance as everywhere else in this feature. Content words with no
 * vocabulary link then fall back to the Kanjium table
 * (src/lib/kanjiumPitchLookup.ts), citation forms only.
 */
export async function getSentencePitchAccentTargets(
  sentenceId: string,
): Promise<SentencePitchAccentTarget[]> {
  const occurrences = await getVocabularyOccurrenceCandidates([sentenceId]);
  const targets: SentencePitchAccentTarget[] = [];
  for (const occurrence of occurrences) {
    const resolved = resolveInflectedPitchAccent(occurrence);
    if (!resolved) continue;
    targets.push({
      // resolved.surfaceForm, not occurrence.surfaceForm — see the doc
      // comment on ResolvedPitchAccent.surfaceForm (truncated stems).
      surfaceForm: resolved.surfaceForm,
      reading: resolved.reading,
      // A citation-form word keeps the dictionary's other listed accents so the row can flag the ambiguity;
      // an inflected occurrence is a single predicted position.
      pitchAccentPositions: resolved.isCitationForm
        ? [resolved.position, ...(occurrence.vocabularyItem.pitchAccentPositions ?? []).slice(1)]
        : [resolved.position],
    });
  }
  // Words with no vocabulary link: fall back to the Kanjium table (citation-form content words only).
  const sentence = await getDb().sentences.get(sentenceId);
  const lookup = sentence?.vocabularySuggestions?.length ? await loadKanjiumPitchLookup() : null;
  if (sentence && lookup) {
    const covered = new Set(targets.map((target) => target.surfaceForm));
    targets.push(
      ...kanjiumTargetsForSuggestions(sentence.vocabularySuggestions, lookup, covered, sentence),
    );
  }
  return targets;
}

export interface TrackedGrammarSpan {
  surfaceForm: string;
  start: number;
  end: number;
  patternName: string;
}

/**
 * For each of `sentenceIds`, its first tracked (`confirmedByLearner`) grammar
 * occurrence with a real character span — ambient "you're tracking this
 * pattern too" highlighting for `reading_in_context`'s passage context lines
 * (docs/ROADMAP.md "Ambient connective tissue in the reveal"), not the
 * target sentence itself, which is under test. One span per sentence: a
 * context line highlighting every occurrence at once would be visual noise,
 * and this is reinforcement, not a review.
 */
export async function getTrackedGrammarSpansForSentences(
  sentenceIds: string[],
): Promise<Map<string, TrackedGrammarSpan>> {
  const result = new Map<string, TrackedGrammarSpan>();
  if (sentenceIds.length === 0) return result;
  const db = getDb();
  const links = await db.sentenceGrammar.where('sentenceId').anyOf(sentenceIds).toArray();
  const firstBySentence = new Map<string, SentenceGrammar>();
  for (const link of links) {
    if (!link.confirmedByLearner || link.start == null || link.end == null) continue;
    if (!firstBySentence.has(link.sentenceId)) firstBySentence.set(link.sentenceId, link);
  }
  if (firstBySentence.size === 0) return result;
  const patterns = await db.grammarPatterns.bulkGet([
    ...new Set([...firstBySentence.values()].map((link) => link.grammarPatternId)),
  ]);
  const patternById = new Map(
    patterns.filter((pattern): pattern is GrammarPattern => !!pattern).map((pattern) => [pattern.id, pattern]),
  );
  for (const [sentenceId, link] of firstBySentence) {
    const pattern = patternById.get(link.grammarPatternId);
    if (!pattern) continue;
    result.set(sentenceId, {
      surfaceForm: link.surfaceForm ?? '',
      start: link.start!,
      end: link.end!,
      patternName: pattern.canonicalName,
    });
  }
  return result;
}

/** Canonical (unordered) pair ordering so A↔B is never stored twice. */
function canonicalConfusionPair(
  itemAId: string,
  itemBId: string,
): [string, string] {
  return itemAId < itemBId ? [itemAId, itemBId] : [itemBId, itemAId];
}

/**
 * Get-or-create a confusion pair. Never overwrites an existing row's
 * confusionType — mirrors ensureVocabularyItem/ensureKanji's "never
 * overwrite once created" convention. Use recordConfusionObservation to
 * bump the count on repeated observations.
 */
export async function ensureVocabularyConfusion(
  itemAId: string,
  itemBId: string,
  confusionType: VocabularyConfusionType,
): Promise<VocabularyConfusion> {
  const [a, b] = canonicalConfusionPair(itemAId, itemBId);
  const db = getDb();
  const existing = await db.vocabularyConfusions
    .where('[itemAId+itemBId]')
    .equals([a, b])
    .first();
  if (existing) return existing;

  const timestamp = nowIso();
  const confusion: VocabularyConfusion = {
    id: createId('vocab_confusion'),
    itemAId: a,
    itemBId: b,
    confusionType,
    observedCount: 1,
    lastObservedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.vocabularyConfusions.put(confusion);
  notifySync('vocabulary_confusions', confusion.id, confusion);
  return confusion;
}

/** Record another observation of an already-known (or new) confusion pair. */
export async function recordConfusionObservation(
  itemAId: string,
  itemBId: string,
  confusionType: VocabularyConfusionType,
): Promise<VocabularyConfusion> {
  const [a, b] = canonicalConfusionPair(itemAId, itemBId);
  const db = getDb();
  const existing = await db.vocabularyConfusions
    .where('[itemAId+itemBId]')
    .equals([a, b])
    .first();
  const timestamp = nowIso();
  const updated: VocabularyConfusion = existing
    ? {
        ...existing,
        observedCount: existing.observedCount + 1,
        lastObservedAt: timestamp,
        updatedAt: timestamp,
      }
    : {
        id: createId('vocab_confusion'),
        itemAId: a,
        itemBId: b,
        confusionType,
        observedCount: 1,
        lastObservedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  await db.vocabularyConfusions.put(updated);
  notifySync('vocabulary_confusions', updated.id, updated);
  return updated;
}

export interface ConfusionPairCandidate {
  confusion: VocabularyConfusion;
  itemA: VocabularyTargetCandidate;
  itemB: VocabularyTargetCandidate;
}

// ---------------------------------------------------------------------------
// Grammar patterns (grammar-learning system foundation, docs/AI_OVERVIEW.md).
// GrammarPattern/SentenceGrammar/GrammarRelationship mirror the
// VocabularyItem/SentenceVocabulary/VocabularyConfusion shapes above — see
// the doc comments on those types (src/domain/types.ts) for how and why they
// diverge. No UI writes to these yet (Phase 2 of the grammar-learning plan);
// this section is schema-adjacent foundation only.
// ---------------------------------------------------------------------------

/**
 * Get-or-create a canonical GrammarPattern, deduped on normalizedKey (exact
 * match modulo leading/trailing tilde/wave-dash and whitespace — see
 * normalizeGrammarPatternKey). Never overwrites an existing row, mirroring
 * ensureVocabularyItem/ensureKanji.
 */
export async function ensureGrammarPattern(
  canonicalName: string,
  fields: {
    shortMeaning?: string;
    reading?: string;
    structuralTemplate?: string;
    explanation?: string;
    structuralNotes?: string;
    family?: string;
    notes?: string;
    aliases?: string[];
    provenance?: 'manual' | 'ai_suggested';
    externalId?: string;
  } = {},
): Promise<GrammarPattern> {
  const db = getDb();
  const normalizedKey = normalizeGrammarPatternKey(canonicalName);
  const existing = await db.grammarPatterns
    .where('normalizedKey')
    .equals(normalizedKey)
    .first();
  if (existing) return existing;

  const timestamp = nowIso();
  const pattern: GrammarPattern = {
    id: await mintGetOrCreateId('grammar_pattern', normalizedKey),
    canonicalName: canonicalName.trim(),
    normalizedKey,
    aliases: fields.aliases ?? [],
    shortMeaning: fields.shortMeaning ?? '',
    reading: fields.reading,
    structuralTemplate: fields.structuralTemplate,
    explanation: fields.explanation,
    structuralNotes: fields.structuralNotes,
    family: fields.family,
    notes: fields.notes,
    provenance: fields.provenance ?? 'manual',
    externalId: fields.externalId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.grammarPatterns.put(pattern);
  notifySync('grammar_patterns', pattern.id, pattern);
  return pattern;
}

export async function updateGrammarPattern(
  patternId: string,
  patch: Partial<
    Pick<
      GrammarPattern,
      | 'shortMeaning'
      | 'reading'
      | 'structuralTemplate'
      | 'explanation'
      | 'structuralNotes'
      | 'family'
      | 'notes'
      | 'aliases'
    >
  >,
): Promise<GrammarPattern> {
  const db = getDb();
  const existing = await db.grammarPatterns.get(patternId);
  if (!existing) throw new Error('Grammar pattern not found');
  const updated: GrammarPattern = { ...existing, ...patch, updatedAt: nowIso() };
  await db.grammarPatterns.put(updated);
  notifySync('grammar_patterns', updated.id, updated);
  return updated;
}

/**
 * Get-or-create the occurrence link for (sentenceId, grammarPatternId). A
 * pattern recurring more than once within the same sentence collapses onto
 * one row — an accepted v1 simplification, same class of limitation as
 * SentenceVocabulary not distinguishing repeated occurrences of a word.
 * Repeat calls patch in newly-supplied fields (never overwriting existing
 * ones with undefined) and OR `confirmedByLearner` so a later "Got it"/
 * "Track" can promote an AI-suggested-only occurrence, but nothing can ever
 * flip a confirmed occurrence back to unconfirmed.
 */
export async function ensureSentenceGrammar(
  sentenceId: string,
  grammarPatternId: string,
  fields: {
    chunkId?: string;
    surfaceForm?: string;
    start?: number;
    end?: number;
    occurrenceExplanation?: string;
    confirmedByLearner?: boolean;
    source?: 'manual' | 'ai_suggested';
  } = {},
): Promise<SentenceGrammar> {
  const db = getDb();
  const existing = await db.sentenceGrammar
    .where('[sentenceId+grammarPatternId]')
    .equals([sentenceId, grammarPatternId])
    .first();
  const timestamp = nowIso();

  if (existing) {
    const updated: SentenceGrammar = {
      ...existing,
      chunkId: fields.chunkId ?? existing.chunkId,
      surfaceForm: fields.surfaceForm ?? existing.surfaceForm,
      start: fields.start ?? existing.start,
      end: fields.end ?? existing.end,
      occurrenceExplanation: fields.occurrenceExplanation ?? existing.occurrenceExplanation,
      confirmedByLearner: existing.confirmedByLearner || Boolean(fields.confirmedByLearner),
      updatedAt: timestamp,
    };
    await db.sentenceGrammar.put(updated);
    notifySync('sentence_grammar', updated.id, updated);
    return updated;
  }

  const created: SentenceGrammar = {
    id: await mintGetOrCreateId('sentence_grammar', sentenceId, grammarPatternId),
    sentenceId,
    grammarPatternId,
    chunkId: fields.chunkId,
    surfaceForm: fields.surfaceForm,
    start: fields.start,
    end: fields.end,
    occurrenceExplanation: fields.occurrenceExplanation,
    confirmedByLearner: Boolean(fields.confirmedByLearner),
    source: fields.source ?? 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.sentenceGrammar.put(created);
  notifySync('sentence_grammar', created.id, created);
  return created;
}

/**
 * Unlink a pattern from one sentence (mis-tag correction) — never deletes
 * the underlying GrammarPattern itself, since other sentences may
 * reference it, same "never delete the canonical row" precedent as
 * materializeVocabularySelections.
 */
export async function removeSentenceGrammar(sentenceGrammarId: string): Promise<void> {
  const db = getDb();
  const existing = await db.sentenceGrammar.get(sentenceGrammarId);
  if (!existing) return;
  await db.sentenceGrammar.delete(sentenceGrammarId);
  notifySync('sentence_grammar', sentenceGrammarId, existing, 'delete');
}

/**
 * Drops assistant-suggested links the learner has not acted on for sentences they have not met yet (see
 * `visibleGrammarLinks`). Reads the introduced set only when such a link is present.
 */
export async function withoutUnseenAiLinks<T extends SentenceGrammar>(links: T[]): Promise<T[]> {
  if (!links.some(isUnreviewedAiLink)) return links;
  const introduced = await getIntroducedSentenceIds(links.map((link) => link.sentenceId));
  return visibleGrammarLinks(links, introduced);
}

export interface GrammarEncounter {
  sentenceGrammar: SentenceGrammar;
  sentence: Sentence;
  books: Book[];
  /** This sentence's native/reference audio clips, if any — playable via NativeAudioButton. */
  audio: SentenceAudio[];
}

/**
 * "Your encounters" (design brief §5/§6) for a GrammarPattern: every
 * sentence it's been linked to, with book/source provenance and whether
 * native audio is available, newest first. Prefers the learner's own
 * corpus over any generated example — if there's only one encounter, this
 * simply returns that one, per the brief's explicit instruction not to
 * manufacture a bigger corpus than actually exists.
 */
export async function listSentenceGrammarForPattern(
  grammarPatternId: string,
): Promise<GrammarEncounter[]> {
  const db = getDb();
  const links = await withoutUnseenAiLinks(
    await db.sentenceGrammar.where('grammarPatternId').equals(grammarPatternId).toArray(),
  );
  if (links.length === 0) return [];

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const [sentences, memberships, audioRows] = await Promise.all([
    db.sentences.bulkGet(sentenceIds),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  const sentenceById = new Map<string, Sentence>();
  sentences.forEach((sentence, index) => {
    if (sentence) sentenceById.set(sentenceIds[index]!, sentence);
  });
  const bookIds = [...new Set(memberships.map((item) => item.bookId))];
  const books = await db.books.bulkGet(bookIds);
  const bookById = new Map<string, Book>();
  books.forEach((book, index) => {
    if (book) bookById.set(bookIds[index]!, book);
  });
  const encounters: GrammarEncounter[] = [];
  for (const link of links) {
    const sentence = sentenceById.get(link.sentenceId);
    if (!sentence) continue;
    const linkedBooks = memberships
      .filter((item) => item.sentenceId === link.sentenceId)
      .map((item) => bookById.get(item.bookId))
      .filter((book): book is Book => Boolean(book));
    encounters.push({
      sentenceGrammar: link,
      sentence,
      books: linkedBooks,
      audio: audioRows.filter((row) => row.sentenceId === link.sentenceId),
    });
  }
  return encounters.sort((a, b) =>
    b.sentenceGrammar.createdAt.localeCompare(a.sentenceGrammar.createdAt),
  );
}

export interface GrammarPatternSummary {
  pattern: GrammarPattern;
  encounterCount: number;
  confirmedCount: number;
  distinctSourceCount: number;
  tracked: boolean;
  /** Every one of this pattern's grammarPattern-subject study items has crossed the graduation threshold. */
  graduated: boolean;
  state: GrammarLearnerState;
  priorityBucket: GrammarPriorityBucket;
  priorityExplanation: string;
  recentAgainCount: number;
  recentReviewCount: number;
}

/**
 * Every GrammarPattern with its encounter/source-diversity counts, derived
 * learner state (design brief §9, computeGrammarLearnerState), and
 * dashboard priority bucket (§13/§14, computeGrammarPriorityBucket) — the
 * `/grammar` browser's list view. Batched, not N+1: five whole-table reads
 * (plus one `reviews` read scoped to grammar study items) regardless of
 * pattern count, same discipline as listStudyItemSummaries.
 *
 * "Recent" reviews (for the priority explanation's "needed help on N of
 * the last M reviews") are scoped to each pattern's own `grammar_completion`
 * study item — the only surviving grammar activity type since
 * `grammar_comprehension`/`grammar_contrast`/`grammar_production` were
 * retired 2026-09-15 (docs/ROADMAP.md).
 */
export async function listGrammarPatternSummaries(): Promise<GrammarPatternSummary[]> {
  const db = getDb();
  const [patterns, allLinks, studyItems, bookSentences, books, settings] = await Promise.all([
    db.grammarPatterns.toArray(),
    db.sentenceGrammar.toArray(),
    db.studyItems.where('subjectType').equals('grammarPattern').toArray(),
    db.bookSentences.toArray(),
    db.books.toArray(),
    readSettings(db),
  ]);
  const links = await withoutUnseenAiLinks(allLinks);
  const graduatedPatternIds = computeGraduatedSubjectIds(
    studyItems,
    settings.graduationMinScheduledDays,
  );

  const sourceKeyByBookId = new Map(books.map((book) => [book.id, book.sourceKey ?? book.id]));
  const sourceKeysBySentenceId = new Map<string, Set<string>>();
  for (const membership of bookSentences) {
    const key = sourceKeyByBookId.get(membership.bookId);
    if (!key) continue;
    const existing = sourceKeysBySentenceId.get(membership.sentenceId);
    if (existing) existing.add(key);
    else sourceKeysBySentenceId.set(membership.sentenceId, new Set([key]));
  }

  const linksByPatternId = new Map<string, SentenceGrammar[]>();
  for (const link of links) {
    const list = linksByPatternId.get(link.grammarPatternId);
    if (list) list.push(link);
    else linksByPatternId.set(link.grammarPatternId, [link]);
  }

  const studyItemsByPatternId = new Map<string, StudyItem[]>();
  for (const item of studyItems) {
    const list = studyItemsByPatternId.get(item.subjectId);
    if (list) list.push(item);
    else studyItemsByPatternId.set(item.subjectId, [item]);
  }
  const gradedStudyItemIds = studyItems
    .filter((item) => item.activityType === 'grammar_completion' || item.activityType === 'grammar_recognition')
    .map((item) => item.id);
  const recentReviews = gradedStudyItemIds.length
    ? await db.reviews.where('studyItemId').anyOf(gradedStudyItemIds).toArray()
    : [];
  const reviewsByStudyItemId = new Map<string, Review[]>();
  for (const review of recentReviews) {
    const list = reviewsByStudyItemId.get(review.studyItemId);
    if (list) list.push(review);
    else reviewsByStudyItemId.set(review.studyItemId, [review]);
  }

  const listedPatterns = patterns.filter((pattern) =>
    isPatternListed(
      pattern,
      linksByPatternId.get(pattern.id)?.length ?? 0,
      (studyItemsByPatternId.get(pattern.id)?.length ?? 0) > 0,
    ),
  );
  const summaries = listedPatterns.map((pattern) => {
    const patternLinks = linksByPatternId.get(pattern.id) ?? [];
    const encounterCount = patternLinks.length;
    const confirmedCount = patternLinks.filter((link) => link.confirmedByLearner).length;
    const distinctSentenceIds = [...new Set(patternLinks.map((link) => link.sentenceId))];
    const sourceKeys = new Set<string>();
    for (const sentenceId of distinctSentenceIds) {
      for (const key of sourceKeysBySentenceId.get(sentenceId) ?? []) sourceKeys.add(key);
    }

    const patternStudyItems = studyItemsByPatternId.get(pattern.id) ?? [];
    const tracked = patternStudyItems.length > 0;
    const completionItem = patternStudyItems.find(
      (item) => item.activityType === 'grammar_completion',
    );
    const recognitionItem = patternStudyItems.find(
      (item) => item.activityType === 'grammar_recognition',
    );
    // "Recent" reviews come from whichever card is currently the pattern's
    // active rung — completion once it's seeded (the more advanced skill),
    // else recognition — so the dashboard's "needed help on N of the last M
    // reviews" text stays meaningful even before completion unlocks.
    const activeItem = completionItem ?? recognitionItem;
    const recent = activeItem
      ? (reviewsByStudyItemId.get(activeItem.id) ?? [])
          .slice()
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 7)
      : [];
    const recentAgainCount = recent.filter((review) => review.rating === 'again').length;
    const recognitionProficient =
      !!recognitionItem && isVocabularyItemProficient(recognitionItem.fsrsState.state);
    const completionProficient =
      !!completionItem && isVocabularyItemProficient(completionItem.fsrsState.state);

    const state = computeGrammarLearnerState({
      encounterCount,
      confirmedCount,
      tracked,
      recognitionProficient,
      completionProficient,
    });
    const priorityInput = {
      encounterCount,
      tracked,
      state,
      recentAgainCount,
      recentReviewCount: recent.length,
    };
    const priorityBucket = computeGrammarPriorityBucket(priorityInput);
    const priorityExplanation = explainGrammarPriority({
      ...priorityInput,
      distinctSourceCount: sourceKeys.size,
    });

    return {
      pattern,
      encounterCount,
      confirmedCount,
      distinctSourceCount: sourceKeys.size,
      tracked,
      graduated: graduatedPatternIds.has(pattern.id),
      state,
      priorityBucket,
      priorityExplanation,
      recentAgainCount,
      recentReviewCount: recent.length,
    };
  });

  // Drop orphaned patterns: a canonical row whose sentence links were all
  // removed (sentence deleted / re-segmented, or the last occurrence
  // mis-tag-corrected) is deliberately never deleted — cascadeRetireSentenceLocal
  // and removeSentenceGrammar both keep the row so it can be reused by
  // ensureGrammarPattern if the pattern recurs. Until then it has nothing to
  // show ("Encountered 0 times"), so it doesn't belong on the browser.
  return summaries.filter((summary) => summary.encounterCount > 0 || summary.tracked);
}

export interface GrammarRelationshipView {
  relationship: GrammarRelationship;
  otherPattern: GrammarPattern;
}

/** Every relationship edge touching `grammarPatternId`, paired with the *other* pattern in each — for the detail page's "Related patterns" section (design brief §7/§8, grammar-learning system Phase 8). */
export async function listGrammarRelationshipsForPattern(
  grammarPatternId: string,
): Promise<GrammarRelationshipView[]> {
  const db = getDb();
  const [asA, asB] = await Promise.all([
    db.grammarRelationships.where('patternAId').equals(grammarPatternId).toArray(),
    db.grammarRelationships.where('patternBId').equals(grammarPatternId).toArray(),
  ]);
  const relationships = [...asA, ...asB];
  if (relationships.length === 0) return [];
  const otherIds = relationships.map((relationship) =>
    relationship.patternAId === grammarPatternId
      ? relationship.patternBId
      : relationship.patternAId,
  );
  const otherPatterns = await db.grammarPatterns.bulkGet(otherIds);
  const views: GrammarRelationshipView[] = [];
  relationships.forEach((relationship, index) => {
    const otherPattern = otherPatterns[index];
    if (otherPattern) views.push({ relationship, otherPattern });
  });
  return views;
}

/**
 * Reading-order neighbours for one sentence (before=2/after=1, same
 * defaults and home-book-by-`lastOpenedAt` logic as buildReadingContextMap
 * in src/lib/readingContext.ts), resolved with bounded per-sentence
 * queries rather than a full-corpus fetch. Grammar patterns are
 * global-scope (a tracked pattern's sentence can come from any book) and
 * this runs once per tracked pattern on every `/review` load, so the
 * "fetch every sentence/book/bookSentence up front" approach
 * deferUnreadyReadingInContextReviews uses (fine for an occasional
 * maintenance pass over the whole corpus) would not scale here.
 */
/** Read-only presentation scope. Never applies study-readiness gates to the chapter. */
export async function getReviewDocument(
  sentenceId: string,
  preferredBookId?: string,
  vocabularyItemId?: string,
): Promise<ReviewDocument | null> {
  const db = getDb();
  const memberships = await db.bookSentences.where('sentenceId').equals(sentenceId).toArray();
  const books = await db.books.bulkGet([...new Set(memberships.map((row) => row.bookId))]);
  const bookById = new Map(books.filter((book): book is Book => Boolean(book)).map((book) => [book.id, book]));
  const candidates = memberships.filter((row) => bookById.has(row.bookId));
  candidates.sort((a, b) => {
    const preferred = Number(b.bookId === preferredBookId) - Number(a.bookId === preferredBookId);
    if (preferred) return preferred;
    const opened = (id: string) => Date.parse(bookById.get(id)?.lastOpenedAt ?? '') || 0;
    return opened(b.bookId) - opened(a.bookId);
  });
  const home = candidates[0];
  if (!home) return null;
  const book = bookById.get(home.bookId)!;
  const membershipsInBook = await db.bookSentences.where('bookId').equals(home.bookId).sortBy('position');
  // Unassigned rows stay together; they must not pull in unrelated episode chapters.
  const rows = membershipsInBook.filter((row) => row.chapterId === home.chapterId);
  const sentences = await db.sentences.bulkGet(rows.map((row) => row.sentenceId));
  const documentRows = rows.flatMap((row, index) => {
    const sentence = sentences[index];
    return sentence ? [{ membershipId: row.id, sentence }] : [];
  });
  if (!documentRows.some((row) => row.membershipId === home.id)) return null;
  const links = vocabularyItemId
    ? await db.sentenceVocabulary.where('vocabularyItemId').equals(vocabularyItemId).toArray()
    : [];
  return {
    bookId: home.bookId,
    bookTitle: book.title,
    chapterTitle: book.chapters.find((chapter) => chapter.id === home.chapterId)?.title
      ?? (book.chapters.length && !home.chapterId ? 'Unassigned sentences' : undefined),
    activeMembershipId: home.id,
    rows: documentRows,
    vocabularyForms: links.flatMap((link) => link.surfaceForm ? [link.surfaceForm] : []),
  };
}

/** Review-state stability (days) above which a word/pattern is treated as already retained. */
const EPISODE_FOCUS_KNOWN_STABILITY_DAYS = 21;

/**
 * Derived whole-episode teaching priorities for a book chapter (or whole book).
 * Read-only: no writes, no scheduling, no gating — see `buildEpisodeFocus`.
 */
export async function getEpisodeFocus(bookId: string, chapterId?: string): Promise<EpisodeFocus> {
  const db = getDb();
  const memberships = (await db.bookSentences.where('bookId').equals(bookId).sortBy('position'))
    .filter((row) => !chapterId || row.chapterId === chapterId);
  const sentenceIds = memberships.map((row) => row.sentenceId);
  const [vocabularyLinks, grammarLinks] = await Promise.all([
    readRowsByKeys(db.sentenceVocabulary, 'sentenceId', sentenceIds),
    readRowsByKeys(db.sentenceGrammar, 'sentenceId', sentenceIds),
  ]);
  const vocabularyIds = [...new Set(vocabularyLinks.map((link) => link.vocabularyItemId))];
  const patternIds = [...new Set(grammarLinks.map((link) => link.grammarPatternId))];
  const vocabularyIdSet = new Set(vocabularyIds);
  const patternIdSet = new Set(patternIds);
  const [vocabularyItems, grammarPatterns, vocabularyStudy, grammarStudy] = await Promise.all([
    db.vocabularyItems.bulkGet(vocabularyIds),
    db.grammarPatterns.bulkGet(patternIds),
    db.studyItems.where('subjectType').equals('vocabularyItem').filter((item) => vocabularyIdSet.has(item.subjectId)).toArray(),
    db.studyItems.where('subjectType').equals('grammarPattern').filter((item) => patternIdSet.has(item.subjectId)).toArray(),
  ]);
  const retained = (items: StudyItem[]) =>
    new Set(
      items
        .filter((item) => item.fsrsState.state === 'review' && item.fsrsState.stability >= EPISODE_FOCUS_KNOWN_STABILITY_DAYS)
        .map((item) => item.subjectId),
    );
  return buildEpisodeFocus({
    sentenceIds,
    vocabularyLinks,
    vocabularyItems: vocabularyItems.filter((item): item is VocabularyItem => Boolean(item)),
    grammarLinks,
    grammarPatterns: grammarPatterns.filter((item): item is GrammarPattern => Boolean(item)),
    knownVocabularyItemIds: retained(vocabularyStudy),
    knownGrammarPatternIds: retained(grammarStudy),
  });
}

/** Sentences + linked vocabulary/grammar of one episode, in the shape the preparation prompt/validator use. */
/**
 * Append one in-passage lesson event. Idempotent on `event.id` (a retried or
 * double-fired write is a no-op) and writes no Review or FSRS history:
 * explanation and assisted practice must leave scheduling alone. The one
 * exception: under the sentence-led flow a completed walkthrough seeds the
 * sentence's (still-new) reading_in_context study item, so the planner and
 * review queue can see it — otherwise cards only appeared once a Review page
 * happened to be opened, which the planner never schedules without due items.
 */
export async function logSentenceLearningEvent(
  event: Omit<SentenceLearningEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): Promise<SentenceLearningEvent> {
  const db = getDb();
  const full: SentenceLearningEvent = {
    ...event,
    id: event.id ?? createId('sl_event'),
    timestamp: event.timestamp ?? nowIso(),
  };
  const existing = await db.sentenceLearningEvents.get(full.id);
  if (existing) return existing;
  await db.sentenceLearningEvents.put(full);
  notifySyncMany([{ entity: 'sentence_learning_events', recordId: full.id, payload: full }]);
  if (full.action === 'walkthrough_completed') {
    await ensureStudyItem('sentence', full.sentenceId, 'reading_in_context');
  }
  return full;
}

/**
 * "I haven't actually walked this one": appends a `walkthrough_reset` event so earlier walkthroughs stop
 * counting as walked (progress line, Read check pool). The history is kept and no Review is written. The
 * sentence's card (seeded by the walkthrough) is removed too, but only while it is untouched (new, no reps,
 * no reviews); a card that has been studied stays, since that is real evidence of contact.
 */
export async function resetSentenceWalkthrough(input: {
  sentenceId: string;
  bookId: string;
  chapterId?: string;
  visitId?: string;
}): Promise<SentenceLearningEvent> {
  const event = await logSentenceLearningEvent({
    visitId: input.visitId ?? createId('visit'),
    action: 'walkthrough_reset',
    sentenceId: input.sentenceId,
    bookId: input.bookId,
    chapterId: input.chapterId,
  });
  const db = getDb();
  const item = await db.studyItems
    .where('[subjectType+subjectId+activityType]')
    .equals(['sentence', input.sentenceId, 'reading_in_context'])
    .first();
  if (item && item.fsrsState.state === 'new' && item.fsrsState.reps === 0 && (await db.reviews.where('studyItemId').equals(item.id).count()) === 0) {
    await db.studyItems.delete(item.id);
    notifySyncMany([{ entity: 'study_items', recordId: item.id, payload: { id: item.id }, operation: 'delete' }]);
  }
  return event;
}

/**
 * Logs one self-rated phrase shadow: the learner marked a span of the sentence's reference clip, shadowed
 * it and judged the pass. The span's text and the vocabulary inside it come from the cached forced alignment
 * and the sentence's own links (no alignment yet: the event still logs, with no text and no words credited).
 * Evidence only: no Review, no FSRS, and not a whole-sentence shadowing attempt. Returns null when the span
 * is not a phrase (too short, or essentially the whole clip).
 */
export async function logPhraseShadow(input: {
  bookId: string;
  chapterId?: string;
  sentenceId: string;
  sentenceAudioId: string;
  clipDurationMs: number;
  range: { startMs: number; endMs: number };
  outcome: PhraseShadowOutcome;
  visitId?: string;
  /** Unlinked content words the learner chose to track at rating time; each gets a bare vocabulary item. Default none. */
  trackSurfaces?: readonly string[];
}): Promise<SentenceLearningEvent | null> {
  if (!isPhraseRange(input.range, input.clipDurationMs)) return null;
  const db = getDb();
  const [alignment, links, settings, sentence] = await Promise.all([
    db.referenceAlignments.get(input.sentenceAudioId),
    db.sentenceVocabulary.where('sentenceId').equals(input.sentenceId).toArray(),
    ensureSettings(db),
    db.sentences.get(input.sentenceId),
  ]);
  const text = alignment ? phraseTextFromAlignment(alignment.result.words, input.range, sentence?.japanese) : '';
  return logSentenceLearningEvent({
    visitId: input.visitId ?? createId('phrase_visit'),
    action: 'phrase_shadow',
    bookId: input.bookId,
    chapterId: input.chapterId,
    sentenceId: input.sentenceId,
    target: { kind: 'expression', key: phraseShadowTargetKey(await phraseCreditedWordIds(sentence, text, links, input.trackSurfaces ?? [])), label: text },
    rangeStartMs: Math.round(input.range.startMs),
    rangeEndMs: Math.round(input.range.endMs),
    outcome: input.outcome,
    assessmentSource: 'self',
    quietMode: settings.quietMode ?? false,
  });
}

/**
 * One rung of a chunk chain rated by the learner (docs/ROADMAP.md, "Chunk chain"). A `phrase_shadow`
 * event whose key is a `chain-rung:` key: it credits no word and is not a pronunciation attempt of its
 * own, so rungs the chain climbs through don't inflate the planner's evidence. The chain's one weighted
 * event is `logChunkChainSummary`.
 */
export async function logChunkChainRung(input: {
  bookId: string;
  chapterId?: string;
  sentenceId: string;
  /** A rung index, or 'cold' for the optional whole-sentence try before the chain (never credits or grades anything). */
  rungIndex: number | 'cold';
  range: { startMs: number; endMs: number };
  text: string;
  outcome: PhraseShadowOutcome;
  visitId: string;
}): Promise<SentenceLearningEvent> {
  const settings = await ensureSettings(getDb());
  return logSentenceLearningEvent({
    visitId: input.visitId,
    action: 'phrase_shadow',
    bookId: input.bookId,
    chapterId: input.chapterId,
    sentenceId: input.sentenceId,
    target: { kind: 'expression', key: input.rungIndex === 'cold' ? CHAIN_COLD_KEY : chainRungTargetKey(input.rungIndex), label: input.text },
    rangeStartMs: Math.round(input.range.startMs),
    rangeEndMs: Math.round(input.range.endMs),
    outcome: input.outcome,
    assessmentSource: 'self',
    quietMode: settings.quietMode ?? false,
  });
}

/** The sentence's content-word suggestions inside a phrase that no link covers (deduplicated by surface). */
export function unlinkedPhraseSuggestions(sentence: Sentence | undefined, text: string, links: readonly SentenceVocabulary[]) {
  if (!text || !sentence) return [];
  const linkedSurfaces = new Set(links.map((link) => link.surfaceForm).filter(Boolean));
  const seen = new Set<string>();
  return sentence.vocabularySuggestions.filter((suggestion) => {
    if (!suggestion.selectedByDefault || !suggestion.surface || seen.has(suggestion.surface)) return false;
    seen.add(suggestion.surface);
    return !linkedSurfaces.has(suggestion.surface) && text.includes(suggestion.surface);
  });
}

/**
 * Vocabulary item ids a phrase pass credits: linked words inside the phrase, plus a bare vocabulary
 * item (no link, no card, like a reader word flag) for each unlinked content word in `track`,
 * so words the learner chose to track earn evidence too.
 */
async function phraseCreditedWordIds(
  sentence: Sentence | undefined,
  text: string,
  links: readonly SentenceVocabulary[],
  track: readonly string[],
): Promise<string[]> {
  const ids = new Set(wordIdsInPhrase(text, links));
  for (const suggestion of unlinkedPhraseSuggestions(sentence, text, links)) {
    if (!track.includes(suggestion.surface)) continue;
    ids.add((await ensureVocabularyItem(suggestion.expression, suggestion.reading, { meaning: suggestion.english })).id);
  }
  return [...ids];
}

/**
 * The chain's one weighted event: an ordinary `phrase_shadow` Got it over the highest rung the learner
 * got, crediting each word in that rung's text once. Not logged when no rung was Got it. Unlike
 * `logPhraseShadow` it accepts a whole-sentence span (the chain's last rung).
 */
export async function logChunkChainSummary(input: {
  bookId: string;
  chapterId?: string;
  sentenceId: string;
  range: { startMs: number; endMs: number };
  text: string;
  visitId: string;
  /** Unlinked content words the learner chose to track; each gets a bare vocabulary item. Default none. */
  trackSurfaces?: readonly string[];
}): Promise<SentenceLearningEvent> {
  const db = getDb();
  const [links, settings, sentence] = await Promise.all([
    db.sentenceVocabulary.where('sentenceId').equals(input.sentenceId).toArray(),
    ensureSettings(db),
    db.sentences.get(input.sentenceId),
  ]);
  return logSentenceLearningEvent({
    visitId: input.visitId,
    action: 'phrase_shadow',
    bookId: input.bookId,
    chapterId: input.chapterId,
    sentenceId: input.sentenceId,
    target: { kind: 'expression', key: phraseShadowTargetKey(await phraseCreditedWordIds(sentence, input.text, links, input.trackSurfaces ?? [])), label: input.text },
    rangeStartMs: Math.round(input.range.startMs),
    rangeEndMs: Math.round(input.range.endMs),
    outcome: 'got_it',
    assessmentSource: 'self',
    quietMode: settings.quietMode ?? false,
  });
}

/**
 * A phrase to shadow for this sentence: the aligned span of its weakest-reading word (with a following
 * particle), widened to a short phrase. Read-only. Null without a current alignment or when none of the
 * sentence's words can be located in the clip. The learner still chooses: the Shadow pane offers it as one tap.
 */
export async function suggestPhraseShadow(input: {
  sentenceId: string;
  sentenceAudioId: string;
  clipDurationMs: number;
  /** Only this occurrence (a word the learner tapped in the reader) instead of the weakest word. */
  surfaceForm?: string;
}): Promise<{ startMs: number; endMs: number; text: string; wordLabel: string } | null> {
  const db = getDb();
  const [alignment, sentence, links] = await Promise.all([
    getReferenceAlignment(input.sentenceAudioId),
    db.sentences.get(input.sentenceId),
    db.sentenceVocabulary.where('sentenceId').equals(input.sentenceId).toArray(),
  ]);
  if (!alignment || !sentence) return null;
  // Never end or start a phrase inside a word the aligner split into several tokens (食べ|ログ), or open on a particle.
  const snapToWords = (range: { startMs: number; endMs: number }) =>
    dropLeadingParticles(
      alignment.words,
      snapRangeToWordBoundaries(alignment.words, sentence.japanese, sentence.vocabularySuggestions ?? [], range),
    );
  // No word could be placed (or none is linked): still never leave the pane on the whole sentence.
  const chunkFallback = (weakestFirst: readonly string[]) => {
    if (input.surfaceForm) return null;
    const chunk = weakestChunkRange(alignment.words, sentence.japanese, weakestFirst, input.clipDurationMs);
    if (!chunk) return null;
    const range = snapToWords(chunk);
    const text = phraseTextFromAlignment(alignment.words, range, sentence.japanese);
    return text ? { ...range, text, wordLabel: '' } : null;
  };
  const candidates = links.filter((link) => link.surfaceForm && (!input.surfaceForm || link.surfaceForm === input.surfaceForm));
  if (candidates.length === 0) {
    // No linked word (most sentences: nothing was confirmed). Not having flagged a word says nothing
    // about whether it is said well, so target the sentence's own content words, those not yet drilled
    // here first, before falling back to a chunk picked by position.
    const past = (await db.sentenceLearningEvents.where('sentenceId').equals(input.sentenceId).toArray())
      .filter((event) => event.action === 'phrase_shadow')
      .map((event) => ({ text: event.target?.label ?? '', outcome: event.outcome, timestamp: event.timestamp }));
    for (const surface of orderSuggestedSurfaces(sentence.vocabularySuggestions, past, input.surfaceForm)) {
      const spans = isolatedWordSpans(alignment.words, sentence.japanese, surface);
      const span = spans?.withParticle ?? spans?.wordOnly;
      if (!span) continue;
      const range = expandToPhrase(alignment.words, span, input.clipDurationMs);
      if (!isPhraseRange(range, input.clipDurationMs)) continue;
      return { ...range, text: phraseTextFromAlignment(alignment.words, range, sentence.japanese), wordLabel: surface };
    }
    return chunkFallback([]);
  }
  const { strengthByWord, vocabById } = await loadWordReadingStrengths(READER_STRENGTH_CACHE_MS);
  const ordered = orderLinksByWeakness(candidates, strengthByWord);
  for (const link of ordered) {
    const spans = isolatedWordSpans(alignment.words, sentence.japanese, link.surfaceForm!);
    const span = spans?.withParticle ?? spans?.wordOnly;
    if (!span) continue;
    const range = snapToWords(expandToPhrase(alignment.words, span, input.clipDurationMs));
    if (!isPhraseRange(range, input.clipDurationMs)) continue;
    return {
      ...range,
      text: phraseTextFromAlignment(alignment.words, range, sentence.japanese),
      wordLabel: vocabById.get(link.vocabularyItemId)?.expression ?? link.surfaceForm!,
    };
  }
  // The weakest word's chunk, located from its place in the sentence rather than by an aligner match.
  return chunkFallback(ordered.map((link) => link.surfaceForm!));
}

/** `suggestPhraseShadow` for a sentence's first reference clip (the planner has the sentence, not the audio row). */
export async function suggestPhraseShadowForSentence(
  sentenceId: string,
): Promise<{ startMs: number; endMs: number; text: string; wordLabel: string } | null> {
  const audio = await getDb().sentenceAudio.where('sentenceId').equals(sentenceId).first();
  if (!audio || audio.durationMs <= 0) return null;
  return suggestPhraseShadow({ sentenceId, sentenceAudioId: audio.id, clipDurationMs: audio.durationMs });
}

export async function logGlossDecision(
  decision: Omit<GlossDecision, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): Promise<GlossDecision> {
  const db = getDb();
  const full: GlossDecision = { ...decision, id: decision.id ?? createId('gloss'), timestamp: decision.timestamp ?? nowIso() };
  const existing = await db.glossDecisions.get(full.id);
  if (existing) return existing;
  await db.glossDecisions.put(full);
  notifySyncMany([{ entity: 'gloss_decisions', recordId: full.id, payload: full }]);
  return full;
}

export async function listGlossDecisions(): Promise<GlossDecision[]> {
  return getDb().glossDecisions.orderBy('timestamp').toArray();
}

/** Appends one reaction to the ungraded clause-question preview (synced; never a review). */
export async function logClauseQuestionFeedback(
  feedback: Omit<ClauseQuestionFeedback, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): Promise<ClauseQuestionFeedback> {
  const db = getDb();
  const full: ClauseQuestionFeedback = {
    ...feedback,
    id: feedback.id ?? createId('clausefb'),
    timestamp: feedback.timestamp ?? nowIso(),
  };
  const existing = await db.clauseQuestionFeedback.get(full.id);
  if (existing) return existing;
  await db.clauseQuestionFeedback.put(full);
  notifySyncMany([{ entity: 'clause_question_feedback', recordId: full.id, payload: full }]);
  return full;
}

/** The learner's current reaction to a question: the most recent row, from any device. */
export async function latestClauseQuestionFeedback(referenceId: string): Promise<ClauseQuestionFeedback | undefined> {
  const rows = await getDb().clauseQuestionFeedback.where('referenceId').equals(referenceId).toArray();
  return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)).at(-1);
}

export interface OpenContentReportWithText extends OpenContentReport {
  japanese: string;
  translation?: string;
}

export async function getOpenContentReports(): Promise<OpenContentReportWithText[]> {
  const db = getDb();
  const open = openContentReports(await db.sentenceLearningEvents.toArray());
  const sentences = await db.sentences.bulkGet(open.map((report) => report.sentenceId));
  return open.map((report, index) => ({
    ...report,
    japanese: sentences[index]?.japanese ?? '',
    translation: sentences[index]?.translation,
  }));
}

/** Triage only: logs a `report_resolved` event. Never edits the sentence, its analysis or any study state. */
export async function resolveContentReport(
  report: OpenContentReport,
  resolution: 'fixed' | 'dismissed',
): Promise<void> {
  await logSentenceLearningEvent({
    visitId: createId('sl_visit'),
    action: 'report_resolved',
    bookId: report.bookId,
    sentenceId: report.sentenceId,
    ...(report.target ? { target: report.target } : {}),
    resolution,
  });
}

export async function getSentenceLessonReport(): Promise<SentenceLessonReport> {
  const db = getDb();
  const [events, sessions] = await Promise.all([
    db.sentenceLearningEvents.toArray(),
    db.plannerSessions.toArray(),
  ]);
  return buildSentenceLessonReport(events, sessions);
}

export async function getEpisodeProgress(): Promise<EpisodeProgressRow[]> {
  const db = getDb();
  const [books, memberships, events] = await Promise.all([
    db.books.toArray(),
    db.bookSentences.toArray(),
    db.sentenceLearningEvents.toArray(),
  ]);
  return buildEpisodeProgress(books, memberships, events);
}

export async function listSentenceLearningEvents(bookId: string): Promise<SentenceLearningEvent[]> {
  if (plannerPassActive()) {
    // Inside a planning pass this runs once per book; filter the single shared scan instead.
    return (await readAllLearningEventsForPass())
      .filter((event) => event.bookId === bookId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return withoutResetWalkthroughs(await getDb().sentenceLearningEvents.where('bookId').equals(bookId).sortBy('timestamp'));
}

export async function getEpisodePreparationContext(
  bookId: string,
  chapterId: string,
): Promise<{ context: PreparationContext; preparation?: EpisodePreparation; needsStructureIds: string[]; needsConstructionIds: string[]; needsWalkthroughIds: string[] }> {
  const db = getDb();
  const rawBook = await db.books.get(bookId);
  const book = rawBook ? await withChapterExtras(rawBook) : undefined;
  const chapter = book?.chapters.find((item) => item.id === chapterId);
  if (!book || !chapter) throw new Error('Chapter not found');
  const memberships = (await db.bookSentences.where('bookId').equals(bookId).sortBy('position'))
    .filter((row) => row.chapterId === chapterId);
  const sentenceRows = await db.sentences.bulkGet(memberships.map((row) => row.sentenceId));
  const sentences = sentenceRows.flatMap((row) => (row ? [{ id: row.id, japanese: row.japanese, translation: row.translation ?? '' }] : []));
  const sentenceIds = sentences.map((row) => row.id);
  const [vocabularyLinks, grammarLinks] = await Promise.all([
    db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.sentenceGrammar.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  const [vocabulary, grammar] = await Promise.all([
    db.vocabularyItems.bulkGet([...new Set(vocabularyLinks.map((link) => link.vocabularyItemId))]),
    db.grammarPatterns.bulkGet([...new Set(grammarLinks.map((link) => link.grammarPatternId))]),
  ]);
  return {
    context: {
      title: chapter.title,
      sentences,
      vocabulary: vocabulary.flatMap((item) => (item ? [{ id: item.id, expression: item.expression, reading: item.reading, meaning: item.meaning }] : [])),
      grammar: grammar.flatMap((item) => (item ? [{ id: item.id, canonicalName: item.canonicalName, shortMeaning: item.shortMeaning }] : [])),
    },
    preparation: chapter.preparation,
    // Sentences with no usable construction draft yet (one that no longer matches the text does not count).
    needsConstructionIds: sentences.filter((sentence) => !constructionChecked(sentence.japanese, chapter.constructionDrafts?.[sentence.id])).map((sentence) => sentence.id),
    needsWalkthroughIds: sentencesNeedingWalkthrough(sentences, chapter.contextWalkthroughs),
    // Sentences with neither a saved analysis nor an AI draft that still rebuilds the text.
    needsStructureIds: await (async () => {
      const analyses = await db.analyses.bulkGet(sentenceIds);
      return sentences.flatMap((sentence, index) => {
        if (analyses[index]?.chunks?.length) return [];
        const draft = chapter.structureDrafts?.[sentence.id];
        return draft && chunksMatchSource(draft.map((chunk) => chunk.japanese), sentence.japanese) ? [] : [sentence.id];
      });
    })(),
  };
}

async function patchChapterPreparation(
  bookId: string,
  chapterId: string,
  change: (current: EpisodePreparation | undefined) => EpisodePreparation | undefined,
): Promise<void> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found');
  if (!book.chapters.some((chapter) => chapter.id === chapterId)) throw new Error('Chapter not found');
  const updated: Book = {
    ...book,
    chapters: book.chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, preparation: change(chapter.preparation) } : chapter,
    ),
    updatedAt: nowIso(),
  };
  await db.books.put(updated);
  notifySync('books', updated.id, updated);
}

/**
 * Validate a pasted AI reply against the episode and store the result. A
 * failed reply never replaces an earlier usable preparation (it is returned
 * to the caller instead), and never blocks reading. A new usable result keeps
 * the learner's earlier decisions for targets that recur.
 */
export async function saveEpisodePreparationReply(
  bookId: string,
  chapterId: string,
  reply: string,
): Promise<EpisodePreparation> {
  const { context, preparation: existing } = await getEpisodePreparationContext(bookId, chapterId);
  return storePreparationResult(bookId, chapterId, existing, parsePreparationReply(reply, context, nowIso()));
}

async function storePreparationResult(
  bookId: string,
  chapterId: string,
  existing: EpisodePreparation | undefined,
  result: EpisodePreparation,
): Promise<EpisodePreparation> {
  if (result.status === 'failed' && existing && existing.targets.length > 0) return result;
  const keyOf = (target: PreparedTarget) => target.vocabularyItemId ?? target.grammarPatternId ?? `${target.kind}:${target.label}`;
  const previous = new Map((existing?.targets ?? []).map((target) => [keyOf(target), target]));
  const merged: EpisodePreparation = {
    ...result,
    targets: result.targets.map((target) => {
      const before = previous.get(keyOf(target));
      return before ? { ...target, decision: before.decision, learnerNote: before.learnerNote } : target;
    }),
  };
  await patchChapterPreparation(bookId, chapterId, () => merged);
  return merged;
}

export interface EpisodePackSaveResult {
  error?: string;
  preparation?: EpisodePreparation;
  translationsSaved: number;
  rejectedTranslations: PackReplyResult['rejectedTranslations'];
  structureSaved: number;
  rejectedStructure: { handle: string; reason: string }[];
  constructionsSaved: number;
  rejectedConstructions: { handle: string; reason: string }[];
  walkthroughsSaved: number;
  rejectedWalkthroughs: { handle: string; reason: string }[];
}

export interface SentenceExtrasPatch {
  structureDraft?: StructureDraftChunk[];
  constructionDraft?: ConstructionLayer[];
  contextWalkthrough?: ContextWalkthrough;
  grammarChecked?: boolean;
}

/** Merges AI drafts into per-sentence `sentence_extras` rows (one small synced row per sentence, not the book row). */
export async function saveSentenceExtras(
  bookId: string,
  chapterId: string,
  patches: ReadonlyArray<readonly [sentenceId: string, patch: SentenceExtrasPatch]>,
): Promise<void> {
  if (patches.length === 0) return;
  const db = getDb();
  if ((await db.books.where(':id').equals(bookId).count()) === 0) throw new Error('Book not found');
  const timestamp = nowIso();
  const written: SentenceExtras[] = [];
  await db.transaction('rw', db.sentenceExtras, async () => {
    const existing = await db.sentenceExtras.bulkGet(patches.map(([id]) => id));
    patches.forEach(([id, patch], index) => {
      const previous = existing[index];
      written.push({
        ...previous,
        id,
        bookId,
        chapterId,
        ...patch,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    });
    await db.sentenceExtras.bulkPut(written);
  });
  for (const row of written) notifySync('sentence_extras', row.id, row);
}

/** Merges AI chunk drafts into `sentence_extras` (book-wide chunking batch). */
export async function saveStructureDraftsByChapter(
  bookId: string,
  byChapter: ReadonlyMap<string, Record<string, StructureDraftChunk[]>>,
): Promise<void> {
  for (const [chapterId, drafts] of byChapter) {
    await saveSentenceExtras(
      bookId,
      chapterId,
      Object.entries(drafts).map(([id, structureDraft]) => [id, { structureDraft }] as const),
    );
  }
}

/** Merges contextual walkthrough drafts into `sentence_extras` (book-wide import); other sentences are untouched. */
export async function saveContextWalkthroughsByChapter(
  bookId: string,
  byChapter: ReadonlyMap<string, Record<string, ContextWalkthrough>>,
): Promise<void> {
  for (const [chapterId, drafts] of byChapter) {
    await saveSentenceExtras(
      bookId,
      chapterId,
      Object.entries(drafts).map(([id, contextWalkthrough]) => [id, { contextWalkthrough }] as const),
    );
  }
}

/**
 * One pasted "episode pack" reply: focus targets and/or missing translations.
 * Translations only ever fill empty sentences (re-checked here against the
 * live row, not just the prompt-time snapshot). A reply that fails to parse
 * changes nothing.
 */
export async function saveEpisodePackReply(
  bookId: string,
  chapterId: string,
  reply: string,
): Promise<EpisodePackSaveResult> {
  const { context, preparation: existing } = await getEpisodePreparationContext(bookId, chapterId);
  const parsed = parseEpisodePackReply(reply, context, nowIso());
  if (parsed.error) {
    return { error: parsed.error, translationsSaved: 0, rejectedTranslations: parsed.rejectedTranslations, structureSaved: 0, rejectedStructure: [], constructionsSaved: 0, rejectedConstructions: [], walkthroughsSaved: 0, rejectedWalkthroughs: [] };
  }
  const db = getDb();
  let translationsSaved = 0;
  const rejectedTranslations = [...parsed.rejectedTranslations];
  for (const item of parsed.translations) {
    const live = await db.sentences.get(item.sentenceId);
    if (!live || live.translation?.trim()) {
      rejectedTranslations.push({ handle: item.sentenceId, reason: 'Already has a translation; kept yours.' });
      continue;
    }
    await updateSentenceText(item.sentenceId, { translation: item.translation });
    translationsSaved += 1;
  }
  const preparation = parsed.preparation
    ? await storePreparationResult(bookId, chapterId, existing, parsed.preparation)
    : undefined;
  let structureSaved = 0;
  if (parsed.structure && parsed.structure.drafts.size > 0) {
    await saveSentenceExtras(
      bookId,
      chapterId,
      [...parsed.structure.drafts].map(([id, structureDraft]) => [id, { structureDraft }] as const),
    );
    structureSaved = parsed.structure.drafts.size;
  }
  let constructionsSaved = 0;
  if (parsed.constructions && parsed.constructions.drafts.size > 0) {
    await saveSentenceExtras(
      bookId,
      chapterId,
      [...parsed.constructions.drafts].map(([id, constructionDraft]) => [id, { constructionDraft }] as const),
    );
    constructionsSaved = parsed.constructions.drafts.size;
  }
  let walkthroughsSaved = 0;
  if (parsed.walkthroughs && parsed.walkthroughs.drafts.size > 0) {
    await saveSentenceExtras(
      bookId,
      chapterId,
      [...parsed.walkthroughs.drafts].map(([id, contextWalkthrough]) => [id, { contextWalkthrough }] as const),
    );
    walkthroughsSaved = parsed.walkthroughs.drafts.size;
  }
  return {
    preparation,
    translationsSaved,
    rejectedTranslations,
    structureSaved,
    rejectedStructure: parsed.structure?.rejected ?? [],
    constructionsSaved,
    rejectedConstructions: parsed.constructions?.rejected ?? [],
    walkthroughsSaved,
    rejectedWalkthroughs: parsed.walkthroughs?.rejected ?? [],
  };
}

export async function updatePreparedTarget(
  bookId: string,
  chapterId: string,
  targetId: string,
  patch: { decision?: PreparedTargetDecision; learnerNote?: string },
): Promise<void> {
  await patchChapterPreparation(bookId, chapterId, (current) =>
    current
      ? {
          ...current,
          targets: current.targets.map((target) =>
            target.id === targetId
              ? {
                  ...target,
                  ...(patch.decision ? { decision: patch.decision } : {}),
                  ...(patch.learnerNote !== undefined
                    ? { learnerNote: patch.learnerNote.trim() || undefined }
                    : {}),
                }
              : target,
          ),
        }
      : current,
  );
}

export async function clearEpisodePreparation(bookId: string, chapterId: string): Promise<void> {
  await patchChapterPreparation(bookId, chapterId, () => undefined);
}

async function getReadingContextForSentence(sentenceId: string): Promise<ReadingContext> {
  const db = getDb();
  const memberships = await db.bookSentences.where('sentenceId').equals(sentenceId).toArray();
  if (memberships.length === 0) return { before: [], after: [] };
  const bookIds = [...new Set(memberships.map((m) => m.bookId))];
  const books = await db.books.bulkGet(bookIds);
  const bookById = new Map<string, Book>();
  books.forEach((book, index) => {
    if (book) bookById.set(bookIds[index]!, book);
  });
  const home = [...memberships].sort((a, b) => {
    const openedA = bookById.get(a.bookId)?.lastOpenedAt;
    const openedB = bookById.get(b.bookId)?.lastOpenedAt;
    return (openedB ? Date.parse(openedB) : 0) - (openedA ? Date.parse(openedA) : 0);
  })[0]!;
  const orderedRows = await db.bookSentences.where('bookId').equals(home.bookId).sortBy('position');
  const index = orderedRows.findIndex((row) => row.sentenceId === sentenceId);
  if (index === -1) return { before: [], after: [] };
  const beforeRows = orderedRows.slice(Math.max(0, index - 2), index);
  const afterRows = orderedRows.slice(index + 1, index + 2);
  const neighbourIds = [...beforeRows, ...afterRows].map((row) => row.sentenceId);
  const neighbourSentences = neighbourIds.length ? await db.sentences.bulkGet(neighbourIds) : [];
  const sentenceById = new Map<string, Sentence>();
  neighbourSentences.forEach((sentence, i) => {
    if (sentence) sentenceById.set(neighbourIds[i]!, sentence);
  });
  return {
    before: beforeRows
      .map((row) => sentenceById.get(row.sentenceId))
      .filter((s): s is Sentence => Boolean(s)),
    after: afterRows
      .map((row) => sentenceById.get(row.sentenceId))
      .filter((s): s is Sentence => Boolean(s)),
    bookTitle: bookById.get(home.bookId)?.title,
    bookId: home.bookId,
  };
}

/**
 * Most-recently-linked sentence for a grammar pattern — mirrors
 * pickContextSentenceForVocabularyItem's shape exactly, including its lack
 * of any "rest of the sentence must be proficient" gate (2026-09-15, user
 * request: grammar review should be gated the same as vocabulary review,
 * not more strictly — the earlier stricter gate, mirroring
 * getSentenceFullReviewReadiness, made the pattern almost never eligible
 * at all, see docs/ROADMAP.md). Used by ReviewPage to pick which of a
 * tracked pattern's encounters to show for its `grammar_completion` card,
 * along with the encounter's reading-order passage context.
 *
 * Pass `suspendedIndex` (from `loadSuspendedBookIndex`, loaded once by the
 * caller) to skip encounters that live only in suspended books — the pattern
 * itself isn't book-scoped, but drilling it on a sentence from a shelved book
 * is the same "keeps showing a book I suspended" problem (user report
 * 2026-09-20). A pattern whose every encounter is suspended-only yields
 * `undefined`. The persistent defer pass deliberately omits it: a temporary
 * suspension shouldn't push stored due dates out.
 */
export async function pickContextSentenceForGrammarPattern(
  grammarPatternId: string,
  suspendedIndex?: SuspendedBookIndex | null,
): Promise<
  { sentence: Sentence; sentenceGrammar: SentenceGrammar; readingContext: ReadingContext } | undefined
> {
  const db = getDb();
  const links = await db.sentenceGrammar
    .where('grammarPatternId')
    .equals(grammarPatternId)
    .toArray();
  if (links.length === 0) return undefined;
  // An assistant link the learner never acted on is not a sentence to build a card from.
  const sorted = links.filter((link) => !isUnreviewedAiLink(link)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const link of sorted) {
    if (suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)) continue;
    const sentence = await db.sentences.get(link.sentenceId);
    if (!sentence) continue;
    const readingContext = await getReadingContextForSentence(sentence.id);
    return { sentence, sentenceGrammar: link, readingContext };
  }
  return undefined;
}

export interface AutoTrackableGrammarCandidate {
  pattern: GrammarPattern;
  sentence: Sentence;
  sentenceGrammar: SentenceGrammar;
  readingContext: ReadingContext;
}

/**
 * Annotated-but-never-Tracked patterns whose vocabulary has now caught up
 * enough to review — same eligibility bar `GrammarPicker`'s manual "Track"
 * button uses (`getSentenceFullReviewReadiness`), just without requiring the
 * learner to revisit that sentence's Analyze page once the condition is
 * already true (2026-09-28 — a real-data check found 68% of eligible
 * patterns were never Tracked for exactly this "forgot to come back" reason,
 * not because the gate itself was too strict). Every other readiness gate
 * in the app already auto-unlocks without a manual step; this makes
 * grammar consistent with that.
 *
 * Feeds `ReviewPage`'s ordinary lazy-seed pool (`descriptor.candidates`),
 * so a newly-eligible pattern is seeded one at a time under the same
 * `newCardsPerSessionLimit` pacing every other new card gets — deliberately
 * not a bulk one-shot seed, since many patterns can become eligible at once
 * and flooding the queue would be its own regression.
 *
 * One candidate per pattern: its most-recently-linked sentence that is both
 * ready and not suspended-only, mirroring `pickContextSentenceForGrammarPattern`'s
 * own tie-break — callers pass the *same* `trackedPatternIds`/`suspendedIndex`
 * they already computed for that function, so an already-tracked pattern is
 * never double-counted here.
 */
export async function getAutoTrackEligibleGrammarCandidates(
  trackedPatternIds: Set<string>,
  suspendedIndex?: SuspendedBookIndex | null,
): Promise<AutoTrackableGrammarCandidate[]> {
  const db = getDb();
  // Unreviewed assistant links never start tracking on their own (AI suggestions are not promoted silently).
  const untrackedLinks = (await db.sentenceGrammar.toArray()).filter(
    (link) => !trackedPatternIds.has(link.grammarPatternId) && !isUnreviewedAiLink(link),
  );
  if (untrackedLinks.length === 0) return [];

  const linksByPattern = new Map<string, SentenceGrammar[]>();
  for (const link of untrackedLinks) {
    const arr = linksByPattern.get(link.grammarPatternId);
    if (arr) arr.push(link);
    else linksByPattern.set(link.grammarPatternId, [link]);
  }

  const readiness = await getSentenceFullReviewReadiness([
    ...new Set(untrackedLinks.map((link) => link.sentenceId)),
  ]);

  const results: AutoTrackableGrammarCandidate[] = [];
  for (const [patternId, links] of linksByPattern) {
    const sorted = [...links].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const readyLink = sorted.find(
      (link) =>
        readiness.get(link.sentenceId) === true &&
        !(suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)),
    );
    if (!readyLink) continue;
    const [pattern, sentence] = await Promise.all([
      db.grammarPatterns.get(patternId),
      db.sentences.get(readyLink.sentenceId),
    ]);
    if (!pattern || !sentence) continue;
    const readingContext = await getReadingContextForSentence(sentence.id);
    results.push({ pattern, sentence, sentenceGrammar: readyLink, readingContext });
  }
  return results;
}

/** Get-or-create a grammarPattern-subject study item for a given activityType — thin wrapper, mirrors ensureVocabularyStudyItem. */
export async function ensureGrammarStudyItem(
  grammarPatternId: string,
  activityType: StudyActivityType,
): Promise<StudyItem> {
  return ensureStudyItem('grammarPattern', grammarPatternId, activityType);
}

/**
 * Natural-encounter evidence for a grammar pattern (design brief §10),
 * mirroring recordNaturalEncounter exactly — same lazy get-or-create study
 * item, same recordReview call with source/contextSentenceId. Unlike
 * vocabulary (where any self-reported recognition may reasonably start FSRS
 * tracking for that word), this is meant to be called only for patterns the
 * learner has already opted into tracking (see ensureGrammarStudyItem's
 * callers) — that policy lives in the UI layer that calls this function, not
 * here, so the primitive itself stays uniform with recordNaturalEncounter
 * rather than growing a special case.
 */
export async function recordGrammarNaturalEncounter(input: {
  grammarPatternId: string;
  sentenceId: string;
  rating: ReviewRating;
  activityType?: StudyActivityType;
}): Promise<{ review: Review; studyItem: StudyItem }> {
  // Defaults to the entry-level rung (2026-09-22 recognition/production
  // split), mirroring recordNaturalEncounter's own default of
  // reading_retrieval over reading_production.
  const studyItem = await ensureGrammarStudyItem(
    input.grammarPatternId,
    input.activityType ?? 'grammar_recognition',
  );
  return recordReview({
    studyItemId: studyItem.id,
    rating: input.rating,
    source: 'natural_encounter',
    contextSentenceId: input.sentenceId,
  });
}

/** Canonical (unordered) pair ordering, mirroring canonicalConfusionPair. */
function canonicalGrammarPatternPair(
  patternAId: string,
  patternBId: string,
): [string, string] {
  return patternAId < patternBId ? [patternAId, patternBId] : [patternBId, patternAId];
}

/**
 * Get-or-create a typed relationship edge for (patternAId, patternBId,
 * relationshipType). Unlike ensureVocabularyConfusion (one row per
 * unordered pair, full stop), a pair may have more than one relationship
 * row — one per distinct relationshipType — so this keys on the full
 * triple. Never overwrites an existing row's notes; use
 * recordGrammarRelationshipObservation to bump the count on repeated
 * observations.
 */
export async function ensureGrammarRelationship(
  patternAId: string,
  patternBId: string,
  relationshipType: GrammarRelationshipType,
  fields: { notes?: string } = {},
): Promise<GrammarRelationship> {
  const [a, b] = canonicalGrammarPatternPair(patternAId, patternBId);
  const db = getDb();
  const existing = await db.grammarRelationships
    .where('[patternAId+patternBId+relationshipType]')
    .equals([a, b, relationshipType])
    .first();
  if (existing) return existing;

  const timestamp = nowIso();
  const relationship: GrammarRelationship = {
    id: await mintGetOrCreateId('grammar_relationship', a, b, relationshipType),
    patternAId: a,
    patternBId: b,
    relationshipType,
    notes: fields.notes,
    observedCount: 1,
    lastObservedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.grammarRelationships.put(relationship);
  notifySync('grammar_relationships', relationship.id, relationship);
  return relationship;
}

/** Record another observation of an already-known (or new) relationship edge. */
export async function recordGrammarRelationshipObservation(
  patternAId: string,
  patternBId: string,
  relationshipType: GrammarRelationshipType,
): Promise<GrammarRelationship> {
  const [a, b] = canonicalGrammarPatternPair(patternAId, patternBId);
  const db = getDb();
  const existing = await db.grammarRelationships
    .where('[patternAId+patternBId+relationshipType]')
    .equals([a, b, relationshipType])
    .first();
  const timestamp = nowIso();
  const updated: GrammarRelationship = existing
    ? {
        ...existing,
        observedCount: existing.observedCount + 1,
        lastObservedAt: timestamp,
        updatedAt: timestamp,
      }
    : {
        id: await mintGetOrCreateId('grammar_relationship', a, b, relationshipType),
        patternAId: a,
        patternBId: b,
        relationshipType,
        observedCount: 1,
        lastObservedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  await db.grammarRelationships.put(updated);
  notifySync('grammar_relationships', updated.id, updated);
  return updated;
}

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
    import('../data/openJlptGrammar.json'),
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
 * Ranks every not-yet-introduced sentence across all books at once (so
 * unlock value and the stretch cadence are global, not per book). A pure
 * permutation of reading order; callers sort their own lists by `rank`.
 */
async function loadIPlusOneContext(stretchEvery: number): Promise<IPlusOneContext> {
  const memberships = await readAllBookSentencesForPass();
  const sentenceIds = [...new Set(memberships.map((row) => row.sentenceId))];
  const introduced = await getIntroducedSentenceIds(sentenceIds);
  const rows = await getDb().sentences.bulkGet(sentenceIds);
  const introducedRows = rows.filter((row) => row && introduced.has(row.id));
  const known = await loadKnownLemmaSet(introducedRows);
  const reinforce = partlyMetLemmas(
    introducedRows.map((row) => row?.vocabularySuggestions),
    known,
  );
  const grammar = await loadCuratedGrammar(introduced, rows);
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
  rows.forEach((row, index) => {
    if (!row || introduced.has(sentenceIds[index]!)) return;
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
  const order = orderByIPlusOne(items, known, {
    stretchEvery,
    knownGrammar: grammar.known,
    grammarCost: grammar.cost,
    reinforce,
  });
  return { rank: new Map(order.map((id, index) => [id, index])), newWords };
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
  const [context, memberships, suspended] = await Promise.all([
    loadIPlusOneContext(0),
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

/** Explore candidates: books with sentences not yet started, most-recently-opened first ("continue where you left off" reusing Book.lastOpenedAt, the same signal BookDetailPage's touchBookOpened already maintains). */
async function findExploreCandidates(
  limit: number,
  sequential = false,
  iPlusOne?: { stretchEvery: number },
): Promise<ExploreCandidate[]> {
  const db = getDb();
  // i+1 order: ranked once across every book (see orderByIPlusOne); each book keeps its own order by that rank.
  const iPlusOneContext =
    iPlusOne && !sequential
      ? await traceStep('explore: i+1 context', () => loadIPlusOneContext(iPlusOne.stretchEvery))
      : undefined;
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
        item.status !== 'complete' && !walked.has(item.sentenceId) && (!unlocked || unlocked.has(item.sentenceId)) && notShelved(item),
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
        ...requestedIds,
        // The per-book cap only throttles automatic revisits; ones the learner asked for are all kept.
        ...[...new Set([...parkedGlossIds, ...sentencesDueForFreshTry(bookEvents), ...weakWordRevisits.keys()])]
          .filter((id) => !requestedIds.includes(id) && !shelvedIds.has(id))
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
  const limited = candidates
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
    .slice(0, limit)
    .map((entry) => entry.candidate);
  return limited;
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
async function activeSentenceIdsForShadowing(bookLimit: number): Promise<Set<string>> {
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

  const ranked = sentenceIdsWithAudio
    .map((sentenceId) => ({
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
        isIPlusOneOrdering(settings) ? { stretchEvery: iPlusOneStretchEvery(settings) } : undefined,
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

  const exploreCandidates = exploreCandidatesRaw
    .filter((candidate) => !exclude.bookIds.has(candidate.bookId))
    .slice(0, EXPLORE_CANDIDATE_LIMIT);
  const shadowCandidatesTrimmed = shadowCandidatesRaw
    .filter((candidate) => !exclude.sentenceIds.has(candidate.sentenceId))
    .slice(0, SHADOW_CANDIDATE_LIMIT);
  // A phrase step names its suggested phrase (the weakest word's span) when the clip's alignment is cached.
  const shadowCandidates = await Promise.all(
    shadowCandidatesTrimmed.map(async (candidate) => {
      if (!candidate.phrase) return candidate;
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
  return getDb().plannerSessions.where('date').equals(localDateKey(now)).first();
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

  const existing = await db.plannerSessions.where('date').equals(date).first();
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
  const session = await db.plannerSessions.where('date').equals(localDateKey(now)).first();
  if (!session) return;
  await db.plannerSessions.delete(session.id);
  notifySync('planner_sessions', session.id, { id: session.id }, 'delete');
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

export { DEFAULT_SETTINGS, ensureSettings, getDb, readSettings } from './database';
export type { GlossbookDatabase } from './database';
