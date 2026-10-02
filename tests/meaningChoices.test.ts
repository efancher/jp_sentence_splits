import { describe, expect, it } from 'vitest';
import type { ComprehensionCheck } from '../src/domain/types';
import {
  distractorHistoryFromRecords,
  getMeaningBank,
  mergeDistractors,
  meaningChoiceId,
  parseDistractorBankReply,
  removeDistractor,
  sampleMeaningQuestion,
} from '../src/lib/meaningChoices';

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const legacy: ComprehensionCheck = {
  options: [
    'He gave the book to her yesterday.',
    'She gave the book to him yesterday.',
    'He did not give the book to her yesterday.',
    'He will give the book to her tomorrow.',
  ],
  correctIndex: 0,
  provenance: 'ai_authored',
  createdAt: '2026-01-01T00:00:00Z',
};
const extras = [
  'He lent the pen to her yesterday.',
  'He wanted to give her the book yesterday.',
  'He gave the book to his brother yesterday.',
  'He took the book from her yesterday.',
  'He gave her the dictionary yesterday.',
  'He gave the book to her last week.',
  'He gave the book to her yesterday.',
];
const rich: ComprehensionCheck = { ...legacy, extraDistractors: extras };

describe('meaning bank', () => {
  it('treats a legacy check as a bank of its 3 wrong options', () => {
    const bank = getMeaningBank(legacy)!;
    expect(bank.correct).toBe(legacy.options[0]);
    expect(bank.distractors).toHaveLength(3);
  });

  it('excludes extras that equal the correct meaning, keeps legacy originals', () => {
    const bank = getMeaningBank(rich)!;
    const bad = bank.entries.find((e) => e.origin === 'extra' && e.text === 'He gave the book to her yesterday.')!;
    expect(bad.usable).toBe(false);
    expect(bad.issues).toContain('same_as_correct');
    expect(bank.entries.filter((e) => e.origin === 'original').every((e) => e.usable)).toBe(true);
  });

  it('returns null rather than inventing choices when no distractor is usable', () => {
    const empty: ComprehensionCheck = { ...legacy, options: ['A', 'A', 'a', 'A.'], correctIndex: 0 };
    expect(sampleMeaningQuestion(empty)).toBeNull();
    expect(sampleMeaningQuestion(undefined)).toBeNull();
  });

  it('smaller legacy banks yield a smaller question without padding', () => {
    const small: ComprehensionCheck = {
      ...legacy,
      options: [legacy.options[0]!, legacy.options[1]!],
      correctIndex: 0,
    };
    const q = sampleMeaningQuestion(small, [], seeded(1))!;
    expect(q.choices).toHaveLength(2);
  });
});

describe('sampling', () => {
  it('shows the correct meaning plus 3 distinct distractors, no none-of-the-above', () => {
    const q = sampleMeaningQuestion(rich, [], seeded(7))!;
    expect(q.choices).toHaveLength(4);
    expect(new Set(q.choices.map((c) => c.text)).size).toBe(4);
    expect(q.choices.filter((c) => c.isCorrect)).toHaveLength(1);
    expect(q.choices.some((c) => /none of/i.test(c.text))).toBe(false);
  });

  it('answer identity is the text id, independent of shuffled position', () => {
    const ids = new Set<string>();
    const positions = new Set<number>();
    for (let seed = 1; seed < 40; seed += 1) {
      const q = sampleMeaningQuestion(rich, [], seeded(seed))!;
      const correct = q.choices.find((c) => c.isCorrect)!;
      ids.add(correct.id);
      positions.add(q.choices.indexOf(correct));
    }
    expect(ids).toEqual(new Set([meaningChoiceId(legacy.options[0]!)]));
    expect(positions.size).toBeGreaterThan(1);
  });

  it('does not repeat the exact distractor set across five attempts when the bank permits', () => {
    const history: string[][] = [];
    const sets = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const q = sampleMeaningQuestion(rich, history, seeded(100 + i))!;
      history.push(q.distractorTexts);
      sets.add([...q.distractorTexts].sort().join('|'));
    }
    expect(sets.size).toBe(5);
  });

  it('is deterministic for a given rng (stable within an attempt)', () => {
    const a = sampleMeaningQuestion(rich, [], seeded(3))!;
    const b = sampleMeaningQuestion(rich, [], seeded(3))!;
    expect(a.choices).toEqual(b.choices);
  });

  it('rebuilds history from stored records', () => {
    const q = sampleMeaningQuestion(rich, [], seeded(5))!;
    const hist = distractorHistoryFromRecords([
      { shown: q.choices.map((c) => c.text), correctText: q.correctText },
    ]);
    expect([...hist[0]!].sort()).toEqual([...q.distractorTexts].sort());
  });
});

describe('authoring', () => {
  it('parses bullet and numbered replies', () => {
    expect(parseDistractorBankReply('- One\n* Two\n3. Three\nnoise')).toEqual(['One', 'Two', 'Three']);
  });

  it('merge rejects duplicates and equal-to-correct with reasons', () => {
    const { added, rejected, check } = mergeDistractors(legacy, [
      'He lent the pen to her yesterday.',
      'He gave the book to her yesterday.',
      'he gave the book to her yesterday',
      'No.',
    ]);
    expect(added).toEqual(['He lent the pen to her yesterday.']);
    expect(rejected).toHaveLength(3);
    expect(check.extraDistractors).toEqual(added);
  });

  it('remove deletes an extra, and swaps an original for an extra only when one exists', () => {
    expect(removeDistractor(rich, extras[0]!).extraDistractors).not.toContain(extras[0]);
    expect(removeDistractor(legacy, legacy.options[1]!)).toEqual(legacy);
    const swapped = removeDistractor({ ...legacy, extraDistractors: [extras[0]!] }, legacy.options[1]!);
    expect(swapped.options[1]).toBe(extras[0]);
  });
});
