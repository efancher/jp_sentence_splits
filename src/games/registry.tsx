import type { ComponentType } from 'react';

import { WordDetectiveGame, WORD_DETECTIVE_GAME_ID } from '../components/games/WordDetectiveGame';
import { getWordDetectiveCandidates } from '../db/repository';
import type { GameSignal } from '../domain/types';
import { signalPoolSizes } from '../lib/gamePicker';
import { WORD_DETECTIVE_ROUND_SIZE } from '../lib/wordDetective';

export interface GamePools {
  /** Items that passed the game's own eligibility check. */
  eligible: number;
  /** Of those, how many fall in each signal's pool. */
  bySignal: Record<GameSignal, number>;
}

export interface GameDef {
  id: string;
  title: string;
  blurb: string;
  /** Shown on the hub when `eligible < roundSize`, so a hidden game says why. */
  needs: string;
  roundSize: number;
  loadPools: () => Promise<GamePools>;
  Component: ComponentType<{ signal: GameSignal }>;
}

/** Every short game under `/play`. Each supplies its own eligibility (`loadPools`) — the hub hides a game/signal that can't fill a round, with a reason. */
export const GAMES: readonly GameDef[] = [
  {
    id: WORD_DETECTIVE_GAME_ID,
    title: 'Word Detective',
    blurb:
      'A mystery word from your own books, blanked out of a real sentence. Type its reading — spend clues to narrow it down, and fewer clues score higher.',
    needs: 'Needs confirmed words you have met in two different sentences.',
    roundSize: WORD_DETECTIVE_ROUND_SIZE,
    loadPools: async () => {
      const candidates = await getWordDetectiveCandidates();
      return { eligible: candidates.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: WordDetectiveGame,
  },
];

export function findGame(id: string | undefined): GameDef | undefined {
  return GAMES.find((game) => game.id === id);
}
