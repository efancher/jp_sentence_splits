import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import {
  alignerCharCount,
  alignerRangeToRawIndices,
  verifiedTokenCharRange,
  isolatedWordRange,
  isolatedWordSpans,
} from '../src/lib/isolatedWordRange';

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
    // 本: 0.8s start; trailing を folded in, ending 1.6s. Both sides butt against
    // another token (は before, 読む after), so neither gets any pad.
    expect(isolatedWordRange(words, japanese, '本')).toEqual({ startMs: 800, endMs: 1600 });
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
    expect(isolatedWordRange(withEmptyUnk, japanese, '本')).toEqual({ startMs: 800, endMs: 1600 });
  });

  it('ignores an <unk> that falls entirely after the target', () => {
    const trailingUnk: WordAlignment[] = [
      word('本', 0, 0.6),
      word('を', 0.6, 0.8),
      word('<unk>', 0.8, 1.6),
    ];
    expect(isolatedWordRange(trailingUnk, '本を読む', '本')).toEqual({ startMs: 0, endMs: 800 });
  });

  it('does not fold in a following word longer than a case particle', () => {
    const trailing: WordAlignment[] = [word('本', 0, 0.6), word('について', 0.6, 1.4)];
    // について (4 chars) is left out; range ends at 本's own end (no gap before it, so no pad).
    expect(isolatedWordRange(trailing, '本について', '本')).toEqual({ startMs: 0, endMs: 600 });
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
    // 本 = 1.2–1.7s; trailing は folded in → 1.9s. Tokens are adjacent both sides → no pad.
    expect(isolatedWordRange(words, japanese, '本')).toEqual({ startMs: 1200, endMs: 1900 });
    expect(isolatedWordSpans(words, japanese, '本')?.wordOnly).toEqual({
      startMs: 1200,
      endMs: 1700,
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
      startMs: 800,
      endMs: 1300,
    });
  });
});

describe('isolatedWordRange padding and degenerate spans', () => {
  it('pads a word only into the silence around it, never into a neighbouring token', () => {
    const words: WordAlignment[] = [
      word('小さい', 0.5, 1.0),
      word('場所', 1.0, 1.5), // butted against 小さい
      word('<eps>', 1.5, 2.0), // 500ms of silence after
      word('山', 2.0, 2.3),
    ];
    // 小さい: nothing before → full 30ms onset; 場所 follows immediately → no tail pad.
    expect(isolatedWordSpans(words, '小さい場所山', '小さい')?.wordOnly).toEqual({ startMs: 470, endMs: 1000 });
    // 場所: onset butted against 小さい → none; tail gets the full 60ms (silence after).
    expect(isolatedWordSpans(words, '小さい場所山', '場所')?.wordOnly).toEqual({ startMs: 1000, endMs: 1560 });
    // A short pause gives only as much pad as the pause allows (40ms < the 60ms ceiling).
    const shortPause: WordAlignment[] = [word('本', 0.5, 1.0), word('<eps>', 1.0, 1.04), word('山', 1.04, 1.4)];
    expect(isolatedWordSpans(shortPause, '本山', '本')?.wordOnly).toEqual({ startMs: 470, endMs: 1040 });
  });

  it('returns null when the aligner crushed the word to a few frames', () => {
    // 何 = 30ms in a real sentence (え、何あやまってるの？).
    const words: WordAlignment[] = [
      word('え', 0, 0.4),
      word('何', 0.51, 0.54),
      word('あやまって', 0.54, 1.3),
    ];
    expect(isolatedWordRange(words, 'え、何あやまって', '何')).toBeNull();
    expect(isolatedWordSpans(words, 'え、何あやまって', '何')).toBeNull();
  });
});

describe('isolatedWordRange with <unk> tokens after the target', () => {
  // 無心とは、怒りや恐れ、そして自分がよく… (real alignment shape): two <unk>
  // blobs later in the sentence used to rescale every position so 自分 mapped
  // onto the preceding そして.
  const japanese = 'そして自分がよくポッドキャストなど';
  const words: WordAlignment[] = [
    word('そして', 5.75, 6.62),
    word('<eps>', 6.62, 7.35),
    word('自分', 7.35, 7.96),
    word('が', 7.96, 8.15),
    word('よく', 8.15, 8.51),
    word('<unk>', 8.51, 9.54),
    word('など', 9.54, 10.0),
  ];

  it('locates the word by exact offset, unaffected by later <unk> tokens', () => {
    expect(isolatedWordSpans(words, japanese, '自分')?.wordOnly).toEqual({
      startMs: 7320, // 30ms onset pad: 0.73s of silence before 自分
      endMs: 7960, // が follows immediately → no tail pad
    });
  });
});

