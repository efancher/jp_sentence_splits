import { describe, expect, it } from 'vitest';

import type { TimingObservation } from '../src/lib/timingObservations';
import { rankObservations, selectPrimaryObservation } from '../src/lib/feedbackRanking';

function observation(overrides: Partial<TimingObservation> & { id: string }): TimingObservation {
  return {
    kind: 'test',
    message: 'test message',
    confidence: 'medium',
    ...overrides,
  };
}

describe('rankObservations', () => {
  it('sorts by severity x confidence, highest first', () => {
    const low = observation({ id: 'low', severity: 0.3, confidence: 'high' }); // 0.3
    const high = observation({ id: 'high', severity: 0.9, confidence: 'medium' }); // 0.63
    const ranked = rankObservations([low, high]);
    expect(ranked.map((o) => o.id)).toEqual(['high', 'low']);
  });

  it('a higher-severity medium-confidence finding outranks a lower-severity high-confidence one', () => {
    const starkButLessCertain = observation({ id: 'a', severity: 1, confidence: 'medium' }); // 0.7
    const mildButCertain = observation({ id: 'b', severity: 0.5, confidence: 'high' }); // 0.5
    expect(rankObservations([mildButCertain, starkButLessCertain]).map((o) => o.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('treats missing severity as 0', () => {
    const informational = observation({ id: 'info', confidence: 'high' });
    const real = observation({ id: 'real', severity: 0.2, confidence: 'low' });
    expect(rankObservations([informational, real]).map((o) => o.id)).toEqual(['real', 'info']);
  });
});

describe('selectPrimaryObservation', () => {
  it('picks the top-ranked candidate', () => {
    const candidates = [
      observation({ id: 'minor', severity: 0.2, confidence: 'medium' }),
      observation({ id: 'major', severity: 0.9, confidence: 'high' }),
    ];
    expect(selectPrimaryObservation(candidates)?.id).toBe('major');
  });

  it('excludes severity-less observations from candidacy', () => {
    const onlyInformational = [
      observation({ id: 'close', confidence: 'medium' }),
      observation({ id: 'register', confidence: 'medium' }),
    ];
    expect(selectPrimaryObservation(onlyInformational)).toBeUndefined();
  });

  it('excludes zero-severity observations even among otherwise-real ones', () => {
    const observations = [
      observation({ id: 'zero', severity: 0, confidence: 'high' }),
      observation({ id: 'real', severity: 0.1, confidence: 'low' }),
    ];
    expect(selectPrimaryObservation(observations)?.id).toBe('real');
  });

  it('returns undefined for an empty list', () => {
    expect(selectPrimaryObservation([])).toBeUndefined();
  });
});
