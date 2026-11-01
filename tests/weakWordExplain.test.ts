import { describe, expect, it } from 'vitest';

import { explainWeakWordSentences } from '../src/lib/weakWordExplain';

const now = new Date('2026-11-01T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('explainWeakWordSentences', () => {
  const base = {
    wordsBySentence: new Map([
      ['old-weak', ['a']],
      ['new-weak', ['a']],
      ['old-strong', ['b']],
      ['no-words', []],
    ]),
    strengthByWord: new Map([['a', 0.1], ['b', 0.8]]),
    expressionOf: (id: string) => ({ a: '怪我', b: '雨' })[id],
    now,
    minGapDays: 3,
    minWeakness: 0.7,
  };

  it('says which sentences wait on spacing, which have nothing weak, and which can be revisited', () => {
    const rows = explainWeakWordSentences({
      ...base,
      sentences: [
        { sentenceId: 'old-strong', preview: 'x', lastWalkedAt: daysAgo(9) },
        { sentenceId: 'new-weak', preview: 'y', lastWalkedAt: daysAgo(1) },
        { sentenceId: 'old-weak', preview: 'z', lastWalkedAt: daysAgo(4) },
        { sentenceId: 'no-words', preview: 'w', lastWalkedAt: daysAgo(9) },
      ],
    });
    expect(rows.map((r) => [r.sentenceId, r.verdict])).toEqual([
      ['old-weak', 'eligible'],
      ['new-weak', 'too_soon'],
      ['old-strong', 'no_weak_word'],
      ['no-words', 'no_words'],
    ]);
    expect(rows[1]!.detail).toContain('eligible in 2d');
    expect(rows[2]!.detail).toContain('0.30');
  });

  it('treats the weakness threshold as inclusive, like the planner', () => {
    const rows = explainWeakWordSentences({
      ...base,
      strengthByWord: new Map([['a', 0.3]]),
      sentences: [{ sentenceId: 'old-weak', preview: 'z', lastWalkedAt: daysAgo(4) }],
    });
    expect(rows[0]!.verdict).toBe('eligible');
  });
});
