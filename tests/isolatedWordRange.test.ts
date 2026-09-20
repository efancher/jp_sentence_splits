import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import { isolatedWordRange, isolatedWordSpans } from '../src/lib/isolatedWordRange';

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

  it('returns null when an <unk> token precedes the target', () => {
    // 私は怖がってたり本を読む — aligner couldn't lex 怖がってたり, emitted <unk>.
    const withUnk: WordAlignment[] = [
      word('私', 0, 0.5),
      word('は', 0.5, 0.8),
      word('<unk>', 0.8, 1.7),
      word('本', 1.7, 2.3),
      word('を', 2.3, 2.5),
      word('読む', 2.5, 3.3),
    ];
    expect(isolatedWordRange(withUnk, '私は怖がってたり本を読む', '本')).toBeNull();
  });

  it('tolerates a zero-duration <unk> (no airtime stolen from the map)', () => {
    const withEmptyUnk: WordAlignment[] = [
      word('<unk>', 0, 0),
      word('私', 0, 0.5),
      word('は', 0.5, 0.8),
      word('本', 0.8, 1.4),
      word('を', 1.4, 1.6),
      word('読む', 1.6, 2.4),
    ];
    expect(isolatedWordRange(withEmptyUnk, japanese, '本')).toEqual({ startMs: 740, endMs: 1720 });
  });

  it('ignores an <unk> that falls entirely after the target', () => {
    const trailingUnk: WordAlignment[] = [
      word('本', 0, 0.6),
      word('を', 0.6, 0.8),
      word('<unk>', 0.8, 1.6),
    ];
    expect(isolatedWordRange(trailingUnk, '本を読む', '本')).toEqual({ startMs: 0, endMs: 920 });
  });

  it('does not fold in a following word longer than a case particle', () => {
    const trailing: WordAlignment[] = [word('本', 0, 0.6), word('について', 0.6, 1.4)];
    // について (4 chars) is left out; range ends at 本's own end + 120ms.
    expect(isolatedWordRange(trailing, '本について', '本')).toEqual({ startMs: 0, endMs: 720 });
  });
});

describe('isolatedWordRange with punctuation in the sentence', () => {
  // The aligner's tokens carry no 、。 — their text concatenates to the
  // punctuation-stripped sentence. Measuring against the raw string used to
  // shift the window onto the previous token.
  it('lands on the target token, not the one before it, after several commas', () => {
    const japanese = 'はい、はい、はい、はい、本は、ね。';
    const words: WordAlignment[] = [
      word('はい', 0, 0.3),
      word('はい', 0.3, 0.6),
      word('はい', 0.6, 0.9),
      word('はい', 0.9, 1.2),
      word('本', 1.2, 1.7),
      word('は', 1.7, 1.9),
      word('ね', 1.9, 2.2),
    ];
    // 本 = 1.2–1.7s; trailing は (≤2 chars) folded in → 1.9s. Pad -60/+120.
    expect(isolatedWordRange(words, japanese, '本')).toEqual({ startMs: 1140, endMs: 2020 });
    expect(isolatedWordSpans(words, japanese, '本')?.wordOnly).toEqual({
      startMs: 1140,
      endMs: 1820,
    });
  });

  it('handles a word inside quotes and a trailing full stop', () => {
    const japanese = '「ありがとうございます。」';
    const words: WordAlignment[] = [
      word('ありがとう', 0, 0.8),
      word('ござい', 0.8, 1.3),
      word('ます', 1.3, 1.7),
    ];
    expect(isolatedWordSpans(words, japanese, 'ござい')?.wordOnly).toEqual({
      startMs: 740,
      endMs: 1420,
    });
  });
});

describe('isolatedWordSpans', () => {
  const japanese = '私は本を読む';
  const words: WordAlignment[] = [
    word('私', 0, 0.5),
    word('は', 0.5, 0.8),
    word('本', 0.8, 1.4),
    word('を', 1.4, 1.6),
    word('読む', 1.6, 2.4),
  ];

  it('returns both the word-alone span and the particle-inclusive span', () => {
    expect(isolatedWordSpans(words, japanese, '本')).toEqual({
      wordOnly: { startMs: 740, endMs: 1520 },
      withParticle: { startMs: 740, endMs: 1720 },
    });
  });

  it('leaves withParticle null when nothing short follows', () => {
    const trailing: WordAlignment[] = [word('本', 0, 0.6), word('について', 0.6, 1.4)];
    expect(isolatedWordSpans(trailing, '本について', '本')).toEqual({
      wordOnly: { startMs: 0, endMs: 720 },
      withParticle: null,
    });
  });

  it('returns null when the word can’t be located', () => {
    expect(isolatedWordSpans(words, japanese, '猫')).toBeNull();
  });
});
