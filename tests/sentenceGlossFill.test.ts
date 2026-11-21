import { describe, expect, it } from 'vitest';

import type { VocabularySuggestion } from '../src/domain/types';
import { applyGlosses, suggestionsNeedingGloss } from '../src/lib/sentenceGlossFill';

function suggestion(expression: string, extra: Partial<VocabularySuggestion> = {}): VocabularySuggestion {
  return { id: `v-${expression}`, start: 0, end: 1, expression, reading: expression, selectedByDefault: true, ...extra } as VocabularySuggestion;
}

describe('sentence gloss fill', () => {
  it('asks only for content words with no gloss and no saved meaning', () => {
    const suggestions = [
      suggestion('実'),
      suggestion('は', { selectedByDefault: false }),
      suggestion('緑茶', { english: 'green tea' }),
      suggestion('いろいろ'),
      suggestion('実'),
    ];
    const needing = suggestionsNeedingGloss(suggestions, new Map([['いろいろ', 'various / diverse']]));
    expect(needing.map((item) => item.expression)).toEqual(['実']);
  });

  it('also asks for glosses on gloss-only conjunctions like だから', () => {
    const conjunction = suggestion('だから', {
      surface: 'だから', start: 0, end: 3, pos: '接続詞', source: 'morphology', selectedByDefault: false,
    });
    const particle = suggestion('は', {
      surface: 'は', start: 3, end: 4, pos: '助詞/係助詞', source: 'morphology', selectedByDefault: false,
    });
    expect(suggestionsNeedingGloss([conjunction, particle]).map((item) => item.expression)).toEqual(['だから']);
  });

  it('applies glosses only where none exist and leaves other suggestions identical', () => {
    const kept = suggestion('緑茶', { english: 'green tea' });
    const bare = suggestion('種類');
    const particle = suggestion('が', { selectedByDefault: false });
    const next = applyGlosses([kept, bare, particle], [
      { expression: '緑茶', meaning: 'something else' },
      { expression: '種類', meaning: ' type; kind ' },
      { expression: '存ずる', meaning: '' },
    ]);
    expect(next[0]).toBe(kept);
    expect(next[1]).toMatchObject({ expression: '種類', english: 'type; kind' });
    expect(next[2]).toBe(particle);
  });
});
