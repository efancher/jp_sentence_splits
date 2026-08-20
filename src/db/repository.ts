import { ANALYSIS_FORMAT_VERSION } from '../appConfig';
import type { BackupPayload } from '../domain/schemas';
import type {
  AlignmentResult,
  AnalysisChunk,
  AppSettings,
  Attempt,
  AttemptAlignment,
  AttemptAnalysisSummary,
  AttemptRating,
  AttemptTranscription,
  Book,
  BookChapter,
  BookSentence,
  CardIssueReport,
  CardIssueStatus,
  ErrorClassification,
  GrammarPattern,
  GrammarRelationship,
  GrammarRelationshipType,
  ImportBatch,
  InboxMembership,
  InitialOrderMode,
  Kanji,
  ReferenceAlignment,
  Review,
  ReviewAssistance,
  ReviewRating,
  ReviewSource,
  Sentence,
  SentenceAudio,
  SentenceAnalysis,
  SentenceGrammar,
  SentenceVocabulary,
  StudyActivityType,
  StudyItem,
  StudyStatus,
  StudySubjectType,
  VocabularyConfusion,
  VocabularyConfusionType,
  VocabularyItem,
  VocabularyKanji,
  VocabularyReviewStatus,
  VocabularySelection,
} from '../domain/types';
import { ALIGNMENT_VERSION, TRANSCRIPTION_VERSION } from '../lib/analysisApi';
import { ANALYSIS_SUMMARY_VERSION } from '../lib/pronunciationHistory';
import {
  mergeSentenceOnReimport,
  parseSatoriCsvText,
  type ImportPreview,
} from '../lib/csvImport';
import {
  computeGrammarLearnerState,
  computeGrammarPriorityBucket,
  explainGrammarPriority,
  normalizeGrammarPatternKey,
  type GrammarLearnerState,
  type GrammarPriorityBucket,
} from '../lib/grammarPatterns';
import { createId, hashString, sentenceIdFromNormalizedKey } from '../lib/ids';
import { isHanCharacter } from '../lib/kanji';
import {
  computeContextDiversity,
  computeMaturityLevel,
  MATURE_MIN_SCHEDULED_DAYS,
  type ContextDiversity,
  type MaturityLevel,
} from '../lib/maturity';
import { nowIso } from '../lib/normalize';
import {
  classifyReviewError,
  createInitialFsrsState,
  isGraduated,
  isSentenceReadyForFullReview,
  isVocabularyItemProficient,
  scheduleReview,
} from '../lib/scheduling';
import {
  parseShadowingPackage,
  type ShadowingImportPreview,
} from '../lib/shadowingImport';
import { buildBackupPayload, type BackupBundle } from '../lib/backup';
import {
  orderBookSentencesFromPaste,
  type PasteOrderResult,
} from '../lib/pasteOrder';
import {
  buildMiningPackage,
  type MiningExportResult,
} from '../lib/miningExport';
import {
  curatedVocabForSourceKey,
  selectionsFromCuratedPicks,
} from '../lib/curatedVocabulary';
import { ensureSettings, getDb } from './database';
import { notifySync, notifySyncMany } from './syncNotify';

function sortSentences(
  sentences: Sentence[],
  mode: InitialOrderMode,
): Sentence[] {
  const copy = [...sentences];
  switch (mode) {
    case 'earliest_created':
      return copy.sort((a, b) =>
        (a.earliestCreatedAt ?? '').localeCompare(b.earliestCreatedAt ?? ''),
      );
    case 'latest_created':
      return copy.sort((a, b) =>
        (b.latestCreatedAt ?? '').localeCompare(a.latestCreatedAt ?? ''),
      );
    case 'japanese':
      return copy.sort((a, b) => a.japanese.localeCompare(b.japanese, 'ja'));
    case 'english':
      return copy.sort((a, b) =>
        a.translation.localeCompare(b.translation, 'en'),
      );
    case 'manual':
    case 'first_occurrence':
    default:
      return copy.sort(
        (a, b) => a.firstOccurrenceIndex - b.firstOccurrenceIndex,
      );
  }
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
      'title' | 'sourceKey' | 'subtitle' | 'sourceUrl' | 'notes' | 'archived'
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

export async function updateSentenceTranslation(
  sentenceId: string,
  translation: string,
): Promise<Sentence> {
  const db = getDb();
  const existing = await db.sentences.get(sentenceId);
  if (!existing) throw new Error('Sentence not found');
  const updated: Sentence = {
    ...existing,
    translation,
    updatedAt: nowIso(),
  };
  await db.sentences.put(updated);
  notifySync('sentences', updated.id, updated);
  return updated;
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
  orderMode: InitialOrderMode = 'first_occurrence',
): Promise<void> {
  const db = getDb();
  const existing = await db.bookSentences.where('bookId').equals(bookId).toArray();
  const existingIds = new Set(existing.map((item) => item.sentenceId));
  const toAddIds = sentenceIds.filter((id) => !existingIds.has(id));
  if (!toAddIds.length) return;

  const sentences = await db.sentences.bulkGet(toAddIds);
  const ordered = sortSentences(
    sentences.filter((item): item is Sentence => Boolean(item)),
    orderMode,
  );
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

export async function reorderBookSentences(
  bookId: string,
  orderedSentenceIds: string[],
): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.bookSentences, db.books, async () => {
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .toArray();
    const bySentence = new Map(
      memberships.map((item) => [item.sentenceId, item]),
    );
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const sentenceId of orderedSentenceIds) {
      if (!bySentence.has(sentenceId) || seen.has(sentenceId)) continue;
      seen.add(sentenceId);
      ordered.push(sentenceId);
    }
    // Keep any memberships missing from the payload at the end (prior relative order).
    const leftovers = memberships
      .filter((item) => !seen.has(item.sentenceId))
      .sort((a, b) => a.position - b.position)
      .map((item) => item.sentenceId);
    const fullOrder = [...ordered, ...leftovers];
    const updates = fullOrder.map((sentenceId, index) => ({
      ...bySentence.get(sentenceId)!,
      position: index,
    }));
    await db.bookSentences.bulkPut(updates);
    const book = await db.books.get(bookId);
    if (book) {
      await db.books.put({ ...book, updatedAt: nowIso() });
    }
  });
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
}

