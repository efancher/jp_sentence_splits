
import { chapterIdsByEpisodeNumber } from '../lib/chapterEpisodeOrder';
import type { BackupPayload } from '../domain/schemas';
import type {
  SourceReference,
  Book,
  BookChapter,
  BookSentence,
  ImportBatch,
  MiningImport,
  PlannerSession,
  PlannerSessionStep,
  Sentence,
  SentenceAudio,
  SentenceExtras,
  SentenceVocabulary,
  StudyItem,
  StudyStatus,
  VocabularySuggestion,
} from '../domain/types';
import {
  mergeSentenceOnReimport,
  type ImportPreview,
} from '../lib/sentenceImport';
import {
  canonicalSourceId,
  createId,
  hashString,
  sentenceIdFromNormalizedKey,
} from '../lib/ids';
import { inlineReadingFromTokens } from '../lib/inlineReadingFromTokens';
import { nowIso, normalizeSentenceKey } from '../lib/normalize';
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
  parseShadowingPackage,
  type ShadowingImportPreview,
} from '../lib/shadowingImport';
import {
} from '../lib/sessionPlannerConfig';
import { buildBackupPayload, type BackupBundle } from '../lib/backup';
import {
  orderBookSentencesFromPaste,
  type PasteOrderResult,
} from '../lib/pasteOrder';
import { ensureSettings, getDb } from './database';
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
export * from './repo/suspendedIndex';
export * from './repo/sentenceLedFlow';
export * from './repo/learningOrchestrator';
export * from './repo/evidenceFoundation';
export * from './repo/progressReports';
export * from './repo/settingsWrites';
import { updateSettings } from './repo/settingsWrites';
export * from './repo/passReads';
export * from './repo/alignmentCaches';
export * from './repo/contextDiversity';
export * from './repo/studyItemExplainability';
export * from './repo/wordReadingStrengths';
export * from './repo/sentenceLearningEvents';
export * from './repo/sequentialUnlocks';
export * from './repo/contextSentences';
export * from './repo/reviewScheduling';
export * from './repo/grammarPatterns';
import {
  getSavedWordStatus,
} from './repo/reviewScheduling';



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
 * Several sentences' suggestion lists in one local transaction, then one sync
 * notification pass. A background fill that saves a sentence per assistant reply
 * would otherwise queue a push cycle per sentence; saving a group lets the sync
 * debounce collapse them into one. Returns how many sentences were written.
 */
