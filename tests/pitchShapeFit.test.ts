import { describe, expect, it } from 'vitest';

import { fitAccentShape, validAccentShapes } from '../src/lib/pitchShapeFit';

const shapeOf = (fit: ReturnType<typeof fitAccentShape>) => fit?.shape.join('') ?? null;

describe('validAccentShapes', () => {
  it('lists each in-word shape once (heiban and odaka look identical inside the word)', () => {
    expect(validAccentShapes(2).map((s) => s.join(''))).toEqual(['lh', 'hl']);
    expect(validAccentShapes(3).map((s) => s.join('')).sort()).toEqual(['hll', 'lhh', 'lhl']);
    expect(validAccentShapes(4).map((s) => s.join('')).sort()).toEqual(['hlll', 'lhhh', 'lhhl', 'lhll']);
  });
});

describe('fitAccentShape', () => {
  it('recognises clean patterns', () => {
    expect(shapeOf(fitAccentShape([0, 4]))).toBe('lh');
    expect(shapeOf(fitAccentShape([4, 0]))).toBe('hl');
    expect(shapeOf(fitAccentShape([0, 4, 4, 0]))).toBe('lhhl');
    expect(shapeOf(fitAccentShape([4, 0, 0, 0]))).toBe('hlll');
  });

  it('keeps a plateau with natural downward drift as heiban — the case the per-mora rule gets wrong', () => {
    // Mean of [0,4,3,2] is 2.25, so a "high if ≥ the word's mean" rule calls the last mora low and reads an
    // accent-3 word. Fitting valid shapes prefers the flat plateau (lhhh: error 2) over lhhl (error 2.5).
    expect(shapeOf(fitAccentShape([0, 4, 3, 2]))).toBe('lhhh');
  });

  it('still finds a real drop when there is one', () => {
    expect(shapeOf(fitAccentShape([0, 4, 3.6, 0.5]))).toBe('lhhl');
  });

  it('never lets high sit below low (no inverted fits)', () => {
    // Rising pitch can only be lh… (a valid shape), never "h at the bottom".
    const fit = fitAccentShape([0, 1, 2, 3])!;
    expect(fit.contrastSemitones).toBeGreaterThanOrEqual(0);
    expect(shapeOf(fit)).toMatch(/^l/); // starts low
  });

  it('lets unvoiced morae abstain instead of voting', () => {
    expect(shapeOf(fitAccentShape([0, null, 4, 4]))).toBe('lhhh');
    expect(shapeOf(fitAccentShape([4, null, 0, 0]))).toBe('hlll');
  });

  it('reports the contrast and how decisive the fit was', () => {
    const clear = fitAccentShape([0, 4, 4, 0])!;
    expect(clear.contrastSemitones).toBeCloseTo(4);
    expect(clear.margin).toBeGreaterThan(1);
    expect(clear.voicedMorae).toBe(4);
    const flat = fitAccentShape([2, 2.1, 1.9, 2])!;
    expect(flat.contrastSemitones).toBeLessThan(0.3); // a flat production is visible as ~0 contrast
  });

  it('can reject fits with no clear contrast', () => {
    expect(fitAccentShape([2, 2.1, 1.9, 2], { minContrastSemitones: 1 })).toBeNull();
    expect(shapeOf(fitAccentShape([0, 4, 4, 0], { minContrastSemitones: 1 }))).toBe('lhhl');
  });

  it('returns null without enough voiced morae', () => {
    expect(fitAccentShape([null, null, 3])).toBeNull();
    expect(fitAccentShape([3])).toBeNull();
    expect(fitAccentShape([])).toBeNull();
  });
});