export async function saveAnalysis(
  sentenceId: string,
  chunks: AnalysisChunk[],
  notes = '',
  vocabulary?: {
    reviewStatus?: VocabularyReviewStatus;
    selections?: VocabularySelection[];
  },
): Promise<SentenceAnalysis> {
  const db = getDb();
  const timestamp = nowIso();
  const existing = await db.analyses.get(sentenceId);
  const populated = chunks.some(
    (chunk) => chunk.role.trim() || chunk.literalEnglish.trim(),
  );
  const status =
    chunks.length === 0
      ? 'empty'
      : populated
        ? chunks.every((chunk) => chunk.role.trim() && chunk.literalEnglish.trim())
          ? 'complete'
          : 'in_progress'
        : 'in_progress';
  const analysis: SentenceAnalysis = {
    sentenceId,
    chunks: chunks.map((chunk, index) => ({ ...chunk, order: index })),
    notes,
    status,
    formatVersion: ANALYSIS_FORMAT_VERSION,
    vocabularyReviewStatus:
      vocabulary?.reviewStatus ??
      existing?.vocabularyReviewStatus ??
      'unreviewed',
    vocabularySelections:
      vocabulary?.selections ?? existing?.vocabularySelections ?? [],
    grammarSuggestions: existing?.grammarSuggestions ?? [],
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await db.analyses.put(analysis);
  notifySync('analyses', analysis.sentenceId, analysis);
  return analysis;
}

export async function commitImport(options: {
  preview: ImportPreview;
  selectedIds: string[];
  destination: 'inbox' | 'new_book' | 'existing_book';
  bookId?: string;
  newBookTitle?: string;
  orderMode?: InitialOrderMode;
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

  await db.transaction(
    'rw',
    db.sentences,
    db.importBatches,
    db.inbox,
    db.books,
    db.bookSentences,
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

      if (options.destination === 'inbox') {
        await db.inbox.bulkPut(
          sentenceIds.map((sentenceId) => ({
            sentenceId,
            importBatchId: batchId,
            addedAt: timestamp,
          })),
        );
      }
    },
  );

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
      options.orderMode ?? 'first_occurrence',
    );
  } else if (options.destination === 'existing_book' && bookId) {
    await addSentencesToBook(
      bookId,
      sentenceIds,
      options.orderMode ?? 'first_occurrence',
    );
  }

  let chapterId = options.chapterId;
  const newChapterTitle = options.newChapterTitle?.trim();
  if (bookId && newChapterTitle) {
    const chapter = await createBookChapter(bookId, newChapterTitle);
    chapterId = chapter.id;
  }
  if (bookId && chapterId) {
    await assignBookSentencesToChapter(bookId, sentenceIds, chapterId);
  }

  // Enqueue imported sentences + batch for sync (memberships handled by addSentencesToBook).
  const storedSentences = await getDb().sentences.bulkGet(sentenceIds);
  notifySyncMany(
    storedSentences
      .filter((s): s is Sentence => Boolean(s))
      .map((sentence) => ({
        entity: 'sentences' as const,
        recordId: sentence.id,
        payload: sentence,
      })),
  );
  const batch = await getDb().importBatches.get(batchId);
  if (batch) notifySync('import_batches', batch.id, batch);
  if (options.destination === 'inbox') {
    const inboxRows = await getDb().inbox.bulkGet(sentenceIds);
    notifySyncMany(
      inboxRows
        .filter((row): row is InboxMembership => Boolean(row))
        .map((row) => ({
          entity: 'inbox' as const,
          recordId: row.sentenceId,
          payload: row,
        })),
    );
  }

  return { batchId, bookId, chapterId };
}

export async function previewCsvFile(
  file: File,
  batchName?: string,
): Promise<ImportPreview> {
  const db = getDb();
  const text = await file.text();
  const existing = await db.sentences.toArray();
  return parseSatoriCsvText(text, file.name, {
    existing,
    batchName,
  });
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
): Promise<{ batchId: string; bookId: string; refreshed: boolean }> {
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
    orderMode: 'first_occurrence',
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
      const meta = await ensureSyncMeta();
      if (!meta.syncReferenceAudio) return;
      const supabase = getSupabase();
      const userId = (await supabase?.auth.getSession())?.data.session?.user
        ?.id;
      if (!userId || !result.bookId) return;
      for (const audio of audioRecords) {
        await uploadReferenceAudio({
          audio,
          bookId: result.bookId,
          ownerId: userId,
        });
      }
    } catch {
      // Local import must succeed even if optional audio upload fails.
    }
  })();

  return {
    batchId: result.batchId,
    bookId: result.bookId,
    refreshed: Boolean(existingBook),
  };
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
    books: await db.books.toArray(),
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
        db.sentenceAudio.clear(),
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
      await db.settings.put(payload.settings);
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

export async function searchAll(query: string): Promise<{
  books: Book[];
  sentences: Sentence[];
}> {
  const db = getDb();
  const q = query.trim().toLowerCase();
  if (!q) return { books: [], sentences: [] };
  const books = (await db.books.toArray()).filter(
    (book) =>
      book.title.toLowerCase().includes(q) ||
      (book.subtitle ?? '').toLowerCase().includes(q),
  );
  const sentences = (await db.sentences.toArray()).filter((sentence) => {
    if (sentence.japanese.includes(query) || sentence.translation.toLowerCase().includes(q)) {
      return true;
    }
    return sentence.targetVocabulary.some(
      (vocab) =>
        vocab.expression.includes(query) ||
        vocab.reading.includes(query) ||
        vocab.english.toLowerCase().includes(q),
    );
  });
  return { books, sentences };
}

