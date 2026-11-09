import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, suggestPhraseShadow } from '../src/db/repository';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { createId } from '../src/lib/ids';
import { chunkRanges, expandToPhrase, orderLinksByWeakness, orderSuggestedSurfaces, weakestChunkRange } from '../src/lib/phraseShadow';

const words = [
  { text: '猫', start: 0, end: 0.4 },
  { text: 'が', start: 0.4, end: 0.5 },
  { text: '寝て', start: 0.5, end: 1.0 },
  { text: 'います', start: 1.0, end: 1.6 },
  { text: 'よ', start: 1.6, end: 1.8 },
];

describe('expandToPhrase', () => {
  it('widens a short word span forward first, up to about a second', () => {
    // ...and takes the trailing よ with いません rather than stopping just before it.
    expect(expandToPhrase(words, { startMs: 500, endMs: 1000 }, 2000)).toEqual({ startMs: 500, endMs: 1800 });
  });

  it('takes in the preceding word when nothing follows, and stays inside the clip', () => {
    expect(expandToPhrase(words, { startMs: 1600, endMs: 1800 }, 1800)).toEqual({ startMs: 500, endMs: 1800 });
  });

  it('leaves a span that is already long enough alone', () => {
    expect(expandToPhrase(words, { startMs: 0, endMs: 1100 }, 2000)).toEqual({ startMs: 0, endMs: 1100 });
  });

  it('keeps a particle that directly follows the span, even when the span is long enough', () => {
    const w = [
      { text: '学校', start: 0, end: 1.2 },
      { text: 'だけ', start: 1.2, end: 1.5 },
      { text: '行く', start: 1.5, end: 2 },
    ];
    expect(expandToPhrase(w, { startMs: 0, endMs: 1200 }, 2000)).toEqual({ startMs: 0, endMs: 1500 });
  });

  it('does not pull in a particle that follows a pause', () => {
    const w = [
      { text: '学校', start: 0, end: 1.2 },
      { text: 'に', start: 1.6, end: 1.8 },
    ];
    expect(expandToPhrase(w, { startMs: 0, endMs: 1200 }, 2000)).toEqual({ startMs: 0, endMs: 1200 });
  });

  it('never starts on a particle', () => {
    const w = [
      { text: '猫', start: 0, end: 0.4 },
      { text: 'が', start: 0.4, end: 0.5 },
      { text: '寝て', start: 0.5, end: 1.6 },
    ];
    expect(expandToPhrase(w, { startMs: 400, endMs: 1600 }, 2000)).toEqual({ startMs: 0, endMs: 1600 });
  });

  it('never grows past the cap', () => {
    const slow = [
      { text: 'あ', start: 0, end: 2.5 },
      { text: 'い', start: 2.5, end: 5 },
    ];
    expect(expandToPhrase(slow, { startMs: 0, endMs: 600 }, 5000)).toEqual({ startMs: 0, endMs: 600 });
  });
});

describe('chunkRanges', () => {
  it('hands a particle that follows a short gap back to the chunk of the word it belongs to', () => {
    const w = [
      { text: 'エピソード1', start: 0, end: 1.2 },
      { text: 'で', start: 1.4, end: 1.5 },
      { text: '私', start: 1.5, end: 1.9 },
      { text: 'は', start: 1.9, end: 2.0 },
      { text: '趣味', start: 2.4, end: 3.6 },
    ];
    // Not [0–1200] then [1400–2000]: で is エピソード1's particle, and 私は stays with what follows it.
    expect(chunkRanges(w)).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 2400, endMs: 3600 },
    ]);
  });
});

describe('orderSuggestedSurfaces', () => {
  const words = ['先週', '風邪', 'ポッドキャスト'].map((surface) => ({ surface, selectedByDefault: true }));
  const all = [...words, { surface: 'は', selectedByDefault: false }];
  const pass = (text: string, outcome: string, timestamp: string) => ({ text, outcome, timestamp });

  it('offers content words in sentence order, stably, and a tapped word on its own', () => {
    expect(orderSuggestedSurfaces(all, [])).toEqual(['先週', '風邪', 'ポッドキャスト']);
    expect(orderSuggestedSurfaces(all, [], '風邪')).toEqual(['風邪']);
  });

  it('puts never-shadowed words first, then not-Got-it, then Got-it', () => {
    const past = [pass('先週の', 'got_it', '2026-11-08'), pass('ポッドキャストなど', 'close', '2026-11-08')];
    expect(orderSuggestedSurfaces(all, past)).toEqual(['風邪', 'ポッドキャスト', '先週']);
  });

  it('judges a word by its latest pass only', () => {
    const past = [pass('先週の', 'got_it', '2026-11-07'), pass('先週の', 'needed_help', '2026-11-08'), pass('風邪を', 'got_it', '2026-11-08'), pass('ポッドキャスト', 'got_it', '2026-11-08')];
    expect(orderSuggestedSurfaces(all, past)[0]).toBe('先週');
  });

  it('cycles the least recently shadowed first once every word got it', () => {
    const past = [pass('先週', 'got_it', '2026-11-09'), pass('風邪', 'got_it', '2026-11-07'), pass('ポッドキャスト', 'got_it', '2026-11-08')];
    expect(orderSuggestedSurfaces(all, past)).toEqual(['風邪', 'ポッドキャスト', '先週']);
  });
});

