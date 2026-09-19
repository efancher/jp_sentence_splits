import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  ensureStudyItem,
  getDb,
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
