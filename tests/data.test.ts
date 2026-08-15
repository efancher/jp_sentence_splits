import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  assignBookSentencesToChapter,
  commitImport,
  createBook,
  createBookChapter,
  deleteAttempt,
  deleteBookChapter,
  ensureKanji,
  ensureStudyItem,
  ensureVocabularyConfusion,
  ensureVocabularyItem,
  ensureVocabularyStudyItem,
  exportFullBackup,
  getDb,
  getDueStudyItems,
  listAttemptsForSentence,
  materializeVocabularySelections,
  moveBookSentence,
  pickContextSentenceForVocabularyItem,
  rateAttempt,
  recordConfusionObservation,
  recordReview,
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
import type { Sentence, VocabularySelection } from '../src/domain/types';
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

describe('FSRS review (study_items/reviews)', () => {
  beforeEach(() => {
    resetDbForTests(`data-review-${createId('db')}`);
  });

  it('ensureStudyItem creates a new, due-now card the first time a subject is seen', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    expect(item.subjectType).toBe('sentence');
    expect(item.subjectId).toBe('sent-1');
    expect(item.activityType).toBe('comprehension');
    expect(item.fsrsState.state).toBe('new');
    expect(item.fsrsState.reps).toBe(0);
  });

  it('ensureStudyItem is idempotent for the same subject/activity pair', async () => {
    const first = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const second = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    expect(second.id).toBe(first.id);
    expect(await getDb().studyItems.count()).toBe(1);
  });

  it('ensureStudyItem treats different activity types as distinct study items', async () => {
    const comprehension = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const reading = await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');
    expect(comprehension.id).not.toBe(reading.id);
    expect(await getDb().studyItems.count()).toBe(2);
  });

  it('getDueStudyItems only returns items due now, filtered by activity type and subject', async () => {
    const due = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const other = await ensureStudyItem('sentence', 'sent-2', 'comprehension');
    const notDue = await ensureStudyItem('sentence', 'sent-3', 'comprehension');
    await getDb().studyItems.update(notDue.id, {
      fsrsState: {
        ...notDue.fsrsState,
        due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    const results = await getDueStudyItems(['comprehension'], {
      subjectIds: [due.subjectId, other.subjectId, notDue.subjectId],
    });
    expect(results.map((item) => item.id).sort()).toEqual(
      [due.id, other.id].sort(),
    );
  });

  it('getDueStudyItems excludes other activity types even when due', async () => {
    await ensureStudyItem('sentence', 'sent-1', 'shadowing');
    const results = await getDueStudyItems(['comprehension', 'reading_in_context']);
    expect(results).toEqual([]);
  });

  it('recordReview appends a Review and advances the study item past "new"', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const { review, studyItem } = await recordReview({
      studyItemId: item.id,
      rating: 'good',
    });
    expect(review.studyItemId).toBe(item.id);
    expect(review.rating).toBe('good');
    expect(studyItem.fsrsState.state).not.toBe('new');
    expect(studyItem.fsrsState.reps).toBe(1);
    expect(new Date(studyItem.fsrsState.due).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(await getDb().reviews.count()).toBe(1);
    const persisted = await getDb().studyItems.get(item.id);
    expect(persisted?.fsrsState.reps).toBe(1);
  });

  it('recordReview rejects an unknown study item id', async () => {
    await expect(
      recordReview({ studyItemId: 'missing-id', rating: 'good' }),
    ).rejects.toThrow('Study item not found');
  });

  it('enqueues sync metadata for study_items/reviews writes, unlike local-only attempts', async () => {
    const item = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    await recordReview({ studyItemId: item.id, rating: 'good' });

    await vi.waitFor(async () => {
      expect(await getDb().syncRecordMeta.count()).toBeGreaterThan(0);
    });
    const keys = (await getDb().syncRecordMeta.toArray()).map((row) => row.entity);
    expect(keys).toContain('study_items');
    expect(keys).toContain('reviews');
  });
});

function selection(
  overrides: Partial<VocabularySelection> &
    Pick<VocabularySelection, 'surface' | 'start' | 'end' | 'expression'>,
): VocabularySelection {
  return {
    id: createId('vsel'),
    reading: '',
    source: 'manual',
    ...overrides,
  };
}

describe('vocabulary/kanji materialization (Phase 5)', () => {
  beforeEach(() => {
    resetDbForTests(`data-vocab-${createId('db')}`);
  });

  it('ensureVocabularyItem creates a new item and dedups on (expression, reading)', async () => {
    const first = await ensureVocabularyItem('大学', 'だいがく', { meaning: 'university' });
    const second = await ensureVocabularyItem('大学', 'だいがく', { meaning: 'ignored' });
    expect(second.id).toBe(first.id);
    expect(second.meaning).toBe('university');
    expect(await getDb().vocabularyItems.count()).toBe(1);
  });

  it('treats homophones (same expression, different reading) as distinct items', async () => {
    const shukan = await ensureVocabularyItem('週間', 'しゅうかん');
    const shuukan = await ensureVocabularyItem('習慣', 'しゅうかん');
    expect(shukan.id).not.toBe(shuukan.id);
    expect(await getDb().vocabularyItems.count()).toBe(2);
  });

  it('creates kanji rows and vocabulary_kanji links at the correct positions', async () => {
    const item = await ensureVocabularyItem('大学', 'だいがく');
    const links = await getDb()
      .vocabularyKanji.where('vocabularyItemId')
      .equals(item.id)
      .toArray();
    expect(links).toHaveLength(2);
    const byPosition = new Map(links.map((link) => [link.positionInWord, link]));
    const dai = await getDb().kanji.get(byPosition.get(0)!.kanjiId);
    const gaku = await getDb().kanji.get(byPosition.get(1)!.kanjiId);
    expect(dai?.character).toBe('大');
    expect(gaku?.character).toBe('学');
  });

  it('reuses an existing kanji row across vocabulary items instead of duplicating it', async () => {
    await ensureVocabularyItem('大学', 'だいがく');
    await ensureVocabularyItem('大きい', 'おおきい');
    expect(await getDb().kanji.count()).toBe(2); // 大, 学
  });

  it('links a repeated kanji at each of its true positions in the word', async () => {
    const item = await ensureVocabularyItem('民主主義', 'みんしゅしゅぎ');
    const links = await getDb()
      .vocabularyKanji.where('vocabularyItemId')
      .equals(item.id)
      .toArray();
    expect(links.map((link) => link.positionInWord).sort()).toEqual([0, 1, 2, 3]);
    const shu = await getDb().kanji.where('character').equals('主').first();
    const shuLinks = links.filter((link) => link.kanjiId === shu?.id);
    expect(shuLinks.map((link) => link.positionInWord).sort()).toEqual([1, 2]);
  });

  it('handles astral-plane kanji (surrogate pairs) as a single character', async () => {
    const item = await ensureVocabularyItem('𠮟る', 'しかる');
    const links = await getDb()
      .vocabularyKanji.where('vocabularyItemId')
      .equals(item.id)
      .toArray();
    expect(links).toHaveLength(1);
    const kanji = await getDb().kanji.get(links[0]!.kanjiId);
    expect(kanji?.character).toBe('𠮟');
  });

  it('ensureKanji is idempotent by character', async () => {
    const first = await ensureKanji('水');
    const second = await ensureKanji('水');
    expect(second.id).toBe(first.id);
    expect(await getDb().kanji.count()).toBe(1);
  });

  it('materializeVocabularySelections links confirmed selections to the sentence', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);
    const links = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links).toHaveLength(1);
    const item = await getDb().vocabularyItems.get(links[0]!.vocabularyItemId);
    expect(item?.expression).toBe('大学');
  });

  it('re-confirming removes stale links but keeps the underlying vocabulary item', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);
    await materializeVocabularySelections('sent-1', []);

    const links = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links).toHaveLength(0);
    expect(await getDb().vocabularyItems.count()).toBe(1);
  });

  it('collapses duplicate selections resolving to the same item into one link', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
      selection({ surface: '大学', start: 3, end: 5, expression: '大学', reading: 'だいがく' }),
    ]);
    const links = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links).toHaveLength(1);
  });

  it('enqueues sync metadata for all four vocabulary/kanji tables', async () => {
    await materializeVocabularySelections('sent-1', [
      selection({ surface: '大学', start: 0, end: 2, expression: '大学', reading: 'だいがく' }),
    ]);

    await vi.waitFor(async () => {
      expect(await getDb().syncRecordMeta.count()).toBeGreaterThan(0);
    });
    const keys = (await getDb().syncRecordMeta.toArray()).map((row) => row.entity);
    expect(keys).toContain('vocabulary_items');
    expect(keys).toContain('sentence_vocabulary');
    expect(keys).toContain('kanji');
    expect(keys).toContain('vocabulary_kanji');
  });
});

