import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  confirmSentenceVocabulary,
  createBook,
  ensureSettings,
  ensureStudyItem,
  getDb,
  getSessionPlannerInput,
  listSentenceLearningEvents,
  logSentenceLearningEvent,
  recordReviewTroubleTags,
  saveAttempt,
  setBookSentenceStatus,
  updateSettings,
} from '../src/db/repository';
import { normalizeTroubleTags, routeTroubleTags } from '../src/lib/reviewTroubleTags';
import type { Sentence } from '../src/domain/types';
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

describe('trouble tag routing (pure)', () => {
  it('sends knowledge gaps to a fresh try and sound to shadowing', () => {
    expect(routeTroubleTags(['reading'])).toEqual({ freshTry: true, shadow: false });
    expect(routeTroubleTags(['kanji', 'meaning'])).toEqual({ freshTry: true, shadow: false });
    expect(routeTroubleTags(['sound'])).toEqual({ freshTry: false, shadow: true });
    expect(routeTroubleTags(['reading', 'sound'])).toEqual({ freshTry: true, shadow: true });
    expect(routeTroubleTags([])).toEqual({ freshTry: false, shadow: false });
  });

  it('normalizes to a de-duplicated display order', () => {
    expect(normalizeTroubleTags(['sound', 'reading', 'sound'])).toEqual(['reading', 'sound']);
  });
});

describe('recordReviewTroubleTags', () => {
  beforeEach(() => {
    resetDbForTests(`trouble-tags-${createId('db')}`);
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

  it('does nothing without tags', async () => {
    const item = await ensureStudyItem('sentence', 'sent-none', 'reading_in_context');
    expect(
      await recordReviewTroubleTags({
        studyItemId: item.id,
        sentenceId: 'sent-none',
        rating: 'hard',
        tags: [],
      }),
    ).toBeUndefined();
    expect(await getDb().reviewTroubleLogs.count()).toBe(0);
  });

  it('queues a fresh try only for a walked-through sentence, and logs what was queued', async () => {
    const book = await createBook({ title: 'Tags' });
    const walked = makeSentence('猫が寝ています。');
    const unwalked = makeSentence('犬が走ります。');
    await getDb().sentences.bulkPut([walked, unwalked]);
    await addSentencesToBook(book.id, [walked.id, unwalked.id]);
    await logSentenceLearningEvent({ sentenceId: walked.id, bookId: book.id, action: 'walkthrough_completed' });
    const item = await ensureStudyItem('sentence', walked.id, 'reading_in_context');

    const walkedLog = await recordReviewTroubleTags({
      studyItemId: item.id,
      sentenceId: walked.id,
      rating: 'hard',
      tags: ['reading'],
    });
    const unwalkedLog = await recordReviewTroubleTags({
      studyItemId: item.id,
      sentenceId: unwalked.id,
      rating: 'again',
      tags: ['meaning'],
    });

    expect(walkedLog?.queued).toEqual({ freshTry: true, shadow: false });
    expect(unwalkedLog?.queued).toEqual({ freshTry: false, shadow: false });
    const settings = await ensureSettings(getDb());
    expect(Object.keys(settings.freshTryRequests ?? {})).toEqual([walked.id]);
    expect(settings.shadowRequests).toBeUndefined();
    // No FSRS side effects: tagging records no review and no learning event beyond the walkthrough.
    expect(await getDb().reviews.count()).toBe(0);
    expect((await listSentenceLearningEvents(book.id)).map((event) => event.action)).toEqual([
      'walkthrough_completed',
    ]);
  });

  it('a sound tag floats the sentence to the front of shadow candidates until it is shadowed', async () => {
    await updateSettings({ sentenceLedFlow: false });
    const book = await createBook({ title: 'Shadow Tags' });
    const first = await shadowReadySentence(book, '彼は忙しいです。');
    const flagged = await shadowReadySentence(book, '今日は雨です。');
    // Give the flagged sentence more shadows so plain ordering would put it last.
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await saveAttempt({ sentenceId: flagged.id, blob, mimeType: 'audio/webm', durationMs: 100 });
    await saveAttempt({ sentenceId: flagged.id, blob, mimeType: 'audio/webm', durationMs: 100 });
    expect((await getSessionPlannerInput(60)).shadowCandidates[0]?.sentenceId).toBe(first.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const item = await ensureStudyItem('sentence', flagged.id, 'reading_in_context');
    const log = await recordReviewTroubleTags({
      studyItemId: item.id,
      sentenceId: flagged.id,
      rating: 'hard',
      tags: ['sound'],
    });
    expect(log?.queued.shadow).toBe(true);

    const flaggedPlan = await getSessionPlannerInput(60);
    expect(flaggedPlan.shadowCandidates[0]?.sentenceId).toBe(flagged.id);
    expect(flaggedPlan.shadowCandidates[0]?.reason).toMatch(/^You flagged the sound in review/);

    await new Promise((resolve) => setTimeout(resolve, 5));
    // Shadowing it after the request clears the priority; the fewest-shadows order returns.
    await saveAttempt({ sentenceId: flagged.id, blob, mimeType: 'audio/webm', durationMs: 100 });
    const cleared = await getSessionPlannerInput(60);
    expect(cleared.shadowCandidates[0]?.sentenceId).toBe(first.id);
  });
});
