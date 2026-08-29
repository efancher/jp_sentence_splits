import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import { isolatedWordRange } from '../src/lib/isolatedWordRange';

const word = (text: string, start: number, end: number): WordAlignment => ({
  text,
  start,
  end,
  phones: [],
});

describe('isolatedWordRange', () => {
  // 私は本を読む — target 本 is char 2 of 6, i.e. [2/6, 3/6) of the sentence.
  const japanese = '私は本を読む';
  const words: WordAlignment[] = [
    word('私', 0, 0.5),
    word('は', 0.5, 0.8),
    word('本', 0.8, 1.4),
    word('を', 1.4, 1.6),
    word('読む', 1.6, 2.4),
  ];

  it('locates the target word, pads each side, and folds in a short following particle', () => {
    // 本: 0.8s−60ms start; trailing を (≤2 chars) folded in, 1.6s+120ms end.
    expect(isolatedWordRange(words, japanese, '本')).toEqual({ startMs: 740, endMs: 1720 });
  });

  it('returns null when the surface form is absent from the sentence', () => {
    expect(isolatedWordRange(words, japanese, '猫')).toBeNull();
  });

  it('returns null when there are no usable aligned words', () => {
    expect(
      isolatedWordRange([word('<unk>', 0, 1), word('<eps>', 1, 2)], japanese, '本'),
    ).toBeNull();
  });

  it('does not fold in a following word longer than a case particle', () => {
    const trailing: WordAlignment[] = [word('本', 0, 0.6), word('について', 0.6, 1.4)];
    // について (4 chars) is left out; range ends at 本's own end + 120ms.
    expect(isolatedWordRange(trailing, '本について', '本')).toEqual({ startMs: 0, endMs: 720 });
  });
});
