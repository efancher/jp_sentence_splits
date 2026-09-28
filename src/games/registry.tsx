import type { ComponentType } from 'react';

import { EarTilesGame, EAR_TILES_COPY } from '../components/games/EarTilesGame';
import { GrammarDetectiveGame, GRAMMAR_DETECTIVE_GAME_ID } from '../components/games/GrammarDetectiveGame';
import { HomophoneHuntGame } from '../components/games/HomophoneHuntGame';
import { KeystoneGame } from '../components/games/KeystoneGame';
import { OddEarOutGame } from '../components/games/OddEarOutGame';
import { SpeakerMatchGame } from '../components/games/SpeakerMatchGame';
import { ThenAndNowGame } from '../components/games/ThenAndNowGame';
import { VerbLegoGame } from '../components/games/VerbLegoGame';
import {
  ParticlePuzzleGame,
  PARTICLE_COPY,
  PARTICLE_PUZZLE_GAME_ID,
} from '../components/games/ParticlePuzzleGame';
import { WordDetectiveGame, WORD_DETECTIVE_GAME_ID } from '../components/games/WordDetectiveGame';
import {
  getEarTilesCandidates,
  getGrammarDetectiveCandidates,
  getHomophoneHuntData,
  getKeystoneCandidates,
  getOddEarOutData,
  getParticlePuzzleData,
  getSpeakerMatchData,
  getThenAndNowData,
  getVerbLegoData,
  getWordDetectiveCandidates,
  readSettings,
} from '../db/repository';
import type { GameSignal } from '../domain/types';
import {
  DEFAULT_SIGNAL_COPY,
  GAME_SIGNALS,
  signalPoolSizes,
  type SignalCopy,
} from '../lib/gamePicker';
import { EAR_TILES_GAME_ID, EAR_TILES_ROUND_SIZE } from '../lib/earTiles';
import {
  buildHomophoneCandidates,
  buildHomophoneRound,
  HOMOPHONE_HUNT_COPY,
  HOMOPHONE_HUNT_GAME_ID,
  HOMOPHONE_HUNT_MIN_TRIALS,
  HOMOPHONE_HUNT_ROUND_SIZE,
} from '../lib/homophoneHunt';
import {
  GRAMMAR_DETECTIVE_COPY,
  GRAMMAR_DETECTIVE_ROUND_SIZE,
} from '../lib/grammarDetective';
import { KEYSTONE_GAME_ID, KEYSTONE_ROUND_SIZE } from '../lib/keystone';
import {
  buildContrastCandidates,
  ODD_EAR_COPY,
  buildOddEarRound,
  ODD_EAR_MIN_TRIALS,
  ODD_EAR_OUT_GAME_ID,
} from '../lib/oddEarOut';
import { findMinimalPairContrasts } from '../lib/pitchAccentMinimalPairs';
import { PARTICLE_PUZZLE_ROUND_SIZE } from '../lib/particlePuzzle';
import {
  buildSpeakerMatchCandidates,
  buildSpeakerMatchRound,
  SPEAKER_MATCH_COPY,
  SPEAKER_MATCH_GAME_ID,
  SPEAKER_MATCH_MIN_TRIALS,
} from '../lib/speakerMatch';
import { THEN_AND_NOW_GAME_ID, THEN_AND_NOW_ROUND_SIZE } from '../lib/thenAndNow';
import { VERB_LEGO_COPY, VERB_LEGO_GAME_ID, VERB_LEGO_ROUND_SIZE } from '../lib/verbLego';
import { WORD_DETECTIVE_ROUND_SIZE } from '../lib/wordDetective';

export interface GamePools {
  /** Items that passed the game's own eligibility check. */
  eligible: number;
  /** Of those, how many fall in each signal's pool. */
  bySignal: Record<GameSignal, number>;
  /**
   * Overrides the hub's generic "not enough data" message when a game is
   * hidden for a deliberate reason rather than a thin pool — e.g.
   * `settings.pitchAccentPaused` (2026-09-28).
   */
  pausedReason?: string;
}

