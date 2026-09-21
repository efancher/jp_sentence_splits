import { describe, expect, it } from 'vitest';

import { pickQuotaSubjects, quotaRemaining } from '../src/lib/newWordQuota';

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
