import { describe, expect, it } from 'vitest';

import { summariseChainOutcomes, type ChainEventRow } from '../scripts/lib/chunkChainOutcomes';

let clock = 0;
const row = (visitId: string, targetKey: string, outcome: string): ChainEventRow => ({
  visitId, sentenceId: `s-${visitId}`, targetKey, outcome, timestamp: new Date(2026, 10, 8, 0, 0, (clock += 1)).toISOString(),
});

describe('summariseChainOutcomes', () => {
  it('compares each cold try with the last rung rated in the same visit', () => {
    const summary = summariseChainOutcomes([
      row('a', 'chain-cold:0', 'needed_help'), row('a', 'chain-rung:1', 'close'), row('a', 'chain-rung:2', 'got_it'),
      row('b', 'chain-cold:0', 'got_it'), row('b', 'chain-rung:1', 'got_it'), row('b', 'chain-rung:2', 'needed_help'),
      row('c', 'chain-rung:1', 'got_it'), // no cold try: counted as a visit, not compared
      row('d', 'phrase-shadow:x', 'got_it'), // not a chain event
    ]);
    expect(summary).toMatchObject({ chainVisits: 3, coldVisits: 2, comparable: 2, better: 1, worse: 1, same: 0, coldGotIt: 1, topGotIt: 1 });
  });

  it('reports nothing comparable when a cold try had no rungs after it', () => {
    const summary = summariseChainOutcomes([row('a', 'chain-cold:0', 'close')]);
    expect(summary).toMatchObject({ coldVisits: 1, comparable: 0 });
  });
});
