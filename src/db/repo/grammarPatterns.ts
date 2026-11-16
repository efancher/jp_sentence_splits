// ---------------------------------------------------------------------------
// Grammar patterns (grammar-learning system foundation, docs/AI_OVERVIEW.md).
// GrammarPattern/SentenceGrammar/GrammarRelationship mirror the
// VocabularyItem/SentenceVocabulary/VocabularyConfusion shapes above — see
// the doc comments on those types (src/domain/types.ts) for how and why they
// diverge. No UI writes to these yet (Phase 2 of the grammar-learning plan);
// this section is schema-adjacent foundation only.
// ---------------------------------------------------------------------------

import type {
  Book,
  ClauseQuestionFeedback,
  ConstructionLayer,
  ContextWalkthrough,
  EpisodePreparation,
  GrammarPattern,
  GrammarRelationship,
  GrammarRelationshipType,
  PreparedTarget,
  PreparedTargetDecision,
  Review,
  ReviewRating,
  GlossDecision,
  Sentence,
  SentenceAudio,
  SentenceExtras,
  SentenceGrammar,
  SentenceLearningEvent,
  SentenceVocabulary,
  StudyActivityType,
  StudyItem,
  StructureDraftChunk,
  VocabularyItem,
} from '../../domain/types';
import { CHAIN_COLD_KEY, chainRungTargetKey } from '../../lib/chunkChainSession';
import { chunksMatchSource } from '../../lib/chunking';
import { openContentReports, type OpenContentReport } from '../../lib/contentReports';
import { sentencesNeedingWalkthrough } from '../../lib/contextWalkthrough';
import { buildEpisodeFocus, type EpisodeFocus } from '../../lib/episodeFocus';
import { buildEpisodeProgress, type EpisodeProgressRow } from '../../lib/episodeProgress';
import { parseEpisodePackReply, type PackReplyResult } from '../../lib/episodePack';
import { type PreparationContext, parsePreparationReply } from '../../lib/episodePreparation';
import {
  isPatternListed,
  isUnreviewedAiLink,
  visibleGrammarLinks,
} from '../../lib/grammarLinkVisibility';
import {
  computeGrammarLearnerState,
  computeGrammarPriorityBucket,
  explainGrammarPriority,
  type GrammarLearnerState,
  type GrammarPriorityBucket,
  normalizeGrammarPatternKey,
} from '../../lib/grammarPatterns';
import { createId } from '../../lib/ids';
import { isolatedWordSpans } from '../../lib/isolatedWordRange';
import { nowIso } from '../../lib/normalize';
import { constructionChecked } from '../../lib/phraseConstruction';
import {
  dropLeadingParticles,
  type PhraseShadowOutcome,
  expandToPhrase,
  isPhraseRange,
  orderLinksByWeakness,
  orderSuggestedSurfaces,
  phraseShadowTargetKey,
  phraseTextFromAlignment,
  snapRangeToWordBoundaries,
  weakestChunkRange,
  wordIdsInPhrase,
} from '../../lib/phraseShadow';
import type { ReadingContext } from '../../lib/readingContext';
import type { ReviewDocument } from '../../lib/reviewDocument';
import { computeGraduatedSubjectIds, isVocabularyItemProficient } from '../../lib/scheduling';
import { buildSentenceLessonReport, type SentenceLessonReport } from '../../lib/sentenceLessonReport';
import { sentenceIsSuspendedOnly, type SuspendedBookIndex } from '../../lib/suspendedBooks';
import { ensureSettings, getDb, readSettings } from '../database';
import { withChapterExtras } from '../sentenceExtras';
import { notifySync, notifySyncMany } from '../syncNotify';
import { getReferenceAlignment } from './alignmentCaches';
import { getReadingContextForSentence } from './contextSentences';
import { readRowsByKeys } from './passReads';
import {
  ensureStudyItem,
  getIntroducedSentenceIds,
  getSentenceFullReviewReadiness,
  recordReview,
} from './reviewScheduling';
import { updateSentenceText } from './sentenceWrites';
import { ensureVocabularyItem, mintGetOrCreateId } from './vocabularyKanji';
import { loadWordReadingStrengths, READER_STRENGTH_CACHE_MS } from './wordReadingStrengths';


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
