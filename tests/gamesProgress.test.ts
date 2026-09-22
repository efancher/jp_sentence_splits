import { describe, expect, it } from 'vitest';

import type { GameRound, GameRoundItem } from '../src/domain/types';
import { buildGamesProgress } from '../src/lib/gamesProgress';

function item(correct: boolean): GameRoundItem {
  return { ref: 'x', correct, cluesUsed: 0, wrongGuesses: 0, points: correct ? 1 : 0, ms: 100 };
}

function round(
  gameId: string,
  signal: GameRound['signal'],
  outcomes: boolean[],
  timestamp = '2026-09-21T00:00:00Z',
): GameRound {
  return { id: `r_${gameId}_${timestamp}_${Math.random()}`, timestamp, gameId, signal, poolSize: 10, items: outcomes.map(item) };
}

describe('buildGamesProgress', () => {
  it('reports no data with no rounds', () => {
    const result = buildGamesProgress([], []);
    expect(result.hasData).toBe(false);
    expect(result.byGame).toEqual([]);
    expect(result.cuedVsFsrs.gap).toBeNull();
  });

  it('groups accuracy by game, most-played first', () => {
    const rounds = [
      round('word-detective', 'weak', [true, true, false]),
      round('particle-puzzle', 'strong', [true]),
      round('word-detective', 'stale', [true]),
    ];
    const result = buildGamesProgress(rounds, []);
    expect(result.byGame[0]).toEqual({
      gameId: 'word-detective',
      rounds: 2,
      items: 4,
      correct: 3,
      accuracy: 0.75,
    });
    expect(result.byGame[1].gameId).toBe('particle-puzzle');
  });

  it('groups accuracy by signal, including every signal even with zero rounds', () => {
    const rounds = [round('word-detective', 'weak', [true, false])];
    const result = buildGamesProgress(rounds, []);
    const bySignal = Object.fromEntries(result.bySignal.map((row) => [row.signal, row]));
    expect(bySignal.weak).toEqual({ signal: 'weak', rounds: 1, items: 2, correct: 1, accuracy: 0.5 });
    expect(bySignal.strong).toEqual({ signal: 'strong', rounds: 0, items: 0, correct: 0, accuracy: null });
    expect(bySignal.any).toEqual({ signal: 'any', rounds: 0, items: 0, correct: 0, accuracy: null });
  });

  it('compares overall game accuracy against the FSRS pass rate', () => {
    const rounds = [round('word-detective', 'weak', [true, true, true, false])]; // 0.75
    const fsrsReviews = [
      { rating: 'good' as const },
      { rating: 'good' as const },
      { rating: 'again' as const },
      { rating: 'again' as const },
    ]; // 0.5
    const result = buildGamesProgress(rounds, fsrsReviews);
    expect(result.cuedVsFsrs.gameAccuracy).toBeCloseTo(0.75);
    expect(result.cuedVsFsrs.fsrsPassRate).toBeCloseTo(0.5);
    expect(result.cuedVsFsrs.gap).toBeCloseTo(0.25);
  });

  it('gap is null unless both sides have data', () => {
    const rounds = [round('word-detective', 'weak', [true])];
    expect(buildGamesProgress(rounds, []).cuedVsFsrs.gap).toBeNull();
    expect(buildGamesProgress([], [{ rating: 'good' }]).cuedVsFsrs.gap).toBeNull();
  });
});
