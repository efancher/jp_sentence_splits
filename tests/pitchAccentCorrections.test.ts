import { describe, expect, it } from 'vitest';

import { diagnosePitchAccentDeviation } from '../src/lib/pitchAccentCorrections';
import type { MoraPitchClass } from '../src/lib/pitchAccentShape';

const hl = (s: string): MoraPitchClass[] => [...s].map((c) => (c === 'h' ? 'h' : 'l'));

describe('diagnosePitchAccentDeviation', () => {
  it('returns null when the contour matches', () => {
    expect(
      diagnosePitchAccentDeviation({
        surfaceForm: 'たまご',
        moraeText: ['た', 'ま', 'ご'],
        expected: hl('lhl'),
        actual: hl('lhl'),
        hasFollowing: false,
      }),
    ).toBeNull();
  });

  it('flags a raised opening mora as first-mora-high with an initial-stress cue', () => {
    const result = diagnosePitchAccentDeviation({
      surfaceForm: 'たまご',
      moraeText: ['た', 'ま', 'ご'],
      expected: hl('lhl'),
      actual: hl('hhl'),
      hasFollowing: false,
    });
    expect(result?.kind).toBe('first-mora-high');
    expect(result?.summary).toContain('started 「たまご」 high on 「た」');
    expect(result?.hint).toContain('first syllable');
  });

  it('flags holding the plateau past the accent as held-high', () => {
    const result = diagnosePitchAccentDeviation({
      surfaceForm: '親鳥',
      moraeText: ['お', 'や', 'ど', 'り'],
      expected: hl('lhll'),
      actual: hl('lhhl'),
      hasFollowing: false,
    });
    expect(result?.kind).toBe('held-high');
    expect(result?.summary).toContain('drop belongs right after 「や」');
    expect(result?.summary).toContain('「ど」');
  });

  it('flags an early sag as early-drop', () => {
    const result = diagnosePitchAccentDeviation({
      surfaceForm: '親鳥',
      moraeText: ['お', 'や', 'ど', 'り'],
      expected: hl('lhhl'),
      actual: hl('lhll'),
      hasFollowing: false,
    });
    expect(result?.kind).toBe('early-drop');
    expect(result?.summary).toContain('came down early, after 「や」');
  });

  it('flags a lost accent as no-downstep', () => {
    const result = diagnosePitchAccentDeviation({
      surfaceForm: 'たまご',
      moraeText: ['た', 'ま', 'ご'],
      expected: hl('lhl'),
      actual: hl('lhh'),
      hasFollowing: false,
    });
    expect(result?.kind).toBe('no-downstep');
    expect(result?.hint).toContain('downstep after 「ま」');
  });

  it('flags a dropped final mora as final-fall with a declination cue', () => {
    const result = diagnosePitchAccentDeviation({
      surfaceForm: 'にほん',
      moraeText: ['に', 'ほ', 'ん'],
      expected: hl('lhh'),
      actual: hl('lhl'),
      hasFollowing: false,
    });
    expect(result?.kind).toBe('final-fall');
    expect(result?.summary).toContain('「ん」');
    expect(result?.hint).toContain('trail downward');
  });

  it('flags a dropped particle after a heiban word as particle-fall', () => {
    const result = diagnosePitchAccentDeviation({
      surfaceForm: '水',
      moraeText: ['み', 'ず'],
      expected: hl('lhh'),
      actual: hl('lhl'),
      hasFollowing: true,
      followingText: 'が',
    });
    expect(result?.kind).toBe('particle-fall');
    expect(result?.summary).toContain('「が」 should stay high');
  });

  it('flags an all-one-level contour as flat', () => {
    const result = diagnosePitchAccentDeviation({
      surfaceForm: 'たまご',
      moraeText: ['た', 'ま', 'ご'],
      expected: hl('lhl'),
      actual: hl('hhh'),
      hasFollowing: false,
    });
    expect(result?.kind).toBe('flat');
    expect(result?.hint).toContain('pitch height');
  });

  it('returns null when inputs do not line up', () => {
    expect(
      diagnosePitchAccentDeviation({
        surfaceForm: 'たまご',
        moraeText: ['た', 'ま', 'ご'],
        expected: hl('lh'),
        actual: hl('lhl'),
        hasFollowing: false,
      }),
    ).toBeNull();
  });
});
