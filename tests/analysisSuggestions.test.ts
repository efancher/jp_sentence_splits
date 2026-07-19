import { describe, expect, it } from 'vitest';

import type { AnalysisChunk } from '../src/domain/types';
import {
  applySuggestion,
  lintAnalysis,
} from '../src/lib/analysisSuggestions';
import { applyHeuristicChunks } from '../src/lib/analysisHelpers';

function chunk(
  overrides: Partial<AnalysisChunk> & Pick<AnalysisChunk, 'id' | 'japanese'>,
): AnalysisChunk {
  return {
    order: 0,
    role: '',
    literalEnglish: '',
    ...overrides,
  };
}

describe('lintAnalysis', () => {
  const source = '空は青くて、木々の緑がきれいでした。';

  it('flags missing roles and sticky English', () => {
    const suggestions = lintAnalysis(source, [
      chunk({ id: 'a', japanese: '空は', order: 0 }),
      chunk({
        id: 'b',
        japanese: '青くて、木々の緑がきれいでした。',
        order: 1,
        role: 'engine',
        literalEnglish: 'was pretty',
      }),
    ]);
    expect(suggestions.some((item) => item.kind === 'missing_role')).toBe(true);
    expect(suggestions.some((item) => item.kind === 'missing_lit')).toBe(true);
  });

  it('suggests a heuristic role when the user role differs', () => {
    const suggestions = lintAnalysis(source, [
      chunk({
        id: 'a',
        japanese: '空は',
        order: 0,
        role: 'modifier/content',
        literalEnglish: 'sky as-for',
      }),
      chunk({
        id: 'b',
        japanese: '青くて、',
        order: 1,
        role: 'て-car',
        literalEnglish: 'being-blue-and',
      }),
      chunk({
        id: 'c',
        japanese: '木々の緑が',
        order: 2,
        role: 'Aが',
        literalEnglish: 'trees’ green [A]',
      }),
      chunk({
        id: 'd',
        japanese: 'きれいでした。',
        order: 3,
        role: 'engine',
        literalEnglish: 'was-pretty.',
      }),
    ]);
    const mismatch = suggestions.find((item) => item.kind === 'role_mismatch');
    expect(mismatch?.suggestedRole).toBe('topic は');
    expect(mismatch?.action).toBe('apply_role');
  });

  it('flags Japanese characters and fluent-looking sticky English', () => {
    const suggestions = lintAnalysis(source, [
      chunk({
        id: 'a',
        japanese: source,
        order: 0,
        role: 'engine',
        literalEnglish: 'The sky was blue because 空 looked pretty.',
      }),
    ]);
    expect(suggestions.some((item) => item.kind === 'lit_has_jp')).toBe(true);
    expect(suggestions.some((item) => item.kind === 'lit_fluentish')).toBe(true);
  });

  it('offers reapplying heuristic chunks when boundaries differ', () => {
    const suggestions = lintAnalysis(source, [
      chunk({
        id: 'a',
        japanese: '空は青くて、',
        order: 0,
        role: 'clause connector',
        literalEnglish: 'sky as-for being-blue-and',
      }),
      chunk({
        id: 'b',
        japanese: '木々の緑がきれいでした。',
        order: 1,
        role: 'engine',
        literalEnglish: 'trees green was pretty',
      }),
    ]);
    expect(
      suggestions.some((item) => item.kind === 'chunk_vs_heuristic'),
    ).toBe(true);
  });

  it('applies a suggested role without touching other chunks', () => {
    const chunks = [
      chunk({
        id: 'a',
        japanese: '空は',
        order: 0,
        role: 'modifier/content',
        literalEnglish: 'sky as-for',
      }),
      chunk({
        id: 'b',
        japanese: '青くて、木々の緑がきれいでした。',
        order: 1,
        role: 'engine',
        literalEnglish: 'was pretty',
      }),
    ];
    const suggestion = lintAnalysis(source, chunks).find(
      (item) => item.kind === 'role_mismatch' && item.chunkId === 'a',
    );
    expect(suggestion).toBeTruthy();
    const next = applySuggestion(
      suggestion!,
      source,
      chunks,
      applyHeuristicChunks,
    );
    expect(next[0]?.role).toBe('topic は');
    expect(next[1]?.role).toBe('engine');
  });
});
