import { describe, expect, it } from 'vitest';

import {
  buildTileFace,
  checkBuildAssembly,
  shuffleChunkIds,
} from '../src/lib/buildMode';

describe('buildMode', () => {
  it('shuffles deterministically for a seed', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(shuffleChunkIds(ids, 'seed-1')).toEqual(
      shuffleChunkIds(ids, 'seed-1'),
    );
    expect(shuffleChunkIds(ids, 'seed-1')).not.toEqual(
      shuffleChunkIds(ids, 'seed-2'),
    );
  });

  it('scores assembly against the correct order', () => {
    const correct = ['1', '2', '3'];
    expect(checkBuildAssembly(['1', '2', '3'], correct)).toEqual({
      perfect: true,
      matchedPrefix: 3,
      lengthMatch: true,
    });
    expect(checkBuildAssembly(['1', '3', '2'], correct)).toEqual({
      perfect: false,
      matchedPrefix: 1,
      lengthMatch: true,
    });
    expect(checkBuildAssembly(['1', '2'], correct).lengthMatch).toBe(false);
  });

  it('escalates tile faces with hint level', () => {
    const chunk = {
      id: 'c1',
      japanese: '本を',
      role: 'を-car',
      literalEnglish: 'book WO',
    };
    expect(buildTileFace(chunk, 0).primary).toBe('？');
    expect(buildTileFace(chunk, 3).primary).toBe('book WO');
    expect(buildTileFace(chunk, 4).primary).toBe('を-car');
    expect(buildTileFace(chunk, 5).primary).toBe('本を');
  });
});
