import { describe, expect, it } from 'vitest';

import {
  formatComprehensionPromptForAI,
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
