import { describe, expect, it } from 'vitest';

import { buildBookCoverage, coveragePercent } from '../src/lib/bookCoverage';

describe('buildBookCoverage', () => {
  it('returns null ratio for a book with no confirmed vocabulary yet', () => {
    const [result] = buildBookCoverage(
      [{ bookId: 'b1', sentenceIds: ['s1'] }],
      new Map(),
      new Set(),
    );
    expect(result).toEqual({ bookId: 'b1', knownCount: 0, totalCount: 0, ratio: null });
  });

  it('computes the ratio of distinct proficient vocabulary to distinct confirmed vocabulary', () => {
    const [result] = buildBookCoverage(
      [{ bookId: 'b1', sentenceIds: ['s1', 's2'] }],
      new Map([
        ['s1', ['v1', 'v2']],
        ['s2', ['v2', 'v3']],
      ]),
      new Set(['v1', 'v2']),
    );
    // distinct vocab across the book: v1, v2, v3 (3); proficient: v1, v2 (2)
    expect(result).toEqual({ bookId: 'b1', knownCount: 2, totalCount: 3, ratio: 2 / 3 });
  });

  it('does not double-count a word that recurs across multiple sentences in the same book', () => {
    const [result] = buildBookCoverage(
      [{ bookId: 'b1', sentenceIds: ['s1', 's2', 's3'] }],
      new Map([
        ['s1', ['v1']],
        ['s2', ['v1']],
        ['s3', ['v1']],
      ]),
      new Set(['v1']),
    );
    expect(result).toEqual({ bookId: 'b1', knownCount: 1, totalCount: 1, ratio: 1 });
  });

  it('scores every book independently, including one with zero sentences', () => {
    const results = buildBookCoverage(
      [
        { bookId: 'easy', sentenceIds: ['s1'] },
        { bookId: 'hard', sentenceIds: ['s2'] },
        { bookId: 'empty', sentenceIds: [] },
      ],
      new Map([
        ['s1', ['v1']],
        ['s2', ['v1', 'v2']],
      ]),
      new Set(['v1']),
    );
    expect(results).toEqual([
      { bookId: 'easy', knownCount: 1, totalCount: 1, ratio: 1 },
      { bookId: 'hard', knownCount: 1, totalCount: 2, ratio: 0.5 },
      { bookId: 'empty', knownCount: 0, totalCount: 0, ratio: null },
    ]);
  });

  it('handles a sentence with no vocabulary lookup entry (never confirmed) as contributing nothing', () => {
    const [result] = buildBookCoverage(
      [{ bookId: 'b1', sentenceIds: ['s1', 's2'] }],
      new Map([['s1', ['v1']]]),
      new Set(['v1']),
    );
    expect(result).toEqual({ bookId: 'b1', knownCount: 1, totalCount: 1, ratio: 1 });
  });
});

describe('coveragePercent', () => {
  it('rounds to a whole percent', () => {
    expect(coveragePercent({ ratio: 2 / 3 })).toBe(67);
  });

  it('passes null through for "not analyzed yet"', () => {
    expect(coveragePercent({ ratio: null })).toBe(null);
  });

  it('handles 0% and 100% exactly', () => {
    expect(coveragePercent({ ratio: 0 })).toBe(0);
    expect(coveragePercent({ ratio: 1 })).toBe(100);
  });
});
