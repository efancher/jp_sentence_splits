import { describe, expect, it } from 'vitest';

import { buildFsrsConfidenceSnapshot } from '../src/lib/fsrsConfidence';

describe('buildFsrsConfidenceSnapshot', () => {
  it('reports no data for an empty input', () => {
    const result = buildFsrsConfidenceSnapshot([]);
    expect(result.hasData).toBe(false);
    expect(result.averageRetrievability).toBeNull();
    expect(result.buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it('buckets each retrievability value into the highest bucket it clears', () => {
    const result = buildFsrsConfidenceSnapshot([0.98, 0.9, 0.6, 0.3, 0.86]);
    expect(result.hasData).toBe(true);
    expect(result.activeCount).toBe(5);
    const byLabel = new Map(result.buckets.map((b) => [b.label, b.count]));
    expect(byLabel.get('95%+')).toBe(1); // 0.98
    expect(byLabel.get('85–95%')).toBe(2); // 0.9, 0.86
    expect(byLabel.get('70–85%')).toBe(0);
    expect(byLabel.get('50–70%')).toBe(1); // 0.6
    expect(byLabel.get('0–50%')).toBe(1); // 0.3
  });

  it('averages the raw values, not the bucket midpoints', () => {
    const result = buildFsrsConfidenceSnapshot([1, 0]);
    expect(result.averageRetrievability).toBeCloseTo(0.5);
  });
});
