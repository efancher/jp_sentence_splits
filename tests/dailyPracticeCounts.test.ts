import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDailyPracticeCounts, logGameRound, logPitchDrillAttempt } from '../src/db/repository';

beforeEach(async () => {
  await resetDbForTests();
});

const attempt = (now: Date) =>
  logPitchDrillAttempt({
    mode: 'word',
    surfaceForm: '橋',
    reading: 'はし',
    contextSentenceId: 's1',
    measured: true,
    mismatch: false,
    focusTriggered: false,
    now,
  });

describe('getDailyPracticeCounts', () => {
  it("counts only today's pitch drill takes and game rounds, per game", async () => {
    const noon = new Date(2026, 8, 19, 12, 0);
    await attempt(new Date(2026, 8, 19, 0, 5));
    await attempt(noon);
    await attempt(new Date(2026, 8, 18, 23, 55)); // yesterday
    await logGameRound({ gameId: 'odd-ear-out', signal: 'weak', poolSize: 5, items: [], now: noon });
    await logGameRound({ gameId: 'odd-ear-out', signal: 'weak', poolSize: 5, items: [], now: noon });
    await logGameRound({ gameId: 'verb-lego', signal: 'weak', poolSize: 5, items: [], now: noon });
    await logGameRound({
      gameId: 'odd-ear-out',
      signal: 'weak',
      poolSize: 5,
      items: [],
      now: new Date(2026, 8, 18, 20, 0),
    });

    const counts = await getDailyPracticeCounts(noon);
    expect(counts.pitchDrillTakes).toBe(2);
    expect(counts.roundsByGame).toEqual({ 'odd-ear-out': 2, 'verb-lego': 1 });
  });

  it('is empty on a fresh day', async () => {
    expect(await getDailyPracticeCounts(new Date(2026, 8, 19, 9, 0))).toEqual({
      pitchDrillTakes: 0,
      roundsByGame: {},
    });
  });
});
