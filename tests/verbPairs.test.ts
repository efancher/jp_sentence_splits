import { describe, expect, it } from 'vitest';

import {
  candidatePairFromReading,
  findVerbPairs,
  isProbablyVerb,
  type VerbPairCandidate,
} from '../scripts/lib/verbPairs';

describe('isProbablyVerb', () => {
  it('treats a る-ending expression as a probable verb', () => {
    expect(isProbablyVerb('表れる', '')).toBe(true);
  });

  it('treats an English "to ..." meaning as a probable verb even without る', () => {
    expect(isProbablyVerb('表す', 'to express')).toBe(true);
  });

  it('does not treat a plain noun as a probable verb', () => {
    expect(isProbablyVerb('大学', 'university')).toBe(false);
  });
});

describe('candidatePairFromReading', () => {
  it('derives the transitive partner from the れる/す suffix-swap rule (表れる/表す)', () => {
    expect(candidatePairFromReading('あらわれる')).toEqual(['あらわれる', 'あらわす']);
  });

  it('derives the intransitive partner when given the transitive reading', () => {
    expect(candidatePairFromReading('あらわす')).toEqual(['あらわれる', 'あらわす']);
  });

  it('uses a curated exception when present (あく/あける)', () => {
    expect(candidatePairFromReading('あく')).toEqual(['あく', 'あける']);
  });

  it('returns null for a reading matching no rule', () => {
    // 'ほん' doesn't end in any PAIR_RULES suffix or match a curated exception.
    expect(candidatePairFromReading('ほん')).toBeNull();
  });
});

function candidate(overrides: Partial<VerbPairCandidate>): VerbPairCandidate {
  return { id: 'id', expression: '', reading: '', meaning: '', ...overrides };
}

describe('findVerbPairs', () => {
  it('pairs 表れる/表す by the suffix-swap rule', () => {
    const arawareru = candidate({ id: 'a', expression: '表れる', reading: 'あらわれる' });
    // 表す doesn't end in る, so it needs an English "to ..." meaning to be
    // recognized as a probable verb at all — matches is_probably_verb's own
    // two-part definition (character ending OR meaning marker), not a
    // simplification.
    const arawasu = candidate({
      id: 'b',
      expression: '表す',
      reading: 'あらわす',
      meaning: 'to express, to show',
    });
    const pairs = findVerbPairs([arawareru, arawasu]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([arawareru, arawasu]);
  });

  it('pairs a curated exception (開く/開ける)', () => {
    const aku = candidate({
      id: 'a',
      expression: '開く',
      reading: 'あく',
      meaning: 'to open (intransitive)',
    });
    const akeru = candidate({ id: 'b', expression: '開ける', reading: 'あける' });
    const pairs = findVerbPairs([aku, akeru]);
    expect(pairs).toEqual([[aku, akeru]]);
  });

  it('does not pair when only one side of a candidate reading exists', () => {
    const arawareru = candidate({ id: 'a', expression: '表れる', reading: 'あらわれる' });
    expect(findVerbPairs([arawareru])).toEqual([]);
  });

  it('does not pair non-verbs even if their reading happens to end like a rule suffix', () => {
    // 'ばす' ends in 'す', the れる/す rule's transitive suffix — but バス
    // ('bus') isn't a verb, so it must never become a confusion candidate.
    const notAVerb = candidate({ id: 'a', expression: 'バス', reading: 'ばす', meaning: 'bus' });
    expect(findVerbPairs([notAVerb])).toEqual([]);
  });

  it('picks the lowest-id item deterministically when a reading has homophones', () => {
    const arawareruB = candidate({ id: 'b-item', expression: '表れる', reading: 'あらわれる' });
    const arawareruA = candidate({ id: 'a-item', expression: '現れる', reading: 'あらわれる' });
    const arawasu = candidate({
      id: 'c-item',
      expression: '表す',
      reading: 'あらわす',
      meaning: 'to express',
    });
    const pairs = findVerbPairs([arawareruB, arawareruA, arawasu]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.[0].id).toBe('a-item');
  });

  it('returns one pair per reading-pair, not duplicated when scanned from either side', () => {
    const arawareru = candidate({ id: 'a', expression: '表れる', reading: 'あらわれる' });
    const arawasu = candidate({
      id: 'b',
      expression: '表す',
      reading: 'あらわす',
      meaning: 'to express',
    });
    expect(findVerbPairs([arawareru, arawasu])).toHaveLength(1);
  });
});