describe('isolatedWordRange with an aligner-expanded date', () => {
  // 16日は雨が降りました — the aligner rewrote 16日 to じゅうろくにち before aligning.
  const japanese = '16日は雨が降りました';
  const words: WordAlignment[] = [
    word('じゅう', 0.0, 0.3),
    word('ろくにち', 0.3, 0.9),
    word('は', 0.9, 1.0),
    word('雨', 1.0, 1.4),
    word('が', 1.4, 1.5),
    word('降りました', 1.5, 2.3),
  ];

  it('finds words after the date by exact offset in the expanded text', () => {
    expect(isolatedWordSpans(words, japanese, '雨')?.wordOnly).toEqual({ startMs: 1000, endMs: 1400 });
    expect(isolatedWordSpans(words, japanese, '降り')?.wordOnly).toEqual({ startMs: 1500, endMs: 2360 });
  });

  it('covers the whole expanded date when the surface form is the date or its 日', () => {
    expect(isolatedWordSpans(words, japanese, '16日')?.wordOnly.endMs).toBe(900);
    expect(isolatedWordSpans(words, japanese, '日')?.wordOnly.startMs).toBe(0);
  });
});

describe('isolatedWordRange particle folding', () => {
  // 生まれた時から、この小さい場所、山の中 — real alignment shape (sent_17d1bdde).
  const japanese = '生まれた時から、この小さい場所、山の中';
  const words: WordAlignment[] = [
    word('<eps>', 0, 0.98),
    word('生まれた', 0.98, 1.59),
    word('時', 1.59, 1.88),
    word('から', 1.88, 2.46),
    word('<eps>', 2.46, 2.61),
    word('この', 2.61, 2.84),
    word('小さい', 2.84, 3.46),
    word('場所', 3.46, 4.0),
    word('<eps>', 4.0, 4.47),
    word('山', 4.47, 4.79),
    word('の', 4.79, 4.96),
    word('中', 4.96, 5.38),
  ];

  it('does not fold a following noun in as if it were a particle', () => {
    // 生まれ → token 生まれた only; 時 is a noun.
    expect(isolatedWordSpans(words, japanese, '生まれ')).toEqual({
      wordOnly: { startMs: 950, endMs: 1590 },
      withParticle: null,
    });
    // 小さい followed by the noun 場所.
    expect(isolatedWordSpans(words, japanese, '小さい')?.withParticle).toBeNull();
  });

  it('does not fold a token that follows a pause (phrase boundary)', () => {
    // 場所 is followed by 0.47s of silence, then 山.
    expect(isolatedWordSpans(words, japanese, '場所')?.withParticle).toBeNull();
    // Full 60ms tail pad: 470ms of silence follows. Onset is butted against 小さい → none.
    expect(isolatedWordRange(words, japanese, '場所')).toEqual({ startMs: 3460, endMs: 4060 });
  });

  it('still folds a real particle, including the two-char から', () => {
    expect(isolatedWordSpans(words, japanese, '時')?.withParticle).toEqual({
      startMs: 1590,
      endMs: 2520,
    });
    expect(isolatedWordSpans(words, japanese, '山')?.withParticle).toEqual({
      startMs: 4440,
      endMs: 4960,
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
      wordOnly: { startMs: 800, endMs: 1400 },
      withParticle: { startMs: 800, endMs: 1600 },
    });
  });

  it('leaves withParticle null when nothing short follows', () => {
    const trailing: WordAlignment[] = [word('本', 0, 0.6), word('について', 0.6, 1.4)];
    expect(isolatedWordSpans(trailing, '本について', '本')).toEqual({
      wordOnly: { startMs: 0, endMs: 600 },
      withParticle: null,
    });
  });

  it('returns null when the word can’t be located', () => {
    expect(isolatedWordSpans(words, japanese, '猫')).toBeNull();
  });
});

describe('alignerRangeToRawIndices', () => {
  const japanese = 'はい、この本は。';

  it('counts only the characters the aligner keeps', () => {
    expect(alignerCharCount(japanese)).toBe(6);
  });

  it('maps a punctuation-free range back to raw indices, skipping punctuation', () => {
    // kept chars: は0 い1 こ3 の4 本5 は6 (raw indices) — 本 is kept #4.
    expect(alignerRangeToRawIndices(japanese, 4, 5)).toEqual({ start: 5, end: 6 });
    // A range spanning the comma includes it inside the highlight.
    expect(alignerRangeToRawIndices(japanese, 1, 3)).toEqual({ start: 1, end: 4 });
  });

  it('does not extend the end over trailing punctuation', () => {
    expect(alignerRangeToRawIndices(japanese, 5, 6)).toEqual({ start: 6, end: 7 });
  });
});

describe('verifiedTokenCharRange', () => {
  const japanese = 'そして、自分がよくポッド';
  const tokens = [{ text: 'そして' }, { text: '自分' }, { text: 'が' }, { text: 'よく' }, { text: '<unk>' }];

  it('gives exact aligner-character offsets, ignoring punctuation and later <unk>', () => {
    expect(verifiedTokenCharRange(tokens, japanese, 1)).toEqual({ start: 3, end: 5 });
    expect(verifiedTokenCharRange(tokens, japanese, 3)).toEqual({ start: 6, end: 8 });
  });

  it('returns null past a token that does not spell the sentence', () => {
    expect(verifiedTokenCharRange(tokens, japanese, 4)).toBeNull();
    expect(verifiedTokenCharRange(tokens, 'ぜんぜん違う文', 0)).toBeNull();
  });
});
