import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  ensureStudyItem,
  getDb,
  getOddEarOutData,
  getParticlePuzzleData,
  getPrecedingSentences,
  getVerbLegoData,
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

  /**
   * A confirmed, citation-form, pitch-carrying word with a clip in a book. The
   * sentence is 「これは語<id>です。」 and its alignment has three tokens whose
   * lengths sum to the sentence's, so the character-proportion mapping is
   * exact: 語<id> sits at 1.0–1.6 s, です。 at 1.6–3.0 s.
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
      suspendedBook?: boolean;
      wordEnd?: number;
      /** Text before 語<id> — lets a test put a date in the sentence. */
      lead?: string;
    } = {},
  ) {
    const { bookId = 'b1', withAudio = true, alignmentVersion = 3, override, suspendedBook = false, wordEnd = 1.6, lead = 'これは' } = opts;
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
    await addSentence(sid, `${lead}語${id}です。`);
    await db.sentenceVocabulary.put({
      id: `l-${id}`,
      sentenceId: sid,
      vocabularyItemId: id,
      surfaceForm: `語${id}`,
      ...(override ? { audioStartMs: override[0], audioEndMs: override[1] } : {}),
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
            { text: lead, start: 0, end: 1, phones: [] },
            { text: `語${id}`, start: 1, end: wordEnd, phones: [] },
            { text: 'です。', start: wordEnd, end: 3, phones: [] },
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
    const { clips } = await getOddEarOutData();
    const byId = new Map(clips.map((c) => [c.vocabularyItemId, c]));
    expect(byId.get('a')).toMatchObject({ moraCount: 3, shape: 'lhh', bookId: 'b1' });
    expect(byId.get('b')).toMatchObject({ moraCount: 3, shape: 'hll' });
    // word-only, padded ~60/120 ms around 1.0–1.6 s — and it must not reach into です。 (from 1.6 s + pad)
    const span = byId.get('a')!.span;
    expect(span.startMs).toBeGreaterThanOrEqual(900);
    expect(span.startMs).toBeLessThan(1000);
    expect(span.endMs).toBeLessThanOrEqual(1750);
  });

  it('drops words that cannot be played: no audio, one mora, no/stale alignment, implausible span', async () => {
    await addPitchWord('noaudio', 'さくら', 0, { withAudio: false });
    await addPitchWord('onemora', 'き', 0);
    await addPitchWord('noaln', 'ことば', 0, { alignmentVersion: null });
    await addPitchWord('stale', 'ひかり', 0, { alignmentVersion: 1 }); // pre-bump cache is ignored, like every other consumer
    await addPitchWord('tiny', 'あした', 0, { wordEnd: 1.05 }); // 50 ms word → padded span under the minimum
    await addPitchWord('long', 'みどり', 1, { wordEnd: 5 }); // 4 s "word" → over the maximum
    await addPitchWord('ok', 'こころ', 0);
    const { clips } = await getOddEarOutData();
    expect(clips.map((c) => c.vocabularyItemId)).toEqual(['ok']);
  });

  it('ignores manual/backfilled ranges — they usually include the following particle', async () => {
    // Override runs to 2.2 s, i.e. through です。; the alignment's word-only end is 1.6 s.
    await addPitchWord('ovr', 'さくら', 0, { override: [900, 2200] });
    const { clips } = await getOddEarOutData();
    expect(clips).toHaveLength(1);
    expect(clips[0]!.span.endMs).toBeLessThan(1800);
    // …and a word with only an override (no current alignment) is not playable at all
    await addPitchWord('ovr-only', 'いのち', 1, { override: [900, 1700], alignmentVersion: null });
    expect((await getOddEarOutData()).clips.map((c) => c.vocabularyItemId)).toEqual(['ovr']);
  });

  it('skips sentences containing a digit+日/月 date — the aligner expands them, skewing every word span', async () => {
    await addPitchWord('dated', 'さくら', 0, { lead: '16日は' });
    await addPitchWord('fullwidth', 'いのち', 1, { lead: '１０月に' });
    await addPitchWord('plain', 'こころ', 0);
    expect((await getOddEarOutData()).clips.map((c) => c.vocabularyItemId)).toEqual(['plain']);
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

describe('verb lego repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  /** 「事実の後、聞かれた。」 with real-style UniDic tokens (聞か[聞く] + れ[れる] + た[た]). */
  async function addChainSentence(id: string, status: 'confirmed' | 'unreviewed') {
    const japanese = '対策を聞かれた。';
    const start = japanese.indexOf('聞か');
    const tok = (surface: string, expression: string, pos: string, at: number, reading = expression) => ({
      id: `${id}-${at}`, surface, start: at, end: at + surface.length, expression, reading, pos, source: 'morphology', selectedByDefault: false,
    });
    await addSentence(id, japanese, {
      vocabularySuggestions: [
        tok('聞か', '聞く', '動詞/一般', start, 'きく'),
        tok('れ', 'れる', '助動詞', start + 2),
        tok('た', 'た', '助動詞', start + 3),
      ] as never,
    });
    await getDb().analyses.put({
      sentenceId: id, chunks: [], notes: '', status: 'empty', formatVersion: 1,
      vocabularyReviewStatus: status, vocabularySelections: [], grammarReviewStatus: 'unreviewed',
      createdAt: T, updatedAt: T,
    } as never);
  }

  async function addConfirmedVerb(id: string, expression: string, reading: string, partOfSpeech: string) {
    await getDb().vocabularyItems.put({ id, expression, reading, meaning: `to ${id}`, partOfSpeech, createdAt: T, updatedAt: T } as never);
    await addSentence(`s-${id}`, `${expression}。`);
    await addLink(`s-${id}`, id, expression);
  }

  it('reads real chains only from vocab-confirmed sentences', async () => {
    await addChainSentence('c-ok', 'confirmed');
    await addChainSentence('c-no', 'unreviewed');
    const { candidates } = await getVerbLegoData();
    const chains = candidates.flatMap((c) => c.chains).filter((c) => c.source === 'sentence');
    expect(chains.map((c) => c.sentenceId)).toEqual(['c-ok']);
    expect(chains[0]!.pieces.map((p) => p.text)).toEqual(['聞か', 'れ', 'た']);
  });

  it('builds chains only from confirmed verbs JMdict tags as godan/ichidan', async () => {
    await addConfirmedVerb('v-taberu', '食べる', 'たべる', 'v1; vt');
    await addConfirmedVerb('v-noun', '猫', 'ねこ', 'n');
    await addConfirmedVerb('v-untagged', '飲む', 'のむ', '');
    await addConfirmedVerb('v-aru', 'ある', 'ある', 'v5r-i; vi');
    const { candidates } = await getVerbLegoData();
    const built = candidates.flatMap((c) => c.chains).filter((c) => c.source === 'built');
    expect(new Set(built.map((c) => c.lemma))).toEqual(new Set(['食べる']));
    expect(built.map((c) => c.pieces.map((p) => p.text).join(''))).toContain('食べさせられなかった');
  });

  it('a verb that is not confirmed (no link with a surface form) is not built', async () => {
    await getDb().vocabularyItems.put({ id: 'v-x', expression: '読む', reading: 'よむ', meaning: 'm', partOfSpeech: 'v5m; vt', createdAt: T, updatedAt: T } as never);
    expect((await getVerbLegoData()).candidates).toEqual([]);
  });

  it('derives a miss focus and candidate stats from logged rounds', async () => {
    await addConfirmedVerb('v-taberu', '食べる', 'たべる', 'v1; vt');
    await logGameRound({
      gameId: 'verb-lego', signal: 'any', poolSize: 5,
      items: [{ ref: 'c', correct: false, cluesUsed: 0, wrongGuesses: 1, points: 2, ms: 1, parts: [{ key: 'させる|させ', correct: false }, { key: 'た|た', correct: true }] }],
    });
    const { candidates, focus } = await getVerbLegoData();
    expect(focus).toEqual(new Map([['させる|させ', 1]]));
    const hit = candidates.filter((c) => c.stats.lapses > 0);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((c) => c.chains[0]!.pieces.some((p) => p.key === 'させる|させ'))).toBe(true);
  });
});
