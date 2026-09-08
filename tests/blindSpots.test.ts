import { describe, expect, it } from 'vitest';

import {
  buildBlindSpots,
  vocabularyKey,
  type BlindSpotsInput,
} from '../src/lib/blindSpots';

function baseInput(overrides: Partial<BlindSpotsInput> = {}): BlindSpotsInput {
  return {
    sentences: [],
    bookIdsBySentenceId: new Map(),
    workedBookIds: new Set(),
    confirmedKeys: new Set(),
    grammar: [],
    ...overrides,
  };
}

describe('buildBlindSpots', () => {
  it('surfaces a contentful word recurring across worked-book sentences', () => {
    const result = buildBlindSpots(
      baseInput({
        sentences: [
          { id: 's1', suggestions: [{ expression: '面倒', reading: 'めんどう', contentful: true }] },
          { id: 's2', suggestions: [{ expression: '面倒', reading: 'めんどう', contentful: true }] },
        ],
        bookIdsBySentenceId: new Map([
          ['s1', ['b1']],
          ['s2', ['b1']],
        ]),
        workedBookIds: new Set(['b1']),
      }),
    );
    expect(result.vocab).toHaveLength(1);
    expect(result.vocab[0]).toMatchObject({
      expression: '面倒',
      reading: 'めんどう',
      sentenceCount: 2,
      bookCount: 1,
      exampleSentenceId: 's1',
      exampleBookId: 'b1',
    });
  });

  it('drops words seen only once (below the recurrence floor)', () => {
    const result = buildBlindSpots(
      baseInput({
        sentences: [
          { id: 's1', suggestions: [{ expression: '一回', reading: 'いっかい', contentful: true }] },
        ],
        bookIdsBySentenceId: new Map([['s1', ['b1']]]),
        workedBookIds: new Set(['b1']),
      }),
    );
    expect(result.vocab).toHaveLength(0);
  });

  it('excludes confirmed words and non-contentful tokens', () => {
    const result = buildBlindSpots(
      baseInput({
        sentences: [
          {
            id: 's1',
            suggestions: [
              { expression: '本', reading: 'ほん', contentful: true },
              { expression: 'を', reading: 'を', contentful: false },
            ],
          },
          {
            id: 's2',
            suggestions: [
              { expression: '本', reading: 'ほん', contentful: true },
              { expression: 'を', reading: 'を', contentful: false },
            ],
          },
        ],
        bookIdsBySentenceId: new Map([
          ['s1', ['b1']],
          ['s2', ['b1']],
        ]),
        workedBookIds: new Set(['b1']),
        confirmedKeys: new Set([vocabularyKey('本', 'ほん')]),
      }),
    );
    expect(result.vocab).toHaveLength(0);
  });

  it('ignores sentences whose only book is not worked', () => {
    const result = buildBlindSpots(
      baseInput({
        sentences: [
          { id: 's1', suggestions: [{ expression: '例', reading: 'れい', contentful: true }] },
          { id: 's2', suggestions: [{ expression: '例', reading: 'れい', contentful: true }] },
        ],
        bookIdsBySentenceId: new Map([
          ['s1', ['b-cold']],
          ['s2', ['b-cold']],
        ]),
        workedBookIds: new Set(['b-warm']),
      }),
    );
    expect(result.vocab).toHaveLength(0);
  });

  it('ranks by sentence reach then book reach', () => {
    const suggestion = (expression: string) => ({
      expression,
      reading: expression,
      contentful: true,
    });
    const result = buildBlindSpots(
      baseInput({
        sentences: [
          { id: 's1', suggestions: [suggestion('A'), suggestion('B')] },
          { id: 's2', suggestions: [suggestion('A'), suggestion('B')] },
          { id: 's3', suggestions: [suggestion('A')] },
        ],
        bookIdsBySentenceId: new Map([
          ['s1', ['b1']],
          ['s2', ['b1']],
          ['s3', ['b2']],
        ]),
        workedBookIds: new Set(['b1', 'b2']),
      }),
    );
    expect(result.vocab.map((word) => word.expression)).toEqual(['A', 'B']);
    expect(result.vocab[0]).toMatchObject({ sentenceCount: 3, bookCount: 2 });
  });

  it('reports the grammar worth-learning-now count and top names', () => {
    const result = buildBlindSpots(
      baseInput({
        grammar: [
          { name: '～わけがない', encounterCount: 5, worthLearningNow: true },
          { name: '～きり', encounterCount: 3, worthLearningNow: true },
          { name: '～ている', encounterCount: 40, worthLearningNow: false },
        ],
      }),
    );
    expect(result.grammar.worthLearningNowCount).toBe(2);
    expect(result.grammar.topNames).toEqual(['～わけがない', '～きり']);
  });
});
