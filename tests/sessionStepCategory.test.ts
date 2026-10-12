import { describe, expect, it } from 'vitest';

import { sessionStepCategory } from '../src/lib/sessionStepCategory';

describe('sessionStepCategory', () => {
  it('separates fresh tries from first lessons and vocabulary', () => {
    const base = { bucket: 'glossing' as const, label: 'x' };
    expect(sessionStepCategory({ ...base, targetKind: 'sentence_learning' })).toBe('learn_sentence');
    expect(sessionStepCategory({ ...base, targetKind: 'sentence_learning', revisit: true })).toBe('fresh_try');
    expect(sessionStepCategory({ ...base, targetKind: 'sentence_learning', label: 'Fresh try: こんにちは' })).toBe('fresh_try');
    expect(sessionStepCategory({ ...base, targetKind: 'vocabulary_review' })).toBe('vocabulary');
    expect(sessionStepCategory({ ...base, targetKind: 'continue_book' })).toBe('learn_sentence');
  });

  it('maps the remaining target kinds', () => {
    const base = { bucket: 'review' as const, label: 'x' };
    expect(sessionStepCategory({ ...base, targetKind: 'review' })).toBe('review');
    expect(sessionStepCategory({ ...base, targetKind: 'shadow' })).toBe('shadowing');
    expect(sessionStepCategory({ ...base, targetKind: 'grammar_noticing' })).toBe('grammar');
    expect(sessionStepCategory({ ...base, targetKind: 'game' })).toBe('game');
  });
});
