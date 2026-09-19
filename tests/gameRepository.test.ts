import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  ensureStudyItem,
  getDb,
  getOddEarOutData,
  getParticlePuzzleData,
  getPrecedingSentences,
  getWordDetectiveCandidates,
  logGameRound,
  recordReview,
} from '../src/db/repository';
import type { Sentence, SentenceVocabulary } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-09-19T00:00:00Z';

async function addSentence(id: string, japanese: string, overrides: Partial<Sentence> = {}) {
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

async function addLink(sentenceId: string, vocabularyItemId: string, surfaceForm?: string) {
  const link: SentenceVocabulary = {
    id: createId('sv'),
    sentenceId,
    vocabularyItemId,
    surfaceForm,
    createdAt: T,
    updatedAt: T,
  };
  await getDb().sentenceVocabulary.add(link);
}

async function addWord(id: string, expression: string, reading: string) {
  await getDb().vocabularyItems.add({
    id,
    expression,
    reading,
    meaning: 'm',
    createdAt: T,
    updatedAt: T,
  });
}

describe('game repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  it('returns only words met in 2+ confirmed sentences, with card stats', async () => {
    await addWord('vi-two', '猫', 'ねこ');
    await addWord('vi-one', '犬', 'いぬ');
    await addSentence('s1', '猫が寝る。');
    await addSentence('s2', '黒い猫だ。');
    await addSentence('s3', '犬が走る。');
    await addLink('s1', 'vi-two', '猫');
    await addLink('s2', 'vi-two', '猫');
    await addLink('s3', 'vi-one', '犬');

    const candidates = await getWordDetectiveCandidates();
    expect(candidates.map((c) => c.id)).toEqual(['vi-two']);
    expect(candidates[0]!.stats.hasCard).toBe(false);
  });

  it('reflects a real lapse in the stats without writing anything', async () => {
    await addWord('vi-two', '猫', 'ねこ');
    await addSentence('s1', '猫が寝る。');
    await addSentence('s2', '黒い猫だ。');
    await addLink('s1', 'vi-two', '猫');
    await addLink('s2', 'vi-two', '猫');
    const card = await ensureStudyItem('vocabularyItem', 'vi-two', 'reading_production');
    for (let i = 0; i < 3; i += 1) {
      await recordReview({
        studyItemId: card.id,
        rating: 'good',
        now: new Date(Date.now() + i * 30 * 24 * 60 * 60 * 1000),
      });
    }
    await recordReview({
      studyItemId: card.id,
      rating: 'again',
      now: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    });

    const reviewsBefore = await getDb().reviews.count();
    const studyItemsBefore = await getDb().studyItems.toArray();
    const [candidate] = await getWordDetectiveCandidates();
    expect(candidate!.stats.hasCard).toBe(true);
    expect(candidate!.stats.lapses).toBe(1);
    expect(await getDb().reviews.count()).toBe(reviewsBefore);
    expect(await getDb().studyItems.toArray()).toEqual(studyItemsBefore);
  });

  it('drops occurrences that only live in suspended books', async () => {
    await addWord('vi-two', '猫', 'ねこ');
    await addSentence('s1', '猫が寝る。');
    await addSentence('s2', '黒い猫だ。');
    await addLink('s1', 'vi-two', '猫');
    await addLink('s2', 'vi-two', '猫');
    const db = getDb();
    await db.books.bulkAdd([
      { id: 'b-active', title: 'a', createdAt: T, updatedAt: T },
      { id: 'b-susp', title: 's', createdAt: T, updatedAt: T, suspendedAt: T },
    ] as never);
    await db.bookSentences.bulkAdd([
      { id: 'm1', bookId: 'b-active', sentenceId: 's1', position: 0, status: 'unstarted', addedAt: T },
      { id: 'm2', bookId: 'b-susp', sentenceId: 's2', position: 0, status: 'unstarted', addedAt: T },
    ] as never);

    expect(await getWordDetectiveCandidates()).toEqual([]); // s2 suspended-only => only 1 usable sentence
  });

  it('logs a round append-only without touching study state', async () => {
    const round = await logGameRound({
      gameId: 'word-detective',
      signal: 'weak',
      poolSize: 7,
      items: [{ ref: 'vi-1', correct: true, cluesUsed: 1, wrongGuesses: 0, points: 4, ms: 5000 }],
    });
    const stored = await getDb().gameRounds.get(round.id);
    expect(stored?.items[0]?.points).toBe(4);
    expect(await getDb().studyItems.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(0);
  });
});

