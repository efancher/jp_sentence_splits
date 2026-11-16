import { describe, expect, it } from 'vitest';

import {
  buildDailyPractice,
  dailyPracticeProgress,
  startOfLocalDayIso,
  type DailyPracticeInput,
} from '../src/lib/dailyPractice';

const base: DailyPracticeInput = {
  quietMode: false,
  pitchDrill: { available: true, focusWordCount: 0, takesToday: 0 },
};

describe('buildDailyPractice', () => {
  it('recommends the pitch drill', () => {
    const items = buildDailyPractice(base);
    expect(items.map((entry) => entry.id)).toEqual(['pitch-drill']);
    expect(items[0]).toMatchObject({ target: 5, done: 0, complete: false, path: '/pitch-accent?mode=word' });
  });

  it('counts progress from the drill log and marks it complete at target', () => {
    const items = buildDailyPractice({ ...base, pitchDrill: { available: true, focusWordCount: 0, takesToday: 7 } });
    expect(items[0]).toMatchObject({ done: 7, complete: true });
    expect(dailyPracticeProgress(items)).toEqual({ done: 1, total: 1 });
  });

  it('points the drill at missed-in-review words when there are any', () => {
    const [drill] = buildDailyPractice({
      ...base,
      pitchDrill: { available: true, focusWordCount: 3, takesToday: 0 },
    });
    expect(drill!.detail).toContain('3 words you missed in review');
  });

  it('recommends nothing in quiet mode or when the drill has no words', () => {
    expect(buildDailyPractice({ ...base, quietMode: true })).toEqual([]);
    expect(buildDailyPractice({ ...base, pitchDrill: { available: false, focusWordCount: 0, takesToday: 0 } })).toEqual([]);
  });
});

describe('startOfLocalDayIso', () => {
  it('is local midnight', () => {
    const start = new Date(startOfLocalDayIso(new Date(2026, 8, 19, 15, 45)));
    expect([start.getHours(), start.getMinutes(), start.getDate()]).toEqual([0, 0, 19]);
  });
});
