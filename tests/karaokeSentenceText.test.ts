import { describe, expect, it } from 'vitest';

import {
  alignmentCharPositions,
  buildSentenceTokens,
} from '../src/components/KaraokeSentenceText';
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

describe('alignmentCharPositions', () => {
  it('resolves each aligner word to its character offset in the sentence, resyncing across a split', () => {
    const japanese = '本を読みますか';
    const words = [
      { start: 0, end: 0.4, text: '本を' },
      { start: 0.4, end: 0.6, text: '読み' }, // aligner split
      { start: 0.6, end: 0.8, text: 'ます' },
      { start: 0.8, end: 1, text: 'か' },
    ];

    expect(alignmentCharPositions(japanese, words)).toEqual([0, 2, 4, 6]);
  });

  it('maps <unk> to -1 and still places the following word past it', () => {
    const japanese = 'それより家どこ';
    const words = [
      { start: 0, end: 0.3, text: 'それより' },
      { start: 0.3, end: 0.5, text: '<unk>' }, // audio the aligner could not place (家)
      { start: 0.5, end: 0.8, text: 'どこ' },
    ];

    expect(alignmentCharPositions(japanese, words)).toEqual([0, -1, 5]);
  });
});
