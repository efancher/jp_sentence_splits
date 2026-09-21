import type { ComponentType } from 'react';

import { OddEarOutGame } from '../components/games/OddEarOutGame';
import { VerbLegoGame } from '../components/games/VerbLegoGame';
import {
  ParticlePuzzleGame,
  PARTICLE_COPY,
  PARTICLE_PUZZLE_GAME_ID,
} from '../components/games/ParticlePuzzleGame';
import { WordDetectiveGame, WORD_DETECTIVE_GAME_ID } from '../components/games/WordDetectiveGame';
import {
  getOddEarOutData,
  getParticlePuzzleData,
  getVerbLegoData,
  getWordDetectiveCandidates,
} from '../db/repository';
import type { GameSignal } from '../domain/types';
import {
  DEFAULT_SIGNAL_COPY,
  GAME_SIGNALS,
  signalPoolSizes,
  type SignalCopy,
} from '../lib/gamePicker';
import {
  buildContrastCandidates,
  ODD_EAR_COPY,
  buildOddEarRound,
  ODD_EAR_MIN_TRIALS,
  ODD_EAR_OUT_GAME_ID,
} from '../lib/oddEarOut';
import { PARTICLE_PUZZLE_ROUND_SIZE } from '../lib/particlePuzzle';
import { VERB_LEGO_COPY, VERB_LEGO_GAME_ID, VERB_LEGO_ROUND_SIZE } from '../lib/verbLego';
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
  /** Short skill the game trains, for a session break's reason line. */
  skill: string;
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
    skill: 'word readings in context',
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
    skill: 'particles',
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
  {
    id: ODD_EAR_OUT_GAME_ID,
    title: 'Odd Ear Out',
    blurb:
      'Four real native clips of same-length words — three share an accent shape, one does not. Listen, tap the odd one, then see all four measured pitch contours side by side.',
    needs:
      'Needs enough words with native audio — same-length groups sharing an accent shape plus a contrasting one — to build a few rounds (counted in rounds).',
    skill: 'pitch-accent listening',
    // Trials needed (a round is up to 5; it may reuse a contrast with fresh words).
    roundSize: ODD_EAR_MIN_TRIALS,
    // No `stale`, as in Particle Puzzle: recent accuracy on a shape pair is just
    // the flip side of `weak`.
    signals: ['weak', 'strong'],
    signalCopy: ODD_EAR_COPY,
    loadPools: async () => {
      const { clips, history } = await getOddEarOutData();
      const candidates = buildContrastCandidates(clips, history);
      // Eligibility is how many trials a round could actually be built with, not
      // how many contrasts exist — contrasts can share a small word pool.
      const trials = buildOddEarRound(
        clips,
        candidates.map((candidate) => candidate.contrast),
        'pool',
      ).length;
      return { eligible: trials, bySignal: signalPoolSizes(candidates) };
    },
    Component: OddEarOutGame,
  },
  {
    id: VERB_LEGO_GAME_ID,
    title: 'Verb Lego',
    blurb:
      'Build stacked verb forms piece by piece — 聞か＋れ＋た, 食べ＋させ＋られ＋なかっ＋た. Some come from your own sentences, some are composed from verbs you know. Tap the next piece; wrong picks cost points.',
    needs:
      'Needs several different verb-form patterns: sentences with vocabulary you have confirmed, or confirmed godan/ichidan verbs.',
    skill: 'stacked verb forms',
    roundSize: VERB_LEGO_ROUND_SIZE,
    // No `stale`, as in the other history-based games: recent accuracy on a
    // piece is just the flip side of `weak`.
    signals: ['weak', 'strong'],
    signalCopy: VERB_LEGO_COPY,
    loadPools: async () => {
      const { candidates } = await getVerbLegoData();
      return { eligible: candidates.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: VerbLegoGame,
  },
];

export function findGame(id: string | undefined): GameDef | undefined {
  return GAMES.find((game) => game.id === id);
}
