import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ReviewDocumentText } from '../src/components/ReviewDocumentText';
import { resetDbForTests } from '../src/db/database';
import { getDb, getReviewDocument } from '../src/db/repository';
import type { Book, BookSentence, Sentence } from '../src/domain/types';
import { maskReviewText, uniqueReviewSpan } from '../src/lib/reviewDocument';

const now = '2026-09-30T00:00:00.000Z';
const sentence = (id: string, japanese = `${id}の文。`): Sentence => ({
  id, japanese, normalizedKey: id, readingOnly: 'hidden reading', inlineReading: '本[ほん]',
  translation: 'hidden translation', targetVocabulary: [], vocabularySuggestions: [],
  sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [],
  createdAt: now, updatedAt: now,
});
const book = (id: string, lastOpenedAt = now): Book => ({
  id, title: id, archived: false, chapters: [
    { id: 'episode-1', title: '読む話', position: 0 },
    { id: 'episode-2', title: 'Other episode', position: 1 },
  ], createdAt: now, updatedAt: now, lastOpenedAt, collapsedChapterIds: [],
});
const membership = (bookId: string, sentenceId: string, position: number, chapterId?: string): BookSentence => ({
  id: `${bookId}:${sentenceId}`, bookId, sentenceId, position, chapterId, status: 'unstarted', addedAt: now,
});

async function seedChapter() {
  const db = getDb();
  const target = sentence('target', '本を読みます。');
  const distant = sentence('distant', '昨日は読んだ。');
  distant.vocabularySuggestions = [{
    id: 'suggestion', expression: '読む', surface: '読んだ', start: 3, end: 6,
    reading: 'よんだ', pos: 'verb', source: 'morphology', selectedByDefault: true,
  }];
  const rows = [sentence('first', '最初の文。'), ...Array.from({ length: 5 }, (_, i) => sentence(`middle-${i}`)), target, distant];
  await db.books.add(book('original'));
  await db.sentences.bulkAdd([...rows, sentence('other', '別の章。')]);
  await db.bookSentences.bulkAdd([
    ...rows.map((row, index) => membership('original', row.id, index, 'episode-1')),
    membership('original', 'other', 99, 'episode-2'),
  ]);
  return target;
}

describe('chapter review documents', () => {
  beforeEach(() => resetDbForTests(`review-document-${crypto.randomUUID()}`));

  it('loads the entire target chapter in order without requiring study data', async () => {
    await seedChapter();
    const document = await getReviewDocument('target');
    expect(document?.rows.map((row) => row.sentence.id)).toEqual([
      'first', 'middle-0', 'middle-1', 'middle-2', 'middle-3', 'middle-4', 'target', 'distant',
    ]);
    expect(document?.chapterTitle).toBe('読む話');
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('honors the selected source identity even when another containing book was opened later', async () => {
    await seedChapter();
    const db = getDb();
    await db.books.add(book('recent', '2026-10-01T00:00:00.000Z'));
    await db.bookSentences.add(membership('recent', 'target', 0));
    expect((await getReviewDocument('target'))?.bookId).toBe('recent');
    expect((await getReviewDocument('target', 'original'))?.bookId).toBe('original');
    expect((await getReviewDocument('target', 'not-a-member'))?.bookId).toBe('recent');
  });

  it('keeps unassigned text out of episode chapters and handles missing sources', async () => {
    await seedChapter();
    await getDb().bookSentences.put(membership('original', 'target', 101));
    expect((await getReviewDocument('target'))?.rows.map((row) => row.sentence.id)).toEqual(['target']);
    expect((await getReviewDocument('target'))?.chapterTitle).toBe('Unassigned sentences');
    await getDb().books.delete('original');
    expect(await getReviewDocument('target')).toBeNull();
    expect(await getReviewDocument('missing')).toBeNull();
  });

  it('masks cloze answers in distant sentences, inflections and titles, without ruby/gloss leakage', async () => {
    const target = await seedChapter();
    const props = {
      sentence: target, bookId: 'original', target: uniqueReviewSpan(target.japanese, '読みます'),
      cloze: { vocabularyItemId: 'vocab', expression: '読む', surface: '読みます' },
    };
    const { rerender } = render(<ReviewDocumentText {...props} revealed={false} />);
    await screen.findByText('_____話');
    const source = screen.getByRole('region', { name: 'Chapter text' });
    expect(within(source).getByText('最初の文。')).toBeInTheDocument();
    expect(within(source).getByText('昨日は_____。')).toBeInTheDocument();
    expect(source.textContent).not.toContain('読みます');
    expect(source.textContent).not.toContain('読んだ');
    expect(source.querySelector('ruby')).toBeNull();
    expect(screen.queryByText('hidden reading')).not.toBeInTheDocument();
    expect(screen.queryByText('hidden translation')).not.toBeInTheDocument();
    expect(screen.queryByText('別の章。')).not.toBeInTheDocument();
    rerender(<ReviewDocumentText {...props} revealed />);
    expect(within(source).getByText('読みます')).toBeInTheDocument();
    expect(within(source).getByText('昨日は読んだ。')).toBeInTheDocument();
  });

  it('never displays the previous document while a different card loads', async () => {
    const target = await seedChapter();
    const { rerender } = render(<ReviewDocumentText sentence={target} revealed />);
    await screen.findByText('最初の文。');
    const orphan = sentence('orphan', '新しい問題。');
    rerender(<ReviewDocumentText sentence={orphan} revealed={false} />);
    expect(screen.queryByText('最初の文。')).not.toBeInTheDocument();
    expect(screen.getByText('新しい問題。')).toBeInTheDocument();
    await screen.findByText('Full source unavailable; showing this sentence.');
  });

  it('uses manual linked surface forms as additional cloze masks', async () => {
    await seedChapter();
    await getDb().sentenceVocabulary.add({
      id: 'link', sentenceId: 'distant', vocabularyItemId: 'vocab', surfaceForm: '読んだ',
      createdAt: now, updatedAt: now,
    });
    expect((await getReviewDocument('target', 'original', 'vocab'))?.vocabularyForms).toEqual(['読んだ']);
  });
});

describe('review text masking', () => {
  it('merges overlapping literal aliases, conceals repetitions, and accepts regex characters literally', () => {
    expect(maskReviewText('読みます、読む、読みます。', ['読', '読む', '読みます', ''])).toBe('_____、_____、_____。');
    expect(maskReviewText('a+b と a+b', ['a+b'])).toBe('_____ と _____');
    expect(maskReviewText('これは本。', [])).toBe('これは本。');
  });

  it('does not invent a unique occurrence for repeated or absent text', () => {
    expect(uniqueReviewSpan('本と本', '本')).toBeUndefined();
    expect(uniqueReviewSpan('本', '読む')).toBeUndefined();
    expect(uniqueReviewSpan('本を読む', '読む')).toEqual({ start: 2, end: 4 });
  });
});
