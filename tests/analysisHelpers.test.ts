import { describe, expect, it } from 'vitest';

import type { AnalysisChunk } from '../src/domain/types';
import { moveChunkBoundary } from '../src/lib/analysisHelpers';

function chunk(id: string, japanese: string, order: number): AnalysisChunk {
  return { id, order, japanese, role: '', literalEnglish: '' };
}

describe('moveChunkBoundary', () => {
  it('grows the current chunk from the following chunk\'s front char, preserving order', () => {
    const source = 'あげるから';
    const chunks = [chunk('a', 'あげ', 0), chunk('b', 'るから', 1)];

    const result = moveChunkBoundary(chunks, 'a', 'right', source);

    expect(result.map((c) => c.japanese)).toEqual(['あげる', 'から']);
  });

  it('grows the current chunk from the previous chunk\'s last char, preserving order', () => {
    const source = 'あげるから';
    const chunks = [chunk('a', 'あ', 0), chunk('b', 'げるから', 1)];

    const result = moveChunkBoundary(chunks, 'b', 'left', source);

    expect(result.map((c) => c.japanese)).toEqual(['あげるから']);
  });

  it('dissolves the following chunk once it runs out of characters', () => {
    const source = 'あげら';
    const chunks = [chunk('a', 'あげ', 0), chunk('b', 'ら', 1)];

    const result = moveChunkBoundary(chunks, 'a', 'right', source);

    expect(result.map((c) => c.japanese)).toEqual(['あげら']);
  });
});
