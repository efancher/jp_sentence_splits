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
  recordReviewTroubleTags,
  setBookSentenceStatus,
  snoozeShadowSentence,
  updateSettings,
} from '../src/db/repository';
import type { PlannerSession, Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { activeShadowSnoozeIds, shadowSnoozeUntil } from '../src/lib/shadowSnooze';

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

describe('shadow snooze helpers', () => {
  it('snoozes to the start of the local day N days out', () => {
    const now = new Date(2026, 9, 31, 15, 30);
    expect(new Date(shadowSnoozeUntil(now, 1))).toEqual(new Date(2026, 10, 1, 0, 0));
    expect(new Date(shadowSnoozeUntil(now, 14))).toEqual(new Date(2026, 10, 14, 0, 0));
  });

  it('only counts snoozes that have not ended', () => {
    const now = new Date(2026, 9, 31, 12);
    const ids = activeShadowSnoozeIds(
      { future: new Date(2026, 10, 2).toISOString(), past: new Date(2026, 9, 30).toISOString() },
      now,
    );
    expect([...ids]).toEqual(['future']);
  });
});

describe('snoozeShadowSentence', () => {
  beforeEach(() => {
    resetDbForTests(`shadow-snooze-${createId('db')}`);
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

  it('drops the sentence from shadow candidates until the snooze ends', async () => {
    const book = await createBook({ title: 'Snooze' });
    const kept = await shadowReadySentence(book, '彼は忙しいです。');
    const snoozed = await shadowReadySentence(book, '今日は雨です。');
    const before = (await getSessionPlannerInput(60)).shadowCandidates.map((c) => c.sentenceId);
    expect(before).toContain(snoozed.id);

    await snoozeShadowSentence(snoozed.id, 5);
    const during = (await getSessionPlannerInput(60)).shadowCandidates.map((c) => c.sentenceId);
    expect(during).toEqual([kept.id]);

    // Same snooze, evaluated once it has ended (rewind it rather than faking the clock).
    await updateSettings({ shadowSnoozes: { [snoozed.id]: new Date(Date.now() - 1000).toISOString() } });
    const after = (await getSessionPlannerInput(60)).shadowCandidates.map((c) => c.sentenceId);
    expect(after).toContain(snoozed.id);
  });

  it('skips its open session step and leaves other steps alone', async () => {
    const timestamp = new Date().toISOString();
    const step = (id: string, sentenceId: string) => ({
      id,
      bucket: 'shadowing' as const,
      sentenceId,
      label: id,
      reason: '',
      estimatedMinutes: 3,
      status: 'pending' as const,
    });
    const session = {
      id: 'session-1',
      status: 'in_progress',
      createdAt: timestamp,
      updatedAt: timestamp,
      steps: [step('a', 'sent-a'), step('b', 'sent-b')],
    } as unknown as PlannerSession;
    await getDb().plannerSessions.put(session);

    await snoozeShadowSentence('sent-a', 1);
    const saved = await getDb().plannerSessions.get('session-1');
    expect(saved?.steps.map((s) => s.status)).toEqual(['skipped', 'pending']);
  });

  it('a later sound flag clears the snooze', async () => {
    const item = await ensureStudyItem('sentence', 'sent-x', 'reading_in_context');
    await snoozeShadowSentence('sent-x', 14);
    expect((await ensureSettings(getDb())).shadowSnoozes?.['sent-x']).toBeDefined();
    await recordReviewTroubleTags({ studyItemId: item.id, sentenceId: 'sent-x', rating: 'hard', tags: ['sound'] });
    expect((await ensureSettings(getDb())).shadowSnoozes?.['sent-x']).toBeUndefined();
  });
});
