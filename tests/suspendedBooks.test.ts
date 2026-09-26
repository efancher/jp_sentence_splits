import { describe, expect, it } from 'vitest';

import {
  isBookInStudyRotation,
  membershipIsShelved,
  sentenceIsSuspendedOnly,
  studyItemIsHeldBackBySuspension,
  vocabularyItemIsSuspendedOnly,
  type SuspendedBookIndex,
} from '../src/lib/suspendedBooks';

/**
 * Fixture: book A is suspended, book B is active, chapter C1 (in book B) is
 * individually suspended.
 *   s1 → [A]           (suspended-only, via book)
 *   s2 → [A, B]        (shared → stays active)
 *   s3 → []            (inbox sentence, no membership → not held back)
 *   s4 → [B/C1]        (suspended-only, via chapter — book B itself is active)
 *   s5 → [B/C1, B]     (same book, one chapter-suspended + one unassigned row → stays active)
 *   w1 → [s1]          (suspended-only)
 *   w2 → [s1, s2]      (shared → stays active)
 *   link L1 → s1, link L2 → s2
 */
const index: SuspendedBookIndex = {
  suspendedBookIds: new Set(['A']),
  suspendedChapterIds: new Set(['C1']),
  membershipsBySentenceId: new Map([
    ['s1', [{ bookId: 'A' }]],
    ['s2', [{ bookId: 'A' }, { bookId: 'B' }]],
    ['s4', [{ bookId: 'B', chapterId: 'C1' }]],
    ['s5', [{ bookId: 'B', chapterId: 'C1' }, { bookId: 'B' }]],
  ]),
  sentenceIdsByVocabularyItemId: new Map([
    ['w1', ['s1']],
    ['w2', ['s1', 's2']],
  ]),
  sentenceIdByLinkId: new Map([
    ['L1', 's1'],
    ['L2', 's2'],
  ]),
};

describe('isBookInStudyRotation', () => {
  it('excludes archived and suspended books', () => {
    expect(isBookInStudyRotation({ archived: false })).toBe(true);
    expect(isBookInStudyRotation({ archived: true })).toBe(false);
    expect(
      isBookInStudyRotation({ archived: false, suspendedAt: '2026-09-11T00:00:00Z' }),
    ).toBe(false);
  });
});

describe('membershipIsShelved', () => {
  it('shelves via the book flag', () => {
    expect(membershipIsShelved({ bookId: 'A' }, index)).toBe(true);
  });
  it('shelves via the chapter flag even when the book is active', () => {
    expect(membershipIsShelved({ bookId: 'B', chapterId: 'C1' }, index)).toBe(true);
  });
  it('keeps an active book/chapter combination', () => {
    expect(membershipIsShelved({ bookId: 'B' }, index)).toBe(false);
    expect(membershipIsShelved({ bookId: 'B', chapterId: 'C2' }, index)).toBe(false);
  });
});

describe('sentenceIsSuspendedOnly', () => {
  it('holds back a sentence only in suspended books', () => {
    expect(sentenceIsSuspendedOnly('s1', index)).toBe(true);
  });
  it('keeps a sentence shared with an active book', () => {
    expect(sentenceIsSuspendedOnly('s2', index)).toBe(false);
  });
  it('keeps a sentence with no book membership', () => {
    expect(sentenceIsSuspendedOnly('s3', index)).toBe(false);
  });
  it('holds back a sentence only in a suspended chapter', () => {
    expect(sentenceIsSuspendedOnly('s4', index)).toBe(true);
  });
  it('keeps a sentence with one shelved-chapter row and one active row in the same book', () => {
    expect(sentenceIsSuspendedOnly('s5', index)).toBe(false);
  });
});

describe('vocabularyItemIsSuspendedOnly', () => {
  it('holds back a word met only in suspended sentences', () => {
    expect(vocabularyItemIsSuspendedOnly('w1', index)).toBe(true);
  });
  it('keeps a word that also appears in an active sentence', () => {
    expect(vocabularyItemIsSuspendedOnly('w2', index)).toBe(false);
  });
  it('keeps a word with no sentence links', () => {
    expect(vocabularyItemIsSuspendedOnly('w-unknown', index)).toBe(false);
  });
});

describe('studyItemIsHeldBackBySuspension', () => {
  const held = (subjectType: string, subjectId: string) =>
    studyItemIsHeldBackBySuspension(
      { subjectType: subjectType as never, subjectId },
      index,
    );

  it('holds back sentence / vocabularyItem / sentenceVocabulary subjects that are suspended-only', () => {
    expect(held('sentence', 's1')).toBe(true);
    expect(held('vocabularyItem', 'w1')).toBe(true);
    expect(held('sentenceVocabulary', 'L1')).toBe(true);
  });

  it('does not hold back subjects shared with an active book', () => {
    expect(held('sentence', 's2')).toBe(false);
    expect(held('vocabularyItem', 'w2')).toBe(false);
    expect(held('sentenceVocabulary', 'L2')).toBe(false);
  });

  it('never holds back grammarPattern or chunk subjects', () => {
    expect(held('grammarPattern', 's1')).toBe(false);
    expect(held('chunk', 's1')).toBe(false);
    expect(held('vocabularyConfusion', 'w1')).toBe(false);
  });
});
