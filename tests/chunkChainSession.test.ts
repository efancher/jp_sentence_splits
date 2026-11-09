import { describe, expect, it } from 'vitest';

import {
  MAX_CHAIN_RATINGS,
  maxChainRatings,
  advanceFromFirstRung,
  highestGotItRung,
  rateChainRung,
  startChainSession,
} from '../src/lib/chunkChainSession';

describe('chunk chain session', () => {
  it('climbs on Got it and finishes after the whole-sentence rung', () => {
    let session = advanceFromFirstRung(startChainSession(3));
    expect(session.rungIndex).toBe(1);
    session = rateChainRung(session, 'got_it');
    expect(session.rungIndex).toBe(2);
    expect(session.done).toBe(false);
    session = rateChainRung(session, 'got_it');
    expect(session.done).toBe(true);
    expect(highestGotItRung(session)).toBe(2);
  });

  it('never rates the first rung', () => {
    const session = startChainSession(3);
    expect(rateChainRung(session, 'got_it')).toBe(session);
  });

  it('repeats a rung once on Close, then climbs', () => {
    let session = advanceFromFirstRung(startChainSession(4));
    session = rateChainRung(session, 'close');
    expect(session.rungIndex).toBe(1);
    session = rateChainRung(session, 'close');
    expect(session.rungIndex).toBe(2);
  });

  it('drops a rung on Not yet', () => {
    let session = advanceFromFirstRung(startChainSession(4));
    session = rateChainRung(session, 'got_it');
    session = rateChainRung(session, 'needed_help');
    expect(session.rungIndex).toBe(1);
    expect(session.done).toBe(false);
  });

  it('ends the chain after too many ratings instead of looping', () => {
    let session = advanceFromFirstRung(startChainSession(3));
    // A Not yet at the second rung drops back to the unrated first rung, so each round needs a Next tap.
    for (let i = 0; i < MAX_CHAIN_RATINGS; i += 1) session = rateChainRung(advanceFromFirstRung(session), 'needed_help');
    expect(session.done).toBe(true);
    expect(highestGotItRung(session)).toBeNull();
  });

  it('lets a long chain use about two ratings per rung before the stop', () => {
    expect(maxChainRatings(3)).toBe(MAX_CHAIN_RATINGS);
    expect(maxChainRatings(20)).toBe(40);
    let session = advanceFromFirstRung(startChainSession(20));
    for (let i = 0; i < 19; i += 1) session = rateChainRung(session, 'got_it');
    expect(session.done).toBe(true);
    expect(session.rungIndex).toBe(19);
  });

  it('credits the highest Got-it rung even if a later rung was not yet', () => {
    let session = advanceFromFirstRung(startChainSession(4));
    session = rateChainRung(session, 'got_it');
    session = rateChainRung(session, 'got_it');
    session = rateChainRung(session, 'needed_help');
    expect(highestGotItRung(session)).toBe(2);
  });
});
