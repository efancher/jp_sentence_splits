import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  createBook,
  ensureStudyItem,
  getDb,
  getSessionPlannerInput,
  resetSentenceWalkthrough,
  updateSettings,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { buildSentenceLessonReport } from '../src/lib/sentenceLessonReport';
import { sessionStepTargetPath } from '../src/lib/sessionPlanner';
import { sessionStepCategory } from '../src/lib/sessionStepCategory';

const DAY = 24 * 60 * 60 * 1000;

function makeSentence(japanese: string): Sentence {
  const timestamp = new Date().toISOString();
  const id = createId('sent');
  return {
    id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '', translation: 'x', targetVocabulary: [],
    vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [],
    createdAt: timestamp, updatedAt: timestamp,
  };
}

describe('Read checks replace sentence review cards in the plan', () => {
  beforeEach(() => {
    resetDbForTests(`read-check-${createId('db')}`);
  });

  async function walk(sentence: Sentence, bookId: string, daysAgo: number) {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: sentence.id, bookId, action: 'walkthrough_completed',
      timestamp: new Date(Date.now() - daysAgo * DAY).toISOString(),
    } as never);
  }

  async function setup() {
    const book = await createBook({ title: 'Read Checks' });
    const due = makeSentence('今日は雨です。');
    const justWalked = makeSentence('明日は晴れです。');
    const needsHelp = makeSentence('猫が好きです。');
    const extra = [makeSentence('犬が走ります。'), makeSentence('魚を食べます。'), makeSentence('水を飲みます。')];
    // An unstarted sentence keeps the per-book Fresh try cap at 2, so the other due sentences get Read checks.
    const unstarted = makeSentence('新しい文です。');
    await getDb().sentences.bulkPut([due, justWalked, needsHelp, ...extra, unstarted]);
    await addSentencesToBook(book.id, [due.id, justWalked.id, needsHelp.id, ...extra.map((e) => e.id), unstarted.id]);
    for (const sentence of extra) await walk(sentence, book.id, 5);
    await walk(due, book.id, 3);
    await walk(justWalked, book.id, 0);
    await walk(needsHelp, book.id, 9);
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: needsHelp.id, bookId: book.id, action: 'gist_check', outcome: 'needed_help',
      timestamp: new Date(Date.now() - 2 * DAY).toISOString(),
    } as never);
    return { book, due, justWalked, needsHelp, extra };
  }

  it('lists due sentences in the planner input, needing-help first, and skips ones walked today', async () => {
    const { justWalked, needsHelp, due, extra } = await setup();
    const input = await getSessionPlannerInput(60);
    const ids = (input.readCheckCandidates ?? []).map((c) => c.sentenceId);
    expect(ids[0]).toBe(needsHelp.id);
    expect(new Set(ids)).toEqual(new Set([needsHelp.id, due.id, ...extra.map((e) => e.id)]));
    expect(ids).not.toContain(justWalked.id);
    expect(input.readCheckCandidates![0]!.reason).toContain('needed help');
    expect(input.readCheckCandidates![0]!.waiting).toBe(5);
  });

  it('drops a sentence from the Read check pool once its walkthrough is reset', async () => {
    const { due, book } = await setup();
    const poolIds = async () => ((await getSessionPlannerInput(60)).readCheckCandidates ?? []).map((c) => c.sentenceId);
    expect(await poolIds()).toContain(due.id);
    await resetSentenceWalkthrough({ sentenceId: due.id, bookId: book.id });
    expect(await poolIds()).not.toContain(due.id);
  });

  it('drafts one-minute Read check steps that open the reader and count as review, not lessons', async () => {
    await setup();
    const session = await addMinutesToTodaySession(60);
    const checks = session.steps.filter((step) => step.readCheck);
    expect(checks.length).toBeGreaterThan(0);
    for (const step of checks) {
      expect(step).toMatchObject({ bucket: 'review', targetKind: 'sentence_learning', estimatedMinutes: 1, status: 'pending' });
      expect(step.label).toMatch(/^Read check:/);
      expect(sessionStepTargetPath(step)).toBe(`/books/${step.bookId}/recall/${step.sentenceId}`);
      expect(sessionStepCategory(step)).toBe('review');
    }
    expect(checks[0]!.reason).toContain('sentences waiting for a check');
    expect(buildSentenceLessonReport([], [session]).planned.lessons).toBe(
      session.steps.filter((step) => step.targetKind === 'sentence_learning' && !step.wordCheck && !step.readCheck).length,
    );
    const saved = await getDb().plannerSessions.get(session.id);
    expect(saved!.steps.filter((step) => step.readCheck)).toHaveLength(checks.length);
  });

  it('does not draft a Read check for a sentence that is drafted a Fresh try in the same plan', async () => {
    await setup();
    const session = await addMinutesToTodaySession(60);
    const freshTries = new Set(session.steps.filter((s) => s.revisit).map((s) => s.sentenceId));
    for (const step of session.steps.filter((s) => s.readCheck)) expect(freshTries.has(step.sentenceId)).toBe(false);
    // Every due sentence is covered one way or the other.
    expect(new Set(session.steps.filter((s) => s.sentenceId && (s.revisit || s.readCheck)).map((s) => s.sentenceId)).size).toBe(5);
  });

  it('pausing sentence cards withholds them from the planner review batches only', async () => {
    const { due } = await setup();
    const item = await ensureStudyItem('sentence', due.id, 'reading_in_context');
    await getDb().studyItems.update(item.id, { fsrsState: { ...item.fsrsState, due: new Date(Date.now() - DAY).toISOString() } });

    const before = await getSessionPlannerInput(60);
    expect([...before.retainDue, ...before.practiceDue].some((entry) => entry.studyItemId === item.id)).toBe(true);

    await updateSettings({ sentenceCardsPaused: true });
    const after = await getSessionPlannerInput(60);
    expect([...after.retainDue, ...after.practiceDue].some((entry) => entry.studyItemId === item.id)).toBe(false);
    // The card row is untouched, and Read checks still plan.
    expect(await getDb().studyItems.get(item.id)).toBeTruthy();
    expect((after.readCheckCandidates ?? []).length).toBeGreaterThan(0);
  });
});
