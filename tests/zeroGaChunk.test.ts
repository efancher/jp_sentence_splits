import { describe, expect, it } from 'vitest';

import {
  addZeroGaSubject,
  applyHeuristicChunks,
  applySpacedChunks,
  chunkHasSpeakableJapanese,
  hasZeroGaSubject,
  initialSpacedText,
  isZeroGaChunk,
  moveChunk,
  removeZeroGaSubject,
  surfaceJapaneseParts,
  ZERO_GA_DEFAULT_JAPANESE,
  ZERO_GA_ROLE,
} from '../src/lib/analysisHelpers';
import { lintAnalysis } from '../src/lib/analysisSuggestions';
import type { AnalysisChunk } from '../src/domain/types';

const SOURCE = 'ひなは飛んだ。';

function surface(japanese: string, order: number, extra?: Partial<AnalysisChunk>): AnalysisChunk {
  return {
    id: `s${order}`,
    order,
    japanese,
    role: '',
    literalEnglish: '',
    ...extra,
  };
}

describe('zero-が subject chunk', () => {
  it('adds a default zero_ga chunk at the front and removes it via checkbox helpers', () => {
    const base = [surface('ひなは', 0), surface('飛んだ。', 1)];
    const withZero = addZeroGaSubject(base);
    expect(hasZeroGaSubject(withZero)).toBe(true);
    expect(withZero[0]?.kind).toBe('zero_ga');
    expect(withZero[0]?.japanese).toBe(ZERO_GA_DEFAULT_JAPANESE);
    expect(withZero[0]?.role).toBe(ZERO_GA_ROLE);
    expect(surfaceJapaneseParts(withZero)).toEqual(['ひなは', '飛んだ。']);
    expect(hasZeroGaSubject(removeZeroGaSubject(withZero))).toBe(false);
  });

  it('does not count zero_ga japanese toward source integrity', () => {
    const chunks = addZeroGaSubject([
      surface('ひなは', 0, { role: 'topic は' }),
      surface('飛んだ。', 1, { role: 'engine' }),
    ]);
    const suggestions = lintAnalysis(SOURCE, chunks);
    expect(suggestions.some((item) => item.kind === 'integrity')).toBe(false);
  });

  it('preserves zero_ga across spaced rebuild and heuristic apply', () => {
    const previous = addZeroGaSubject([
      surface('ひなは飛んだ。', 0, {
        role: 'engine',
        literalEnglish: 'hina-as-for flew',
      }),
    ]);
    previous[0] = {
      ...previous[0]!,
      literalEnglish: 'the chick',
    };

    const spaced = applySpacedChunks('ひなは 飛んだ。', SOURCE, previous);
    expect(spaced.ok).toBe(true);
    if (!spaced.ok) return;
    expect(spaced.chunks.filter(isZeroGaChunk)).toHaveLength(1);
    expect(spaced.chunks.find(isZeroGaChunk)?.literalEnglish).toBe('the chick');
    expect(surfaceJapaneseParts(spaced.chunks)).toEqual(['ひなは', '飛んだ。']);
    expect(initialSpacedText(SOURCE, spaced.chunks)).toBe('ひなは 飛んだ。');

    const heuristic = applyHeuristicChunks(SOURCE, spaced.chunks);
    expect(heuristic.some(isZeroGaChunk)).toBe(true);
    expect(heuristic.find(isZeroGaChunk)?.literalEnglish).toBe('the chick');
  });

  it('moves the zero_ga chunk among surface chunks', () => {
    let chunks = addZeroGaSubject([
      surface('ひなは', 0),
      surface('飛んだ。', 1),
    ]);
    const zeroId = chunks[0]!.id;
    chunks = moveChunk(chunks, zeroId, 'down');
    expect(chunks.map((chunk) => chunk.japanese)).toEqual([
      'ひなは',
      ZERO_GA_DEFAULT_JAPANESE,
      '飛んだ。',
    ]);
    chunks = moveChunk(chunks, zeroId, 'down');
    expect(chunks.map((chunk) => (isZeroGaChunk(chunk) ? 'ZERO' : chunk.japanese))).toEqual([
      'ひなは',
      '飛んだ。',
      'ZERO',
    ]);
  });

  it('treats ∅が as non-speakable and editable subject text as speakable', () => {
    expect(chunkHasSpeakableJapanese(ZERO_GA_DEFAULT_JAPANESE)).toBe(false);
    expect(chunkHasSpeakableJapanese('ひな')).toBe(true);
  });
});
