import { describe, expect, it } from 'vitest';

import type { TimingObservation } from '../src/lib/timingObservations';
import {
  buildHistoryDisplay,
  categorizeObservations,
  trendLabel,
} from '../src/lib/pronunciationHistory';

function observation(kind: string, severity: number): TimingObservation {
  return { id: `${kind}-${severity}`, kind, message: 'msg', confidence: 'medium', severity };
}

describe('categorizeObservations', () => {
  it('takes the max severity within each category', () => {
    const observations = [
      observation('word-duration', 0.3),
      observation('sokuon_timing', 0.8),
      observation('pitch_timing', 0.5),
      observation('pitch_shape', 0.2),
    ];
    expect(categorizeObservations(observations)).toEqual({
      timingSeverity: 0.8,
      pitchSeverity: 0.5,
    });
  });

  it('returns 0 for a category with no observations', () => {
    expect(categorizeObservations([observation('word-duration', 0.5)])).toEqual({
      timingSeverity: 0.5,
      pitchSeverity: 0,
    });
  });

  it('excludes observations with no severity and unrelated kinds (asr, meta)', () => {
    const observations = [
      { id: 'a', kind: 'asr_diagnostic', message: 'm', confidence: 'low' as const, severity: 0.25 },
      { id: 'b', kind: 'meta', message: 'm', confidence: 'low' as const },
    ];
    expect(categorizeObservations(observations)).toEqual({ timingSeverity: 0, pitchSeverity: 0 });
  });
});

describe('trendLabel', () => {
  it('is "close" when current severity is zero', () => {
    expect(trendLabel(0, 0.8)).toBe('close');
  });

  it('is "needs work" for the first attempt with a real issue', () => {
    expect(trendLabel(0.6, undefined)).toBe('needs work');
  });

  it('is "improving" when meaningfully lower than the previous attempt', () => {
    expect(trendLabel(0.4, 0.8)).toBe('improving');
  });

  it('is "much closer" for a large improvement down to a low severity', () => {
    expect(trendLabel(0.1, 0.8)).toBe('much closer');
  });

  it('stays "needs work" when not meaningfully better than before', () => {
    expect(trendLabel(0.75, 0.8)).toBe('needs work');
  });

  it('stays "needs work" when it got worse', () => {
    expect(trendLabel(0.9, 0.5)).toBe('needs work');
  });
});

describe('buildHistoryDisplay', () => {
  it('labels a chronological sequence relative to each prior attempt', () => {
    const summaries = [
      { id: 'c', createdAt: '2026-08-16T00:00:00.000Z', timingSeverity: 0, pitchSeverity: 0.1 },
      { id: 'a', createdAt: '2026-08-12T00:00:00.000Z', timingSeverity: 0.8, pitchSeverity: 0.7 },
      { id: 'b', createdAt: '2026-08-14T00:00:00.000Z', timingSeverity: 0.4, pitchSeverity: 0.7 },
    ];

    const entries = buildHistoryDisplay(summaries);

    expect(entries.map((e) => e.summary.id)).toEqual(['a', 'b', 'c']); // sorted oldest-first
    expect(entries[0]).toMatchObject({ timingLabel: 'needs work', pitchLabel: 'needs work' });
    expect(entries[1]).toMatchObject({ timingLabel: 'improving', pitchLabel: 'needs work' });
    expect(entries[2]).toMatchObject({ timingLabel: 'close', pitchLabel: 'much closer' });
  });

  it('returns an empty array for no history', () => {
    expect(buildHistoryDisplay([])).toEqual([]);
  });
});
