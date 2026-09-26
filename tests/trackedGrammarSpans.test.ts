import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  ensureGrammarPattern,
  ensureSentenceGrammar,
  getDb,
  getTrackedGrammarSpansForSentences,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';

const T = '2026-09-26T00:00:00Z';

async function addSentence(id: string, japanese: string): Promise<void> {
  await getDb().sentences.add({
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: `tr ${id}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: T,
    updatedAt: T,
  } satisfies Sentence);
}

beforeEach(async () => {
  await resetDbForTests();
});

describe('getTrackedGrammarSpansForSentences', () => {
  it('returns a tracked occurrence with its pattern name', async () => {
    await addSentence('sent_1', 'それは訳がないでしょう。');
    const pattern = await ensureGrammarPattern('〜わけがない', { shortMeaning: 'no reason to think that' });
    await ensureSentenceGrammar('sent_1', pattern.id, {
      surfaceForm: '訳がない',
      start: 3,
      end: 7,
      confirmedByLearner: true,
    });

    const spans = await getTrackedGrammarSpansForSentences(['sent_1']);
    expect(spans.get('sent_1')).toEqual({
      surfaceForm: '訳がない',
      start: 3,
      end: 7,
      patternName: '〜わけがない',
    });
  });

  it('skips an unconfirmed (AI-suggested-only) occurrence', async () => {
    await addSentence('sent_1', 'それは訳がないでしょう。');
    const pattern = await ensureGrammarPattern('〜わけがない', {});
    await ensureSentenceGrammar('sent_1', pattern.id, {
      surfaceForm: '訳がない',
      start: 3,
      end: 7,
      confirmedByLearner: false,
    });

    expect(await getTrackedGrammarSpansForSentences(['sent_1'])).toEqual(new Map());
  });

  it('skips an occurrence with no character span recorded', async () => {
    await addSentence('sent_1', 'それは訳がないでしょう。');
    const pattern = await ensureGrammarPattern('〜わけがない', {});
    await ensureSentenceGrammar('sent_1', pattern.id, { confirmedByLearner: true });

    expect(await getTrackedGrammarSpansForSentences(['sent_1'])).toEqual(new Map());
  });

  it('picks one occurrence per sentence when more than one is tracked', async () => {
    await addSentence('sent_1', 'それは訳がないし、はずもない。');
    const a = await ensureGrammarPattern('〜わけがない', {});
    const b = await ensureGrammarPattern('〜はずがない', {});
    await ensureSentenceGrammar('sent_1', a.id, { start: 3, end: 7, confirmedByLearner: true });
    await ensureSentenceGrammar('sent_1', b.id, { start: 9, end: 13, confirmedByLearner: true });

    const spans = await getTrackedGrammarSpansForSentences(['sent_1']);
    expect(spans.size).toBe(1);
  });

  it('returns nothing for an empty or unmatched id list', async () => {
    expect(await getTrackedGrammarSpansForSentences([])).toEqual(new Map());
    expect(await getTrackedGrammarSpansForSentences(['missing'])).toEqual(new Map());
  });

  it('keys results by sentence id across several sentences', async () => {
    await addSentence('sent_1', '訳がないでしょう。');
    await addSentence('sent_2', 'はずがないでしょう。');
    const a = await ensureGrammarPattern('〜わけがない', {});
    const b = await ensureGrammarPattern('〜はずがない', {});
    await ensureSentenceGrammar('sent_1', a.id, { start: 0, end: 4, confirmedByLearner: true });
    await ensureSentenceGrammar('sent_2', b.id, { start: 0, end: 4, confirmedByLearner: true });

    const spans = await getTrackedGrammarSpansForSentences(['sent_1', 'sent_2', 'sent_3']);
    expect(spans.get('sent_1')?.patternName).toBe('〜わけがない');
    expect(spans.get('sent_2')?.patternName).toBe('〜はずがない');
    expect(spans.has('sent_3')).toBe(false);
  });
});
