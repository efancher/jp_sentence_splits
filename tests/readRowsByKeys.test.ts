import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, readRowsByKeys, readSentenceAudioForSentences } from '../src/db/repository';

async function seedBlock(count: number) {
  const now = new Date().toISOString();
  await getDb().sentenceVocabulary.bulkAdd(
    Array.from({ length: count }, (_, i) => ({
      id: `sv_${i}`,
      sentenceId: `sent_${i % 12}`,
      vocabularyItemId: `vocab_${i}`,
      surfaceForm: `w${i}`,
      createdAt: now,
      updatedAt: now,
    })) as never,
  );
}

describe('readRowsByKeys', () => {
  beforeEach(async () => {
    await resetDbForTests();
    await seedBlock(36);
  });

  it('returns every row for a few keys (indexed lookup)', async () => {
    const rows = await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', ['sent_0', 'sent_3']);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.sentenceId))).toEqual(new Set(['sent_0', 'sent_3']));
  });

  it('returns the same rows for many keys (single table read)', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `sent_${i}`);
    const rows = await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', keys);
    const expected = await getDb().sentenceVocabulary.where('sentenceId').anyOf(keys).toArray();
    expect(rows.map((row) => row.id).sort()).toEqual(expected.map((row) => row.id).sort());
    expect(rows).toHaveLength(30);
  });

  it('ignores keys with no rows and handles an empty key list', async () => {
    expect(await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', [])).toEqual([]);
    const keys = ['nope_1', 'nope_2', 'nope_3', 'nope_4', 'nope_5', 'nope_6', 'sent_11'];
    expect(await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', keys)).toHaveLength(3);
  });
});

describe('readSentenceAudioForSentences', () => {
  beforeEach(async () => {
    await resetDbForTests();
    const now = new Date().toISOString();
    // A large episode: 400 sentences, every third one with no clip and every fifth with two.
    const clips = [];
    for (let i = 0; i < 400; i++) {
      if (i % 3 === 0) continue;
      for (let copy = 0; copy < (i % 5 === 0 ? 2 : 1); copy++) {
        clips.push({
          id: `audio_${i}_${copy}`,
          sentenceId: `sent_${i}`,
          sourceId: `source-${copy}`,
          sourceSentenceId: `source-${copy}:${i}`,
          sourceTitle: 'Ep',
          mimeType: 'audio/mp4',
          durationMs: 3000,
          startMs: 0,
          endMs: 3000,
          blob: new Blob([`clip-${i}`], { type: 'audio/mp4' }),
          importedAt: now,
        });
      }
    }
    await getDb().sentenceAudio.bulkAdd(clips);
    // A clip for a sentence outside the episode must not come back.
    await getDb().sentenceAudio.add({ ...clips[0]!, id: 'audio_other', sentenceId: 'sent_elsewhere' });
  });

  it('matches the anyOf result for a few ids', async () => {
    const rows = await readSentenceAudioForSentences(['sent_1', 'sent_5', 'sent_3']);
    expect(rows.map((row) => row.id).sort()).toEqual(['audio_1_0', 'audio_5_0', 'audio_5_1']);
  });

  it('matches the anyOf result for a whole large episode, keeping every clip of a sentence', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `sent_${i}`);
    const rows = await readSentenceAudioForSentences(ids);
    const expected = await getDb().sentenceAudio.where('sentenceId').anyOf(ids).toArray();
    expect(rows.map((row) => row.id).sort()).toEqual(expected.map((row) => row.id).sort());
    expect(rows.some((row) => row.id === 'audio_other')).toBe(false);
    // Rows come back whole (blob field present), same shape as the anyOf read.
    expect(rows.every((row) => row.blob !== undefined)).toBe(true);
    expect(expected.every((row) => row.blob !== undefined)).toBe(true);
  });

  it('returns nothing for no ids', async () => {
    expect(await readSentenceAudioForSentences([])).toEqual([]);
  });
});