describe('weakestChunkRange', () => {
  const sentence = '私は先週、風邪をひいてしまい、ポッドキャストなどをやすみました';
  const long = [
    { text: '私は', start: 0.2, end: 0.8 },
    { text: '先週', start: 0.8, end: 1.4 },
    { text: '風邪を', start: 1.7, end: 2.3 },
    { text: 'ひいて', start: 2.3, end: 3.0 },
    { text: 'しまい', start: 3.4, end: 4.0 },
    { text: 'ポッド', start: 4.3, end: 5.2 },
    { text: 'きゃすと', start: 5.2, end: 6.4 },
    { text: 'など', start: 6.4, end: 7.0 },
    { text: 'やすみました', start: 7.4, end: 9.0 },
  ];

  it('returns the chunk where the weakest word sits, not the whole clip', () => {
    const range = weakestChunkRange(long, sentence, ['ポッドキャスト'], 9500)!;
    expect(range.startMs).toBeLessThanOrEqual(4300);
    expect(range.endMs).toBeGreaterThanOrEqual(6400);
    expect(range.endMs - range.startMs).toBeLessThan(9500 * 0.9);
  });

  it('tries the next weakest word when one is not in the sentence text', () => {
    expect(weakestChunkRange(long, sentence, ['存在しない', '先週'], 9500)).toEqual(
      weakestChunkRange(long, sentence, ['先週'], 9500),
    );
  });

  it('falls back to a stable chunk that varies by sentence with no usable word', () => {
    const pick = (text: string) => weakestChunkRange(long, text, [], 9500)!.startMs;
    expect(pick(sentence)).toBe(pick(sentence));
    const starts = new Set(['あ', 'いう', 'えおか', 'きくけこ', 'さしすせそ', 'たちつてと', 'なにぬ'].map(pick));
    expect(starts.size).toBeGreaterThan(1);
  });

  it('returns null when the clip is already phrase-sized', () => {
    expect(weakestChunkRange([{ text: 'はい', start: 0, end: 0.5 }], 'はい', [], 520)).toBeNull();
  });
});

describe('orderLinksByWeakness', () => {
  it('puts the weakest word first, unknown words in the middle, ties in sentence order', () => {
    const links = [{ vocabularyItemId: 'a' }, { vocabularyItemId: 'b' }, { vocabularyItemId: 'c' }, { vocabularyItemId: 'd' }];
    const strengths = new Map([['a', 2], ['c', 0.2]]);
    expect(orderLinksByWeakness(links, strengths).map((l) => l.vocabularyItemId)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('suggestPhraseShadow', () => {
  beforeEach(() => {
    resetDbForTests(`phrase-suggest-${createId('db')}`);
  });

  async function seed(options: { aligned: boolean }) {
    const db = getDb();
    const stamp = new Date().toISOString();
    await db.sentences.put({
      id: 's1', normalizedKey: 's1', japanese: '猫が寝ていますよ', readingOnly: '', inlineReading: '', translation: 'x',
      targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
      importBatchIds: [], createdAt: stamp, updatedAt: stamp,
    });
    await db.vocabularyItems.put({ id: 'v-sleep', expression: '寝る', reading: 'ねる', createdAt: stamp, updatedAt: stamp } as never);
    await db.sentenceVocabulary.put({ id: 'sv1', sentenceId: 's1', vocabularyItemId: 'v-sleep', surfaceForm: '寝て' } as never);
    if (options.aligned) {
      await db.referenceAlignments.put({
        id: 'a1', alignmentVersion: ALIGNMENT_VERSION, computedAt: stamp,
        result: { durationSeconds: 1.8, words: words.map((w) => ({ ...w, phones: [] })) },
      });
    }
  }

  it('offers the weak word as a phrase with its aligned text', async () => {
    await seed({ aligned: true });
    const suggestion = await suggestPhraseShadow({ sentenceId: 's1', sentenceAudioId: 'a1', clipDurationMs: 2000 });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.wordLabel).toBe('寝る');
    expect(suggestion!.text).toContain('寝て');
    expect(suggestion!.endMs - suggestion!.startMs).toBeGreaterThanOrEqual(1000);
    expect(suggestion!.endMs - suggestion!.startMs).toBeLessThan(2000 * 0.9);
  });

  it('offers nothing without a current alignment', async () => {
    await seed({ aligned: false });
    expect(await suggestPhraseShadow({ sentenceId: 's1', sentenceAudioId: 'a1', clipDurationMs: 2000 })).toBeNull();
  });
});