export async function getBookProgress(bookId: string): Promise<{
  total: number;
  complete: number;
  percent: number;
}> {
  const db = getDb();
  const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
  const total = memberships.length;
  const complete = memberships.filter((item) => item.status === 'complete').length;
  return {
    total,
    complete,
    percent: total ? Math.round((complete / total) * 100) : 0,
  };
}

export async function exportBookMiningPackage(
  bookId: string,
): Promise<MiningExportResult> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found.');
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const sentenceIds = memberships.map((item) => item.sentenceId);
  const sentences = (await db.sentences.bulkGet(sentenceIds)).filter(
    (item): item is Sentence => Boolean(item),
  );
  const analyses = (await db.analyses.bulkGet(sentenceIds)).filter(
    (item): item is SentenceAnalysis => Boolean(item),
  );
  const audio = (
    await Promise.all(
      sentenceIds.map((sentenceId) =>
        db.sentenceAudio.where('sentenceId').equals(sentenceId).toArray(),
      ),
    )
  ).flat();
  return buildMiningPackage({ book, sentences, analyses, audio });
}

/**
 * Apply offline curated vocabulary picks for a known immersion book.
 * Overwrites unreviewed analyses; skips sentences already confirmed unless
 * `overwriteConfirmed` is true.
 */
export async function applyCuratedVocabularyForBook(
  bookId: string,
  options: { overwriteConfirmed?: boolean } = {},
): Promise<{
  updated: number;
  confirmed: number;
  skippedConfirmed: number;
  missingPicks: number;
  unresolvedPicks: number;
}> {
  const db = getDb();
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Book not found.');
  const curated = curatedVocabForSourceKey(book.sourceKey);
  if (!curated) {
    throw new Error('No curated vocabulary pack is available for this book.');
  }

  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  let updated = 0;
  let confirmed = 0;
  let skippedConfirmed = 0;
  let missingPicks = 0;
  let unresolvedPicks = 0;

  for (const membership of memberships) {
    const sentence = await db.sentences.get(membership.sentenceId);
    if (!sentence) continue;
    const existing = await db.analyses.get(sentence.id);
    if (
      existing?.vocabularyReviewStatus === 'confirmed' &&
      !options.overwriteConfirmed
    ) {
      skippedConfirmed += 1;
      continue;
    }

    const picks = curated.picksByJapanese[sentence.japanese];
    if (!picks) {
      missingPicks += 1;
      continue;
    }

    const selections = selectionsFromCuratedPicks(
      sentence.japanese,
      picks,
      sentence.vocabularySuggestions ?? [],
    );
    unresolvedPicks += Math.max(0, picks.length - selections.length);

    await saveAnalysis(sentence.id, existing?.chunks ?? [], existing?.notes ?? '', {
      reviewStatus: selections.length ? 'confirmed' : 'unreviewed',
      selections,
    });
    updated += 1;
    if (selections.length) confirmed += 1;
  }

  return {
    updated,
    confirmed,
    skippedConfirmed,
    missingPicks,
    unresolvedPicks,
  };
}

export async function findResumeSentence(
  bookId: string,
): Promise<string | null> {
  const db = getDb();
  const memberships = await db.bookSentences
    .where('bookId')
    .equals(bookId)
    .sortBy('position');
  const target =
    memberships.find(
      (item) => item.status === 'needs_review' || item.status === 'in_progress',
    ) ?? memberships.find((item) => item.status === 'unstarted');
  return target?.sentenceId ?? memberships[0]?.sentenceId ?? null;
}

// ---------------------------------------------------------------------------
// Shadowing attempts (docs/UNIFIED_APP_ARCHITECTURE.md §12, Phase 3) —
// local-only, no sync wiring by design (§18). Do not call
// notifySync/notifySyncMany here.
// ---------------------------------------------------------------------------

export async function saveAttempt(input: {
  sentenceId: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  notes?: string;
}): Promise<Attempt> {
  const db = getDb();
  const attempt: Attempt = {
    id: createId('attempt'),
    sentenceId: input.sentenceId,
    mimeType: input.mimeType,
    durationMs: input.durationMs,
    blob: input.blob,
    notes: input.notes,
    createdAt: nowIso(),
  };
  await db.attempts.add(attempt);
  return attempt;
}

