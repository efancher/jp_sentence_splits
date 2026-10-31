import { describe, expect, it } from 'vitest';

import {
  pickAudioQuotaSubjects,
  pickQuotaSubjects,
  pickSentenceQuotaSubjects,
  pickShadowingQuotaSubjects,
  quotaRemaining,
} from '../src/lib/newWordQuota';

const seed = (descriptorKey: string, subjectId: string) => ({ descriptorKey, subjectId });

describe('pickQuotaSubjects', () => {
  const pool = [
    seed('sentence', 's1'),
    seed('vocabulary', 'w1'),
    seed('vocabulary', 'w1'), // a word's several activity types are one subject
    seed('grammar', 'g1'),
    seed('vocabulary', 'w2'),
    seed('vocabulary', 'w3'),
  ];

  it('takes distinct vocabulary subjects in pool order, ignoring other descriptors', () => {
    expect(pickQuotaSubjects(pool, 2)).toEqual(['w1', 'w2']);
    expect(pickQuotaSubjects(pool, 10)).toEqual(['w1', 'w2', 'w3']);
  });

  it('returns nothing for a zero, negative or NaN quota', () => {
    expect(pickQuotaSubjects(pool, 0)).toEqual([]);
    expect(pickQuotaSubjects(pool, -3)).toEqual([]);
    expect(pickQuotaSubjects(pool, Number.NaN)).toEqual([]);
  });
});

describe('quotaRemaining', () => {
  it('subtracts what was seeded today and never goes negative', () => {
    expect(quotaRemaining(12, 5)).toBe(7);
    expect(quotaRemaining(12, 20)).toBe(0);
    expect(quotaRemaining(0, 0)).toBe(0);
    expect(quotaRemaining(2.9, 1)).toBe(1);
  });
});

describe('pickSentenceQuotaSubjects', () => {
  const pool = [
    seed('vocabulary', 'w1'),
    seed('sentence', 's1'),
    seed('listening', 's1'),
    seed('sentence', 's2'),
    seed('sentence', 's3'),
  ];

  it('picks distinct sentence-descriptor subjects in pool order', () => {
    expect(pickSentenceQuotaSubjects(pool, 2)).toEqual(['s1', 's2']);
    expect(pickSentenceQuotaSubjects(pool, 9)).toEqual(['s1', 's2', 's3']);
    expect(pickSentenceQuotaSubjects(pool, 0)).toEqual([]);
  });
});

describe('pickAudioQuotaSubjects', () => {
  const audio = (subjectId: string, activityType: string) => ({ descriptorKey: 'listening', subjectId, activityType });
  const pool = [
    audio('a', 'listening'), // a new sentence also needs ear_tiles, which is what gets it picked
    audio('a', 'ear_tiles'),
    audio('b', 'dictation_tile:1'), // follow-up tiles alone never consume the quota
    audio('c', 'ear_tiles'),
    { descriptorKey: 'vocabulary', subjectId: 'w1', activityType: 'cloze' },
    audio('d', 'ear_tiles'),
  ];

  it('picks distinct sentences that still need an ear_tiles card, in pool order', () => {
    expect(pickAudioQuotaSubjects(pool, 2)).toEqual(['a', 'c']);
    expect(pickAudioQuotaSubjects(pool, 10)).toEqual(['a', 'c', 'd']);
  });

  it('picks nothing when the quota is used up or off', () => {
    expect(pickAudioQuotaSubjects(pool, 0)).toEqual([]);
    expect(pickAudioQuotaSubjects(pool, Number.NaN)).toEqual([]);
  });
});

describe('pickShadowingQuotaSubjects', () => {
  const pool = [
    seed('listening', 'a'),
    seed('shadowingCard', 's1'),
    seed('shadowingCard', 's1'),
    seed('shadowingCard', 's2'),
    seed('shadowingCard', 's3'),
  ];

  it('picks distinct sentences from the shadowing descriptor only, in pool order', () => {
    expect(pickShadowingQuotaSubjects(pool, 2)).toEqual(['s1', 's2']);
    expect(pickShadowingQuotaSubjects(pool, 10)).toEqual(['s1', 's2', 's3']);
  });

  it('picks nothing when the quota is used up or off', () => {
    expect(pickShadowingQuotaSubjects(pool, 0)).toEqual([]);
    expect(pickShadowingQuotaSubjects(pool, Number.NaN)).toEqual([]);
  });
});
