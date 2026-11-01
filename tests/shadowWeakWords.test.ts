import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  confirmSentenceVocabulary,
  createBook,
  ensureStudyItem,
  ensureVocabularyItem,
  getDb,
  getSessionPlannerInput,
  getWeakWordRecallTarget,
  getWeakWordSentenceSignal,
  setBookSentenceStatus,
  updateSettings,
} from '../src/db/repository';
import type { Review, Sentence, SentenceVocabulary } from '../src/domain/types';
import { createId } from '../src/lib/ids';

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

describe('weak words steer shadowing candidates', () => {
  beforeEach(() => {
    resetDbForTests(`shadow-weak-${createId('db')}`);
  });

  async function shadowReadySentence(book: { id: string }, japanese: string): Promise<Sentence> {
    const db = getDb();
    const sentence = makeSentence(japanese);
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
    await confirmSentenceVocabulary(sentence.id, []);
    await db.sentenceAudio.add({
      id: `audio-${sentence.id}`,
      sentenceId: sentence.id,
      sourceId: 'source-1',
      sourceSentenceId: `src-${sentence.id}`,
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: new Date().toISOString(),
    });
    return sentence;
  }

  async function linkFailedWord(sentenceId: string, expression: string, reading: string) {
    const db = getDb();
    const word = await ensureVocabularyItem(expression, reading);
    const link = {
      id: createId('sv'),
      sentenceId,
      vocabularyItemId: word.id,
      surfaceForm: expression,
    } as SentenceVocabulary;
    await db.sentenceVocabulary.put(link);
    const created = await ensureStudyItem('vocabularyItem', word.id, 'reading_retrieval');
    // Shadowing readiness needs the word introduced (left the `new` state), as it would be after real reviews.
    await db.studyItems.update(created.id, { fsrsState: { ...created.fsrsState, state: 'review', reps: 3 } });
    const item = created;
    for (let i = 0; i < 3; i += 1) {
      await db.reviews.put({
        id: createId('review'),
        studyItemId: item.id,
        timestamp: new Date().toISOString(),
        rating: 'again',
      } as Review);
    }
  }

  it('puts the sentence holding a repeatedly failed word first and names the word', async () => {
    await updateSettings({ sentenceLedFlow: false });
    const book = await createBook({ title: 'Weak words' });
    const plain = await shadowReadySentence(book, '今日は雨です。');
    const weak = await shadowReadySentence(book, '怪我をしました。');
    await linkFailedWord(weak.id, '怪我', 'けが');

    const input = await getSessionPlannerInput(60);
    const ids = input.shadowCandidates.map((candidate) => candidate.sentenceId);
    expect(ids).toEqual([weak.id, plain.id]);
    expect(input.shadowCandidates[0]!.reason).toContain('怪我');
    expect(input.shadowCandidates[1]!.reason).not.toContain('haven\'t stuck');
  });

  async function typedReadingFixture() {
    const db = getDb();
    const sentence = { ...makeSentence('本を読みます。'), inlineReading: '本[ほん]を読[よ]みます。' };
    await db.sentences.put(sentence);
    const word = await ensureVocabularyItem('本', 'ほん');
    await db.sentenceVocabulary.put({
      id: createId('sv'),
      sentenceId: sentence.id,
      vocabularyItemId: word.id,
      surfaceForm: '本',
    } as SentenceVocabulary);
    const card = await ensureStudyItem('sentence', sentence.id, 'reading_in_context');
    const review = async (typed?: string) => {
      await db.reviews.put({
        id: createId('review'),
        studyItemId: card.id,
        timestamp: new Date().toISOString(),
        rating: 'good',
        contextSentenceId: sentence.id,
        ...(typed === undefined ? {} : { responseRaw: typed, expectedAnswer: 'ほん' }),
      } as Review);
    };
    return { sentence, word, review };
  }

  it('targets a word seen only in passing, naming the surface and its reading', async () => {
    const { sentence, word, review } = await typedReadingFixture();
    await review(); // exposure only: one sentence is worth 0.25, still weak
    expect(await getWeakWordRecallTarget(sentence)).toEqual({
      japanese: '本',
      expectedReading: 'ほん',
      vocabularyItemId: word.id,
    });
  });

  it('counts right typed readings as recall: the word stops being targeted', async () => {
    const { sentence, review } = await typedReadingFixture();
    await review('ほん');
    await review('hon'); // romaji folds to the same reading
    expect(await getWeakWordRecallTarget(sentence)).toBeUndefined();
  });

  it('counts a wrong typed reading against the word: it stays targeted', async () => {
    const { sentence, review } = await typedReadingFixture();
    await review('ぼん');
    expect(await getWeakWordRecallTarget(sentence)).toMatchObject({ japanese: '本' });
  });

  it('adds nothing when no word is weak', async () => {
    const book = await createBook({ title: 'Fine' });
    const a = await shadowReadySentence(book, '今日は雨です。');
    expect(await getWeakWordSentenceSignal([a.id])).toEqual({ order: [], labels: new Map() });
  });
});
