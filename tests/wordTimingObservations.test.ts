import { describe, expect, it } from 'vitest';

import type { AlignmentResult, PhoneAlignment, WordAlignment } from '../src/domain/types';
import {
  buildWordTimingObservations,
  displayWordText,
  findLongPhones,
  pairWords,
} from '../src/lib/wordTimingObservations';

function phone(start: number, end: number, text: string): PhoneAlignment {
  return { start, end, text };
}

function word(start: number, end: number, text: string, phones: PhoneAlignment[]): WordAlignment {
  return { start, end, text, phones };
}

/** ちょっと, matching the real japanese_mfa output shape from Milestone 2a's spike. */
function chottoWord(tHoldDurationMs: number): WordAlignment {
  const firstOEnd = 0.69;
  const tHoldEnd = firstOEnd + tHoldDurationMs / 1000;
  const finalOEnd = tHoldEnd + 0.05;
  return word(0.5, finalOEnd, 'ちょっと', [
    phone(0.5, 0.6, 'tɕ'),
    phone(0.6, firstOEnd, 'o'),
    phone(firstOEnd, tHoldEnd, 'tː'),
    phone(tHoldEnd, finalOEnd, 'o'),
  ]);
}

describe('findLongPhones', () => {
  it('classifies a held consonant and a long vowel correctly', () => {
    const w = word(0, 1, 'x', [
      phone(0, 0.1, 'c'),
      phone(0.1, 0.3, 'oː'),
      phone(0.3, 0.4, 'w'),
      phone(0.4, 0.5, 'tː'),
    ]);
    const long = findLongPhones(w);
    expect(long).toHaveLength(2);
    expect(long[0]).toMatchObject({ kind: 'vowel' });
    expect(long[1]).toMatchObject({ kind: 'consonant' });
  });

  it('returns nothing when no phone is length-marked', () => {
    const w = word(0, 1, 'x', [phone(0, 0.1, 'k'), phone(0.1, 0.2, 'a')]);
    expect(findLongPhones(w)).toEqual([]);
  });
});

describe('pairWords', () => {
  it('pairs by index when silence-filtered counts match', () => {
    const ref = [word(0, 0.1, '<eps>', []), word(0.1, 0.5, '今日', []), word(0.5, 0.8, 'は', [])];
    const learner = [word(0, 0.5, '今日', []), word(0.5, 0.9, 'は', []), word(0.9, 1.0, '<eps>', [])];
    const pairs = pairWords(ref, learner);
    expect(pairs.map(([r, l]) => [r.text, l.text])).toEqual([
      ['今日', '今日'],
      ['は', 'は'],
    ]);
  });

  it('resyncs past an inserted learner word', () => {
    const ref = [word(0, 0.3, '今日', []), word(0.3, 0.6, 'は', []), word(0.6, 1.0, '寒い', [])];
    const learner = [
      word(0, 0.3, '今日', []),
      word(0.3, 0.5, 'えっと', []), // filler the learner inserted
      word(0.5, 0.8, 'は', []),
      word(0.8, 1.2, '寒い', []),
    ];
    const pairs = pairWords(ref, learner);
    expect(pairs.map(([r, l]) => [r.text, l.text])).toEqual([
      ['今日', '今日'],
      ['は', 'は'],
      ['寒い', '寒い'],
    ]);
  });
});

