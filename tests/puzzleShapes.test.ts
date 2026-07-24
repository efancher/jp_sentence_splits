import { describe, expect, it } from 'vitest';

import { buildPuzzlePiecePath } from '../src/lib/puzzlePiecePath';
import {
  adjacentPuzzleFit,
  puzzleShapeFamily,
  resolveLeftEdge,
  rightEdgeForFamily,
  PUZZLE_SHAPE_BLURBS,
} from '../src/lib/puzzleShapes';

describe('puzzleShapeFamily', () => {
  it('maps core pedagogical roles to distinct families', () => {
    expect(puzzleShapeFamily('を-car')).toBe('wo-socket');
    expect(puzzleShapeFamily('に-car')).toBe('ni-de-slot');
    expect(puzzleShapeFamily('で-car + topic は')).toBe('ni-de-slot');
    expect(puzzleShapeFamily('Aが')).toBe('ga-subject');
    expect(puzzleShapeFamily('zero-が (∅ subject)')).toBe('ga-subject');
    expect(puzzleShapeFamily('topic は')).toBe('topic-band');
    expect(puzzleShapeFamily('て-car')).toBe('te-bridge');
    expect(puzzleShapeFamily('engine: verb')).toBe('engine-anchor');
    expect(puzzleShapeFamily('sentence ending')).toBe('ending-cap');
    expect(puzzleShapeFamily('clause connector')).toBe('connector');
  });

  it('treats unknown non-car roles as noun-flat blocks', () => {
    expect(puzzleShapeFamily('time')).toBe('noun-flat');
    expect(puzzleShapeFamily('')).toBe('generic');
  });

  it('has a blurb for every family', () => {
    const families = [
      'noun-flat',
      'wo-socket',
      'ni-de-slot',
      'ga-subject',
      'topic-band',
      'te-bridge',
      'other-car',
      'engine-anchor',
      'ending-cap',
      'connector',
      'generic',
    ] as const;
    for (const family of families) {
      expect(PUZZLE_SHAPE_BLURBS[family].length).toBeGreaterThan(10);
    }
  });
});

describe('neighbor edges and fit', () => {
  it('mates the next left edge to the previous right tab', () => {
    const prevRight = rightEdgeForFamily('wo-socket');
    expect(prevRight).toBe('deep-u');
    expect(resolveLeftEdge('engine-anchor', prevRight)).toBe('deep-u');
    expect(resolveLeftEdge('wo-socket', null)).toBe('deep-u');
  });

  it('marks common car→engine joints as good and odd inversions', () => {
    expect(adjacentPuzzleFit('を-car', 'engine: verb')).toBe('good');
    expect(adjacentPuzzleFit('Aが', 'engine')).toBe('good');
    expect(adjacentPuzzleFit('engine', 'sentence ending')).toBe('good');
    expect(adjacentPuzzleFit('engine', 'を-car')).toBe('odd');
    expect(adjacentPuzzleFit('を-car', 'を-car')).toBe('odd');
  });

  it('builds a closed SVG path for piece chrome', () => {
    const path = buildPuzzlePiecePath('deep-u', 'flat');
    expect(path.startsWith('M ')).toBe(true);
    expect(path.includes(' Z') || path.endsWith('Z')).toBe(true);
    expect(path.length).toBeGreaterThan(40);
  });
});
