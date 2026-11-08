import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  createBook,
  getDb,
  getSessionPlannerInput,
  getWeakGrammarSentenceSignal,
  resetWordStrengthCache,
  updateSettings,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { grammarFeedbackTargetKey } from '../src/lib/grammarEvidence';
import { createId } from '../src/lib/ids';
import { buildRecommendedSession } from '../src/lib/sessionPlanner';

const DAY = 24 * 60 * 60 * 1000;
const T = '2026-11-08T00:00:00.000Z';

function makeSentence(japanese: string): Sentence {
  const id = createId('sent');
  return {
    id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '', translation: 'x', targetVocabulary: [],
    vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [],
    createdAt: T, updatedAt: T,
  };
}

describe('weak grammar brings walked-through sentences back for a walkthrough', () => {
  beforeEach(() => {
    resetDbForTests(`weak-grammar-${createId('db')}`);
    resetWordStrengthCache();
  });

  async function walk(sentence: Sentence, bookId: string, daysAgo: number) {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: sentence.id, bookId, action: 'walkthrough_completed',
      timestamp: new Date(Date.now() - daysAgo * DAY).toISOString(),
    } as never);
  }

  async function linkPattern(sentenceId: string, patternId: string, name: string) {
    const db = getDb();
    await db.grammarPatterns.put({
      id: patternId, canonicalName: name, normalizedKey: name, aliases: [], shortMeaning: '', provenance: 'manual',
      createdAt: T, updatedAt: T,
    } as never);
    await db.sentenceGrammar.put({
      id: `${sentenceId}-${patternId}`, sentenceId, grammarPatternId: patternId, confirmedByLearner: false,
      source: 'manual', createdAt: T, updatedAt: T,
    } as never);
  }

  async function tap(sentence: Sentence, bookId: string, patternId: string, outcome: 'got_it' | 'needed_help') {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: sentence.id, bookId, action: 'target_practice', timestamp: new Date().toISOString(),
      target: { kind: 'grammar', key: grammarFeedbackTargetKey(patternId, 'use'), label: patternId },
      support: 'target_masked', outcome,
    } as never);
  }

  async function setup() {
    await updateSettings({ sentenceFirstPlanning: true });
    const book = await createBook({ title: 'Weak Grammar' });
    const weak = makeSentence('食べてみる。');
    const solid = makeSentence('読んでみる。');
    const tooSoon = makeSentence('見てみる。');
    const untapped = makeSentence('今日は雨です。');
    const fresh = makeSentence('明日は晴れです。');
    await getDb().sentences.bulkPut([weak, solid, tooSoon, untapped, fresh]);
    await addSentencesToBook(book.id, [weak.id, solid.id, tooSoon.id, untapped.id, fresh.id]);
    for (const [sentence, days] of [[weak, 4], [solid, 4], [tooSoon, 1], [untapped, 4]] as const) await walk(sentence, book.id, days);
    await linkPattern(weak.id, 'p-weak', '〜てみる');
    await linkPattern(tooSoon.id, 'p-weak', '〜てみる');
    await linkPattern(solid.id, 'p-solid', '〜ておく');
    await linkPattern(untapped.id, 'p-untapped', '〜ながら');
    for (let i = 0; i < 3; i += 1) await tap(weak, book.id, 'p-weak', 'needed_help');
    for (let i = 0; i < 3; i += 1) await tap(solid, book.id, 'p-solid', 'got_it');
    return { weak, solid, tooSoon, untapped };
  }

  it('names only patterns the learner has missed, not solid or untapped ones', async () => {
    const { weak, solid, untapped } = await setup();
    const signal = await getWeakGrammarSentenceSignal([weak.id, solid.id, untapped.id]);
    expect(signal.order).toEqual([weak.id]);
    expect(signal.labels.get(weak.id)).toEqual(['〜てみる']);
  });

  it('returns nothing when there are no grammar taps at all', async () => {
    const book = await createBook({ title: 'No taps' });
    const sentence = makeSentence('今日は雨です。');
    await getDb().sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    expect(await getWeakGrammarSentenceSignal([sentence.id])).toEqual({ order: [], labels: new Map() });
  });

  it('flags a spaced-out sentence with weak grammar as a revisit, and not one walked yesterday', async () => {
    const { weak, tooSoon, solid } = await setup();
    const input = await getSessionPlannerInput(60);
    const byId = new Map(input.exploreCandidates.flatMap((c) => c.sentences).map((s) => [s.sentenceId, s]));
    expect(byId.get(weak.id)).toMatchObject({ revisit: true, weakGrammar: ['〜てみる'] });
    expect(byId.get(weak.id)?.weakWords).toBeUndefined();
    expect(byId.get(tooSoon.id)?.weakGrammar).toBeUndefined();
    expect(byId.get(solid.id)?.weakGrammar).toBeUndefined();
  });

  it('names the weak pattern in the drafted step', async () => {
    await setup();
    const session = buildRecommendedSession(await getSessionPlannerInput(60));
    const step = session.steps.find((s) => s.targetKind === 'sentence_learning' && s.reason.includes('〜てみる'));
    expect(step?.reason).toContain("Has grammar that hasn't stuck");
  });
});
