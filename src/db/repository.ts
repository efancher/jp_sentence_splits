import { ANALYSIS_FORMAT_VERSION } from '../appConfig';
import type { BackupPayload } from '../domain/schemas';
import type {
  AnalysisChunk,
  AppSettings,
  Attempt,
  AttemptRating,
  Book,
  BookChapter,
  BookSentence,
  ErrorClassification,
  ImportBatch,
  InboxMembership,
  InitialOrderMode,
  Kanji,
  Review,
  ReviewAssistance,
  ReviewRating,
  Sentence,
  SentenceAudio,
  SentenceAnalysis,
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
import {
  mergeSentenceOnReimport,
  parseSatoriCsvText,
  type ImportPreview,
} from '../lib/csvImport';
import { createId, hashString, sentenceIdFromNormalizedKey } from '../lib/ids';
import { isHanCharacter } from '../lib/kanji';
import { computeContextDiversity, type ContextDiversity } from '../lib/maturity';
import { nowIso } from '../lib/normalize';
import { createInitialFsrsState, scheduleReview } from '../lib/scheduling';
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
  options: { subjectIds?: string[]; now?: Date; limit?: number } = {},
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
    .sort((a, b) => a.fsrsState.due.localeCompare(b.fsrsState.due));
  return options.limit ? due.slice(0, options.limit) : due;
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
    errorClassification: input.errorClassification,
    assistance: input.assistance,
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
 * Fetches the data `computeContextDiversity` (src/lib/maturity.ts) needs
 * for one vocabulary item and calls it — the Dexie-querying half of
 * maturity computation, kept separate from the pure ladder logic itself
 * (Phase 7.1). A sentence's "source" is the sourceKey (or id, as a
 * stand-in) of any Book containing it via `book_sentences`, since Sentence
 * has no direct link to the `sources` table yet.
 */
export async function computeVocabularyContextDiversity(
  vocabularyItemId: string,
): Promise<ContextDiversity> {
  const db = getDb();
  const links = await db.sentenceVocabulary
    .where('vocabularyItemId')
    .equals(vocabularyItemId)
    .toArray();
  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  if (sentenceIds.length === 0) return computeContextDiversity(new Map());

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

export { DEFAULT_SETTINGS, ensureSettings, getDb, readSettings } from './database';
export type { GlossbookDatabase } from './database';
