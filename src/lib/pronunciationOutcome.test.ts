import { describe, expect, it } from 'vitest';
import { buildPronunciationAttempts, shadowTargetKey } from './pronunciationOutcome';

const ev = (action: 'target_practice' | 'phrase_shadow' | 'gist_check', key: string | undefined, outcome: 'got_it' | 'close' | 'needed_help' | undefined, day: number) => ({
  sentenceId: 's1',
  timestamp: new Date(Date.UTC(2026, 10, day)).toISOString(),
  action,
  target: key ? { kind: 'expression' as const, key, label: 'x' } : undefined,
  outcome,
});

describe('buildPronunciationAttempts', () => {
  it('collects sentence self-ratings and phrase shadows oldest first, and nothing else', () => {
    const attempts = buildPronunciationAttempts([
      ev('phrase_shadow', 'phrase-shadow:w1', 'close', 3),
      ev('target_practice', shadowTargetKey('s1'), 'got_it', 2),
      ev('target_practice', 'vocab:w1', 'got_it', 1), // a word check
      ev('gist_check', undefined, 'got_it', 1),
      ev('target_practice', shadowTargetKey('s1'), undefined, 4), // no outcome
    ]);
    expect(attempts.map((a) => [a.at, a.success])).toEqual([
      [Date.UTC(2026, 10, 2), true],
      [Date.UTC(2026, 10, 3), false],
    ]);
  });
});