describe('particle puzzle repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  async function addParticleSentence(id: string, status: 'confirmed' | 'unreviewed') {
    const tokens = [
      { id: 'a', surface: 'が', start: 1, end: 2, expression: 'が', reading: 'が', pos: '助詞/格助詞', source: 'morphology', selectedByDefault: false },
      { id: 'b', surface: 'を', start: 3, end: 4, expression: 'を', reading: 'を', pos: '助詞/格助詞', source: 'morphology', selectedByDefault: false },
    ];
    await addSentence(id, '猫が魚を食べた。', { vocabularySuggestions: tokens as never });
    await getDb().analyses.put({
      sentenceId: id,
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 1,
      vocabularyReviewStatus: status,
      vocabularySelections: [],
      grammarReviewStatus: 'unreviewed',
      createdAt: T,
      updatedAt: T,
    } as never);
  }

  it('only offers sentences whose vocabulary is confirmed', async () => {
    await addParticleSentence('p-ok', 'confirmed');
    await addParticleSentence('p-no', 'unreviewed');
    const { candidates } = await getParticlePuzzleData();
    expect(candidates.map((c) => c.id)).toEqual(['p-ok']);
    expect(candidates[0]!.particles).toEqual(['が', 'を']);
    expect(candidates[0]!.stats.hasCard).toBe(false);
  });

  it('derives a miss focus and weak stats from logged rounds', async () => {
    await addParticleSentence('p-ok', 'confirmed');
    await logGameRound({
      gameId: 'particle-puzzle',
      signal: 'any',
      poolSize: 1,
      items: [
        {
          ref: 'p-ok',
          correct: false,
          cluesUsed: 0,
          wrongGuesses: 1,
          points: 1,
          ms: 100,
          parts: [
            { key: 'が', correct: false, note: 'は' },
            { key: 'を', correct: true },
          ],
        },
      ],
    });
    const { candidates, focus } = await getParticlePuzzleData();
    expect(focus).toEqual(new Map([['が', 1]]));
    expect(candidates[0]!.stats.lapses).toBe(1);
    expect(candidates[0]!.stats.hasCard).toBe(true);
  });

  it('returns preceding sentences in reading order from the home book', async () => {
    const db = getDb();
    await db.books.add({ id: 'b1', title: 'b', createdAt: T, updatedAt: T } as never);
    for (const [i, id] of ['c1', 'c2', 'c3'].entries()) {
      await addSentence(id, `文${id}`);
      await db.bookSentences.add({ id: `m-${id}`, bookId: 'b1', sentenceId: id, position: i, status: 'unstarted', addedAt: T } as never);
    }
    const context = await getPrecedingSentences(['c3', 'c1']);
    expect(context.get('c3')!.map((s) => s.id)).toEqual(['c1', 'c2']);
    expect(context.get('c1')).toEqual([]);
  });
});

