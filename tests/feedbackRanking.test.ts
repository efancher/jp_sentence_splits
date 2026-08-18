import { describe, expect, it } from 'vitest';

import type { TimingObservation } from '../src/lib/timingObservations';
import {
  compareObservations,
  rankObservations,
  selectPrimaryObservation,
} from '../src/lib/feedbackRanking';

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

describe('compareObservations (cross-recording comparison)', () => {
  it('reports nothing_to_compare when the previous attempt had no flagged issue', () => {
    const current = observation({ id: 'current', kind: 'sokuon_timing', severity: 0.5 });
    expect(compareObservations(undefined, current).status).toBe('nothing_to_compare');
  });

  it('reports resolved when the previous issue no longer shows up at all', () => {
    const previous = observation({ id: 'previous', kind: 'sokuon_timing', severity: 0.5 });
    expect(compareObservations(previous, undefined).status).toBe('resolved');
  });

  it('reports improved for the same issue kind with a meaningfully smaller severity', () => {
    const previous = observation({ id: 'previous', kind: 'sokuon_timing', severity: 0.8 });
    const current = observation({ id: 'current', kind: 'sokuon_timing', severity: 0.3 });
    const result = compareObservations(previous, current);
    expect(result).toMatchObject({
      status: 'improved',
      kind: 'sokuon_timing',
      previousSeverity: 0.8,
      currentSeverity: 0.3,
    });
  });

  it('reports same_or_worse for the same issue kind with only a trivial severity change', () => {
    const previous = observation({ id: 'previous', kind: 'sokuon_timing', severity: 0.5 });
    const current = observation({ id: 'current', kind: 'sokuon_timing', severity: 0.48 });
    expect(compareObservations(previous, current).status).toBe('same_or_worse');
  });

  it('reports same_or_worse when the same issue kind gets worse', () => {
    const previous = observation({ id: 'previous', kind: 'sokuon_timing', severity: 0.3 });
    const current = observation({ id: 'current', kind: 'sokuon_timing', severity: 0.8 });
    expect(compareObservations(previous, current).status).toBe('same_or_worse');
  });

  it('reports new_focus when a different issue kind takes over as primary', () => {
    const previous = observation({ id: 'previous', kind: 'sokuon_timing', severity: 0.6 });
    const current = observation({
      id: 'current',
      kind: 'pitch_drop',
      severity: 0.4,
      message: 'Pitch drop message',
    });
    const result = compareObservations(previous, current);
    expect(result).toMatchObject({ status: 'new_focus', message: 'Pitch drop message' });
  });
});
