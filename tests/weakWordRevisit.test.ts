import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  createBook,
  ensureStudyItem,
  ensureVocabularyItem,
  getDb,
  getSessionPlannerInput,
  updateSettings,
} from '../src/db/repository';
import type { Review, Sentence, SentenceVocabulary } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { buildRecommendedSession } from '../src/lib/sessionPlanner';

function makeSentence(japanese: string): Sentence {
  const timestamp = new Date().toISOString();
  const id = createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: 'x',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('weak words bring walked-through sentences back for a walkthrough', () => {
  beforeEach(() => {
    resetDbForTests(`weak-revisit-${createId('db')}`);
  });

  async function walk(sentence: Sentence, bookId: string, daysAgo: number) {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'),
      sentenceId: sentence.id,
      bookId,
      action: 'walkthrough_completed',
      timestamp: new Date(Date.now() - daysAgo * DAY).toISOString(),
    } as never);
  }

  async function linkFailedWord(sentenceId: string, expression: string, reading: string) {
    const db = getDb();
    const word = await ensureVocabularyItem(expression, reading);
    await db.sentenceVocabulary.put({
      id: createId('sv'),
      sentenceId,
      vocabularyItemId: word.id,
      surfaceForm: expression,
    } as SentenceVocabulary);
    const item = await ensureStudyItem('vocabularyItem', word.id, 'reading_retrieval');
    for (let i = 0; i < 3; i += 1) {
      await db.reviews.put({
        id: createId('review'),
        studyItemId: item.id,
        timestamp: new Date().toISOString(),
        rating: 'again',
      } as Review);
    }
  }

  async function setup() {
    await updateSettings({ sentenceFirstPlanning: true });
    const book = await createBook({ title: 'Weak Revisit' });
    const db = getDb();
    const weak = makeSentence('怪我をしました。');
    const tooSoon = makeSentence('最近忙しいです。');
    const plain = makeSentence('今日は雨です。');
    const fresh = makeSentence('明日は晴れです。');
    await db.sentences.bulkPut([weak, tooSoon, plain, fresh]);
    await addSentencesToBook(book.id, [weak.id, tooSoon.id, plain.id, fresh.id]);
    await walk(weak, book.id, 4);
    await walk(tooSoon, book.id, 1);
    await walk(plain, book.id, 4);
    await linkFailedWord(weak.id, '怪我', 'けが');
    await linkFailedWord(tooSoon.id, '最近', 'さいきん');
    return { weak, tooSoon, plain };
  }

  it('flags a spaced-out sentence with a weak word, and only that one', async () => {
    const { weak, tooSoon, plain } = await setup();
    const input = await getSessionPlannerInput(60);
    const byId = new Map(input.exploreCandidates.flatMap((c) => c.sentences).map((s) => [s.sentenceId, s]));
    expect(byId.get(weak.id)).toMatchObject({ revisit: true, weakWords: ['怪我'] });
    // Walked yesterday: too soon to bring back for its weak word.
    expect(byId.get(tooSoon.id)?.weakWords).toBeUndefined();
    expect(byId.get(plain.id)?.weakWords).toBeUndefined();
  });

  it('names the weak words in the drafted step', async () => {
    await setup();
    const input = await getSessionPlannerInput(60);
    const session = buildRecommendedSession(input);
    const step = session.steps.find((s) => s.targetKind === 'sentence_learning' && s.reason.includes('怪我'));
    expect(step?.reason).toContain("haven't stuck");
  });
});
