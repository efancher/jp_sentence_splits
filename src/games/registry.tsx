import type { ComponentType } from 'react';

import {
  ParticlePuzzleGame,
  PARTICLE_COPY,
  PARTICLE_PUZZLE_GAME_ID,
} from '../components/games/ParticlePuzzleGame';
import { WordDetectiveGame, WORD_DETECTIVE_GAME_ID } from '../components/games/WordDetectiveGame';
import { getParticlePuzzleData, getWordDetectiveCandidates } from '../db/repository';
import type { GameSignal } from '../domain/types';
import {
  DEFAULT_SIGNAL_COPY,
  GAME_SIGNALS,
  signalPoolSizes,
  type SignalCopy,
} from '../lib/gamePicker';
import { PARTICLE_PUZZLE_ROUND_SIZE } from '../lib/particlePuzzle';
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
  /** Which signals this game offers on the hub (a game can lack a meaningful `stale`). */
  signals: readonly GameSignal[];
  /** Per-signal blurbs shown on the hub; defaults describe vocabulary. */
  signalCopy: SignalCopy;
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
    signals: GAME_SIGNALS,
    signalCopy: DEFAULT_SIGNAL_COPY,
    loadPools: async () => {
      const candidates = await getWordDetectiveCandidates();
      return { eligible: candidates.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: WordDetectiveGame,
  },
  {
    id: PARTICLE_PUZZLE_GAME_ID,
    title: 'Particle Puzzle',
    blurb:
      'A real sentence from your books with its particles pulled out. Tap each particle into the blank where it belongs — they share one bank, so every choice constrains the rest.',
    needs: 'Needs sentences whose vocabulary you have confirmed, with two or more particles.',
    roundSize: PARTICLE_PUZZLE_ROUND_SIZE,
    // No `stale`: recent accuracy on a sentence's particles is just the flip
    // side of `weak`, so a third signal would only duplicate it.
    signals: ['weak', 'strong'],
    signalCopy: PARTICLE_COPY,
    loadPools: async () => {
      const { candidates } = await getParticlePuzzleData();
      return { eligible: candidates.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: ParticlePuzzleGame,
  },
];

export function findGame(id: string | undefined): GameDef | undefined {
  return GAMES.find((game) => game.id === id);
}