export async function listAttemptsForSentence(
  sentenceId: string,
): Promise<Attempt[]> {
  const db = getDb();
  const attempts = await db.attempts.where('sentenceId').equals(sentenceId).toArray();
  return attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteAttempt(attemptId: string): Promise<void> {
  const db = getDb();
  await db.attempts.delete(attemptId);
}

export async function rateAttempt(
  attemptId: string,
  rating: AttemptRating,
): Promise<Attempt> {
  const db = getDb();
  await db.attempts.update(attemptId, { manualRating: rating });
  const attempt = await db.attempts.get(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  return attempt;
}

export async function setAttemptFavorite(
  attemptId: string,
  isFavorite: boolean,
): Promise<Attempt> {
  const db = getDb();
  await db.attempts.update(attemptId, { isFavorite });
  const attempt = await db.attempts.get(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  return attempt;
}

// ---------------------------------------------------------------------------
// Cached forced-alignment results (docs/STATUS.md Phase 9, Milestone 2b).
// A stale `alignmentVersion` is treated the same as a cache miss, so callers
// always get either a fresh cached result or nothing — never a stale one.

export async function getReferenceAlignment(
  sentenceAudioId: string,
): Promise<AlignmentResult | undefined> {
  const db = getDb();
  const row = await db.referenceAlignments.get(sentenceAudioId);
  if (!row || row.alignmentVersion !== ALIGNMENT_VERSION) return undefined;
  return row.result;
}

export async function saveReferenceAlignment(
  sentenceAudioId: string,
  result: AlignmentResult,
): Promise<void> {
  const db = getDb();
  const row: ReferenceAlignment = {
    id: sentenceAudioId,
    alignmentVersion: ALIGNMENT_VERSION,
    result,
    computedAt: nowIso(),
  };
  await db.referenceAlignments.put(row);
}

export async function getAttemptAlignment(
  attemptId: string,
): Promise<AlignmentResult | undefined> {
  const db = getDb();
  const row = await db.attemptAlignments.get(attemptId);
  if (!row || row.alignmentVersion !== ALIGNMENT_VERSION) return undefined;
  return row.result;
}

export async function saveAttemptAlignment(
  attemptId: string,
  result: AlignmentResult,
): Promise<void> {
  const db = getDb();
  const row: AttemptAlignment = {
    id: attemptId,
    alignmentVersion: ALIGNMENT_VERSION,
    result,
    computedAt: nowIso(),
  };
  await db.attemptAlignments.put(row);
}

export async function getAttemptTranscription(attemptId: string): Promise<string | undefined> {
  const db = getDb();
  const row = await db.attemptTranscriptions.get(attemptId);
  if (!row || row.transcriptionVersion !== TRANSCRIPTION_VERSION) return undefined;
  return row.text;
}

export async function saveAttemptTranscription(attemptId: string, text: string): Promise<void> {
  const db = getDb();
  const row: AttemptTranscription = {
    id: attemptId,
    transcriptionVersion: TRANSCRIPTION_VERSION,
    text,
    computedAt: nowIso(),
  };
  await db.attemptTranscriptions.put(row);
}

export async function saveAttemptAnalysisSummary(
  summary: Omit<AttemptAnalysisSummary, 'analysisSummaryVersion'>,
): Promise<void> {
  const db = getDb();
  const row: AttemptAnalysisSummary = { ...summary, analysisSummaryVersion: ANALYSIS_SUMMARY_VERSION };
  await db.attemptAnalysisSummaries.put(row);
}

export async function listAttemptAnalysisSummariesForSentence(
  sentenceId: string,
): Promise<AttemptAnalysisSummary[]> {
  const db = getDb();
  const rows = await db.attemptAnalysisSummaries.where('sentenceId').equals(sentenceId).toArray();
  return rows.filter((row) => row.analysisSummaryVersion === ANALYSIS_SUMMARY_VERSION);
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
  } = {},
): Promise<StudyItem[]> {
  const db = getDb();
  const nowIsoValue = (options.now ?? new Date()).toISOString();
  const subjectIdSet = options.subjectIds ? new Set(options.subjectIds) : null;
  const candidates = await db.studyItems
    .where('activityType')
    .anyOf(activityTypes)
    .toArray();
  const due = candidates
    .filter((item) => item.fsrsState.due <= nowIsoValue)
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
  const links = await db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray();
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
  const vocabularyStudyItems = allVocabularyItemIds.length
    ? (await db.studyItems.where('subjectType').equals('vocabularyItem').toArray()).filter(
        (item) => allVocabularyItemIds.includes(item.subjectId),
      )
    : [];
  const proficientVocabularyItemIds = new Set(
    vocabularyStudyItems
      .filter((item) => isVocabularyItemProficient(item.fsrsState.state))
      .map((item) => item.subjectId),
  );
  const analysesBySentenceId = new Map(
    (await db.analyses.bulkGet(sentenceIds))
      .filter((item): item is SentenceAnalysis => Boolean(item))
      .map((item) => [item.sentenceId, item]),
  );
  for (const sentenceId of sentenceIds) {
    const vocabularyItemIds = vocabularyItemIdsBySentence.get(sentenceId) ?? [];
    const vocabularyReviewStatus = analysesBySentenceId.get(sentenceId)?.vocabularyReviewStatus;
    readiness.set(
      sentenceId,
      isSentenceReadyForFullReview(vocabularyReviewStatus, vocabularyItemIds, proficientVocabularyItemIds),
    );
  }
  return readiness;
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
}): Promise<{ review: Review; studyItem: StudyItem }> {
  const db = getDb();
  const studyItem = await db.studyItems.get(input.studyItemId);
  if (!studyItem) throw new Error('Study item not found');
  const now = input.now ?? new Date();
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
      }),
    assistance: input.assistance,
    source: input.source,
    contextSentenceId: input.contextSentenceId,
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
  return { review, studyItem: updatedStudyItem };
}

// ---------------------------------------------------------------------------
// Vocabulary/kanji relationships (docs/UNIFIED_APP_ARCHITECTURE.md §8, Phase 5).
// VocabularyItem/Kanji are get-or-create, deduped on (expression, reading) and
// character respectively, and never overwritten once created — mirrors
// ensureStudyItem above. SentenceVocabulary links are wholesale-replaced per
// sentence on every confirm, since VocabularySelection[] is itself an
// authoritative snapshot (of the sentence's current picks), not an
// incremental diff.
// ---------------------------------------------------------------------------

