import { describe, expect, it } from 'vitest';

import {
  buildDailyPractice,
  dailyPracticeProgress,
  rotatingGameOrder,
  startOfLocalDayIso,
  type DailyPracticeInput,
} from '../src/lib/dailyPractice';

const base: DailyPracticeInput = {
  quietMode: false,
  pitchDrill: { available: true, focusWordCount: 0, takesToday: 0 },
  oddEarOut: { available: true, roundsToday: 0 },
  rotatingGame: { id: 'verb-lego', title: 'Verb Lego', roundsToday: 0 },
};

describe('buildDailyPractice', () => {
  it('recommends the pitch drill, Odd Ear Out and the rotating game, in that order', () => {
    const items = buildDailyPractice(base);
    expect(items.map((entry) => entry.id)).toEqual(['pitch-drill', 'odd-ear-out', 'game:verb-lego']);
    expect(items[0]).toMatchObject({ target: 5, done: 0, complete: false, path: '/pitch-accent?mode=word' });
    expect(items[2]!.path).toBe('/play/verb-lego/auto');
  });

  it('counts progress from the logs and marks items complete at target', () => {
    const items = buildDailyPractice({
      ...base,
      pitchDrill: { available: true, focusWordCount: 0, takesToday: 7 },
      oddEarOut: { available: true, roundsToday: 1 },
    });
    expect(items[0]).toMatchObject({ done: 7, complete: true });
    expect(items[1]).toMatchObject({ done: 1, complete: true });
    expect(dailyPracticeProgress(items)).toEqual({ done: 2, total: 3 });
  });

  it('points the drill at missed-in-review words when there are any', () => {
    const [drill] = buildDailyPractice({
      ...base,
      pitchDrill: { available: true, focusWordCount: 3, takesToday: 0 },
    });
    expect(drill!.detail).toContain('3 words you missed in review');
  });

  it('leaves the recording drill out in quiet mode but keeps the listening game', () => {
    const items = buildDailyPractice({ ...base, quietMode: true });
    expect(items.map((entry) => entry.id)).toEqual(['odd-ear-out', 'game:verb-lego']);
  });

  it('omits items that cannot be played', () => {
    const items = buildDailyPractice({
      ...base,
      pitchDrill: { available: false, focusWordCount: 0, takesToday: 0 },
      oddEarOut: { available: false, roundsToday: 0 },
      rotatingGame: undefined,
    });
    expect(items).toEqual([]);
  });
});

describe('rotatingGameOrder', () => {
  const ids = ['a', 'b', 'c'];

  it('is stable within a day and covers every game', () => {
    const morning = rotatingGameOrder(ids, new Date(2026, 8, 19, 7, 0));
    const night = rotatingGameOrder(ids, new Date(2026, 8, 19, 23, 30));
    expect(morning).toEqual(night);
    expect([...morning].sort()).toEqual(ids);
  });

  it('advances by one game each day', () => {
    const today = rotatingGameOrder(ids, new Date(2026, 8, 19, 12));
    const tomorrow = rotatingGameOrder(ids, new Date(2026, 8, 20, 12));
    expect(tomorrow[0]).toBe(today[1]);
  });

  it('handles no games', () => {
    expect(rotatingGameOrder([], new Date())).toEqual([]);
  });
});

describe('startOfLocalDayIso', () => {
  it('is local midnight', () => {
    const start = new Date(startOfLocalDayIso(new Date(2026, 8, 19, 15, 45)));
    expect([start.getHours(), start.getMinutes(), start.getDate()]).toEqual([0, 0, 19]);
  });
});
