import { describe, expect, it } from 'vitest';

import type { SentenceLearningEvent } from '../src/domain/types';
import { readCheckReason, sentencesDueForReadCheck } from '../src/lib/readCheck';

const now = new Date(2026, 10, 10, 12, 0, 0);
const daysAgo = (n: number) => new Date(2026, 10, 10 - n, 9, 0, 0).toISOString();
let counter = 0;
const event = (sentenceId: string, action: SentenceLearningEvent['action'], n: number, outcome?: 'got_it' | 'needed_help'): SentenceLearningEvent => ({
  id: `e${counter++}`, visitId: 'v', bookId: 'b', sentenceId, action, timestamp: daysAgo(n), ...(outcome ? { outcome } : {}),
});

describe('sentencesDueForReadCheck', () => {
  it('waits a day after the walkthrough, then asks', () => {
    expect(sentencesDueForReadCheck([event('today', 'walkthrough_completed', 0)], now)).toEqual([]);
    const [due] = sentencesDueForReadCheck([event('s', 'walkthrough_completed', 1)], now);
    expect(due).toMatchObject({ sentenceId: 's', neverChecked: true, overdueDays: 0, streak: 0 });
  });

  it('ignores sentences that were never walked through', () => {
    expect(sentencesDueForReadCheck([event('s', 'gist_check', 5, 'got_it')], now)).toEqual([]);
  });

  it('stretches the gap with each got-it day and resets after needed help', () => {
    const walked = event('s', 'walkthrough_completed', 20);
    // Two good checks make the gap 4 days; a third good check 3 days ago makes it 8, so it is not due again yet.
    const twoGood = [walked, event('s', 'gist_check', 10, 'got_it'), event('s', 'gist_check', 6, 'got_it')];
    expect(sentencesDueForReadCheck([...twoGood, event('s', 'gist_check', 3, 'got_it')], now)).toEqual([]);
    // Without that third check the last contact is 6 days ago, 2 days past the 4-day gap.
    expect(sentencesDueForReadCheck(twoGood, now)[0]).toMatchObject({ streak: 2, daysSinceContact: 6, overdueDays: 2 });
  });

  it('counts a streak per day and resets on needed help', () => {
    const walked = event('s', 'walkthrough_completed', 30);
    const good = [walked, event('s', 'gist_check', 12, 'got_it'), event('s', 'gist_check', 12, 'got_it'), event('s', 'gist_check', 8, 'got_it')];
    // Streak 2 (two days; same-day repeat counts once) → gap 4d; last contact 8d ago → due, 4d overdue.
    expect(sentencesDueForReadCheck(good, now)[0]).toMatchObject({ streak: 2, overdueDays: 4, neededHelpLast: false });
    const reset = [...good, event('s', 'gist_check', 2, 'needed_help')];
    // Needed help resets to the first rung (1 day); seen 2 days ago → due.
    expect(sentencesDueForReadCheck(reset, now)[0]).toMatchObject({ streak: 0, neededHelpLast: true });
  });

  it('treats a Fresh try as contact, pushing the next check out', () => {
    const events = [event('s', 'walkthrough_completed', 9), event('s', 'walkthrough_completed', 0)];
    expect(sentencesDueForReadCheck(events, now)).toEqual([]);
  });

  it('puts needed-help sentences first, then the most overdue', () => {
    const events = [
      event('old', 'walkthrough_completed', 40),
      event('help', 'walkthrough_completed', 30), event('help', 'gist_check', 5, 'needed_help'),
      event('recent', 'walkthrough_completed', 2),
    ];
    expect(sentencesDueForReadCheck(events, now).map((d) => d.sentenceId)).toEqual(['help', 'old', 'recent']);
  });

  it('says why in plain words', () => {
    const [help] = sentencesDueForReadCheck([event('s', 'walkthrough_completed', 9), event('s', 'gist_check', 3, 'needed_help')], now);
    expect(readCheckReason(help!)).toContain('needed help');
    const [fresh] = sentencesDueForReadCheck([event('s', 'walkthrough_completed', 3)], now);
    expect(readCheckReason(fresh!)).toContain('read it unaided');
  });
});
