import type { PhraseShadowOutcome } from './phraseShadow';

/**
 * Progression through a chunk chain (see `chunkChain.ts` for the rungs): the learner's own rating
 * decides every move. Got it climbs a rung, Close repeats the rung once and then climbs, Not yet drops
 * a rung. The first rung is only listened to and echoed (a "Next" tap, never rated), so ratings start
 * at the second rung. Pure; the panel owns the state and the logging.
 */

/** Close repeats a rung this many times before the chain climbs anyway. */
export const MAX_CLOSE_REPEATS = 1;
/** A hard stop so a run of Not yets can't loop forever; the chain just ends with what it has. Never below this, however short the chain. */
export const MAX_CHAIN_RATINGS = 12;

/** The stop scales with the chain (about two tries per rung) so a long chain can still reach the whole sentence. */
export function maxChainRatings(rungCount: number): number {
  return Math.max(MAX_CHAIN_RATINGS, rungCount * 2);
}

export interface ChainRating {
  rungIndex: number;
  outcome: PhraseShadowOutcome;
}

export interface ChainSession {
  rungCount: number;
  /** The rung being shadowed now (0 is the shortest, the last is the whole sentence). */
  rungIndex: number;
  /** Close ratings already given at the current rung. */
  closeRepeats: number;
  ratings: ChainRating[];
  done: boolean;
}

export function startChainSession(rungCount: number): ChainSession {
  return { rungCount, rungIndex: 0, closeRepeats: 0, ratings: [], done: rungCount <= 0 };
}

/** The first rung is not rated: "Next" just moves on to the second. */
export function advanceFromFirstRung(session: ChainSession): ChainSession {
  if (session.done || session.rungIndex !== 0 || session.rungCount < 2) return session;
  return { ...session, rungIndex: 1, closeRepeats: 0 };
}

export function rateChainRung(session: ChainSession, outcome: PhraseShadowOutcome): ChainSession {
  if (session.done || session.rungIndex === 0) return session;
  const ratings = [...session.ratings, { rungIndex: session.rungIndex, outcome }];
  const top = session.rungCount - 1;
  const finish = (rungIndex: number): ChainSession => ({ ...session, ratings, rungIndex, closeRepeats: 0, done: true });
  const outOfRatings = ratings.length >= maxChainRatings(session.rungCount);

  if (outcome === 'needed_help') {
    if (outOfRatings) return finish(session.rungIndex);
    return { ...session, ratings, rungIndex: session.rungIndex - 1, closeRepeats: 0 };
  }
  if (outcome === 'close' && session.closeRepeats < MAX_CLOSE_REPEATS && !outOfRatings) {
    return { ...session, ratings, closeRepeats: session.closeRepeats + 1 };
  }
  // Got it, or a Close that has already been repeated: climb, or finish at the top.
  if (session.rungIndex >= top || outOfRatings) return finish(session.rungIndex);
  return { ...session, ratings, rungIndex: session.rungIndex + 1, closeRepeats: 0 };
}

/** The highest rung rated Got it, or null: the span whose words the chain credits (once). */
export function highestGotItRung(session: Pick<ChainSession, 'ratings'>): number | null {
  let best: number | null = null;
  for (const rating of session.ratings) {
    if (rating.outcome === 'got_it' && (best === null || rating.rungIndex > best)) best = rating.rungIndex;
  }
  return best;
}

/**
 * `target.key` of a per-rung `phrase_shadow` event. Deliberately not the `phrase-shadow:` prefix, so a
 * rung rating credits no word and does not count as a pronunciation attempt of its own: only the
 * chain's one summary event (an ordinary phrase-shadow key listing the words) carries that weight.
 */
export const CHAIN_RUNG_KEY_PREFIX = 'chain-rung:';

export function chainRungTargetKey(rungIndex: number): string {
  return `${CHAIN_RUNG_KEY_PREFIX}${rungIndex}`;
}

/** Share of chain runs that open with an unrated-by-the-chain cold whole-sentence try, to compare against the chain's end. */
export const COLD_PASS_SHARE = 0.25;
export const CHAIN_COLD_KEY = 'chain-cold:0';
