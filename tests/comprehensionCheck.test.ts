import { describe, expect, it } from 'vitest';

import {
  formatBatchComprehensionPromptForAI,
  formatComprehensionPromptForAI,
  parseBatchComprehensionCheckReply,
  parseComprehensionCheckReply,
} from '../src/lib/comprehensionCheck';
import type { Sentence } from '../src/domain/types';

function sentence(overrides: Partial<Sentence> = {}): Sentence {
  return {
    id: 's1',
    normalizedKey: 'k1',
    japanese: '彼は行った。',
    readingOnly: '',
    inlineReading: '',
    translation: 'He went.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('formatComprehensionPromptForAI', () => {
  it('includes the target sentence and before-context', () => {
    const prompt = formatComprehensionPromptForAI(sentence(), {
      before: [sentence({ id: 's0', japanese: '太郎が来た。' })],
    });
    expect(prompt).toContain('彼は行った。');
    expect(prompt).toContain('太郎が来た。');
  });

  it('notes when there is no preceding context', () => {
    const prompt = formatComprehensionPromptForAI(sentence(), { before: [] });
    expect(prompt).toContain('(none — this is the first sentence)');
  });
});

describe('parseComprehensionCheckReply', () => {
  it('parses 4 numbered options with the correct one marked', () => {
    const reply = [
      '1. He left.',
      '*2. He went.',
      '3. She went.',
      '4. He will go.',
    ].join('\n');
    expect(parseComprehensionCheckReply(reply)).toEqual({
      options: ['He left.', 'He went.', 'She went.', 'He will go.'],
      correctIndex: 1,
    });
  });

  it('tolerates a ")" separator and surrounding prose', () => {
    const reply = [
      'Here are the options:',
      '1) He left.',
      '2) He went.',
      '*3) She went.',
      '4) He will go.',
      'Let me know if you need anything else.',
    ].join('\n');
    const result = parseComprehensionCheckReply(reply);
    expect(result?.correctIndex).toBe(2);
    expect(result?.options).toHaveLength(4);
  });

  it('returns null when a number is missing', () => {
    const reply = ['1. He left.', '*2. He went.', '4. He will go.'].join('\n');
    expect(parseComprehensionCheckReply(reply)).toBeNull();
  });

  it('returns null when no option is marked correct', () => {
    const reply = [
      '1. He left.',
      '2. He went.',
      '3. She went.',
      '4. He will go.',
    ].join('\n');
    expect(parseComprehensionCheckReply(reply)).toBeNull();
  });

  it('returns null when more than one option is marked correct', () => {
    const reply = [
      '*1. He left.',
      '*2. He went.',
      '3. She went.',
      '4. He will go.',
    ].join('\n');
    expect(parseComprehensionCheckReply(reply)).toBeNull();
  });

  it('returns null on unparseable input', () => {
    expect(parseComprehensionCheckReply('just some prose')).toBeNull();
    expect(parseComprehensionCheckReply('')).toBeNull();
  });
});

describe('formatBatchComprehensionPromptForAI', () => {
  it('numbers sections in order and notes when a sentence has no preceding context', () => {
    const prompt = formatBatchComprehensionPromptForAI([
      { sentence: sentence({ id: 's1', japanese: '猫がいます。' }), before: [] },
      {
        sentence: sentence({ id: 's2', japanese: '犬もいます。' }),
        before: [sentence({ id: 's1', japanese: '猫がいます。' })],
      },
    ]);
    expect(prompt).toContain('=== Sentence 1 ===');
    expect(prompt).toContain('(none — this is the first sentence)');
    expect(prompt).toContain('=== Sentence 2 ===');
    expect(prompt.indexOf('=== Sentence 1 ===')).toBeLessThan(prompt.indexOf('=== Sentence 2 ==='));
  });
});

const GOOD_SECTION = ['1. wrong a', '*2. correct', '3. wrong b', '4. wrong c'].join('\n');

describe('parseBatchComprehensionCheckReply', () => {
  it('parses each section independently, in order', () => {
    const reply = ['=== Sentence 1 ===', GOOD_SECTION, '', '=== Sentence 2 ===', GOOD_SECTION].join(
      '\n',
    );
    const results = parseBatchComprehensionCheckReply(reply, 2);
    expect(results).toEqual([
      { options: ['wrong a', 'correct', 'wrong b', 'wrong c'], correctIndex: 1 },
      { options: ['wrong a', 'correct', 'wrong b', 'wrong c'], correctIndex: 1 },
    ]);
  });

  it('returns null for a missing section without disturbing the others', () => {
    const reply = ['=== Sentence 1 ===', GOOD_SECTION].join('\n');
    const results = parseBatchComprehensionCheckReply(reply, 2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull();
  });

  it('returns null for a malformed section (missing asterisk)', () => {
    const badSection = ['1. wrong a', '2. missing asterisk', '3. wrong b', '4. wrong c'].join('\n');
    const reply = ['=== Sentence 1 ===', badSection].join('\n');
    expect(parseBatchComprehensionCheckReply(reply, 1)[0]).toBeNull();
  });

  it('tolerates sections reordered or interleaved with extra prose', () => {
    const reply = [
      'Sure, here are the checks:',
      '',
      '=== Sentence 2 ===',
      GOOD_SECTION,
      '',
      '=== Sentence 1 ===',
      GOOD_SECTION,
    ].join('\n');
    const results = parseBatchComprehensionCheckReply(reply, 2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
  });
});
