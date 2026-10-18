import { describe, expect, it } from 'vitest';
import { summarize } from '../e2e/performance/reporter';

describe('performance summaries', () => {
  it('reports the median without labelling a tiny sample maximum as p95', () => {
    expect(summarize([8, 2, 4, 6])).toEqual({ n: 4, medianMs: 5, p95Ms: null, maxMs: 8 });
  });
  it('uses nearest-rank p95 once twenty observations exist', () => {
    expect(summarize(Array.from({ length: 20 }, (_, i) => i + 1))).toEqual({ n: 20, medianMs: 10.5, p95Ms: 19, maxMs: 20 });
    expect(() => summarize([])).toThrow('Invalid timing samples');
  });
});
