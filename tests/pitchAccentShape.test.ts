import { describe, expect, it } from 'vitest';

import {
  detectedDropPosition,
  expectedPitchShape,
  pitchPatternLabel,
} from '../src/lib/pitchAccentShape';

describe('expectedPitchShape', () => {
  it('heiban (position 0): low then all high', () => {
    expect(expectedPitchShape(3, 0)).toEqual(['l', 'h', 'h']);
  });

  it('atamadaka (position 1): high then all low', () => {
    expect(expectedPitchShape(3, 1)).toEqual(['h', 'l', 'l']);
  });

  it('nakadaka (interior position): low, high run, then low', () => {
    expect(expectedPitchShape(5, 3)).toEqual(['l', 'h', 'h', 'l', 'l']);
  });

  it('odaka (position == mora count): identical shape to heiban', () => {
    expect(expectedPitchShape(3, 3)).toEqual(expectedPitchShape(3, 0));
    expect(expectedPitchShape(3, 3)).toEqual(['l', 'h', 'h']);
  });

  it('single-mora words are always high', () => {
    expect(expectedPitchShape(1, 0)).toEqual(['h']);
    expect(expectedPitchShape(1, 1)).toEqual(['h']);
  });

  it('returns empty for a zero mora count', () => {
    expect(expectedPitchShape(0, 0)).toEqual([]);
  });
});

describe('pitchPatternLabel', () => {
  it('labels every pattern class', () => {
    expect(pitchPatternLabel(0, 4)).toBe('heiban');
    expect(pitchPatternLabel(1, 4)).toBe('atamadaka');
    expect(pitchPatternLabel(2, 4)).toBe('nakadaka');
    expect(pitchPatternLabel(4, 4)).toBe('odaka');
  });
});

describe('detectedDropPosition', () => {
  it('finds the drop in an atamadaka-shaped sequence', () => {
    expect(detectedDropPosition(['h', 'l', 'l'])).toBe(1);
  });

  it('finds the drop in a nakadaka-shaped sequence', () => {
    expect(detectedDropPosition(['l', 'h', 'h', 'l', 'l'])).toBe(3);
  });

  it('reports 0 (no drop) for a heiban-shaped sequence', () => {
    expect(detectedDropPosition(['l', 'h', 'h'])).toBe(0);
  });

  it('reports 0 for an odaka-shaped prediction too, by construction', () => {
    // The whole point: odaka and heiban predictions produce the same
    // shape, so they must also produce the same detected drop position.
    expect(detectedDropPosition(expectedPitchShape(3, 3))).toBe(
      detectedDropPosition(expectedPitchShape(3, 0)),
    );
  });

  it('reports 0 for an all-high or single-mora sequence', () => {
    expect(detectedDropPosition(['h'])).toBe(0);
    expect(detectedDropPosition(['h', 'h', 'h'])).toBe(0);
  });
});
