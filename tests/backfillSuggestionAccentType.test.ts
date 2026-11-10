import { describe, expect, it } from 'vitest';

import type { VocabularySuggestion } from '../src/domain/types';
import { annotateAccentTypes } from '../scripts/backfill-suggestion-accent-type';

function sug(over: Partial<VocabularySuggestion>): VocabularySuggestion {
  return {
    id: 's',
    surface: '駅前',
    start: 0,
    end: 2,
    expression: '駅前',
    reading: 'えきまえ',
    pos: '名詞/普通名詞',
    source: 'morphology',
    selectedByDefault: true,
    ...over,
  };
}

describe('annotateAccentTypes', () => {
  it('adds a plain-integer accent for a matching span, keeping everything else', () => {
    const original = sug({});
    const next = annotateAccentTypes('駅前だ', [original], [
      { surface: '駅前', start: 0, end: 2, pos: '名詞/普通名詞', accentType: '0' },
    ]);
    expect(next).toEqual([{ ...original, accentType: 0 }]);
  });

  it('skips proper nouns, blank accents, mismatched spans and stamped suggestions', () => {
    const tokens = [{ surface: '駅前', start: 0, end: 2, pos: '名詞/固有名詞', accentType: '1' }];
    expect(annotateAccentTypes('駅前だ', [sug({})], tokens)).toBeNull();
    expect(annotateAccentTypes('駅前だ', [sug({})], [{ surface: '駅前', start: 0, end: 2, accentType: '' }])).toBeNull();
    expect(annotateAccentTypes('駅前だ', [sug({})], [{ surface: '駅前', start: 1, end: 3, accentType: '0' }])).toBeNull();
    expect(annotateAccentTypes('駅前だ', [sug({ accentType: 3 })], [{ surface: '駅前', start: 0, end: 2, accentType: '0' }])).toBeNull();
  });

  it('maps code-point offsets to UTF-16 after an astral character', () => {
    const next = annotateAccentTypes('𠮟る', [sug({ surface: 'る', start: 2, end: 3, expression: 'る' })], [
      { surface: 'る', start: 1, end: 2, accentType: '1' },
    ]);
    expect(next?.[0]?.accentType).toBe(1);
  });
});
