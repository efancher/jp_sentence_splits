import { describe, expect, it } from 'vitest';

import { fitAccentShape } from './pitchShapeFit';

describe('fitAccentShape explainedVariance', () => {
  it('is high for a clean accented contour', () => {
    const fit = fitAccentShape([0, 4, 4, 1, 0]);
    expect(fit?.explainedVariance).toBeGreaterThan(0.8);
  });

  it('is near zero for the について contour that only HLLL could fit (low い, high て)', () => {
    // Measured native means (semitones): に .9, つ .1, い −1.2, て 2.4 — the high ≥ low rule leaves only HLLL.
    const fit = fitAccentShape([0.9, 0.1, -1.2, 2.4]);
    expect(fit?.shape.join('')).toBe('hlll');
    expect(fit?.explainedVariance).toBeLessThan(0.15);
  });
});