const PITCH_ACCENT_PAUSED_REASON =
  'Pitch accent is paused — turn it back on in Settings to play this.';

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
      if ((await readSettings()).pitchAccentPaused) {
        return { eligible: 0, bySignal: signalPoolSizes([]), pausedReason: PITCH_ACCENT_PAUSED_REASON };
      }
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
  {
    id: KEYSTONE_GAME_ID,
    title: 'Keystone',
    blurb:
      "Confirmed words you haven't started reviewing yet — for each round, guess which one unlocks the most sentences you haven't read.",
    needs:
      "Needs confirmed words with no study card yet that appear in your books' next unread sentences.",
    skill: 'the no-card backlog',
    roundSize: KEYSTONE_ROUND_SIZE,
    // No FSRS signal applies — every candidate is by definition card-less;
    // the round ranks by upcoming-sentence unlock count instead (see keystone.ts).
    signals: [],
    signalCopy: DEFAULT_SIGNAL_COPY,
    loadPools: async () => {
      const candidates = await getKeystoneCandidates();
      return { eligible: candidates.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: KeystoneGame,
  },
  {
    id: HOMOPHONE_HUNT_GAME_ID,
    title: 'Homophone Hunt',
    blurb:
      'Two real native clips of words that share a reading but not a pitch-accent shape — 箸 vs 橋, both はし. Guess which clip is which, then see both measured contours.',
    needs:
      "Needs two confirmed words that are true homophones (same reading, different accent) with playable native clips — rare in most vocabularies.",
    skill: 'pitch-accent listening',
    roundSize: HOMOPHONE_HUNT_MIN_TRIALS,
    // No `stale`, as in Odd Ear Out: recent accuracy on a pair is just the flip
    // side of `weak`.
    signals: ['weak', 'strong'],
    signalCopy: HOMOPHONE_HUNT_COPY,
    loadPools: async () => {
      if ((await readSettings()).pitchAccentPaused) {
        return { eligible: 0, bySignal: signalPoolSizes([]), pausedReason: PITCH_ACCENT_PAUSED_REASON };
      }
      const { clips, history } = await getHomophoneHuntData();
      const contrasts = findMinimalPairContrasts(clips);
      const candidates = buildHomophoneCandidates(contrasts, history);
      const trials = buildHomophoneRound(
        clips,
        candidates.map((candidate) => candidate.contrast),
        HOMOPHONE_HUNT_ROUND_SIZE,
      );
      return { eligible: trials.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: HomophoneHuntGame,
  },
  {
    id: GRAMMAR_DETECTIVE_GAME_ID,
    title: 'Grammar Detective',
    blurb:
      "A mystery grammar construction from a sentence you've tracked. Type the construction — spend clues (passage context, its role, first kana, audio) to narrow it down, fewer clues score higher.",
    needs: 'Needs tracked grammar patterns whose sentence has a translation.',
    skill: 'grammar construction recall',
    roundSize: GRAMMAR_DETECTIVE_ROUND_SIZE,
    signals: GAME_SIGNALS,
    signalCopy: GRAMMAR_DETECTIVE_COPY,
    loadPools: async () => {
      const candidates = await getGrammarDetectiveCandidates();
      return { eligible: candidates.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: GrammarDetectiveGame,
  },
  {
    id: SPEAKER_MATCH_GAME_ID,
    title: 'Speaker Match',
    blurb:
      'Two real native clips of the same word, from two different books. Guess which clip belongs to the named book, then see both measured pitch contours.',
    needs:
      'Needs a confirmed word mined from playable native clips in two or more different books — rare unless the same word shows up across several books.',
    skill: 'cross-recording listening',
    roundSize: SPEAKER_MATCH_MIN_TRIALS,
    // No `stale`, as in Odd Ear Out/Homophone Hunt: recent accuracy on a word
    // is just the flip side of `weak`.
    signals: ['weak', 'strong'],
    signalCopy: SPEAKER_MATCH_COPY,
    loadPools: async () => {
      if ((await readSettings()).pitchAccentPaused) {
        return { eligible: 0, bySignal: signalPoolSizes([]), pausedReason: PITCH_ACCENT_PAUSED_REASON };
      }
      const { comparisons, history } = await getSpeakerMatchData();
      const candidates = buildSpeakerMatchCandidates(comparisons, history);
      const trials = buildSpeakerMatchRound(
        candidates.map((candidate) => candidate.comparison),
        candidates.length,
      );
      return { eligible: trials.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: SpeakerMatchGame,
  },
  {
    id: EAR_TILES_GAME_ID,
    title: 'Ear Tiles',
    blurb:
      'Hear a real sentence from your books, then rebuild it from shuffled phrase tiles in the order you heard them. The audio decides — no translation unless you peek.',
    needs:
      'Needs sentences with native audio, confirmed vocabulary and a translation that split into 4–7 phrases.',
    skill: 'whole-sentence listening',
    roundSize: EAR_TILES_ROUND_SIZE,
    // All three signals: they come from the FSRS state of the sentence's own words.
    signals: GAME_SIGNALS,
    signalCopy: EAR_TILES_COPY,
    loadPools: async () => {
      const candidates = await getEarTilesCandidates();
      return { eligible: candidates.length, bySignal: signalPoolSizes(candidates) };
    },
    Component: EarTilesGame,
  },
  {
    id: THEN_AND_NOW_GAME_ID,
    title: 'Then & Now',
    blurb:
      "Replay a sentence you read a while ago with the words you didn't know back then turned down quiet, then again at full volume. Purely reflective — nothing here is scored.",
    needs: 'Needs a sentence reviewed a while ago whose linked vocabulary has grown since.',
    skill: 'noticing your own progress',
    roundSize: THEN_AND_NOW_ROUND_SIZE,
    // No FSRS signal applies — this isn't ranked or graded, just a reflective listen.
    signals: [],
    signalCopy: DEFAULT_SIGNAL_COPY,
    loadPools: async () => {
      const clips = await getThenAndNowData();
      return { eligible: clips.length, bySignal: { weak: 0, stale: 0, strong: 0 } };
    },
    Component: ThenAndNowGame,
  },
];

export function findGame(id: string | undefined): GameDef | undefined {
  return GAMES.find((game) => game.id === id);
}
