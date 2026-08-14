import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  assignBookSentencesToChapter,
  commitImport,
  createBook,
  createBookChapter,
  deleteAttempt,
  deleteBookChapter,
  exportFullBackup,
  getDb,
  listAttemptsForSentence,
  moveBookSentence,
  rateAttempt,
  removeSentencesFromBook,
  reorderBookSentences,
  restoreBookSentenceSnapshot,
  restoreBackup,
  saveAnalysis,
  saveAttempt,
  setBookSentenceStatus,
  transferBookSentences,
  updateBookChapter,
} from '../src/db/repository';
import { parseBackupJson } from '../src/lib/backup';
import { parseSatoriCsvText } from '../src/lib/csvImport';
import { createId } from '../src/lib/ids';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const littleBirds = readFileSync(
  resolve(import.meta.dirname, '../fixtures/little-birds.csv'),
  'utf8',
);

describe('data layer', () => {
  beforeEach(() => {
    resetDbForTests(`data-${createId('db')}`);
  });

  it('creates books, shares sentences, reorders, and preserves analysis on reimport', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const selected = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: selected,
      destination: 'inbox',
    });

    const bookA = await createBook({ title: 'Book A' });
    const bookB = await createBook({ title: 'Book B' });
    await addSentencesToBook(bookA.id, selected.slice(0, 2));
    await addSentencesToBook(bookB.id, selected.slice(0, 1));

    const firstId = selected[0]!;
    await saveAnalysis(firstId, [
      {
        id: 'c1',
        order: 0,
        japanese: 'ある小鳥の',
        role: 'modifier/content',
        literalEnglish: "a-certain-little-bird's",
      },
    ]);
    await setBookSentenceStatus(bookA.id, firstId, 'in_progress');

    await reorderBookSentences(bookA.id, [selected[1]!, selected[0]!]);

    const reimport = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    await commitImport({
      preview: reimport,
      selectedIds: reimport.drafts.map((item) => item.proposedId),
      destination: 'inbox',
    });

    const backup = await exportFullBackup();
    expect(backup.sentences.length).toBeGreaterThan(0);
    const analysis = backup.analyses.find((item) => item.sentenceId === firstId);
    expect(analysis?.chunks[0]?.literalEnglish).toBe("a-certain-little-bird's");
    const memberships = backup.bookSentences
      .filter((item) => item.bookId === bookA.id)
      .sort((a, b) => a.position - b.position);
    expect(memberships.map((item) => item.sentenceId)).toEqual([
      selected[1],
      selected[0],
    ]);
    expect(
      memberships.find((item) => item.sentenceId === firstId)?.status,
    ).toBe('in_progress');

    const parsed = parseBackupJson(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      await restoreBackup(parsed.data, 'replace');
      const again = await exportFullBackup();
      expect(again.books).toHaveLength(backup.books.length);
      expect(again.sentences).toHaveLength(backup.sentences.length);
    }
  });

  it('moves and copies memberships, supports exact positions, and restores removal metadata', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: sentenceIds,
      destination: 'inbox',
    });
    const source = await createBook({ title: 'Source' });
    const destination = await createBook({ title: 'Destination' });
    await addSentencesToBook(source.id, sentenceIds);
    await setBookSentenceStatus(source.id, sentenceIds[0]!, 'needs_review');

    await moveBookSentence(source.id, sentenceIds[0]!, 3);
    const db = getDb();
    const reordered = await db.bookSentences
      .where('bookId')
      .equals(source.id)
      .sortBy('position');
    expect(reordered[2]?.sentenceId).toBe(sentenceIds[0]);

    await transferBookSentences({
      sourceBookId: source.id,
      destinationBookId: destination.id,
      sentenceIds: [sentenceIds[0]!],
      mode: 'copy',
    });
    const copied = await db.bookSentences
      .where('[bookId+sentenceId]')
      .equals([destination.id, sentenceIds[0]!])
      .first();
    expect(copied?.status).toBe('needs_review');

    await transferBookSentences({
      sourceBookId: source.id,
      destinationBookId: destination.id,
      sentenceIds: [sentenceIds[1]!],
      mode: 'move',
    });
    expect(
      await db.bookSentences
        .where('[bookId+sentenceId]')
        .equals([source.id, sentenceIds[1]!])
        .count(),
    ).toBe(0);

    const beforeRemoval = await db.bookSentences
      .where('bookId')
      .equals(source.id)
      .sortBy('position');
    const snapshot = await removeSentencesFromBook(source.id, [
      sentenceIds[0]!,
    ]);
    await restoreBookSentenceSnapshot(source.id, snapshot);
    const restored = await db.bookSentences
      .where('bookId')
      .equals(source.id)
      .sortBy('position');
    expect(restored).toEqual(beforeRemoval);
    expect(
      restored.find((item) => item.sentenceId === sentenceIds[0])?.status,
    ).toBe('needs_review');
  });

  it('creates, orders, assigns, and deletes book chapters without duplicating sentences', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: sentenceIds,
      destination: 'inbox',
    });
    const book = await createBook({ title: 'Chaptered Book' });
    await addSentencesToBook(book.id, sentenceIds);
    const first = await createBookChapter(book.id, 'Lesson One');
    const second = await createBookChapter(book.id, 'Lesson Two');
    await assignBookSentencesToChapter(book.id, sentenceIds.slice(0, 2), first.id);

    const db = getDb();
    let memberships = await db.bookSentences
      .where('bookId')
      .equals(book.id)
      .sortBy('position');
    expect(
      memberships.filter((item) => item.chapterId === first.id),
    ).toHaveLength(2);

    await updateBookChapter(book.id, second.id, { position: 0 });
    let storedBook = await db.books.get(book.id);
    expect(storedBook?.chapters.map((chapter) => chapter.title)).toEqual([
      'Lesson Two',
      'Lesson One',
    ]);

    const backup = await exportFullBackup();
    expect(
      backup.books.find((item) => item.id === book.id)?.chapters,
    ).toHaveLength(2);
    expect(
      backup.bookSentences.some((item) => item.chapterId === first.id),
    ).toBe(true);

    await deleteBookChapter(book.id, first.id);
    storedBook = await db.books.get(book.id);
    expect(storedBook?.chapters).toHaveLength(1);
    memberships = await db.bookSentences
      .where('bookId')
      .equals(book.id)
      .toArray();
    expect(memberships.some((item) => item.chapterId === first.id)).toBe(false);
    expect(await db.sentences.count()).toBe(sentenceIds.length);
  });

  it('imports selected sentences into a new or existing chapter', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    const book = await createBook({ title: 'Satori Series' });
    const existing = await createBookChapter(book.id, 'Earlier Lesson');

    const intoExisting = await commitImport({
      preview,
      selectedIds: sentenceIds.slice(0, 2),
      destination: 'existing_book',
      bookId: book.id,
      chapterId: existing.id,
    });
    expect(intoExisting.chapterId).toBe(existing.id);

    const intoNew = await commitImport({
      preview,
      selectedIds: sentenceIds.slice(2),
      destination: 'existing_book',
      bookId: book.id,
      newChapterTitle: 'Imported Lesson',
    });
    expect(intoNew.chapterId).toBeTruthy();

    const db = getDb();
    const storedBook = await db.books.get(book.id);
    expect(storedBook?.chapters.map((chapter) => chapter.title)).toEqual([
      'Earlier Lesson',
      'Imported Lesson',
    ]);
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(book.id)
      .toArray();
    expect(
      memberships.filter((item) => item.chapterId === existing.id),
    ).toHaveLength(2);
    expect(
      memberships.filter((item) => item.chapterId === intoNew.chapterId),
    ).toHaveLength(sentenceIds.length - 2);
  });

  it('creates a book chapter during new-book import and assigns already-membered sentences', async () => {
    const preview = parseSatoriCsvText(littleBirds, 'little-birds.csv');
    const sentenceIds = preview.drafts.map((item) => item.proposedId);
    await commitImport({
      preview,
      selectedIds: sentenceIds.slice(0, 1),
      destination: 'new_book',
      newBookTitle: 'Starter',
    });
    const book = (await getDb().books.toArray())[0]!;

    const result = await commitImport({
      preview,
      selectedIds: sentenceIds,
      destination: 'existing_book',
      bookId: book.id,
      newChapterTitle: 'Full Export',
    });

    const memberships = await getDb()
      .bookSentences.where('bookId')
      .equals(book.id)
      .toArray();
    expect(memberships).toHaveLength(sentenceIds.length);
    expect(
      memberships.every((item) => item.chapterId === result.chapterId),
    ).toBe(true);
  });
});

