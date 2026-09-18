import { describe, expect, it } from 'vitest';

import {
  buildMinimalPairTrials,
  findMinimalPairContrasts,
  type MinimalPairOccurrence,
  type MinimalPairWordSummary,
} from '../src/lib/pitchAccentMinimalPairs';

describe('findMinimalPairContrasts', () => {
  it('pairs same-reading words with different, audibly-distinct accent positions', () => {
    // はし, 2 morae: 箸 atamadaka (1), 橋 heiban (0) — different in-word shapes.
    const words: MinimalPairWordSummary[] = [
      { vocabularyItemId: 'hashi-chopsticks', reading: 'はし', position: 1 },
      { vocabularyItemId: 'hashi-bridge', reading: 'はし', position: 0 },
    ];
    const contrasts = findMinimalPairContrasts(words);
    expect(contrasts).toHaveLength(1);
    expect(contrasts[0]).toMatchObject({
      reading: 'はし',
      moraCount: 2,
      a: { vocabularyItemId: 'hashi-chopsticks' },
      b: { vocabularyItemId: 'hashi-bridge' },
    });
  });

  it('excludes heiban vs. odaka — identical shape within the word itself', () => {
    // 3 morae: heiban (0) and odaka (3) both render ['l','h','h'] — no
    // in-word audio distinguishes them, so this isn't a usable trial.
    const words: MinimalPairWordSummary[] = [
      { vocabularyItemId: 'heiban-word', reading: 'さくら', position: 0 },
      { vocabularyItemId: 'odaka-word', reading: 'さくら', position: 3 },
    ];
    expect(findMinimalPairContrasts(words)).toHaveLength(0);
  });

  it('ignores words with different readings entirely', () => {
    const words: MinimalPairWordSummary[] = [
      { vocabularyItemId: 'a', reading: 'はし', position: 1 },
      { vocabularyItemId: 'b', reading: 'あめ', position: 0 },
    ];
    expect(findMinimalPairContrasts(words)).toHaveLength(0);
  });

  it('dedupes a word listed twice under the same id', () => {
    const words: MinimalPairWordSummary[] = [
      { vocabularyItemId: 'a', reading: 'はし', position: 1 },
      { vocabularyItemId: 'a', reading: 'はし', position: 1 },
      { vocabularyItemId: 'b', reading: 'はし', position: 0 },
    ];
    expect(findMinimalPairContrasts(words)).toHaveLength(1);
  });
});

interface TestOccurrence extends MinimalPairOccurrence {
  id: string;
}

function occurrence(
  vocabularyItemId: string,
  reading: string,
  position: number,
  bookId: string,
  id: string,
): TestOccurrence {
  return { vocabularyItemId, reading, position, bookId, id };
}

describe('buildMinimalPairTrials', () => {
  const contrast = findMinimalPairContrasts([
    { vocabularyItemId: 'chopsticks', reading: 'はし', position: 1 },
    { vocabularyItemId: 'bridge', reading: 'はし', position: 0 },
  ])[0]!;

  it('builds a same-book trial when both words occur in one book', () => {
    const occurrences: TestOccurrence[] = [
      occurrence('chopsticks', 'はし', 1, 'book-a', 'occ-1'),
      occurrence('bridge', 'はし', 0, 'book-a', 'occ-2'),
    ];
    const trials = buildMinimalPairTrials([contrast], occurrences);
    expect(trials).toHaveLength(1);
    expect(trials[0]!.sameBook).toBe(true);
  });

  it('adds a cross-book trial when the corpus has one', () => {
    const occurrences: TestOccurrence[] = [
      occurrence('chopsticks', 'はし', 1, 'book-a', 'occ-1'),
      occurrence('bridge', 'はし', 0, 'book-a', 'occ-2'),
      occurrence('bridge', 'はし', 0, 'book-b', 'occ-3'),
    ];
    const trials = buildMinimalPairTrials([contrast], occurrences);
    expect(trials).toHaveLength(2);
    expect(trials.map((t) => t.sameBook).sort()).toEqual([false, true]);
  });

  it('skips a contrast with no audio for one of its two words', () => {
    const occurrences: TestOccurrence[] = [occurrence('chopsticks', 'はし', 1, 'book-a', 'occ-1')];
    expect(buildMinimalPairTrials([contrast], occurrences)).toHaveLength(0);
  });

  it('caps the total number of trials at maxTrials', () => {
    const contrasts = findMinimalPairContrasts([
      { vocabularyItemId: 'a1', reading: 'あめ', position: 1 },
      { vocabularyItemId: 'a2', reading: 'あめ', position: 0 },
      { vocabularyItemId: 'b1', reading: 'かみ', position: 1 },
      { vocabularyItemId: 'b2', reading: 'かみ', position: 0 },
      { vocabularyItemId: 'c1', reading: 'かき', position: 1 },
      { vocabularyItemId: 'c2', reading: 'かき', position: 0 },
    ]);
    const occurrences: TestOccurrence[] = contrasts.flatMap((c, index) => [
      occurrence(c.a.vocabularyItemId, c.reading, c.a.position, 'book-a', `${index}-a1`),
      occurrence(c.b.vocabularyItemId, c.reading, c.b.position, 'book-a', `${index}-b1`),
      occurrence(c.b.vocabularyItemId, c.reading, c.b.position, 'book-b', `${index}-b2`),
    ]);
    const trials = buildMinimalPairTrials(contrasts, occurrences, 4);
    expect(trials).toHaveLength(4);
  });
});
