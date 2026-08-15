import { describe, expect, it } from 'vitest';

import {
  computeContextDiversity,
  computeMaturityLevel,
} from '../src/lib/maturity';

describe('computeContextDiversity', () => {
  it('counts zero sentences/sources for an empty map', () => {
    const diversity = computeContextDiversity(new Map());
    expect(diversity).toEqual({ distinctSentenceCount: 0, distinctSourceCount: 0 });
  });

  it('counts one sentence/one source for a single link', () => {
    const diversity = computeContextDiversity(
      new Map([['sent-1', ['satori:book-1']]]),
    );
    expect(diversity).toEqual({ distinctSentenceCount: 1, distinctSourceCount: 1 });
  });

  it('counts multiple sentences from the same source as one distinct source', () => {
    const diversity = computeContextDiversity(
      new Map([
        ['sent-1', ['satori:book-1']],
        ['sent-2', ['satori:book-1']],
      ]),
    );
    expect(diversity).toEqual({ distinctSentenceCount: 2, distinctSourceCount: 1 });
  });

  it('counts distinct sources across sentences, deduping shared source keys', () => {
    const diversity = computeContextDiversity(
      new Map([
        ['sent-1', ['satori:book-1']],
        ['sent-2', ['youtube:video-1']],
        ['sent-3', ['satori:book-1', 'youtube:video-1']],
      ]),
    );
    expect(diversity).toEqual({ distinctSentenceCount: 3, distinctSourceCount: 2 });
  });

  it('treats a sentence with no book membership as contributing no source', () => {
    const diversity = computeContextDiversity(new Map([['sent-1', []]]));
    expect(diversity).toEqual({ distinctSentenceCount: 1, distinctSourceCount: 0 });
  });
});

describe('computeMaturityLevel', () => {
  it('is fragile with a single context and no long-interval success', () => {
    const level = computeMaturityLevel(
      { distinctSentenceCount: 1, distinctSourceCount: 1 },
      { hasLongIntervalSuccess: false },
    );
    expect(level).toBe('fragile');
  });

  it('is established with several sentences from one source', () => {
    const level = computeMaturityLevel(
      { distinctSentenceCount: 3, distinctSourceCount: 1 },
      { hasLongIntervalSuccess: false },
    );
    expect(level).toBe('established');
  });

  it('is generalized once contexts span multiple sources', () => {
    const level = computeMaturityLevel(
      { distinctSentenceCount: 2, distinctSourceCount: 2 },
      { hasLongIntervalSuccess: false },
    );
    expect(level).toBe('generalized');
  });

  it('is mature with multi-source diversity plus a long-interval success', () => {
    const level = computeMaturityLevel(
      { distinctSentenceCount: 4, distinctSourceCount: 3 },
      { hasLongIntervalSuccess: true },
    );
    expect(level).toBe('mature');
  });

  it('does not treat a long-interval success alone (single source) as mature', () => {
    const level = computeMaturityLevel(
      { distinctSentenceCount: 1, distinctSourceCount: 1 },
      { hasLongIntervalSuccess: true },
    );
    expect(level).toBe('fragile');
  });
});