export async function ensureKanji(character: string): Promise<Kanji> {
  const db = getDb();
  const existing = await db.kanji.where('character').equals(character).first();
  if (existing) return existing;
  const timestamp = nowIso();
  const kanji: Kanji = {
    id: createId('kanji'),
    character,
    meanings: [],
    onyomi: [],
    kunyomi: [],
    nanori: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.kanji.put(kanji);
  notifySync('kanji', kanji.id, kanji);
  return kanji;
}

export async function ensureVocabularyItem(
  expression: string,
  reading: string,
  fields: {
    meaning?: string;
    partOfSpeech?: string;
    notes?: string;
    externalId?: string;
  } = {},
): Promise<VocabularyItem> {
  const db = getDb();
  const existing = await db.vocabularyItems
    .where('[expression+reading]')
    .equals([expression, reading])
    .first();
  if (existing) return existing;

  const timestamp = nowIso();
  const item: VocabularyItem = {
    id: createId('vocab_item'),
    expression,
    reading,
    meaning: fields.meaning ?? '',
    partOfSpeech: fields.partOfSpeech,
    notes: fields.notes,
    externalId: fields.externalId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Kanji rows are get-or-create (shared across every vocabulary item), so
  // resolve them one at a time, in word order, before the item/links commit —
  // matches every occurrence's true position, including repeated kanji
  // (e.g. 主 twice in 民主主義).
  const characters = Array.from(expression);
  const kanjiLinks: VocabularyKanji[] = [];
  for (let position = 0; position < characters.length; position += 1) {
    const character = characters[position];
    if (!isHanCharacter(character)) continue;
    const kanji = await ensureKanji(character);
    kanjiLinks.push({
      id: createId('vocab_kanji'),
      vocabularyItemId: item.id,
      kanjiId: kanji.id,
      positionInWord: position,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await db.transaction(
    'rw',
    db.vocabularyItems,
    db.vocabularyKanji,
    async () => {
      await db.vocabularyItems.put(item);
      for (const link of kanjiLinks) {
        await db.vocabularyKanji.put(link);
      }
    },
  );

  notifySyncMany([
    { entity: 'vocabulary_items', recordId: item.id, payload: item },
    ...kanjiLinks.map((link) => ({
      entity: 'vocabulary_kanji' as const,
      recordId: link.id,
      payload: link,
    })),
  ]);

  return item;
}

export async function updateVocabularyItem(
  itemId: string,
  patch: Partial<Pick<VocabularyItem, 'meaning' | 'partOfSpeech' | 'notes'>>,
): Promise<VocabularyItem> {
  const db = getDb();
  const existing = await db.vocabularyItems.get(itemId);
  if (!existing) throw new Error('Vocabulary item not found');
  const updated: VocabularyItem = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
  };
  await db.vocabularyItems.put(updated);
  notifySync('vocabulary_items', updated.id, updated);
  return updated;
}

/**
 * Materialize a sentence's confirmed VocabularyPicker selections into real
 * VocabularyItem/SentenceVocabulary rows. Called once, from the confirm
 * action — not on every autosave tick. Wholesale-replaces this sentence's
 * links (add newly-selected, remove deselected); never deletes the
 * VocabularyItem/Kanji rows themselves, since other sentences may reference
 * them.
 */
export async function materializeVocabularySelections(
  sentenceId: string,
  selections: VocabularySelection[],
): Promise<void> {
  const db = getDb();
  const itemIds = new Set<string>();
  // First selection's surface wins per item id — matters when duplicate
  // selections (same expression/reading, different spans) collapse onto one
  // vocabulary item (see the "collapses duplicate selections" test).
  const surfaceByItemId = new Map<string, string>();
  for (const selection of selections) {
    const expression = selection.expression.trim();
    if (!expression) continue;
    const item = await ensureVocabularyItem(expression, selection.reading.trim(), {
      meaning: selection.english,
      partOfSpeech: selection.pos,
    });
    itemIds.add(item.id);
    if (!surfaceByItemId.has(item.id)) {
      surfaceByItemId.set(item.id, selection.surface);
    }
  }

  const existingLinks = await db.sentenceVocabulary
    .where('sentenceId')
    .equals(sentenceId)
    .toArray();
  const existingItemIds = new Set(
    existingLinks.map((link) => link.vocabularyItemId),
  );

  const toDelete = existingLinks.filter(
    (link) => !itemIds.has(link.vocabularyItemId),
  );
  const timestamp = nowIso();
  const toCreate: SentenceVocabulary[] = [...itemIds]
    .filter((itemId) => !existingItemIds.has(itemId))
    .map((itemId) => ({
      id: createId('sentence_vocab'),
      sentenceId,
      vocabularyItemId: itemId,
      surfaceForm: surfaceByItemId.get(itemId),
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

  await db.transaction('rw', db.sentenceVocabulary, async () => {
    for (const link of toDelete) {
      await db.sentenceVocabulary.delete(link.id);
    }
    for (const link of toCreate) {
      await db.sentenceVocabulary.put(link);
    }
  });

  notifySyncMany([
    ...toDelete.map((link) => ({
      entity: 'sentence_vocabulary' as const,
      recordId: link.id,
      payload: link,
      operation: 'delete' as const,
    })),
    ...toCreate.map((link) => ({
      entity: 'sentence_vocabulary' as const,
      recordId: link.id,
      payload: link,
    })),
  ]);
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
}

/**
 * Vocabulary items, restricted to `sentenceIds`, that have a
 * `surfaceForm`-bearing link and are therefore eligible targets for any
 * review experience that highlights or blanks a specific occurrence of a
 * word in its sentence — reading retrieval (Phase 7.2) and cloze (Phase
 * 7.3) both consume this, since they share the same eligibility condition
 * and only differ in how the target is rendered. One candidate per
 * distinct vocabulary item (first qualifying link found), not one per
 * sentence×word pair, so seeding stays bounded by vocabulary size, not
 * sentence count.
 */
export async function getVocabularyTargetCandidates(
  sentenceIds: string[],
): Promise<VocabularyTargetCandidate[]> {
  if (sentenceIds.length === 0) return [];
  const db = getDb();
  const links = await db.sentenceVocabulary
    .where('sentenceId')
    .anyOf(sentenceIds)
    .toArray();
  const bestLinkByItemId = new Map<string, SentenceVocabulary>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    if (!bestLinkByItemId.has(link.vocabularyItemId)) {
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
    candidates.push({ vocabularyItem, sentence, surfaceForm: link.surfaceForm });
  });
  return candidates;
}

/**
 * Fetches the data `computeContextDiversity` (src/lib/maturity.ts) needs for
 * a set of sentence ids and calls it — the Dexie-querying half of maturity
 * computation, kept separate from the pure ladder logic itself (Phase 7.1).
 * A sentence's "source" is the sourceKey (or id, as a stand-in) of any Book
 * containing it via `book_sentences`, since Sentence has no direct link to
 * the `sources` table yet. Shared by computeVocabularyContextDiversity and
 * computeGrammarPatternContextDiversity — same diversity question, different
 * link table feeding it the sentence ids.
 */
async function contextDiversityFromSentenceIds(
  sentenceIds: string[],
): Promise<ContextDiversity> {
  if (sentenceIds.length === 0) return computeContextDiversity(new Map());
  const db = getDb();

  const memberships = await db.bookSentences
    .where('sentenceId')
    .anyOf(sentenceIds)
    .toArray();
  const bookIds = [...new Set(memberships.map((item) => item.bookId))];
  const books = await db.books.bulkGet(bookIds);
  const sourceKeyByBookId = new Map<string, string>();
  books.forEach((book, index) => {
    if (book) sourceKeyByBookId.set(bookIds[index]!, book.sourceKey ?? book.id);
  });

  const sourceKeysBySentenceId = new Map<string, string[]>();
  for (const sentenceId of sentenceIds) {
    const keys = memberships
      .filter((item) => item.sentenceId === sentenceId)
      .map((item) => sourceKeyByBookId.get(item.bookId))
      .filter((key): key is string => Boolean(key));
    sourceKeysBySentenceId.set(sentenceId, keys);
  }
  return computeContextDiversity(sourceKeysBySentenceId);
}

export async function computeVocabularyContextDiversity(
  vocabularyItemId: string,
): Promise<ContextDiversity> {
  const db = getDb();
  const links = await db.sentenceVocabulary
    .where('vocabularyItemId')
    .equals(vocabularyItemId)
    .toArray();
  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  return contextDiversityFromSentenceIds(sentenceIds);
}

/** Grammar-pattern counterpart of computeVocabularyContextDiversity, over sentenceGrammar instead of sentenceVocabulary. */
export async function computeGrammarPatternContextDiversity(
  grammarPatternId: string,
): Promise<ContextDiversity> {
  const db = getDb();
  const links = await db.sentenceGrammar
    .where('grammarPatternId')
    .equals(grammarPatternId)
    .toArray();
  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  return contextDiversityFromSentenceIds(sentenceIds);
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

/**
 * Confusion pairs (Phase 7.6) eligible for contrastive review (Phase 7.7):
 * both members must themselves be vocabulary-target candidates (a
 * surfaceForm-bearing link within the current scope's sentences) — the same
 * eligibility condition reading_retrieval/cloze already use, reused here
 * via `vocabularyTargetCandidates` rather than re-querying, so a pair only
 * shows up in a book's review queue if both words actually appear there.
 */
export async function getConfusionPairCandidates(
  vocabularyTargetCandidates: VocabularyTargetCandidate[],
): Promise<ConfusionPairCandidate[]> {
  if (vocabularyTargetCandidates.length === 0) return [];
  const db = getDb();
  const byItemId = new Map(
    vocabularyTargetCandidates.map((candidate) => [candidate.vocabularyItem.id, candidate]),
  );
  const confusions = await db.vocabularyConfusions.toArray();
  const candidates: ConfusionPairCandidate[] = [];
  for (const confusion of confusions) {
    const itemA = byItemId.get(confusion.itemAId);
    const itemB = byItemId.get(confusion.itemBId);
    if (itemA && itemB) candidates.push({ confusion, itemA, itemB });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Card issue reports: a lightweight "flag this card, deal with it later"
// mechanism raised from ReviewPage. Deliberately not part of
// backupSchema/restoreBackup (same reasoning Phase 1 used for `sources`) —
// these are synced like study_items/reviews, so cloud sync (or
// scripts/list-card-issues.ts, for a future Claude session) is the actual
// durability story, not the local JSON backup.
// ---------------------------------------------------------------------------

export async function reportCardIssue(input: {
  studyItemId: string;
  sentenceId?: string;
  activityType: StudyActivityType;
  note: string;
}): Promise<CardIssueReport> {
  const db = getDb();
  const timestamp = nowIso();
  const report: CardIssueReport = {
    id: createId('card_issue'),
    studyItemId: input.studyItemId,
    sentenceId: input.sentenceId,
    activityType: input.activityType,
    note: input.note,
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.cardIssueReports.put(report);
  notifySync('card_issue_reports', report.id, report);
  return report;
}

export async function listCardIssueReports(
  status?: CardIssueStatus,
): Promise<CardIssueReport[]> {
  const db = getDb();
  const all = await db.cardIssueReports.toArray();
  const filtered = status ? all.filter((item) => item.status === status) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface CardIssueReportWithContext {
  report: CardIssueReport;
  sentence?: Sentence;
}

/** listCardIssueReports plus the sentence shown at report time, for the /issues list UI. */
export async function listCardIssueReportsWithContext(): Promise<
  CardIssueReportWithContext[]
> {
  const db = getDb();
  const reports = await listCardIssueReports();
  const sentenceIds = [
    ...new Set(
      reports
        .map((report) => report.sentenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const sentences = await db.sentences.bulkGet(sentenceIds);
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  return reports.map((report) => ({
    report,
    sentence: report.sentenceId ? sentenceById.get(report.sentenceId) : undefined,
  }));
}

export async function resolveCardIssueReport(id: string): Promise<CardIssueReport> {
  const db = getDb();
  const existing = await db.cardIssueReports.get(id);
  if (!existing) throw new Error('Issue report not found');
  const timestamp = nowIso();
  const updated: CardIssueReport = {
    ...existing,
    status: 'resolved',
    resolvedAt: timestamp,
    updatedAt: timestamp,
  };
  await db.cardIssueReports.put(updated);
  notifySync('card_issue_reports', updated.id, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Study-item explainability/debug view (Phase 7.10). Read-only: gathers
// everything a "why am I seeing this card, and why is it scheduled the way
// it is" view needs — the study item's raw FSRS state, its full Review
// history (finally surfacing source/assistance/responseRaw/expectedAnswer,
// recorded since Phases 7.1/7.8/7.9 but never shown anywhere), each
// review's context sentence if it has one, and — for a vocabulary-item
// subject — its computed maturity ladder position (Phase 7.1/7.5).
// ---------------------------------------------------------------------------

export type StudyItemDebugSubject =
  | { kind: 'sentence'; sentence: Sentence }
  | {
      kind: 'vocabularyItem';
      vocabularyItem: VocabularyItem;
      maturity: { diversity: ContextDiversity; level: MaturityLevel };
    }
  | {
      kind: 'vocabularyConfusion';
      confusion: VocabularyConfusion;
      itemA: VocabularyItem;
      itemB: VocabularyItem;
    }
  | {
      kind: 'grammarPattern';
      grammarPattern: GrammarPattern;
      maturity: { diversity: ContextDiversity; level: MaturityLevel };
    }
  | { kind: 'unknown' };

export interface StudyItemDebugInfo {
  studyItem: StudyItem;
  subject: StudyItemDebugSubject;
  /** Most-recent-first. */
  reviews: Review[];
  contextSentencesById: Map<string, Sentence>;
}

export async function getStudyItemDebugInfo(
  studyItemId: string,
): Promise<StudyItemDebugInfo | undefined> {
  const db = getDb();
  const studyItem = await db.studyItems.get(studyItemId);
  if (!studyItem) return undefined;

  const reviews = (
    await db.reviews.where('studyItemId').equals(studyItemId).toArray()
  ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const contextSentenceIds = [
    ...new Set(
      reviews
        .map((review) => review.contextSentenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const contextSentences = await db.sentences.bulkGet(contextSentenceIds);
  const contextSentencesById = new Map<string, Sentence>();
  contextSentences.forEach((sentence, index) => {
    if (sentence) contextSentencesById.set(contextSentenceIds[index]!, sentence);
  });

  let subject: StudyItemDebugSubject = { kind: 'unknown' };
  if (studyItem.subjectType === 'sentence') {
    const sentence = await db.sentences.get(studyItem.subjectId);
    if (sentence) subject = { kind: 'sentence', sentence };
  } else if (studyItem.subjectType === 'vocabularyItem') {
    const vocabularyItem = await db.vocabularyItems.get(studyItem.subjectId);
    if (vocabularyItem) {
      const diversity = await computeVocabularyContextDiversity(vocabularyItem.id);
      const level = computeMaturityLevel(diversity, {
        hasLongIntervalSuccess:
          studyItem.fsrsState.state === 'review' &&
          studyItem.fsrsState.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS,
      });
      subject = { kind: 'vocabularyItem', vocabularyItem, maturity: { diversity, level } };
    }
  } else if (studyItem.subjectType === 'vocabularyConfusion') {
    const confusion = await db.vocabularyConfusions.get(studyItem.subjectId);
    if (confusion) {
      const [itemA, itemB] = await Promise.all([
        db.vocabularyItems.get(confusion.itemAId),
        db.vocabularyItems.get(confusion.itemBId),
      ]);
      if (itemA && itemB) subject = { kind: 'vocabularyConfusion', confusion, itemA, itemB };
    }
  } else if (studyItem.subjectType === 'grammarPattern') {
    const grammarPattern = await db.grammarPatterns.get(studyItem.subjectId);
    if (grammarPattern) {
      const diversity = await computeGrammarPatternContextDiversity(grammarPattern.id);
      const level = computeMaturityLevel(diversity, {
        hasLongIntervalSuccess:
          studyItem.fsrsState.state === 'review' &&
          studyItem.fsrsState.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS,
      });
      subject = { kind: 'grammarPattern', grammarPattern, maturity: { diversity, level } };
    }
  }

  return { studyItem, subject, reviews, contextSentencesById };
}

/**
 * A short human label for a study item's subject, for the top-level
 * `/study-items` browsable list (Phase 7.10a follow-up). Deliberately a
 * separate, batched implementation rather than calling
 * `getStudyItemDebugInfo` once per row — that function's per-item
 * `db.get()` calls would be an N+1 query pattern at list scale.
 */
export interface StudyItemSummary {
  studyItem: StudyItem;
  subjectLabel: string;
}

export async function listStudyItemSummaries(): Promise<StudyItemSummary[]> {
  const db = getDb();
  const studyItems = await db.studyItems.toArray();

  const sentenceIds = studyItems
    .filter((item) => item.subjectType === 'sentence')
    .map((item) => item.subjectId);
  const vocabularyItemIds = studyItems
    .filter((item) => item.subjectType === 'vocabularyItem')
    .map((item) => item.subjectId);
  const confusionIds = studyItems
    .filter((item) => item.subjectType === 'vocabularyConfusion')
    .map((item) => item.subjectId);
  const grammarPatternIds = studyItems
    .filter((item) => item.subjectType === 'grammarPattern')
    .map((item) => item.subjectId);

  const [sentences, vocabularyItems, confusions, grammarPatterns] = await Promise.all([
    db.sentences.bulkGet(sentenceIds),
    db.vocabularyItems.bulkGet(vocabularyItemIds),
    db.vocabularyConfusions.bulkGet(confusionIds),
    db.grammarPatterns.bulkGet(grammarPatternIds),
  ]);
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const vocabularyItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .map((row) => [row.id, row]),
  );
  const confusionById = new Map(
    confusions
      .filter((row): row is VocabularyConfusion => Boolean(row))
      .map((row) => [row.id, row]),
  );
  const grammarPatternById = new Map(
    grammarPatterns
      .filter((row): row is GrammarPattern => Boolean(row))
      .map((row) => [row.id, row]),
  );

  return studyItems.map((studyItem) => {
    let subjectLabel = studyItem.subjectId;
    if (studyItem.subjectType === 'sentence') {
      const sentence = sentenceById.get(studyItem.subjectId);
      if (sentence) subjectLabel = sentence.japanese;
    } else if (studyItem.subjectType === 'vocabularyItem') {
      const vocabularyItem = vocabularyItemById.get(studyItem.subjectId);
      if (vocabularyItem) {
        subjectLabel = `${vocabularyItem.expression} (${vocabularyItem.reading})`;
      }
    } else if (studyItem.subjectType === 'vocabularyConfusion') {
      const confusion = confusionById.get(studyItem.subjectId);
      if (confusion) {
        const itemA = vocabularyItemById.get(confusion.itemAId);
        const itemB = vocabularyItemById.get(confusion.itemBId);
        subjectLabel = `${itemA?.expression ?? confusion.itemAId} vs ${itemB?.expression ?? confusion.itemBId}`;
      }
    } else if (studyItem.subjectType === 'grammarPattern') {
      const grammarPattern = grammarPatternById.get(studyItem.subjectId);
      if (grammarPattern) subjectLabel = grammarPattern.canonicalName;
    }
    return { studyItem, subjectLabel };
  });
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
    id: createId('grammar_pattern'),
    canonicalName: canonicalName.trim(),
    normalizedKey,
    aliases: fields.aliases ?? [],
    shortMeaning: fields.shortMeaning ?? '',
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
    id: createId('sentence_grammar'),
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
  const links = await db.sentenceGrammar
    .where('grammarPatternId')
    .equals(grammarPatternId)
    .toArray();
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
 * the last M reviews") are scoped to each pattern's own
 * `grammar_comprehension` study item specifically, not `grammar_completion`
 * too — comprehension is self-rated on every review regardless of whether
 * the learner actually struggled, so its rating history is the more direct
 * "did this feel hard" signal; completion's auto-graded correctness is a
 * different kind of evidence already folded into its own FSRS state.
 */
export async function listGrammarPatternSummaries(): Promise<GrammarPatternSummary[]> {
  const db = getDb();
  const [patterns, links, studyItems, bookSentences, books] = await Promise.all([
    db.grammarPatterns.toArray(),
    db.sentenceGrammar.toArray(),
    db.studyItems.where('subjectType').equals('grammarPattern').toArray(),
    db.bookSentences.toArray(),
    db.books.toArray(),
  ]);

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
  const comprehensionStudyItemIds = studyItems
    .filter((item) => item.activityType === 'grammar_comprehension')
    .map((item) => item.id);
  const recentReviews = comprehensionStudyItemIds.length
    ? await db.reviews.where('studyItemId').anyOf(comprehensionStudyItemIds).toArray()
    : [];
  const reviewsByStudyItemId = new Map<string, Review[]>();
  for (const review of recentReviews) {
    const list = reviewsByStudyItemId.get(review.studyItemId);
    if (list) list.push(review);
    else reviewsByStudyItemId.set(review.studyItemId, [review]);
  }

  return patterns.map((pattern) => {
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
    const comprehensionItem = patternStudyItems.find(
      (item) => item.activityType === 'grammar_comprehension',
    );
    const recent = comprehensionItem
      ? (reviewsByStudyItemId.get(comprehensionItem.id) ?? [])
          .slice()
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 7)
      : [];
    const recentAgainCount = recent.filter((review) => review.rating === 'again').length;
    const proficient = patternStudyItems.some(
      (item) =>
        item.activityType === 'grammar_comprehension' &&
        isVocabularyItemProficient(item.fsrsState.state),
    );
    const contrastProficient = patternStudyItems.some(
      (item) =>
        item.activityType === 'grammar_contrast' &&
        isVocabularyItemProficient(item.fsrsState.state),
    );

    const state = computeGrammarLearnerState({
      encounterCount,
      confirmedCount,
      tracked,
      proficient,
      contrastProficient,
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
      state,
      priorityBucket,
      priorityExplanation,
      recentAgainCount,
      recentReviewCount: recent.length,
    };
  });
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
 * Most-recently-linked sentence for a grammar pattern — mirrors
 * pickContextSentenceForVocabularyItem's shape exactly. Used by ReviewPage
 * to pick which of a tracked pattern's encounters to show for a
 * grammar_comprehension/grammar_completion card.
 */
export async function pickContextSentenceForGrammarPattern(
  grammarPatternId: string,
): Promise<{ sentence: Sentence; sentenceGrammar: SentenceGrammar } | undefined> {
  const db = getDb();
  const links = await db.sentenceGrammar
    .where('grammarPatternId')
    .equals(grammarPatternId)
    .toArray();
  if (links.length === 0) return undefined;
  const sorted = [...links].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const link of sorted) {
    const sentence = await db.sentences.get(link.sentenceId);
    if (sentence) return { sentence, sentenceGrammar: link };
  }
  return undefined;
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
  const studyItem = await ensureGrammarStudyItem(
    input.grammarPatternId,
    input.activityType ?? 'grammar_comprehension',
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
    id: createId('grammar_relationship'),
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
        id: createId('grammar_relationship'),
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

export { DEFAULT_SETTINGS, ensureSettings, getDb, readSettings } from './database';
export type { GlossbookDatabase } from './database';
