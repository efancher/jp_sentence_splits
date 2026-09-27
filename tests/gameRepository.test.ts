import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  ensureStudyItem,
  getDb,
  getEarTilesCandidates,
  getGamesProgress,
  getGrammarDetectiveCandidates,
  getKeystoneCandidates,
  getOddEarOutData,
  getParticlePuzzleData,
  getPrecedingSentences,
  getRecentGameDifficulty,
  getSpeakerMatchData,
  getThenAndNowData,
  getVerbLegoData,
  getWordDetectiveCandidates,
  logGameRound,
  recordReview,
} from '../src/db/repository';
import type { GrammarPattern, Sentence, SentenceGrammar, SentenceVocabulary } from '../src/domain/types';
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

  it('adaptive difficulty tracks a game\'s own last rounds only, not other games', async () => {
    expect(await getRecentGameDifficulty('word-detective')).toBe('standard');
    for (let i = 0; i < 3; i += 1) {
      await logGameRound({
        gameId: 'word-detective',
        signal: 'weak',
        poolSize: 5,
        items: [
          { ref: 'a', correct: true, cluesUsed: 0, wrongGuesses: 0, points: 4, ms: 100 },
          { ref: 'b', correct: true, cluesUsed: 0, wrongGuesses: 0, points: 4, ms: 100 },
        ],
      });
    }
    expect(await getRecentGameDifficulty('word-detective')).toBe('harder');
    expect(await getRecentGameDifficulty('particle-puzzle')).toBe('standard');
  });

  it('games progress reports accuracy by game/signal and a cued-vs-FSRS gap, writing nothing', async () => {
    await logGameRound({
      gameId: 'word-detective',
      signal: 'weak',
      poolSize: 5,
      items: [
        { ref: 'a', correct: true, cluesUsed: 0, wrongGuesses: 0, points: 4, ms: 100 },
        { ref: 'b', correct: false, cluesUsed: 1, wrongGuesses: 1, points: 0, ms: 100 },
      ],
    });
    const card = await ensureStudyItem('vocabularyItem', 'vi-x', 'reading_production');
    await recordReview({ studyItemId: card.id, rating: 'good' });
    await recordReview({ studyItemId: card.id, rating: 'again' });

    const progress = await getGamesProgress();
    expect(progress.hasData).toBe(true);
    expect(progress.byGame).toEqual([
      { gameId: 'word-detective', rounds: 1, items: 2, correct: 1, accuracy: 0.5 },
    ]);
    const weak = progress.bySignal.find((row) => row.signal === 'weak');
    expect(weak).toMatchObject({ items: 2, correct: 1, accuracy: 0.5 });
    expect(progress.cuedVsFsrs.fsrsPassRate).toBeCloseTo(0.5);
    expect(progress.cuedVsFsrs.gap).toBeCloseTo(0);
  });
});

async function addGrammarPattern(id: string, canonicalName: string, overrides: Partial<GrammarPattern> = {}) {
  await getDb().grammarPatterns.add({
    id,
    canonicalName,
    normalizedKey: canonicalName,
    aliases: [],
    shortMeaning: 'm',
    provenance: 'manual',
    createdAt: T,
    updatedAt: T,
    ...overrides,
  });
}

async function addGrammarLink(sentenceId: string, grammarPatternId: string, surfaceForm?: string) {
  const link: SentenceGrammar = {
    id: createId('sg'),
    sentenceId,
    grammarPatternId,
    surfaceForm,
    confirmedByLearner: true,
    source: 'manual',
    createdAt: T,
    updatedAt: T,
  };
  await getDb().sentenceGrammar.add(link);
}