describe('shadowing attempts', () => {
  beforeEach(() => {
    resetDbForTests(`data-attempts-${createId('db')}`);
  });

  function makeBlob(bytes = 'audio-bytes'): Blob {
    return new Blob([bytes], { type: 'audio/webm' });
  }

  it('saves an attempt with expected defaults', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_500,
    });
    expect(attempt.id).toMatch(/^attempt_/);
    expect(attempt.sentenceId).toBe('sent-1');
    expect(attempt.manualRating).toBeUndefined();
    expect(await getDb().attempts.get(attempt.id)).toMatchObject({
      sentenceId: 'sent-1',
      durationMs: 1_500,
    });
  });

  it('lists attempts for a sentence newest-first, excluding other sentences', async () => {
    const first = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob('one'),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    const second = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob('two'),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    await saveAttempt({
      sentenceId: 'sent-2',
      blob: makeBlob('other'),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });

    const attempts = await listAttemptsForSentence('sent-1');
    expect(attempts.map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it('deletes an attempt', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    await deleteAttempt(attempt.id);
    expect(await getDb().attempts.get(attempt.id)).toBeUndefined();
  });

  it('rates an attempt and rejects an unknown id', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    const rated = await rateAttempt(attempt.id, 'better');
    expect(rated.manualRating).toBe('better');

    await expect(rateAttempt('missing-id', 'worse')).rejects.toThrow(
      'Attempt not found',
    );
  });

  it('never enqueues sync metadata for attempt writes (local-only by design)', async () => {
    const attempt = await saveAttempt({
      sentenceId: 'sent-1',
      blob: makeBlob(),
      mimeType: 'audio/webm',
      durationMs: 1_000,
    });
    await rateAttempt(attempt.id, 'same');
    await deleteAttempt(attempt.id);

    expect(await getDb().syncRecordMeta.count()).toBe(0);
    expect(await getDb().syncQueue.count()).toBe(0);
  });
});
