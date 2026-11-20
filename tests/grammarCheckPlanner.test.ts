import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { addMinutesToTodaySession, addSentencesToBook, createBook, getDb, getSessionPlannerInput } from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { grammarFeedbackTargetKey } from '../src/lib/grammarEvidence';
import { createId } from '../src/lib/ids';
import { sessionStepTargetPath } from '../src/lib/sessionPlanner';

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

describe('standalone Grammar checks are planned from walked sentences with an unchecked pattern', () => {
  beforeEach(() => {
    resetDbForTests(`grammar-check-${createId('db')}`);
  });

  async function log(sentence: Sentence, bookId: string, daysAgo: number, fields: Record<string, unknown>) {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: sentence.id, bookId, timestamp: new Date(Date.now() - daysAgo * DAY).toISOString(), ...fields,
    } as never);
  }

  async function link(sentence: Sentence, name: string) {
    const db = getDb();
    const now = new Date().toISOString();
    const patternId = createId('grammar_pattern');
    await db.grammarPatterns.put({
      id: patternId, canonicalName: name, normalizedKey: name, aliases: [], shortMeaning: 'm', provenance: 'manual',
      createdAt: now, updatedAt: now,
    });
    await db.sentenceGrammar.put({
      id: createId('sg'), sentenceId: sentence.id, grammarPatternId: patternId, confirmedByLearner: true, source: 'manual',
      createdAt: now, updatedAt: now,
    });
    return patternId;
  }

  async function setup() {
    const book = await createBook({ title: 'Grammar Checks' });
    const unchecked = makeSentence('猫が好きです');
    const tooRecent = makeSentence('犬が走る');
    const checkedLately = makeSentence('魚を食べる');
    const noPattern = makeSentence('そうですね');
    const unstarted = makeSentence('新しい文');
    const all = [unchecked, tooRecent, checkedLately, noPattern, unstarted];
    await getDb().sentences.bulkPut(all);
    await addSentencesToBook(book.id, all.map((sentence) => sentence.id));
    for (const [sentence, days] of [[unchecked, 4], [tooRecent, 0], [checkedLately, 6], [noPattern, 5]] as const) {
      await log(sentence, book.id, days, { action: 'walkthrough_completed' });
    }
    await link(unchecked, '～が好き');
    await link(tooRecent, '～が');
    const lately = await link(checkedLately, '～を');
    await log(checkedLately, book.id, 1, {
      action: 'target_practice', outcome: 'got_it', support: 'target_masked',
      target: { kind: 'grammar', key: grammarFeedbackTargetKey(lately, 'use'), label: '～を' },
    });
    return { book, unchecked, tooRecent, checkedLately, noPattern };
  }

  it('lists walked sentences whose pattern is unchecked, skipping recent walks, recent checks and pattern-free lines', async () => {
    const { unchecked } = await setup();
    const candidates = (await getSessionPlannerInput(60)).grammarCheckCandidates ?? [];
    expect(candidates.map((candidate) => candidate.sentenceId)).toEqual([unchecked.id]);
    expect(candidates[0]!.reason).toContain('grammar');
  });

  it('drafts at most one Grammar check, in review, routed to the grammar-check page', async () => {
    const { unchecked } = await setup();
    const session = await addMinutesToTodaySession(60);
    const checks = session.steps.filter((step) => step.grammarCheck);
    expect(checks.length).toBeLessThanOrEqual(1);
    for (const step of checks) {
      expect(step).toMatchObject({ targetKind: 'sentence_learning', estimatedMinutes: 1, status: 'pending' });
      expect(step.label).toMatch(/^Grammar check:/);
      expect(sessionStepTargetPath(step)).toBe(`/books/${step.bookId}/grammar-check/${step.sentenceId}`);
      expect(step.sentenceId).toBe(unchecked.id);
    }
  });
});
