import { describe, expect, it } from 'vitest';

import { buildSentenceTokens } from '../src/components/KaraokeSentenceText';
import type { TargetVocabulary, VocabularySuggestion } from '../src/domain/types';

function suggestion(overrides: Partial<VocabularySuggestion>): VocabularySuggestion {
  return {
    id: 'sugg-1',
    surface: '',
    start: 0,
    end: 0,
    expression: '',
    reading: '',
    pos: '',
    source: 'morphology',
    selectedByDefault: true,
    ...overrides,
  };
}

function targetVocab(overrides: Partial<TargetVocabulary>): TargetVocabulary {
  return {
    expression: '',
    reading: '',
    english: '',
    furigana: '',
    partsOfSpeech: '',
    cardTypes: [],
    sourceCardIds: [],
    ...overrides,
  };
}

describe('buildSentenceTokens', () => {
  it('slices the sentence at the suggestion offsets and carries each suggestion english across', () => {
    const japanese = '本を読みます。';
    const suggestions = [
      suggestion({ surface: '本', start: 0, end: 1, english: 'book' }),
      suggestion({ surface: '読み', start: 2, end: 4, expression: '読む', english: 'read' }),
    ];

    expect(buildSentenceTokens(japanese, suggestions)).toEqual([
      { text: '本', start: 0, end: 1, gloss: 'book' },
      { text: 'を', start: 1, end: 2 },
      { text: '読み', start: 2, end: 4, gloss: 'read' },
      { text: 'ます。', start: 4, end: 7 },
    ]);
  });

  it('glosses a conjugated token from targetVocabulary matched by dictionary expression', () => {
    const japanese = '終わってる';
    const suggestions = [
      // Conjugated surface, no english (JMDict backfill declined the homophones).
      suggestion({ surface: '終わっ', start: 0, end: 3, expression: '終わる', reading: 'おわっ' }),
    ];
    const targetVocabulary = [targetVocab({ expression: '終わる', reading: 'おわる', english: 'to end' })];

    expect(buildSentenceTokens(japanese, suggestions, targetVocabulary)[0]).toEqual({
      text: '終わっ',
      start: 0,
      end: 3,
      gloss: 'to end',
    });
  });

  it('renders the whole sentence as one plain token when there are no suggestions', () => {
    expect(buildSentenceTokens('走る。', [])).toEqual([{ text: '走る。', start: 0, end: 3 }]);
  });

  it('skips a suggestion that overlaps one already emitted', () => {
    const japanese = 'ABCD';
    const suggestions = [
      suggestion({ surface: 'ABC', start: 0, end: 3, english: 'abc' }),
      suggestion({ surface: 'BC', start: 1, end: 3, english: 'bc' }),
      suggestion({ surface: 'D', start: 3, end: 4, english: 'd' }),
    ];

    expect(buildSentenceTokens(japanese, suggestions)).toEqual([
      { text: 'ABC', start: 0, end: 3, gloss: 'abc' },
      { text: 'D', start: 3, end: 4, gloss: 'd' },
    ]);
  });
});