describe('odd ear out repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  /** A confirmed, citation-form, pitch-carrying word with a clip in a book. */
  async function addPitchWord(
    id: string,
    reading: string,
    position: number,
    opts: { bookId?: string; withAudio?: boolean; manualSpan?: [number, number] | null; suspendedBook?: boolean } = {},
  ) {
    const { bookId = 'b1', withAudio = true, manualSpan = [100, 600], suspendedBook = false } = opts;
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
    const sid = `s-${id}`;
    await addSentence(sid, `これは語${id}です。`);
    await db.sentenceVocabulary.put({
      id: `l-${id}`,
      sentenceId: sid,
      vocabularyItemId: id,
      surfaceForm: `語${id}`,
      ...(manualSpan ? { audioStartMs: manualSpan[0], audioEndMs: manualSpan[1] } : {}),
      createdAt: T,
      updatedAt: T,
    } as never);
    if (!(await db.books.get(bookId))) {
      await db.books.put({ id: bookId, title: bookId, createdAt: T, updatedAt: T, ...(suspendedBook ? { suspendedAt: T } : {}) } as never);
    }
    await db.bookSentences.put({ id: `m-${id}`, bookId, sentenceId: sid, position: 0, status: 'unstarted', addedAt: T } as never);
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

  it('returns playable clips with their in-word shape and book, one per word per book', async () => {
    await addPitchWord('a', 'さくら', 0);
    await addPitchWord('b', 'いのち', 1);
    const { clips } = await getOddEarOutData();
    const byId = new Map(clips.map((c) => [c.vocabularyItemId, c]));
    expect(byId.get('a')).toMatchObject({ moraCount: 3, shape: 'lhh', bookId: 'b1', span: { startMs: 100, endMs: 600 } });
    expect(byId.get('b')).toMatchObject({ moraCount: 3, shape: 'hll' });
  });

  it('drops words that cannot be played: no audio, one mora, no isolatable span, implausible span', async () => {
    await addPitchWord('noaudio', 'さくら', 0, { withAudio: false });
    await addPitchWord('onemora', 'き', 0);
    await addPitchWord('nospan', 'ことば', 0, { manualSpan: null }); // no override, no alignment
    await addPitchWord('tiny', 'ひかり', 0, { manualSpan: [100, 150] });
    await addPitchWord('ok', 'こころ', 0);
    const { clips } = await getOddEarOutData();
    expect(clips.map((c) => c.vocabularyItemId)).toEqual(['ok']);
  });

  it('uses the cached forced alignment when there is no manual span, word-only (no particle)', async () => {
    await addPitchWord('al', 'ことば', 0, { manualSpan: null });
    const db = getDb();
    // 「これは語alです。」: three 3-char tokens, so the character-proportion mapping is exact.
    await db.referenceAlignments.put({
      id: 'a-al',
      alignmentVersion: 3,
      computedAt: T,
      result: {
        durationSeconds: 3,
        words: [
          { text: 'これは', start: 0, end: 1, phones: [] },
          { text: '語al', start: 1, end: 2, phones: [] },
          { text: 'です。', start: 2, end: 3, phones: [] },
        ],
      },
    });
    const { clips } = await getOddEarOutData();
    expect(clips).toHaveLength(1);
    // padded word-only span around 1.0–2.0s; must not extend into です
    expect(clips[0]!.span.startMs).toBeGreaterThanOrEqual(900);
    expect(clips[0]!.span.endMs).toBeLessThan(2400);
  });

  it('skips sentences that live only in suspended books', async () => {
    await addPitchWord('s1', 'さくら', 0, { bookId: 'shelved', suspendedBook: true });
    await addPitchWord('s2', 'いのち', 1);
    const { clips } = await getOddEarOutData();
    expect(clips.map((c) => c.vocabularyItemId)).toEqual(['s2']);
  });

  it('reads per-shape-pair history from logged rounds', async () => {
    await logGameRound({
      gameId: 'odd-ear-out',
      signal: 'any',
      poolSize: 3,
      items: [
        { ref: 't', correct: false, cluesUsed: 0, wrongGuesses: 1, points: 2, ms: 1, parts: [{ key: '3m hll/lhh', correct: false }] },
      ],
    });
    const { history } = await getOddEarOutData();
    expect(history.get('3m hll/lhh')).toEqual({ attempts: 1, misses: 1 });
  });
});
