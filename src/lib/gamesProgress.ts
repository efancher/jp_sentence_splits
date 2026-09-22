import type { EffectiveGameSignal, GameRound, GameRoundItem } from '../domain/types';

/**
 * "Games" progress panel (docs/ROADMAP.md "Short games" P3). Pure — no
 * Dexie — same convention as `selfRatingCalibration.ts`/`progressReport.ts`;
 * `src/db/repository.ts#getGamesProgress` does the only fetching. Reads
 * `gameRounds` (local-only, never written to FSRS) purely as a "how is this
 * going" mirror; nothing here feeds back into scheduling.
 */

const SIGNALS_WITH_ANY: readonly EffectiveGameSignal[] = ['weak', 'stale', 'strong', 'any'];

export interface GameAccuracyRow {
  gameId: string;
  rounds: number;
  items: number;
  correct: number;
  accuracy: number | null;
}

export interface SignalAccuracyRow {
  signal: EffectiveGameSignal;
  rounds: number;
  items: number;
  correct: number;
  accuracy: number | null;
}

export interface CuedVsFsrs {
  gameAccuracy: number | null;
  gameItemCount: number;
  fsrsPassRate: number | null;
  fsrsReviewCount: number;
  /** gameAccuracy - fsrsPassRate, when both exist — positive means cued games look easier than unaided FSRS recall. */
  gap: number | null;
}

export interface GamesProgress {
  hasData: boolean;
  totalRounds: number;
  byGame: GameAccuracyRow[];
  /** Includes every signal a round can settle on, incl. the `any` fallback. */
  bySignal: SignalAccuracyRow[];
  cuedVsFsrs: CuedVsFsrs;
}

export interface FsrsReviewInput {
  rating: 'again' | 'hard' | 'good' | 'easy';
}

function itemAccuracy(items: readonly GameRoundItem[]): number | null {
  if (items.length === 0) return null;
  return items.filter((item) => item.correct).length / items.length;
}

function fsrsPassRate(reviews: readonly FsrsReviewInput[]): number | null {
  if (reviews.length === 0) return null;
  return reviews.filter((review) => review.rating !== 'again').length / reviews.length;
}

export function buildGamesProgress(
  rounds: readonly GameRound[],
  fsrsReviews: readonly FsrsReviewInput[],
): GamesProgress {
  const byGameMap = new Map<string, GameRound[]>();
  const bySignalMap = new Map<EffectiveGameSignal, GameRound[]>();
  for (const round of rounds) {
    const gameGroup = byGameMap.get(round.gameId) ?? [];
    gameGroup.push(round);
    byGameMap.set(round.gameId, gameGroup);

    const signalGroup = bySignalMap.get(round.signal) ?? [];
    signalGroup.push(round);
    bySignalMap.set(round.signal, signalGroup);
  }

  const byGame: GameAccuracyRow[] = [...byGameMap.entries()]
    .map(([gameId, gameRounds]) => {
      const items = gameRounds.flatMap((round) => round.items);
      return {
        gameId,
        rounds: gameRounds.length,
        items: items.length,
        correct: items.filter((item) => item.correct).length,
        accuracy: itemAccuracy(items),
      };
    })
    .sort((a, b) => b.rounds - a.rounds);

  const bySignal: SignalAccuracyRow[] = SIGNALS_WITH_ANY.map((signal) => {
    const signalRounds = bySignalMap.get(signal) ?? [];
    const items = signalRounds.flatMap((round) => round.items);
    return {
      signal,
      rounds: signalRounds.length,
      items: items.length,
      correct: items.filter((item) => item.correct).length,
      accuracy: itemAccuracy(items),
    };
  });

  const allItems = rounds.flatMap((round) => round.items);
  const gameAccuracy = itemAccuracy(allItems);
  const fsrsRate = fsrsPassRate(fsrsReviews);

  return {
    hasData: rounds.length > 0,
    totalRounds: rounds.length,
    byGame,
    bySignal,
    cuedVsFsrs: {
      gameAccuracy,
      gameItemCount: allItems.length,
      fsrsPassRate: fsrsRate,
      fsrsReviewCount: fsrsReviews.length,
      gap: gameAccuracy !== null && fsrsRate !== null ? gameAccuracy - fsrsRate : null,
    },
  };
}
