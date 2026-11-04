import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, suggestPhraseShadow } from '../src/db/repository';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { createId } from '../src/lib/ids';
import { expandToPhrase, orderLinksByWeakness } from '../src/lib/phraseShadow';

const words = [
  { text: '猫', start: 0, end: 0.4 },
  { text: 'が', start: 0.4, end: 0.5 },
  { text: '寝て', start: 0.5, end: 1.0 },
  { text: 'います', start: 1.0, end: 1.6 },
  { text: 'よ', start: 1.6, end: 1.8 },
];

describe('expandToPhrase', () => {
  it('widens a short word span forward first, up to about a second', () => {
    expect(expandToPhrase(words, { startMs: 500, endMs: 1000 }, 2000)).toEqual({ startMs: 500, endMs: 1600 });
  });

  it('takes in the preceding word when nothing follows, and stays inside the clip', () => {
    expect(expandToPhrase(words, { startMs: 1600, endMs: 1800 }, 1800)).toEqual({ startMs: 500, endMs: 1800 });
  });

  it('leaves a span that is already long enough alone', () => {
    expect(expandToPhrase(words, { startMs: 0, endMs: 1100 }, 2000)).toEqual({ startMs: 0, endMs: 1100 });
  });

  it('never grows past the cap', () => {
    const slow = [
      { text: 'あ', start: 0, end: 2.5 },
      { text: 'い', start: 2.5, end: 5 },
    ];
    expect(expandToPhrase(slow, { startMs: 0, endMs: 600 }, 5000)).toEqual({ startMs: 0, endMs: 600 });
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
