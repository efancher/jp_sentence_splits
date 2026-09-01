import { describe, expect, it } from 'vitest';

import type { Book, BookSentence, Sentence } from '../src/domain/types';
import { buildReadingContextMap } from '../src/lib/readingContext';

function sentence(id: string): Sentence {
  return {
    id,
    normalizedKey: id,
    japanese: `${id}文`,
    readingOnly: '',
    inlineReading: '',
    translation: `${id} translation`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function book(id: string, lastOpenedAt?: string): Book {
  return {
    id,
    title: `Book ${id}`,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt,
    chapters: [],
    collapsedChapterIds: [],
  };
}

function membership(bookId: string, sentenceId: string, position: number): BookSentence {
  return {
    id: `${bookId}:${sentenceId}`,
    bookId,
    sentenceId,
    position,
    status: 'unstarted',
    addedAt: '2026-01-01T00:00:00.000Z',
  };
}

const sentences = ['s1', 's2', 's3', 's4', 's5'].map(sentence);
const sentencesById = new Map(sentences.map((item) => [item.id, item]));

describe('buildReadingContextMap', () => {
  it('returns the preceding and following sentences in reading order', () => {
    const map = buildReadingContextMap({
      targetSentenceIds: ['s3'],
      bookSentences: sentences.map((item, index) => membership('b1', item.id, index)),
      books: [book('b1')],
      sentencesById,
    });
    const context = map.get('s3')!;
    expect(context.before.map((item) => item.id)).toEqual(['s1', 's2']);
    expect(context.after.map((item) => item.id)).toEqual(['s4']);
    expect(context.bookTitle).toBe('Book b1');
  });

  it('clamps at the start of the book', () => {
    const map = buildReadingContextMap({
      targetSentenceIds: ['s1'],
      bookSentences: sentences.map((item, index) => membership('b1', item.id, index)),
      books: [book('b1')],
      sentencesById,
    });
    const context = map.get('s1')!;
    expect(context.before).toEqual([]);
    expect(context.after.map((item) => item.id)).toEqual(['s2']);
  });

  it('respects the before/after window sizes', () => {
    const map = buildReadingContextMap({
      targetSentenceIds: ['s3'],
      bookSentences: sentences.map((item, index) => membership('b1', item.id, index)),
      books: [book('b1')],
      sentencesById,
      before: 1,
      after: 2,
    });
    const context = map.get('s3')!;
    expect(context.before.map((item) => item.id)).toEqual(['s2']);
    expect(context.after.map((item) => item.id)).toEqual(['s4', 's5']);
  });

  it('picks the most recently opened book when a sentence is in several', () => {
    const map = buildReadingContextMap({
      targetSentenceIds: ['s2'],
      bookSentences: [
        membership('b1', 's1', 0),
        membership('b1', 's2', 1),
        membership('b1', 's3', 2),
        membership('b2', 's2', 0),
        membership('b2', 's5', 1),
      ],
      books: [
        book('b1', '2026-02-01T00:00:00.000Z'),
        book('b2', '2026-03-01T00:00:00.000Z'),
      ],
      sentencesById,
    });
    const context = map.get('s2')!;
    expect(context.bookTitle).toBe('Book b2');
    expect(context.before).toEqual([]);
    expect(context.after.map((item) => item.id)).toEqual(['s5']);
  });

  it('returns an empty context for a sentence with no book membership', () => {
    const map = buildReadingContextMap({
      targetSentenceIds: ['s3'],
      bookSentences: [],
      books: [],
      sentencesById,
    });
    expect(map.get('s3')).toEqual({ before: [], after: [] });
  });
});