export async function updateSentenceVocabularySuggestionsBatch(
  updates: ReadonlyArray<{ sentenceId: string; suggestions: VocabularySuggestion[] }>,
): Promise<number> {
  if (updates.length === 0) return 0;
  const db = getDb();
  const timestamp = nowIso();
  const written: Sentence[] = [];
  await db.transaction('rw', db.sentences, async () => {
    const existing = await db.sentences.bulkGet(updates.map((u) => u.sentenceId));
    updates.forEach((update, index) => {
      const row = existing[index];
      if (row) written.push({ ...row, vocabularySuggestions: update.suggestions, updatedAt: timestamp });
    });
    await db.sentences.bulkPut(written);
  });
  notifySyncMany(written.map((sentence) => ({ entity: 'sentences' as const, recordId: sentence.id, payload: sentence })));
  return written.length;
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
    // Fusing suffix runs changes the array length, so compare by id: any
    // new or flipped entry counts as changed.
    const before = new Map(sentence.vocabularySuggestions.map((s) => [s.id, s.selectedByDefault]));
    const changed = recomputed.filter(
      (suggestion) => before.get(suggestion.id) !== suggestion.selectedByDefault,
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

/**
 * Move one episode (chapter) from a book into another book, e.g. a podcast
 * episode imported into the wrong series. Study progress lives on study_items
 * keyed by sentence, so repointing the memberships carries it across. The
 * chapter lands as a new chapter at the end of the target (title, source id,
 * date and shelved state kept); sentences the target already holds are not
 * duplicated (the target's copy wins and the source membership is dropped).
 * Mining-import tracking and AI extras that name the chapter are repointed.
 */
export async function moveChapterToBook(options: {
  sourceBookId: string;
  chapterId: string;
  targetBookId: string;
}): Promise<{ chapterId: string; movedCount: number; collisionCount: number }> {
  const db = getDb();
  const { sourceBookId, chapterId, targetBookId } = options;
  if (sourceBookId === targetBookId) throw new Error('Source and target book are the same.');
  const timestamp = nowIso();

  let updatedSource: Book | undefined;
  let updatedTarget: Book | undefined;
  let moved: BookSentence[] = [];
  let collisions: BookSentence[] = [];
  let repointedExtras: SentenceExtras[] = [];
  let repointedImports: MiningImport[] = [];
  let newChapterId = '';

  await db.transaction(
    'rw',
    [db.books, db.bookSentences, db.sentenceExtras, db.miningImports],
    async () => {
      const [source, target] = await Promise.all([db.books.get(sourceBookId), db.books.get(targetBookId)]);
      if (!source) throw new Error('Source book not found');
      if (!target) throw new Error('Target book not found');
      const chapter = (source.chapters ?? []).find((item) => item.id === chapterId);
      if (!chapter) throw new Error('Chapter not found in the source book');

      const [sourceMemberships, targetMemberships] = await Promise.all([
        db.bookSentences.where('bookId').equals(sourceBookId).sortBy('position'),
        db.bookSentences.where('bookId').equals(targetBookId).sortBy('position'),
      ]);
      const targetBySentenceId = new Map(targetMemberships.map((item) => [item.sentenceId, item]));
      const inChapter = sourceMemberships.filter((item) => item.chapterId === chapterId);
      const toMove = inChapter.filter((item) => !targetBySentenceId.has(item.sentenceId));
      collisions = inChapter.filter((item) => targetBySentenceId.has(item.sentenceId));
      const maxTargetPosition = targetMemberships.reduce((max, item) => Math.max(max, item.position), -1);

      newChapterId = createId('chapter');
      const targetChapters = target.chapters ?? [];
      const newChapter: BookChapter = { ...chapter, id: newChapterId, position: targetChapters.length };

      moved = toMove.map((item, index) => ({
        ...item,
        bookId: targetBookId,
        chapterId: newChapterId,
        position: maxTargetPosition + 1 + index,
        addedAt: timestamp,
      }));
      if (moved.length) await db.bookSentences.bulkPut(moved);
      if (collisions.length) await db.bookSentences.bulkDelete(collisions.map((item) => item.id));

      const chapterSentenceIds = new Set(inChapter.map((item) => item.sentenceId));
      const sourceExtras = await db.sentenceExtras.where('bookId').equals(sourceBookId).toArray();
      repointedExtras = sourceExtras
        .filter((row) => row.chapterId === chapterId && chapterSentenceIds.has(row.id))
        .map((row) => ({ ...row, bookId: targetBookId, chapterId: newChapterId, updatedAt: timestamp }));
      if (repointedExtras.length) await db.sentenceExtras.bulkPut(repointedExtras);

      const imports = await db.miningImports.toArray();
      repointedImports = imports
        .filter((row) => row.bookId === sourceBookId && row.chapterId === chapterId)
        .map((row) => ({
          ...row,
          bookId: targetBookId,
          chapterId: newChapterId,
          targetBookId: row.targetBookId === sourceBookId ? targetBookId : row.targetBookId,
          updatedAt: timestamp,
        }));
      if (repointedImports.length) await db.miningImports.bulkPut(repointedImports);

      updatedTarget = { ...target, chapters: [...targetChapters, newChapter], updatedAt: timestamp };
      updatedSource = {
        ...source,
        chapters: (source.chapters ?? [])
          .filter((item) => item.id !== chapterId)
          .map((item, position) => ({ ...item, position })),
        collapsedChapterIds: (source.collapsedChapterIds ?? []).filter((id) => id !== chapterId),
        updatedAt: timestamp,
      };
      await db.books.bulkPut([updatedSource, updatedTarget]);
    },
  );

  notifySyncMany([
    ...moved.map((item) => ({ entity: 'book_sentences' as const, recordId: item.id, payload: item })),
    ...collisions.map((item) => ({
      entity: 'book_sentences' as const,
      recordId: item.id,
      payload: { id: item.id },
      operation: 'delete' as const,
    })),
  ]);
  for (const row of repointedExtras) notifySync('sentence_extras', row.id, row);
  for (const row of repointedImports) notifySync('mining_imports', row.id, row);
  if (updatedSource) notifySync('books', sourceBookId, updatedSource);
  if (updatedTarget) notifySync('books', targetBookId, updatedTarget);

  return { chapterId: newChapterId, movedCount: moved.length, collisionCount: collisions.length };
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
  // Only this import's sentences matter: an indexed lookup, not the whole library.
  const sentenceByKey = new Map(
    (
      await db.sentences
        .where('normalizedKey')
        .anyOf([...new Set(preview.audioDrafts.map((audio) => audio.normalizedKey))])
        .toArray()
    ).map((sentence) => [sentence.normalizedKey, sentence]),
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
      // Small worker pool: serial uploads of a long episode took minutes.
      const queue = [...audioRecords];
      const worker = async () => {
        for (let audio = queue.shift(); audio; audio = queue.shift()) {
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
      };
      await Promise.all(Array.from({ length: 3 }, worker));
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


export { DEFAULT_SETTINGS, ensureSettings, getDb, readSettings } from './database';
export type { GlossbookDatabase } from './database';
