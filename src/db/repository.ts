import { ANALYSIS_FORMAT_VERSION } from '../appConfig';
import type { BackupPayload } from '../domain/schemas';
import type {
  AnalysisChunk,
  AppSettings,
  Book,
  BookChapter,
  BookSentence,
  ImportBatch,
  InitialOrderMode,
  Sentence,
  SentenceAnalysis,
  StudyStatus,
} from '../domain/types';
import {
  mergeSentenceOnReimport,
  parseSatoriCsvText,
  type ImportPreview,
} from '../lib/csvImport';
import { createId, sentenceIdFromNormalizedKey } from '../lib/ids';
import { nowIso } from '../lib/normalize';
import { buildBackupPayload, type BackupBundle } from '../lib/backup';
import { ensureSettings, getDb } from './database';

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
  subtitle?: string;
  sourceUrl?: string;
  notes?: string;
}): Promise<Book> {
  const db = getDb();
  const timestamp = nowIso();
  const book: Book = {
    id: createId('book'),
    title: input.title.trim() || 'Untitled book',
    subtitle: input.subtitle?.trim() || undefined,
    sourceUrl: input.sourceUrl?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    chapters: [],
  };
  await db.books.put(book);
  return book;
}

export async function updateBook(
  bookId: string,
  patch: Partial<Pick<Book, 'title' | 'subtitle' | 'sourceUrl' | 'notes' | 'archived'>>,
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
  return updated;
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.books, db.bookSentences, async () => {
    await db.bookSentences.where('bookId').equals(bookId).delete();
    await db.books.delete(bookId);
  });
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
  await db.bookSentences.bulkPut(
    memberships.map((item) => ({
      ...item,
      id: createId('bs'),
      bookId: copy.id,
      addedAt: timestamp,
      lastStudiedAt: undefined,
      chapterId: item.chapterId
        ? chapterIdMap.get(item.chapterId)
        : undefined,
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
    await db.books.put({ ...book, chapters, updatedAt: nowIso() });
  });
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
  await db.bookSentences.bulkPut(
    ordered.map((sentence, index) => ({
      id: createId('bs'),
      bookId,
      sentenceId: sentence.id,
      position: maxPosition + 1 + index,
      status: 'unstarted' as StudyStatus,
      addedAt: timestamp,
    })),
  );
  await db.inbox.bulkDelete(toAddIds);
  const book = await db.books.get(bookId);
  if (book) {
    await db.books.put({ ...book, updatedAt: timestamp });
  }
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
    const updates = orderedSentenceIds
      .map((sentenceId, index) => {
        const item = bySentence.get(sentenceId);
        if (!item) return null;
        return { ...item, position: index };
      })
      .filter((item): item is BookSentence => Boolean(item));
    await db.bookSentences.bulkPut(updates);
    const book = await db.books.get(bookId);
    if (book) {
      await db.books.put({ ...book, updatedAt: nowIso() });
    }
  });
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
}

export async function saveAnalysis(
  sentenceId: string,
  chunks: AnalysisChunk[],
  notes = '',
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
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await db.analyses.put(analysis);
  return analysis;
}

export async function commitImport(options: {
  preview: ImportPreview;
  selectedIds: string[];
  destination: 'inbox' | 'new_book' | 'existing_book';
  bookId?: string;
  newBookTitle?: string;
  orderMode?: InitialOrderMode;
}): Promise<{ batchId: string; bookId?: string }> {
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
  if (options.destination === 'new_book') {
    const book = await createBook({
      title: options.newBookTitle || options.preview.batchName,
    });
    bookId = book.id;
    await addSentencesToBook(
      book.id,
      selected.map((item) => item.proposedId),
      options.orderMode ?? 'first_occurrence',
    );
  } else if (options.destination === 'existing_book' && bookId) {
    await addSentencesToBook(
      bookId,
      selected.map((item) => item.proposedId),
      options.orderMode ?? 'first_occurrence',
    );
  }

  return { batchId, bookId };
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
  return buildBackupPayload({
    books: [book],
    sentences: full.sentences.filter((item) => sentenceIds.has(item.id)),
    bookSentences: memberships,
    analyses: full.analyses.filter((item) => sentenceIds.has(item.sentenceId)),
    importBatches: full.importBatches,
    inbox: [],
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
    db.settings,
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
      ]);
      await db.books.bulkPut(payload.books);
      await db.sentences.bulkPut(payload.sentences);
      await db.bookSentences.bulkPut(payload.bookSentences);
      await db.analyses.bulkPut(payload.analyses);
      await db.importBatches.bulkPut(payload.importBatches);
      await db.inbox.bulkPut(payload.inbox);
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

export { DEFAULT_SETTINGS, ensureSettings, getDb, readSettings } from './database';
export type { GlossbookDatabase } from './database';
