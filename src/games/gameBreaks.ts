import type { GameBreakCandidate } from '../lib/sessionPlanner';
import { rotatingGameOrder } from '../lib/dailyPractice';
import { GAMES } from './registry';

/**
 * The `/play` games that can fill a round right now, ordered for use as
 * session breaks (`addMinutesToTodaySession`'s `gameBreakGames`). Same
 * eligibility check as the hub and the daily-practice panel (`loadPools`
 * against `roundSize`); a game whose pool can't be read is left out rather
 * than failing the plan. Order rotates by calendar day so the same game
 * doesn't lead every session.
 */
export async function loadGameBreakCandidates(now: Date = new Date()): Promise<GameBreakCandidate[]> {
  const checked = await Promise.all(
    GAMES.map(async (game) => {
      try {
        const pools = await game.loadPools();
        return pools.eligible >= game.roundSize ? game : null;
      } catch {
        return null;
      }
    }),
  );
  const playable = new Map(
    checked.flatMap((game) => (game ? [[game.id, game] as const] : [])),
  );
  return rotatingGameOrder([...playable.keys()], now).map((id) => {
    const game = playable.get(id)!;
    return { gameId: game.id, title: game.title, skill: game.skill };
  });
}
