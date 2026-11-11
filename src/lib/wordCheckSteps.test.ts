import { describe, expect, it } from 'vitest';

import { dueWordChecks, type WordCheckSentence } from './wordCheckSteps';

const DAY = 86_400_000;
const now = 100 * DAY;

function sentence(id: string, fields: Partial<WordCheckSentence> = {}): WordCheckSentence {
  return { sentenceId: id, lastWalkedAt: now - 10 * DAY, word: { label: id, meaningStrength: 0.2 }, ...fields };
}

describe('dueWordChecks', () => {
  it('needs a word whose meaning is not solid, and a walkthrough at least a day old', () => {
    const due = dueWordChecks({
      now,
      sentences: [
        sentence('ok'),
        sentence('no-word', { word: undefined }),
        sentence('solid', { word: { label: 'solid', meaningStrength: 0.7 } }),
        sentence('today', { lastWalkedAt: now - DAY / 2 }),
      ],
    });
    expect(due.map((entry) => entry.sentenceId)).toEqual(['ok']);
    expect(due[0]!.reason).toContain("hasn't been checked");
  });

  it('spaces a sentence from its last meaning check: 7 days after got it, 2 after a slip', () => {
    const ids = (sentences: WordCheckSentence[]) => dueWordChecks({ now, sentences }).map((entry) => entry.sentenceId);
    expect(ids([sentence('a', { lastCheck: { at: now - 3 * DAY, gotIt: true } })])).toEqual([]);
    expect(ids([sentence('a', { lastCheck: { at: now - 8 * DAY, gotIt: true } })])).toEqual(['a']);
    expect(ids([sentence('a', { lastCheck: { at: now - DAY, gotIt: false } })])).toEqual([]);
    expect(ids([sentence('a', { lastCheck: { at: now - 3 * DAY, gotIt: false } })])).toEqual(['a']);
  });

  it('puts a sentence whose Read check needed help first and skips its wait, until a meaning check follows', () => {
    const struggling = sentence('struggling', {
      lastCheck: { at: now - 3 * DAY, gotIt: true },
      lastReadCheck: { at: now - DAY, gotIt: false },
    });
    const answered = sentence('answered', {
      lastCheck: { at: now - DAY / 2, gotIt: true },
      lastReadCheck: { at: now - DAY, gotIt: false },
    });
    const due = dueWordChecks({ now, sentences: [sentence('plain'), answered, struggling] });
    expect(due.map((entry) => entry.sentenceId)).toEqual(['struggling', 'plain']);
    expect(due[0]).toMatchObject({ struggling: true });
    expect(due[0]!.reason).toContain('needed help');
  });

  it('orders recently walked sentences ahead of older ones, then by weakest word', () => {
    const due = dueWordChecks({
      now,
      sentences: [
        sentence('old-weak', { word: { label: 'x', meaningStrength: 0.1 } }),
        sentence('old-weaker', { word: { label: 'y', meaningStrength: 0.05 } }),
        sentence('recent', { lastWalkedAt: now - 2 * DAY, word: { label: 'z', meaningStrength: 0.5 } }),
      ],
    });
    expect(due.map((entry) => entry.sentenceId)).toEqual(['recent', 'old-weaker', 'old-weak']);
  });
});
