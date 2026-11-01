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

  it('adds nothing when no word is weak', async () => {
    const book = await createBook({ title: 'Fine' });
    const a = await shadowReadySentence(book, '今日は雨です。');
    expect(await getWeakWordSentenceSignal([a.id])).toEqual({ order: [], labels: new Map() });
  });
});
