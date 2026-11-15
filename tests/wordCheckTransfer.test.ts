import { describe, expect, it } from 'vitest';

import { buildRecommendedSession, sessionStepTargetPath, type SessionPlannerInput } from '../src/lib/sessionPlanner';
import { pickTransferSentence } from '../src/lib/wordCheckSteps';

describe('pickTransferSentence', () => {
  it('prefers the sentence where the word is the only gap, then the shorter one', () => {
    const options = [
      { sentenceId: 'busy', otherWeakWords: 3, length: 10 },
      { sentenceId: 'long', otherWeakWords: 0, length: 30 },
      { sentenceId: 'short', otherWeakWords: 0, length: 12 },
    ];
    expect(pickTransferSentence(options)?.sentenceId).toBe('short');
    expect(pickTransferSentence(options, new Set(['short']))?.sentenceId).toBe('long');
    expect(pickTransferSentence(options, new Set(['short', 'long', 'busy']))).toBeUndefined();
  });
});

describe('moved Word checks in the plan', () => {
  function input(): SessionPlannerInput {
    return {
      now: new Date('2026-11-15T12:00:00.000Z'),
      totalMinutes: 60,
      recentActivity: [],
      retainDue: [],
      practiceDue: [],
      shadowCandidates: [],
      exploreCandidates: [
        { bookId: 'b1', label: 'Book', reason: 'Continue', sentences: [{ sentenceId: 'lesson', preview: 'x' }] },
      ],
      wordCheckCandidates: [
        {
          bookId: 'b1', sentenceId: 'lesson', preview: '猫が鳴く', reason: 'moved', word: '猫',
          source: { bookId: 'b1', sentenceId: 'walked1', preview: '猫が好き', reason: 'own' },
        },
        {
          bookId: 'b2', sentenceId: 'unstudied', preview: '犬が走る', reason: 'moved', word: '犬',
          source: { bookId: 'b1', sentenceId: 'walked2', preview: '犬です', reason: 'own' },
        },
      ],
    };
  }

  it('names the word in the path, and falls back to the walked sentence when the other is a new lesson', () => {
    const session = buildRecommendedSession(input());
    expect(session.steps.some((step) => step.sentenceId === 'lesson' && !step.wordCheck)).toBe(true);
    const checks = session.steps.filter((step) => step.wordCheck);
    expect(checks.map((step) => step.sentenceId)).toEqual(['walked1', 'unstudied']);
    expect(checks[0]!.wordCheckWord).toBeUndefined();
    expect(sessionStepTargetPath(checks[0]!)).toBe('/books/b1/check/walked1');
    expect(checks[1]).toMatchObject({ bookId: 'b2', wordCheckWord: '犬' });
    expect(sessionStepTargetPath(checks[1]!)).toBe(`/books/b2/check/unstudied/${encodeURIComponent('犬')}`);
  });
});