function stubSentence(id: string, overrides: Partial<Sentence> = {}): Sentence {
  const now = new Date().toISOString();
  return {
    id,
    normalizedKey: id,
    japanese: `${id}-japanese`,
    readingOnly: '',
    inlineReading: '',
    translation: '',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('evidence-model foundation (Phase 7.1)', () => {
  beforeEach(() => {
    resetDbForTests(`data-evidence-${createId('db')}`);
  });

  it('ensureVocabularyStudyItem creates a vocabularyItem-subject study item, distinct from a sentence one', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const wordLevel = await ensureVocabularyStudyItem(vocabItem.id, 'reading');
    expect(wordLevel.subjectType).toBe('vocabularyItem');
    expect(wordLevel.subjectId).toBe(vocabItem.id);

    const sentenceLevel = await ensureStudyItem('sentence', 'sent-1', 'reading');
    expect(sentenceLevel.id).not.toBe(wordLevel.id);
  });

  it('ensureVocabularyStudyItem is idempotent for the same vocabulary item/activity pair', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const first = await ensureVocabularyStudyItem(vocabItem.id, 'reading');
    const second = await ensureVocabularyStudyItem(vocabItem.id, 'reading');
    expect(second.id).toBe(first.id);
  });

  it('pickContextSentenceForVocabularyItem returns the most recently linked sentence', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    await getDb().sentences.bulkPut([stubSentence('sent-old'), stubSentence('sent-new')]);
    await getDb().sentenceVocabulary.bulkPut([
      {
        id: 'link-old',
        sentenceId: 'sent-old',
        vocabularyItemId: vocabItem.id,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'link-new',
        sentenceId: 'sent-new',
        vocabularyItemId: vocabItem.id,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const picked = await pickContextSentenceForVocabularyItem(vocabItem.id);
    expect(picked?.id).toBe('sent-new');
  });

  it('pickContextSentenceForVocabularyItem returns undefined with no links', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    expect(await pickContextSentenceForVocabularyItem(vocabItem.id)).toBeUndefined();
  });

  it('ensureVocabularyConfusion creates a canonicalized, deduped pair', async () => {
    const arawasu = await ensureVocabularyItem('表す', 'あらわす');
    const arawareru = await ensureVocabularyItem('表れる', 'あらわれる');

    const forward = await ensureVocabularyConfusion(
      arawasu.id,
      arawareru.id,
      'transitivity',
    );
    const backward = await ensureVocabularyConfusion(
      arawareru.id,
      arawasu.id,
      'transitivity',
    );

    expect(backward.id).toBe(forward.id);
    expect(await getDb().vocabularyConfusions.count()).toBe(1);
    // Canonicalized regardless of call order.
    const [expectedA, expectedB] =
      arawasu.id < arawareru.id ? [arawasu.id, arawareru.id] : [arawareru.id, arawasu.id];
    expect(forward.itemAId).toBe(expectedA);
    expect(forward.itemBId).toBe(expectedB);
  });

  it('recordConfusionObservation increments the count and bumps lastObservedAt', async () => {
    const a = await ensureVocabularyItem('開く', 'あく');
    const b = await ensureVocabularyItem('開ける', 'あける');

    const first = await recordConfusionObservation(a.id, b.id, 'transitivity');
    expect(first.observedCount).toBe(1);

    const second = await recordConfusionObservation(b.id, a.id, 'transitivity');
    expect(second.id).toBe(first.id);
    expect(second.observedCount).toBe(2);
    expect(await getDb().vocabularyConfusions.count()).toBe(1);
  });

  it('recordConfusionObservation enqueues sync metadata', async () => {
    const a = await ensureVocabularyItem('開く', 'あく');
    const b = await ensureVocabularyItem('開ける', 'あける');
    await recordConfusionObservation(a.id, b.id, 'transitivity');

    await vi.waitFor(async () => {
      const keys = (await getDb().syncRecordMeta.toArray()).map((row) => row.entity);
      expect(keys).toContain('vocabulary_confusions');
    });
  });
});
