import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  computeLearningBalance,
  createBook,
  endPlannerSessionEarly,
  ensureStudyItem,
  getDb,
  planRecommendedSession,
  recordReview,
  startPlannerSession,
  updatePlannerSessionStep,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeSentence(overrides: Partial<Sentence> = {}): Sentence {
  const timestamp = new Date().toISOString();
  const id = overrides.id ?? createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese: '猫が寝ています。',
    readingOnly: 'ねこがねています。',
    inlineReading: '',
    translation: 'The cat is sleeping.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('Learning Orchestrator repository layer', () => {
  beforeEach(() => {
    resetDbForTests(`session-planner-${createId('db')}`);
  });

  it('surfaces unstarted book sentences as an Explore step, with no retain minutes when nothing is due', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentences = [makeSentence(), makeSentence(), makeSentence()];
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(
      book.id,
      sentences.map((s) => s.id),
    );

    const recommended = await planRecommendedSession('normal');
    expect(recommended.allocation.retain).toBe(0);
    const exploreStep = recommended.steps.find((step) => step.mode === 'explore');
    expect(exploreStep).toBeDefined();
    expect(exploreStep!.bookId).toBe(book.id);
  });

  it('tracks step completion/skip explicitly, and only completes the session once every step is settled', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    // A brand-new StudyItem is immediately due, giving a second (retain) step.
    await ensureStudyItem('sentence', sentence.id, 'comprehension');

    const recommended = await planRecommendedSession('normal');
    expect(recommended.steps.length).toBeGreaterThanOrEqual(2);

    const session = await startPlannerSession(recommended, 'normal');
    expect(session.status).toBe('in_progress');
    expect(session.steps.every((step) => step.status === 'pending')).toBe(true);
    // Real, freshly-minted ids — not the pure algorithm's draft_N placeholders.
    expect(session.steps.every((step) => step.id.startsWith('planner_step_'))).toBe(true);

    const [first, second] = session.steps;
    const afterSkip = await updatePlannerSessionStep(session.id, first!.id, { status: 'skipped' });
    expect(afterSkip!.steps.find((step) => step.id === first!.id)!.status).toBe('skipped');
    // One step settled, one still pending — the session as a whole isn't done yet.
    expect(afterSkip!.status).toBe('in_progress');

    const afterComplete = await updatePlannerSessionStep(session.id, second!.id, {
      status: 'completed',
    });
    expect(afterComplete!.status).toBe('completed');
    expect(afterComplete!.endedAt).toBeDefined();
  });

  it('ending a session early marks remaining steps skipped, never completed', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const recommended = await planRecommendedSession('normal');
    const session = await startPlannerSession(recommended, 'normal');
    const ended = await endPlannerSessionEarly(session.id);

    expect(ended!.status).toBe('ended_early');
    expect(ended!.steps.every((step) => step.status !== 'completed')).toBe(true);
    expect(ended!.steps.every((step) => step.status === 'skipped')).toBe(true);
  });

  it('learning balance reflects real recent Review activity, not the planner\'s own bookkeeping', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    const studyItem = await ensureStudyItem('sentence', sentence.id, 'comprehension');
    await recordReview({ studyItemId: studyItem.id, rating: 'good' });

    const balance = await computeLearningBalance();
    const retain = balance.find((entry) => entry.mode === 'retain')!;
    const understand = balance.find((entry) => entry.mode === 'understand')!;
    expect(retain.neglectScore).toBeLessThan(understand.neglectScore);
    expect(understand.daysSinceLast).toBeNull();
  });
});
