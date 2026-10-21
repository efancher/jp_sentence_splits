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
/**
 * Per-game cap on the eligibility check. Game breaks are optional garnish on
 * a plan, but every pool loader scans whole tables and some (`loadAlignmentsBulk`)
 * can wait on the network, so one slow game used to freeze "+N min" on Home.
 * A game that misses the cap is simply left out of this plan.
 */
export const GAME_POOL_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const TIMED_OUT = Symbol('timed-out');

export async function loadGameBreakCandidates(now: Date = new Date()): Promise<GameBreakCandidate[]> {
  const checked = await Promise.all(
    GAMES.map(async (game) => {
      try {
        const started = performance.now();
        const pools = await withTimeout(game.loadPools(), GAME_POOL_TIMEOUT_MS);
        if (pools === TIMED_OUT) {
          console.warn(`[game breaks] ${game.id} eligibility check timed out after ${GAME_POOL_TIMEOUT_MS}ms — skipped`);
          return null;
        }
        const elapsed = performance.now() - started;
        if (elapsed > 500) console.warn(`[game breaks] ${game.id} eligibility took ${Math.round(elapsed)}ms`);
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
