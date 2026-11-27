import { describe, expect, it } from 'vitest';

import { summariseIPlusOne, type IPlusOneStatusEntry } from './iPlusOneStatus';

const entry = (sentenceId: string, rank: number, ...newPieces: string[]): IPlusOneStatusEntry => ({
  sentenceId,
  rank,
  newPieces,
});

describe('summariseIPlusOne', () => {
  it('counts nothing-new sentences before the first new-piece sentence', () => {
    const status = summariseIPlusOne([entry('a', 0), entry('b', 1), entry('c', 2, '雨'), entry('d', 3)]);
    expect(status.readyNow).toBe(3);
    expect(status.beforeNext).toBe(2);
    expect(status.next[0]).toMatchObject({ sentenceId: 'c', newPieces: ['雨'] });
  });

  it('counts other sentences a new piece would complete, excluding the step itself', () => {
    const status = summariseIPlusOne([
      entry('a', 0, '雨'),
      entry('b', 1, '雨'),
      entry('c', 2, '雨', '傘'),
      entry('d', 3, '風'),
    ]);
    expect(status.next[0]).toMatchObject({ sentenceId: 'a', unlocks: 1 });
    // 傘 completes c; 雨 is already known by then.
    expect(status.next[1]).toMatchObject({ sentenceId: 'c', newPieces: ['雨', '傘'], unlocks: 0 });
    expect(status.next[2]).toMatchObject({ sentenceId: 'd', unlocks: 0 });
  });

  it('splits nearly-ready from further-away sentences and handles an empty pool', () => {
    const status = summariseIPlusOne([entry('a', 0, '1'), entry('b', 1, '1', '2'), entry('c', 2, '1', '2', '3')]);
    expect(status.nearlyReady).toBe(2);
    expect(status.further).toBe(1);
    expect(summariseIPlusOne([])).toEqual({ readyNow: 0, beforeNext: 0, nearlyReady: 0, further: 0, next: [] });
  });
});
