import { describe, expect, it } from 'vitest';

import { attachGlosses } from '../src/components/KaraokeSentenceText';
import type { VocabularySuggestion } from '../src/domain/types';

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

describe('attachGlosses', () => {
  it('attaches a gloss when an aligner word exactly matches a suggestion surface', () => {
    const words = [
      { text: '本を', start: 0, end: 0.6 },
      { text: '読みます', start: 0.6, end: 1.5 },
    ];
    const suggestions = [
      suggestion({ surface: '本を', english: 'book (object)' }),
      suggestion({ surface: '読みます', english: 'read' }),
    ];

    expect(attachGlosses(words, suggestions)).toEqual([
      { text: '本を', start: 0, end: 0.6, gloss: 'book (object)' },
      { text: '読みます', start: 0.6, end: 1.5, gloss: 'read' },
    ]);
  });

  it('leaves a word ungliossed when nothing matches within the lookahead window', () => {
    const words = [{ text: 'は', start: 0, end: 0.2 }];
    const suggestions = [suggestion({ surface: '本', english: 'book' })];

    expect(attachGlosses(words, suggestions)).toEqual([{ text: 'は', start: 0, end: 0.2 }]);
  });

  it('resyncs after a mismatch instead of matching out of order', () => {
    // Aligner splits "読みます" into two tokens the tokenizer treats as one;
    // the next real word ("か") should still find its match a few slots
    // later, not fail just because the previous slot didn't line up.
    const words = [
      { text: '読み', start: 0, end: 0.3 },
      { text: 'ます', start: 0.3, end: 0.6 },
      { text: 'か', start: 0.6, end: 0.8 },
    ];
    const suggestions = [
      suggestion({ surface: '読みます', english: 'read' }),
      suggestion({ surface: 'か', english: 'question particle' }),
    ];

    expect(attachGlosses(words, suggestions)).toEqual([
      { text: '読み', start: 0, end: 0.3 },
      { text: 'ます', start: 0.3, end: 0.6 },
      { text: 'か', start: 0.6, end: 0.8, gloss: 'question particle' },
    ]);
  });

  it('consumes a matched suggestion with no english so it does not get reused later', () => {
    const words = [
      { text: 'を', start: 0, end: 0.2 },
      { text: 'を', start: 0.2, end: 0.4 },
    ];
    const suggestions = [
      suggestion({ surface: 'を' }), // particle, no gloss
      suggestion({ surface: 'を', english: 'object marker' }),
    ];

    const result = attachGlosses(words, suggestions);
    expect(result[0]!.gloss).toBeUndefined();
    expect(result[1]!.gloss).toBe('object marker');
  });
});
