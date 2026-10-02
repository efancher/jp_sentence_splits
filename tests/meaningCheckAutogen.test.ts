import { beforeEach, describe, expect, it } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  createBook,
  getDb,
  setSentenceComprehensionCheck,
  updateSettings,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import {
  applyMeaningBankResult,
  autoGenerateMeaningChecks,
  findMeaningBankCandidates,
  resetMeaningAutogenBackoff,
} from '../src/lib/meaningCheckAutogen';
import {
  buildCheckFromMeaningBank,
  formatBatchMeaningBankPromptForAI,
  getMeaningBank,
  parseBatchMeaningBankReply,
} from '../src/lib/meaningChoices';

const WRONG = [
  'The cat is not sleeping.',
  'The dog is sleeping.',
  'The cat slept all day.',
  'The cat wants to sleep.',
  'The cats are sleeping.',
];

function makeSentence(id: string, translation: string | undefined) {
  const now = new Date().toISOString();
  return {
    id,
    normalizedKey: id,
    japanese: `猫が寝ています。${id}`,
    readingOnly: '',
    inlineReading: '',
    translation,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function seed(translations: (string | undefined)[]) {
  const book = await createBook({ title: 'Imported' });
  const sentences = translations.map((t) => makeSentence(createId('sent'), t));
  await getDb().sentences.bulkPut(sentences);
  await addSentencesToBook(book.id, sentences.map((s) => s.id));
  return { book, ids: sentences.map((s) => s.id) };
}

describe('bulk meaning-bank prompt and parser', () => {
  it('round-trips sections and reads an optional CORRECT line', () => {
    const prompt = formatBatchMeaningBankPromptForAI([
      { japanese: '猫が寝ています。', context: [], correct: 'The cat is sleeping.' },
      { japanese: '犬が走る。', context: ['猫が寝ています。'] },
    ]);
    expect(prompt).toContain('=== Sentence 2 ===');
    expect(prompt).toContain('The cat is sleeping.');
    const reply = [
      '=== Sentence 1 ===',
      '- The dog is sleeping.',
      '- The cat is not sleeping.',
      '=== Sentence 2 ===',
      'CORRECT: The dog runs.',
      '1) The dog ran.',
      '=== Sentence 4 ===',
      '- stray',
    ].join('\n');
    const parsed = parseBatchMeaningBankReply(reply, 3);
    expect(parsed[0]).toEqual({ correct: undefined, wrong: ['The dog is sleeping.', 'The cat is not sleeping.'] });
    expect(parsed[1]).toEqual({ correct: 'The dog runs.', wrong: ['The dog ran.'] });
    expect(parsed[2]).toBeNull();
  });

  it('builds a check: first 3 wrong become options, the rest the bank, bad ones rejected', () => {
    const { check, rejected } = buildCheckFromMeaningBank(
      'The cat is sleeping.',
      [...WRONG, 'The cat is sleeping.', 'The dog is sleeping.', ''],
      'ai_suggested',
    );
    expect(check!.options).toHaveLength(4);
    expect(check!.options[check!.correctIndex]).toBe('The cat is sleeping.');
    expect(check!.extraDistractors).toEqual(['The cat wants to sleep.', 'The cats are sleeping.']);
    expect(rejected.map((r) => r.issues[0])).toEqual(['same_as_correct', 'duplicate', 'empty']);
    expect(getMeaningBank(check!)!.distractors).toHaveLength(5);
  });

  it('refuses to build a check with fewer than 3 valid wrong meanings', () => {
    expect(buildCheckFromMeaningBank('A.', ['B b b.', 'B b b.'], 'manual').check).toBeNull();
  });
});

describe('meaning check auto-generation', () => {
  beforeEach(async () => {
    resetDbForTests(`autogen-${createId('db')}`);
    await ensureSettings();
    resetMeaningAutogenBackoff();
  });

  it('fills sentences with no check, using the stored translation as the correct meaning', async () => {
    const { ids } = await seed(['The cat is sleeping.', undefined]);
    const summary = await autoGenerateMeaningChecks({
      generate: async (items) => ({
        ok: true,
        items: items.map((item) => ({
          id: item.id,
          // The model's own "correct" must lose to the stored translation.
          correct: item.correct ? 'A different rendering.' : 'The AI-written correct meaning.',
          wrong: WRONG,
        })),
      }),
    });
    expect(summary).toMatchObject({ saved: 2, attempted: 2 });
    const [first, second] = await Promise.all(ids.map((id) => getDb().analyses.get(id)));
    expect(first!.comprehensionCheck!.options[0]).toBe('The cat is sleeping.');
    expect(second!.comprehensionCheck!.options[0]).toBe('The AI-written correct meaning.');
  });

  it('sends the previous sentences as context and skips sentences that already have a check', async () => {
    const { ids } = await seed(['One.', 'Two.', 'Three.']);
    await setSentenceComprehensionCheck(ids[1]!, {
      options: ['Two.', 'a a a', 'b b b', 'c c c'],
      correctIndex: 0,
      provenance: 'manual',
      createdAt: new Date().toISOString(),
    });
    const candidates = await findMeaningBankCandidates({ mode: 'missing', limit: 10 });
    expect(candidates.map((c) => c.sentenceId)).toEqual([ids[0], ids[2]]);
    expect(candidates[1]!.request.context).toHaveLength(2);
  });

  it('never overwrites a check authored while the request was in flight', async () => {
    const { ids } = await seed(['One.']);
    const manual = {
      options: ['One.', 'a a a', 'b b b', 'c c c'],
      correctIndex: 0,
      provenance: 'manual' as const,
      createdAt: new Date().toISOString(),
    };
    await autoGenerateMeaningChecks({
      generate: async (items) => {
        await setSentenceComprehensionCheck(ids[0]!, manual);
        return { ok: true, items: items.map((i) => ({ id: i.id, correct: 'X.', wrong: WRONG })) };
      },
    });
    expect((await getDb().analyses.get(ids[0]!))!.comprehensionCheck!.provenance).toBe('manual');
  });

  it('backs off after AI is unavailable and respects the setting', async () => {
    await seed(['One.']);
    let calls = 0;
    const unavailable = async () => {
      calls += 1;
      return { ok: false as const, reason: 'Sign in' };
    };
    const first = await autoGenerateMeaningChecks({ generate: unavailable });
    expect(first.unavailableReason).toBe('Sign in');
    await autoGenerateMeaningChecks({ generate: unavailable });
    expect(calls).toBe(1);

    resetMeaningAutogenBackoff();
    await updateSettings({ autoMeaningChoices: false });
    await autoGenerateMeaningChecks({ generate: unavailable });
    expect(calls).toBe(1);
  });

  it('top-up adds validated wrong meanings to a legacy 3-option check', async () => {
    const { ids } = await seed(['The cat is sleeping.']);
    await setSentenceComprehensionCheck(ids[0]!, {
      options: ['The cat is sleeping.', 'The cat is not sleeping.', 'The dog is sleeping.', 'The cat slept all day.'],
      correctIndex: 0,
      provenance: 'manual',
      createdAt: new Date().toISOString(),
    });
    expect(await findMeaningBankCandidates({ mode: 'topup', limit: 5 })).toHaveLength(1);
    const saved = await applyMeaningBankResult(ids[0]!, 'topup', {
      wrong: ['The cat is not sleeping.', 'The cat wants to sleep.', 'The cats are sleeping.'],
    });
    expect(saved).toBe(true);
    const bank = getMeaningBank((await getDb().analyses.get(ids[0]!))!.comprehensionCheck)!;
    expect(bank.distractors).toHaveLength(5);
  });
});
