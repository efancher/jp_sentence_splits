import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, getPitchWordClips } from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { introduceWords } from './introduceWords';

const T = '2026-09-19T00:00:00Z';

/** Adds a sentence the learner has met (walked through), unless `introduced` is false. */
async function addSentence(id: string, japanese: string, overrides: Partial<Sentence> = {}, introduced = true) {
  if (introduced) await markWalked(id);
  await getDb().sentences.add({
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: `tr ${id}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: T,
    updatedAt: T,
    ...overrides,
  });
}

async function markWalked(sentenceId: string) {
  await getDb().sentenceLearningEvents.put({
    id: createId('sle'), visitId: 'v', sentenceId, action: 'walkthrough_completed', timestamp: T,
  } as never);
}

describe('getPitchWordClips', () => {
  beforeEach(async () => {
    await resetDbForTests(`pitch-word-clips-${createId('db')}`);
  });

  /**
   * A confirmed, citation-form, pitch-carrying word with a clip in a book. The
   * sentence is 「これは語<id>です。」 and its alignment has three tokens whose
   * lengths sum to the sentence's *without* the 。 (the real aligner drops
   * punctuation), so the character-proportion mapping is exact: 語<id> sits at
   * 1.0–1.6 s, です at 1.6–3.0 s.
   */
  async function addPitchWord(
    id: string,
    reading: string,
    position: number,
    opts: {
      bookId?: string;
      withAudio?: boolean;
      alignmentVersion?: number | null; // null = no cached alignment
      override?: [number, number];
      /** `SentenceVocabulary.wordOnlyStartMs/EndMs` — a hand-corrected strict span. */
      wordOnlyOverride?: [number, number];
      suspendedBook?: boolean;
      wordEnd?: number;
      /** Text before 語<id> — lets a test put a date in the sentence. */
      lead?: string;
      /** How the aligner spells `lead` (dates come back expanded to hiragana); defaults to `lead`. */
      leadToken?: string;
    } = {},
  ) {
    const {
      bookId = 'b1',
      withAudio = true,
      alignmentVersion = 3,
      override,
      wordOnlyOverride,
      suspendedBook = false,
      wordEnd = 1.6,
      lead = 'これは',
      leadToken = lead,
    } = opts;
    const db = getDb();
    await db.vocabularyItems.put({
      id,
      expression: `語${id}`,
      reading,
      meaning: 'm',
      pitchAccentPositions: [position],
      createdAt: T,
      updatedAt: T,
    } as never);
    await introduceWords([id]);
    const sid = `s-${id}`;
    await addSentence(sid, `${lead}語${id}です。`);
    await db.sentenceVocabulary.put({
      id: `l-${id}`,
      sentenceId: sid,
      vocabularyItemId: id,
      surfaceForm: `語${id}`,
      ...(override ? { audioStartMs: override[0], audioEndMs: override[1] } : {}),
      ...(wordOnlyOverride ? { wordOnlyStartMs: wordOnlyOverride[0], wordOnlyEndMs: wordOnlyOverride[1] } : {}),
      createdAt: T,
      updatedAt: T,
    } as never);
    if (!(await db.books.get(bookId))) {
      await db.books.put({ id: bookId, title: bookId, createdAt: T, updatedAt: T, ...(suspendedBook ? { suspendedAt: T } : {}) } as never);
    }
    await db.bookSentences.put({ id: `m-${id}`, bookId, sentenceId: sid, position: 0, status: 'unstarted', addedAt: T } as never);
    if (alignmentVersion !== null) {
      await db.referenceAlignments.put({
        id: `a-${id}`,
        alignmentVersion,
        computedAt: T,
        result: {
          durationSeconds: 3,
          words: [
            { text: leadToken, start: 0, end: 1, phones: [] },
            { text: `語${id}`, start: 1, end: wordEnd, phones: [] },
            { text: 'です', start: wordEnd, end: 3, phones: [] },
          ],
        },
      });
    }
    if (withAudio) {
      await db.sentenceAudio.put({
        id: `a-${id}`,
        sentenceId: sid,
        sourceId: 'src',
        sourceSentenceId: sid,
        sourceTitle: 'src',
        mimeType: 'audio/mpeg',
        durationMs: 3000,
        startMs: 0,
        endMs: 3000,
        blob: new Blob(['x']),
        importedAt: T,
      });
    }
  }

  it('returns playable clips with their in-word shape, book and word-only span', async () => {
    await addPitchWord('a', 'さくら', 0);
    await addPitchWord('b', 'いのち', 1);
    const { clips } = await getPitchWordClips();
    const byId = new Map(clips.map((c) => [c.vocabularyItemId, c]));
    expect(byId.get('a')).toMatchObject({ moraCount: 3, shape: 'lhh', bookId: 'b1' });
    expect(byId.get('b')).toMatchObject({ moraCount: 3, shape: 'hll' });
    // word-only around 1.0–1.6 s. Both edges butt against a neighbouring token, so no pad —
    // the span must not reach into です (from 1.6 s).
    const span = byId.get('a')!.span;
    expect(span).toEqual({ startMs: 1000, endMs: 1600 });
  });

  it('drops words that cannot be played: no audio, one mora, no/stale alignment, implausible span', async () => {
    await addPitchWord('noaudio', 'さくら', 0, { withAudio: false });
    await addPitchWord('onemora', 'き', 0);
    await addPitchWord('noaln', 'ことば', 0, { alignmentVersion: null });
    await addPitchWord('stale', 'ひかり', 0, { alignmentVersion: 1 }); // pre-bump cache is ignored, like every other consumer
    await addPitchWord('tiny', 'あした', 0, { wordEnd: 1.05 }); // 50 ms word → padded span under the minimum
    await addPitchWord('long', 'みどり', 1, { wordEnd: 5 }); // 4 s "word" → over the maximum
    await addPitchWord('ok', 'こころ', 0);
    const { clips } = await getPitchWordClips();
    expect(clips.map((c) => c.vocabularyItemId)).toEqual(['ok']);
  });

  it('ignores manual/backfilled ranges — they usually include the following particle', async () => {
    // Override runs to 2.2 s, i.e. through です。; the alignment's word-only end is 1.6 s.
    await addPitchWord('ovr', 'さくら', 0, { override: [900, 2200] });
    const { clips } = await getPitchWordClips();
    expect(clips).toHaveLength(1);
    expect(clips[0]!.span.endMs).toBeLessThan(1800);
    // …and a word with only an override (no current alignment) is not playable at all
    await addPitchWord('ovr-only', 'いのち', 1, { override: [900, 1700], alignmentVersion: null });
    expect((await getPitchWordClips()).clips.map((c) => c.vocabularyItemId)).toEqual(['ovr']);
  });

  it('uses a hand-corrected wordOnlyStartMs/EndMs span in place of the aligner match', async () => {
    // The aligner would place 語fix at 1.0–1.6 s; the hand fix says 1.05–1.55 s.
    await addPitchWord('fix', 'さくら', 0, { wordOnlyOverride: [1050, 1550] });
    const { clips } = await getPitchWordClips();
    expect(clips).toHaveLength(1);
    expect(clips[0]!.span).toEqual({ startMs: 1050, endMs: 1550 });
  });

  it('plays a word-only correction even with no current alignment cached', async () => {
    await addPitchWord('fixnoaln', 'さくら', 0, { wordOnlyOverride: [1050, 1550], alignmentVersion: null });
    const { clips } = await getPitchWordClips();
    expect(clips.map((c) => c.vocabularyItemId)).toEqual(['fixnoaln']);
  });

  it('plays words in sentences with a digit+日/月 date — the aligner expands it, and the span mapping accounts for that', async () => {
    await addPitchWord('dated', 'さくら', 0, { lead: '16日は', leadToken: 'じゅうろくにちは' });
    await addPitchWord('fullwidth', 'いのち', 1, { lead: '１０月に', leadToken: 'じゅうがつに' });
    await addPitchWord('plain', 'こころ', 0);
    const { clips } = await getPitchWordClips();
    expect(clips.map((c) => c.vocabularyItemId).sort()).toEqual(['dated', 'fullwidth', 'plain']);
    // 語<id> sits at 1.0–1.6 s in every fixture; a mis-mapped date would shift the span.
    for (const clip of clips) expect(clip.span).toEqual({ startMs: 1000, endMs: 1600 });
  });

  it('skips sentences that live only in suspended books', async () => {
    await addPitchWord('s1', 'さくら', 0, { bookId: 'shelved', suspendedBook: true });
    await addPitchWord('s2', 'いのち', 1);
    const { clips } = await getPitchWordClips();
    expect(clips.map((c) => c.vocabularyItemId)).toEqual(['s2']);
  });
});
