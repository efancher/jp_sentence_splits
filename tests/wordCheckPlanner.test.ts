import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  createBook,
  ensureVocabularyItem,
  getDb,
  getSessionPlannerInput,
  getWordMeaningCheckTarget,
  resetWordStrengthCache,
  updateSettings,
} from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { buildSentenceLessonReport } from '../src/lib/sentenceLessonReport';
import { sessionStepTargetPath } from '../src/lib/sessionPlanner';
import { sessionStepCategory } from '../src/lib/sessionStepCategory';
import { meaningCheckTargetKey } from '../src/lib/wordEvidence';

const DAY = 24 * 60 * 60 * 1000;

/** A sentence with morphology only (no `sentence_vocabulary` links), as walked-through sentences usually are. */
function makeSentence(pieces: Array<[surface: string, english?: string]>): Sentence {
  const timestamp = new Date().toISOString();
  const id = createId('sent');
  let cursor = 0;
  const vocabularySuggestions = pieces.map(([surface, english], index): VocabularySuggestion => {
    const suggestion: VocabularySuggestion = {
      id: `${id}-sg-${index}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface,
      pos: english ? 'noun' : 'particle', english, source: 'morphology', selectedByDefault: Boolean(english),
    };
    cursor += surface.length;
    return suggestion;
  });
  return {
    id, normalizedKey: id, japanese: pieces.map(([surface]) => surface).join(''), readingOnly: '', inlineReading: '',
    translation: 'x', targetVocabulary: [], vocabularySuggestions, sourceReferences: [], conflicts: [],
    firstOccurrenceIndex: 0, importBatchIds: [], createdAt: timestamp, updatedAt: timestamp,
  };
}

describe('Word checks are planned on their own, from sentence morphology', () => {
  beforeEach(() => {
    resetDbForTests(`word-check-${createId('db')}`);
    resetWordStrengthCache();
  });

  async function log(sentence: Sentence, bookId: string, daysAgo: number, fields: Record<string, unknown>) {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: sentence.id, bookId, timestamp: new Date(Date.now() - daysAgo * DAY).toISOString(), ...fields,
    } as never);
  }

  async function setup() {
    await updateSettings({ sentenceFirstPlanning: true });
    const book = await createBook({ title: 'Word Checks' });
    const ready = makeSentence([['猫', 'cat'], ['が'], ['好き', 'liking'], ['です']]);
    const walkedToday = makeSentence([['犬', 'dog'], ['が'], ['走る', 'to run']]);
    const checkedYesterday = makeSentence([['魚', 'fish'], ['を'], ['食べる', 'to eat']]);
    const noMeanings = makeSentence([['そう'], ['です'], ['ね']]);
    const struggling = makeSentence([['水', 'water'], ['を'], ['飲む', 'to drink']]);
    // An unstarted sentence keeps the per-book Fresh try cap on, so not every walked sentence is drafted a Fresh try.
    const unstarted = makeSentence([['新しい', 'new'], ['文', 'sentence']]);
    const extra = [makeSentence([['山', 'mountain'], ['です']]), makeSentence([['川', 'river'], ['です']])];
    const all = [ready, walkedToday, checkedYesterday, noMeanings, struggling, ...extra, unstarted];
    await getDb().sentences.bulkPut(all);
    await addSentencesToBook(book.id, all.map((sentence) => sentence.id));
    await log(ready, book.id, 2, { action: 'walkthrough_completed' });
    await log(walkedToday, book.id, 0, { action: 'walkthrough_completed' });
    await log(checkedYesterday, book.id, 5, { action: 'walkthrough_completed' });
    await log(noMeanings, book.id, 5, { action: 'walkthrough_completed' });
    await log(struggling, book.id, 9, { action: 'walkthrough_completed' });
    for (const sentence of extra) await log(sentence, book.id, 6, { action: 'walkthrough_completed' });
    const fish = await ensureVocabularyItem('魚', '魚', { meaning: 'fish' });
    await log(checkedYesterday, book.id, 1, {
      action: 'target_practice', outcome: 'needed_help', support: 'target_masked',
      target: { kind: 'vocabulary', key: meaningCheckTargetKey(fish.id), label: '魚' },
    });
    await log(struggling, book.id, 1, { action: 'gist_check', outcome: 'needed_help' });
    return { book, ready, walkedToday, checkedYesterday, noMeanings, struggling, extra };
  }

  it('picks a word from morphology when the sentence has no vocabulary links', async () => {
    const { ready } = await setup();
    expect(await getDb().sentenceVocabulary.count()).toBe(0);
    const target = await getWordMeaningCheckTarget(ready);
    expect(target).toMatchObject({ vocabularyItemId: '', surface: '猫', meaning: 'cat', start: 0 });
  });

  it('lists walked sentences with a checkable word, struggling first, and skips too-recent ones', async () => {
    const { ready, walkedToday, checkedYesterday, noMeanings, struggling } = await setup();
    const candidates = (await getSessionPlannerInput(60)).wordCheckCandidates ?? [];
    const ids = candidates.map((candidate) => candidate.sentenceId);
    expect(ids.slice(0, 2)).toEqual([struggling.id, ready.id]);
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain(walkedToday.id);
    expect(ids).not.toContain(checkedYesterday.id);
    expect(ids).not.toContain(noMeanings.id);
    expect(candidates[0]!.reason).toContain('needed help');
    expect(candidates[1]!.reason).toContain('猫');
  });

  it('drafts Word check steps in review, never on a sentence with another step in the same plan', async () => {
    await setup();
    const session = await addMinutesToTodaySession(60);
    const checks = session.steps.filter((step) => step.wordCheck);
    expect(checks.length).toBeGreaterThan(0);
    for (const step of checks) {
      expect(step).toMatchObject({ bucket: 'review', targetKind: 'sentence_learning', estimatedMinutes: 1, status: 'pending' });
      expect(step.label).toMatch(/^Word check:/);
      expect(sessionStepTargetPath(step)).toBe(`/books/${step.bookId}/check/${step.sentenceId}`);
      expect(sessionStepCategory(step)).toBe('vocabulary');
    }
    expect(buildSentenceLessonReport([], [session]).planned.lessons).toBe(
      session.steps.filter((step) => step.targetKind === 'sentence_learning' && !step.wordCheck && !step.readCheck && !step.readerTool).length,
    );
    // One tool per sentence: no sentence has two of Fresh try / Read check / Word check / listening step.
    const perSentence = new Map<string, number>();
    for (const step of session.steps) {
      if (step.targetKind !== 'sentence_learning' || !step.sentenceId) continue;
      perSentence.set(step.sentenceId, (perSentence.get(step.sentenceId) ?? 0) + 1);
    }
    expect([...perSentence.values()].every((count) => count === 1)).toBe(true);
  });
});
