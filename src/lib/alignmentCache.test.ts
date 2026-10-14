import { describe, expect, it, vi } from 'vitest';

import type { AlignmentResult } from '../domain/types';

vi.mock('./analysisApi', () => ({ alignAudio: vi.fn() }));

import { alignmentMatchesAudio, loadOrComputeAlignment } from './alignmentCache';
import { alignAudio } from './analysisApi';

const alignment = (durationSeconds: number): AlignmentResult => ({ words: [], durationSeconds }) as unknown as AlignmentResult;

describe('alignmentMatchesAudio', () => {
  it('accepts a matching or unmeasurable duration', () => {
    expect(alignmentMatchesAudio(alignment(6.45), 6.5)).toBe(true);
    expect(alignmentMatchesAudio(alignment(6.45), undefined)).toBe(true);
  });
  it('rejects an alignment computed on a differently-cut clip', () => {
    expect(alignmentMatchesAudio(alignment(7.55), 6.45)).toBe(false);
  });
});

describe('loadOrComputeAlignment', () => {
  it('still returns the cache when audio duration cannot be read', async () => {
    const cached = alignment(7.55);
    const result = await loadOrComputeAlignment('a', new Blob(['x']), 't', async () => cached, async () => {});
    expect(result).toBe(cached);
    expect(alignAudio).not.toHaveBeenCalled();
  });
});
