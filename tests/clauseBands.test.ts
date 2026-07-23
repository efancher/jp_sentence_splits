import { describe, expect, it } from 'vitest';

import {
  assignClauseIndices,
  isEngineRole,
} from '../src/lib/clauseBands';

describe('assignClauseIndices', () => {
  it('keeps a single clause for て-car linking into one engine', () => {
    const indices = assignClauseIndices([
      { role: 'topic は' },
      { role: 'て-car' },
      { role: 'engine: verb' },
      { role: 'sentence ending' },
    ]);
    expect(indices).toEqual([0, 0, 0, 0]);
  });

  it('starts a new clause at clause connector', () => {
    const indices = assignClauseIndices([
      { role: 'Aが' },
      { role: 'engine' },
      { role: 'clause connector' },
      { role: 'topic は' },
      { role: 'engine' },
    ]);
    expect(indices).toEqual([0, 0, 1, 1, 1]);
  });

  it('starts a new clause after an engine when more content follows', () => {
    const indices = assignClauseIndices([
      { role: 'time' },
      { role: 'engine' },
      { role: 'Aが' },
      { role: 'を-car' },
      { role: 'engine: verb' },
    ]);
    expect(indices).toEqual([0, 0, 1, 1, 1]);
  });

  it('recognizes engine role variants', () => {
    expect(isEngineRole('engine')).toBe(true);
    expect(isEngineRole('engine: verb')).toBe(true);
    expect(isEngineRole('て-car')).toBe(false);
  });
});
