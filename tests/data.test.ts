import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  assignBookSentencesToChapter,
  commitImport,
  createBook,
  createBookChapter,
  deleteBookChapter,
  exportFullBackup,
  getDb,
  moveBookSentence,
  removeSentencesFromBook,
  reorderBookSentences,
  restoreBookSentenceSnapshot,
  restoreBackup,
  saveAnalysis,
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
});