describe('buildWordTimingObservations', () => {
  it('flags a much-shorter っ hold with high confidence — the brief\'s own example', () => {
    const reference: AlignmentResult = {
      durationSeconds: 1.7,
      words: [chottoWord(100)], // reference っ hold: 100ms
    };
    const learner: AlignmentResult = {
      durationSeconds: 1.5,
      words: [chottoWord(20)], // learner っ hold: 20ms — much shorter
    };

    const observations = buildWordTimingObservations({ reference, learner });
    const sokuon = observations.find((o) => o.kind === 'sokuon_timing');
    expect(sokuon).toBeDefined();
    expect(sokuon?.message).toBe('Your 「っ」 in 「ちょっと」 is much shorter than the reference.');
    expect(sokuon?.confidence).toBe('high');
    expect(sokuon?.severity).toBeGreaterThan(0.5);
    expect(sokuon?.segment).toEqual({
      startMs: reference.words[0]!.start * 1000,
      endMs: reference.words[0]!.end * 1000,
    });
  });

  it('flags a shortened long vowel at high confidence for a stark difference', () => {
    const reference: AlignmentResult = {
      durationSeconds: 0.5,
      words: [word(0, 0.4, 'きょう', [phone(0, 0.1, 'c'), phone(0.1, 0.35, 'oː')])],
    };
    const learner: AlignmentResult = {
      durationSeconds: 0.4,
      words: [word(0, 0.3, 'きょう', [phone(0, 0.1, 'c'), phone(0.1, 0.17, 'oː')])],
    };

    const observations = buildWordTimingObservations({ reference, learner });
    const longVowel = observations.find((o) => o.kind === 'long_vowel_timing');
    expect(longVowel?.message).toBe('Your long vowel in 「きょう」 is much shorter than the reference.');
    expect(longVowel?.confidence).toBe('high');
  });

  it('flags a shortened long vowel at medium confidence for a moderate difference', () => {
    const reference: AlignmentResult = {
      durationSeconds: 0.5,
      words: [word(0, 0.35, 'きょう', [phone(0, 0.1, 'c'), phone(0.1, 0.25, 'oː')])], // 150ms
    };
    const learner: AlignmentResult = {
      durationSeconds: 0.45,
      words: [word(0, 0.3, 'きょう', [phone(0, 0.1, 'c'), phone(0.1, 0.185, 'oː')])], // 85ms, ratio ~0.57
    };

    const observations = buildWordTimingObservations({ reference, learner });
    const longVowel = observations.find((o) => o.kind === 'long_vowel_timing');
    expect(longVowel?.message).toBe('Your long vowel in 「きょう」 is shorter than the reference.');
    expect(longVowel?.confidence).toBe('medium');
  });

  it('flags a word the learner said noticeably slower than the reference', () => {
    const reference: AlignmentResult = {
      durationSeconds: 1,
      words: [word(0, 0.3, '見に', [])],
    };
    const learner: AlignmentResult = {
      durationSeconds: 1.2,
      words: [word(0, 0.55, '見に', [])],
    };

    const observations = buildWordTimingObservations({ reference, learner });
    const durationObservation = observations.find((o) => o.kind === 'word-duration');
    expect(durationObservation?.message).toBe('You were slower than the reference during 「見に」.');
    // ratio = 0.55 / 0.3 = 1.833..., severity = min(1, |ratio - 1|)
    expect(durationObservation?.severity).toBeCloseTo(0.833, 2);
    expect(durationObservation?.segment).toEqual({ startMs: 0, endMs: 300 });
  });

  it('produces no observations for a close match', () => {
    const reference: AlignmentResult = {
      durationSeconds: 1,
      words: [chottoWord(100)],
    };
    const learner: AlignmentResult = {
      durationSeconds: 1,
      words: [chottoWord(95)],
    };

    expect(buildWordTimingObservations({ reference, learner })).toEqual([]);
  });

  it('does not flag a tiny particle whose ratio is large but absolute difference is negligible', () => {
    const reference: AlignmentResult = {
      durationSeconds: 1,
      words: [word(0, 0.04, 'は', [])],
    };
    const learner: AlignmentResult = {
      durationSeconds: 1,
      words: [word(0, 0.07, 'は', [])], // ratio 1.75, but only 30ms absolute
    };

    expect(buildWordTimingObservations({ reference, learner })).toEqual([]);
  });

  it('shows a flagged placeholder instead of the raw <unk> token for an OOV reference word', () => {
    const reference: AlignmentResult = {
      durationSeconds: 1,
      words: [word(0, 0.3, '<unk>', [])],
    };
    const learner: AlignmentResult = {
      durationSeconds: 1.2,
      words: [word(0, 0.55, '<unk>', [])],
    };

    const observations = buildWordTimingObservations({ reference, learner });
    const durationObservation = observations.find((o) => o.kind === 'word-duration');
    expect(durationObservation?.message).toBe('You were slower than the reference during 「?」.');
  });
});

describe('displayWordText', () => {
  it('passes real words through unchanged', () => {
    expect(displayWordText('見に')).toBe('見に');
  });

  it('replaces the aligner OOV token with a flagged placeholder', () => {
    expect(displayWordText('<unk>')).toBe('?');
  });
});