describe('grammar detective repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  it('plays a pattern from a single tracked, translated sentence', async () => {
    await addGrammarPattern('gp-1', '〜わけがない');
    await addSentence('s1', '彼が犯人なわけがない。');
    await addGrammarLink('s1', 'gp-1', 'わけがない');

    const candidates = await getGrammarDetectiveCandidates();
    expect(candidates.map((c) => c.id)).toEqual(['gp-1']);
    expect(candidates[0]!.word.sentenceId).toBe('s1');
    expect(candidates[0]!.stats.hasCard).toBe(false);
  });

  it('drops a pattern whose only sentence has no translation', async () => {
    await addGrammarPattern('gp-1', '〜わけがない');
    await addSentence('s1', '彼が犯人なわけがない。', { translation: '' });
    await addGrammarLink('s1', 'gp-1', 'わけがない');

    expect(await getGrammarDetectiveCandidates()).toEqual([]);
  });

  it('reflects a real grammar_completion lapse in the stats without writing anything, and ignores other activity types', async () => {
    await addGrammarPattern('gp-1', '〜わけがない');
    await addSentence('s1', '彼が犯人なわけがない。');
    await addGrammarLink('s1', 'gp-1', 'わけがない');
    const completionCard = await ensureStudyItem('grammarPattern', 'gp-1', 'grammar_completion');
    for (let i = 0; i < 3; i += 1) {
      await recordReview({
        studyItemId: completionCard.id,
        rating: 'good',
        now: new Date(Date.now() + i * 30 * 24 * 60 * 60 * 1000),
      });
    }
    await recordReview({
      studyItemId: completionCard.id,
      rating: 'again',
      now: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    });
    const recognitionCard = await ensureStudyItem('grammarPattern', 'gp-1', 'grammar_recognition');
    for (let i = 0; i < 3; i += 1) {
      await recordReview({
        studyItemId: recognitionCard.id,
        rating: 'good',
        now: new Date(Date.now() + i * 30 * 24 * 60 * 60 * 1000),
      });
    }
    await recordReview({
      studyItemId: recognitionCard.id,
      rating: 'again',
      now: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    });
    await recordReview({
      studyItemId: recognitionCard.id,
      rating: 'again',
      now: new Date(Date.now() + 260 * 24 * 60 * 60 * 1000),
    });

    const studyItemsBefore = await getDb().studyItems.toArray();
    const [candidate] = await getGrammarDetectiveCandidates();
    expect(candidate!.stats.hasCard).toBe(true);
    expect(candidate!.stats.lapses).toBe(1); // only the grammar_completion lapse, not grammar_recognition's
    expect(await getDb().studyItems.toArray()).toEqual(studyItemsBefore);
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
    const { clips } = await getOddEarOutData();
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

  it('uses a hand-corrected wordOnlyStartMs/EndMs span in place of the aligner match', async () => {
    // The aligner would place 語fix at 1.0–1.6 s; the hand fix says 1.05–1.55 s.
    await addPitchWord('fix', 'さくら', 0, { wordOnlyOverride: [1050, 1550] });
    const { clips } = await getOddEarOutData();
    expect(clips).toHaveLength(1);
    expect(clips[0]!.span).toEqual({ startMs: 1050, endMs: 1550 });
  });

  it('plays a word-only correction even with no current alignment cached', async () => {
    await addPitchWord('fixnoaln', 'さくら', 0, { wordOnlyOverride: [1050, 1550], alignmentVersion: null });
    const { clips } = await getOddEarOutData();
    expect(clips.map((c) => c.vocabularyItemId)).toEqual(['fixnoaln']);
  });

  it('plays words in sentences with a digit+日/月 date — the aligner expands it, and the span mapping accounts for that', async () => {
    await addPitchWord('dated', 'さくら', 0, { lead: '16日は', leadToken: 'じゅうろくにちは' });
    await addPitchWord('fullwidth', 'いのち', 1, { lead: '１０月に', leadToken: 'じゅうがつに' });
    await addPitchWord('plain', 'こころ', 0);
    const { clips } = await getOddEarOutData();
    expect(clips.map((c) => c.vocabularyItemId).sort()).toEqual(['dated', 'fullwidth', 'plain']);
    // 語<id> sits at 1.0–1.6 s in every fixture; a mis-mapped date would shift the span.
    for (const clip of clips) expect(clip.span).toEqual({ startMs: 1000, endMs: 1600 });
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

describe('speaker match repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  /** One playable citation-form clip of `itemId` mined into `bookId`. */
  async function addSpeakerClip(
    itemId: string,
    bookId: string,
    opts: { withAudio?: boolean; wordOnlyOverride?: [number, number] } = {},
  ) {
    const { withAudio = true, wordOnlyOverride } = opts;
    const db = getDb();
    if (!(await db.vocabularyItems.get(itemId))) {
      await db.vocabularyItems.put({
        id: itemId,
        expression: '桜',
        reading: 'さくら',
        meaning: 'cherry blossom',
        pitchAccentPositions: [0],
        createdAt: T,
        updatedAt: T,
      } as never);
    }
    const sid = `s-${itemId}-${bookId}`;
    await addSentence(sid, 'これは桜です。');
    await db.sentenceVocabulary.put({
      id: `l-${itemId}-${bookId}`,
      sentenceId: sid,
      vocabularyItemId: itemId,
      surfaceForm: '桜',
      ...(wordOnlyOverride ? { wordOnlyStartMs: wordOnlyOverride[0], wordOnlyEndMs: wordOnlyOverride[1] } : {}),
      createdAt: T,
      updatedAt: T,
    } as never);
    if (!(await db.books.get(bookId))) {
      await db.books.put({ id: bookId, title: bookId, createdAt: T, updatedAt: T } as never);
    }
    await db.bookSentences.put({ id: `m-${sid}`, bookId, sentenceId: sid, position: 0, status: 'unstarted', addedAt: T } as never);
    await db.referenceAlignments.put({
      id: `a-${sid}`,
      alignmentVersion: 3,
      computedAt: T,
      result: {
        durationSeconds: 3,
        words: [
          { text: 'これは', start: 0, end: 1, phones: [] },
          { text: '桜', start: 1, end: 1.6, phones: [] },
          { text: 'です', start: 1.6, end: 3, phones: [] },
        ],
      },
    });
    if (withAudio) {
      await db.sentenceAudio.put({
        id: `a-${sid}`,
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

  it('pairs up a word only once mined into 2+ distinct books', async () => {
    await addSpeakerClip('vi-1', 'book-a');
    await addSpeakerClip('vi-1', 'book-b');
    await addSpeakerClip('vi-2', 'book-a'); // only one book — not eligible

    const { comparisons } = await getSpeakerMatchData();
    expect(comparisons.map((c) => c.word.vocabularyItemId)).toEqual(['vi-1']);
    expect(comparisons[0]!.clips).toHaveLength(2);
    expect(new Set(comparisons[0]!.clips.map((c) => c.bookId))).toEqual(new Set(['book-a', 'book-b']));
  });

  it('honours a wordOnlyStartMs/EndMs correction made from Odd Ear Out', async () => {
    await addSpeakerClip('vi-1', 'book-a', { wordOnlyOverride: [1050, 1550] });
    await addSpeakerClip('vi-1', 'book-b');
    const { comparisons } = await getSpeakerMatchData();
    const clip = comparisons[0]!.clips.find((c) => c.bookId === 'book-a')!;
    expect(clip.span).toEqual({ startMs: 1050, endMs: 1550 });
  });

  it('reads per-word history from logged rounds, writing nothing', async () => {
    await addSpeakerClip('vi-1', 'book-a');
    await addSpeakerClip('vi-1', 'book-b');
    await logGameRound({
      gameId: 'speaker-match',
      signal: 'weak',
      poolSize: 1,
      items: [{ ref: 'vi-1', correct: false, cluesUsed: 0, wrongGuesses: 1, points: 0, ms: 1, parts: [{ key: 'vi-1', correct: false }] }],
    });

    const studyItemsBefore = await getDb().studyItems.count();
    const { history } = await getSpeakerMatchData();
    expect(history.get('vi-1')).toEqual({ attempts: 1, misses: 1 });
    expect(await getDb().studyItems.count()).toBe(studyItemsBefore);
  });
});

describe('then and now repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  const NOW = new Date('2026-09-27T00:00:00Z');
  const OLD_REVIEW = new Date('2026-09-01T00:00:00Z'); // 26 days before NOW

  /** A reviewed sentence with a citation-form link, native audio and a current alignment. */
  async function addReviewedSentence(
    sentenceId: string,
    opts: { bookId?: string; suspendedBook?: boolean; reviewedAt?: Date; translation?: string } = {},
  ) {
    const { bookId = 'b1', suspendedBook = false, reviewedAt = OLD_REVIEW, translation = `tr ${sentenceId}` } = opts;
    const db = getDb();
    await addSentence(sentenceId, 'これは桜です。', { translation });
    const studyItem = await ensureStudyItem('sentence', sentenceId, 'cloze');
    await recordReview({ studyItemId: studyItem.id, rating: 'good', now: reviewedAt });
    if (!(await db.books.get(bookId))) {
      await db.books.put({ id: bookId, title: bookId, createdAt: T, updatedAt: T, ...(suspendedBook ? { suspendedAt: T } : {}) } as never);
    }
    await db.bookSentences.put({ id: `m-${sentenceId}`, bookId, sentenceId, position: 0, status: 'unstarted', addedAt: T } as never);
    await db.sentenceAudio.put({
      id: `a-${sentenceId}`,
      sentenceId,
      sourceId: 'src',
      sourceSentenceId: sentenceId,
      sourceTitle: 'src',
      mimeType: 'audio/mpeg',
      durationMs: 3000,
      startMs: 0,
      endMs: 3000,
      blob: new Blob(['x']),
      importedAt: T,
    });
    await db.referenceAlignments.put({
      id: `a-${sentenceId}`,
      alignmentVersion: 3,
      computedAt: T,
      result: {
        durationSeconds: 3,
        words: [
          { text: 'これは', start: 0, end: 1, phones: [] },
          { text: '桜', start: 1, end: 1.6, phones: [] },
          { text: 'です', start: 1.6, end: 3, phones: [] },
        ],
      },
    });
  }

  it('plays a clip whose word was confirmed after the sentence was first reviewed', async () => {
    await addReviewedSentence('s1');
    await addWord('vi-1', '桜', 'さくら');
    await getDb().vocabularyItems.update('vi-1', { createdAt: '2026-09-20T00:00:00Z' }); // after OLD_REVIEW
    await addLink('s1', 'vi-1', '桜');

    const clips = await getThenAndNowData({ now: NOW });
    expect(clips.map((c) => c.sentenceId)).toEqual(['s1']);
    expect(clips[0]!.thenUnknownWords).toEqual([
      { vocabularyItemId: 'vi-1', expression: '桜', startMs: 1000, endMs: 1600 },
    ]);
    expect(clips[0]!.audio.id).toBe('a-s1');
  });

  it('drops a sentence whose linked word was already confirmed before the review', async () => {
    await addReviewedSentence('s1');
    await addWord('vi-1', '桜', 'さくら');
    await getDb().vocabularyItems.update('vi-1', { createdAt: '2026-08-01T00:00:00Z' }); // before OLD_REVIEW
    await addLink('s1', 'vi-1', '桜');

    expect(await getThenAndNowData({ now: NOW })).toEqual([]);
  });

  it('drops a sentence reviewed too recently for "then" to mean anything', async () => {
    await addReviewedSentence('s1', { reviewedAt: new Date('2026-09-25T00:00:00Z') }); // 2 days before NOW
    await addWord('vi-1', '桜', 'さくら');
    await getDb().vocabularyItems.update('vi-1', { createdAt: '2026-09-26T00:00:00Z' });
    await addLink('s1', 'vi-1', '桜');

    expect(await getThenAndNowData({ now: NOW })).toEqual([]);
  });

  it('drops a sentence that lives only in a suspended book, writing nothing either way', async () => {
    await addReviewedSentence('s1', { bookId: 'shelved', suspendedBook: true });
    await addWord('vi-1', '桜', 'さくら');
    await getDb().vocabularyItems.update('vi-1', { createdAt: '2026-09-20T00:00:00Z' });
    await addLink('s1', 'vi-1', '桜');

    const reviewsBefore = await getDb().reviews.count();
    expect(await getThenAndNowData({ now: NOW })).toEqual([]);
    expect(await getDb().reviews.count()).toBe(reviewsBefore);
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

describe('ear tiles repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  const pieces: [string, string][] = [
    ['今日', '名詞/普通名詞/一般'],
    ['は', '助詞/係助詞'],
    ['友達', '名詞/普通名詞/一般'],
    ['と', '助詞/格助詞'],
    ['公園', '名詞/普通名詞/一般'],
    ['で', '助詞/格助詞'],
    ['遊び', '動詞/一般'],
    ['まし', '助動詞'],
    ['た', '助動詞'],
  ];

  async function addTilesSentence(
    id: string,
    status: 'confirmed' | 'unreviewed',
    options: { audio?: boolean; durationMs?: number } = {},
  ) {
    let cursor = 0;
    const tokens = pieces.map(([surface, pos], i) => {
      const token = {
        id: `${id}-t${i}`,
        surface,
        start: cursor,
        end: cursor + surface.length,
        expression: surface,
        reading: surface,
        pos,
        source: 'morphology',
        selectedByDefault: false,
      };
      cursor += surface.length;
      return token;
    });
    await addSentence(id, pieces.map(([surface]) => surface).join(''), {
      vocabularySuggestions: tokens as never,
    });
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
    if (options.audio !== false) {
      await getDb().sentenceAudio.add({
        id: `${id}-audio`,
        sentenceId: id,
        sourceId: 'src',
        sourceSentenceId: id,
        sourceTitle: 'Source',
        mimeType: 'audio/mpeg',
        durationMs: options.durationMs ?? 3000,
        startMs: 0,
        endMs: options.durationMs ?? 3000,
        blob: new Blob(['x']),
        importedAt: T,
      });
    }
  }

  it('offers only confirmed sentences that have native audio and a playable clip length', async () => {
    await addTilesSentence('ok', 'confirmed');
    await addTilesSentence('unconfirmed', 'unreviewed');
    await addTilesSentence('no-audio', 'confirmed', { audio: false });
    await addTilesSentence('long-clip', 'confirmed', { durationMs: 20_000 });
    const candidates = await getEarTilesCandidates();
    expect(candidates.map((c) => c.id)).toEqual(['ok']);
    expect(candidates[0]!.audio.id).toBe('ok-audio');
    expect(candidates[0]!.stats.hasCard).toBe(false);
  });

  it('takes its stats from the sentence\'s own words and names the lapsed ones, writing nothing', async () => {
    await addTilesSentence('ok', 'confirmed');
    await addWord('vi-park', '公園', 'こうえん');
    await addLink('ok', 'vi-park', '公園');
    const card = await ensureStudyItem('vocabularyItem', 'vi-park', 'reading_production');
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
    const [candidate] = await getEarTilesCandidates();
    expect(candidate!.stats.lapses).toBe(1);
    expect(candidate!.weakWords).toEqual(['公園']);
    expect(await getDb().reviews.count()).toBe(reviewsBefore);
  });

  it('skips sentences that live only in suspended books', async () => {
    await addTilesSentence('susp', 'confirmed');
    const db = getDb();
    await db.books.add({ id: 'b-susp', title: 's', createdAt: T, updatedAt: T, suspendedAt: T } as never);
    await db.bookSentences.add({
      id: 'm1',
      bookId: 'b-susp',
      sentenceId: 'susp',
      position: 0,
      status: 'unstarted',
      addedAt: T,
    } as never);
    expect(await getEarTilesCandidates()).toEqual([]);
  });
});

describe('keystone repository', () => {
  beforeEach(() => {
    resetDbForTests(`game-repo-${createId('db')}`);
  });

  async function addBook(id: string, overrides: Record<string, unknown> = {}) {
    await getDb().books.add({ id, title: id, createdAt: T, updatedAt: T, ...overrides } as never);
  }

  async function addMembership(
    id: string,
    bookId: string,
    sentenceId: string,
    position: number,
    status: 'unstarted' | 'complete' = 'unstarted',
    overrides: Record<string, unknown> = {},
  ) {
    await getDb().bookSentences.add({
      id,
      bookId,
      sentenceId,
      position,
      status,
      addedAt: T,
      ...overrides,
    } as never);
  }

  it('surfaces a confirmed, card-less word that appears in an upcoming sentence', async () => {
    await addWord('vi-park', '公園', 'こうえん');
    await addSentence('s1', '公園で遊ぶ。');
    await addLink('s1', 'vi-park', '公園');
    await addBook('b1');
    await addMembership('m1', 'b1', 's1', 0);

    const candidates = await getKeystoneCandidates();
    expect(candidates.map((c) => c.id)).toEqual(['vi-park']);
    expect(candidates[0]!.unlockedSentenceIds).toEqual(['s1']);
    expect(candidates[0]!.stats.hasCard).toBe(false);
  });

  it('counts every upcoming sentence a word appears in', async () => {
    await addWord('vi-park', '公園', 'こうえん');
    await addSentence('s1', '公園で遊ぶ。');
    await addSentence('s2', '公園は広い。');
    await addLink('s1', 'vi-park', '公園');
    await addLink('s2', 'vi-park', '公園');
    await addBook('b1');
    await addMembership('m1', 'b1', 's1', 0);
    await addMembership('m2', 'b1', 's2', 1);

    const [candidate] = await getKeystoneCandidates();
    expect(candidate!.unlockedSentenceIds.sort()).toEqual(['s1', 's2']);
  });

  it('excludes a word that already has a study item, even if still in the upcoming window', async () => {
    await addWord('vi-park', '公園', 'こうえん');
    await addSentence('s1', '公園で遊ぶ。');
    await addLink('s1', 'vi-park', '公園');
    await addBook('b1');
    await addMembership('m1', 'b1', 's1', 0);
    await ensureStudyItem('vocabularyItem', 'vi-park', 'reading_production');

    expect(await getKeystoneCandidates()).toEqual([]);
  });

  it('ignores sentences already started, not just unstarted ones', async () => {
    await addWord('vi-park', '公園', 'こうえん');
    await addSentence('s1', '公園で遊ぶ。');
    await addLink('s1', 'vi-park', '公園');
    await addBook('b1');
    await addMembership('m1', 'b1', 's1', 0, 'complete');

    expect(await getKeystoneCandidates()).toEqual([]);
  });

  it('skips a book that is suspended', async () => {
    await addWord('vi-park', '公園', 'こうえん');
    await addSentence('s1', '公園で遊ぶ。');
    await addLink('s1', 'vi-park', '公園');
    await addBook('b-susp', { suspendedAt: T });
    await addMembership('m1', 'b-susp', 's1', 0);

    expect(await getKeystoneCandidates()).toEqual([]);
  });

  it('ignores a link with no surfaceForm (not actually confirmed)', async () => {
    await addWord('vi-park', '公園', 'こうえん');
    await addSentence('s1', '公園で遊ぶ。');
    await addLink('s1', 'vi-park', undefined);
    await addBook('b1');
    await addMembership('m1', 'b1', 's1', 0);

    expect(await getKeystoneCandidates()).toEqual([]);
  });
});
