import { describe, expect, it } from 'vitest';

import {
  buildPronunciationProfile,
  focusKindMeta,
  type ProfileSummaryLike,
} from '../src/lib/pronunciationProfile';

const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date('2026-08-01T00:00:00.000Z').getTime();

function summary(overrides: Partial<ProfileSummaryLike> & { dayOffset: number }): ProfileSummaryLike {
  const { dayOffset, ...rest } = overrides;
  return {
    id: `a_${dayOffset}_${Math.random().toString(36).slice(2)}`,
    sentenceId: 'sent_1',
    createdAt: new Date(BASE + dayOffset * DAY).toISOString(),
    timingSeverity: 0,
    pitchSeverity: 0,
    ...rest,
  };
}

describe('buildPronunciationProfile', () => {
  it('returns an empty profile with no summaries', () => {
    const profile = buildPronunciationProfile([]);
    expect(profile.attemptsAnalyzed).toBe(0);
    expect(profile.focusAreas).toEqual([]);
    expect(profile.headline).toBeNull();
    expect(profile.timingTrend).toBe('insufficient_data');
  });

  it('ranks recurring primary issues by frequency and counts distinct sentences', () => {
    const summaries: ProfileSummaryLike[] = [
      summary({ dayOffset: 0, primaryIssueKind: 'sokuon_timing', primaryIssueSeverity: 0.5, sentenceId: 's1' }),
      summary({ dayOffset: 1, primaryIssueKind: 'sokuon_timing', primaryIssueSeverity: 0.4, sentenceId: 's2' }),
      summary({ dayOffset: 2, primaryIssueKind: 'sokuon_timing', primaryIssueSeverity: 0.4, sentenceId: 's2' }),
      summary({ dayOffset: 3, primaryIssueKind: 'pitch_accent_shape', primaryIssueSeverity: 0.6, sentenceId: 's3' }),
    ];
    const profile = buildPronunciationProfile(summaries);
    expect(profile.focusAreas[0]!.kind).toBe('sokuon_timing');
    expect(profile.focusAreas[0]!.primaryCount).toBe(3);
    expect(profile.focusAreas[0]!.sentenceCount).toBe(2);
    expect(profile.focusAreas[0]!.label).toBe('Small tsu (っ) timing');
    expect(profile.focusAreas[1]!.kind).toBe('pitch_accent_shape');
    expect(profile.sentencesPracticed).toBe(3);
    expect(profile.headline).toContain('small tsu');
  });

  it('ignores meta and missing primary-issue kinds', () => {
    const profile = buildPronunciationProfile([
      summary({ dayOffset: 0, primaryIssueKind: 'meta', primaryIssueSeverity: 0.9 }),
      summary({ dayOffset: 1 }),
    ]);
    expect(profile.focusAreas).toEqual([]);
  });

  it('calls a timing trend improving when recent severities drop', () => {
    const summaries = [
      summary({ dayOffset: 0, timingSeverity: 0.8 }),
      summary({ dayOffset: 1, timingSeverity: 0.7 }),
      summary({ dayOffset: 2, timingSeverity: 0.2 }),
      summary({ dayOffset: 3, timingSeverity: 0.1 }),
    ];
    expect(buildPronunciationProfile(summaries).timingTrend).toBe('improving');
  });

  it('calls a trend worsening when recent severities climb, steady when flat', () => {
    const worse = buildPronunciationProfile([
      summary({ dayOffset: 0, pitchSeverity: 0.1 }),
      summary({ dayOffset: 1, pitchSeverity: 0.2 }),
      summary({ dayOffset: 2, pitchSeverity: 0.7 }),
      summary({ dayOffset: 3, pitchSeverity: 0.8 }),
    ]);
    expect(worse.pitchTrend).toBe('worsening');

    const flat = buildPronunciationProfile([
      summary({ dayOffset: 0, timingSeverity: 0.4 }),
      summary({ dayOffset: 1, timingSeverity: 0.42 }),
      summary({ dayOffset: 2, timingSeverity: 0.39 }),
      summary({ dayOffset: 3, timingSeverity: 0.41 }),
    ]);
    expect(flat.timingTrend).toBe('steady');
  });

  it('reports insufficient_data below the sample floor', () => {
    const profile = buildPronunciationProfile([
      summary({ dayOffset: 0, timingSeverity: 0.9 }),
      summary({ dayOffset: 1, timingSeverity: 0.1 }),
    ]);
    expect(profile.timingTrend).toBe('insufficient_data');
  });

  it('computes the span in days between first and last analyzed attempt', () => {
    const profile = buildPronunciationProfile([
      summary({ dayOffset: 0 }),
      summary({ dayOffset: 10 }),
    ]);
    expect(Math.round(profile.spanDays)).toBe(10);
  });
});

describe('focusKindMeta', () => {
  it('falls through to a generic entry for an unknown kind', () => {
    expect(focusKindMeta('brand_new_kind')).toEqual({ label: 'brand_new_kind', category: 'other' });
  });
});
