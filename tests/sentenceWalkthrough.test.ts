import { describe, expect, it } from 'vitest';

import type { AnalysisChunk } from '../src/domain/types';
import { walkthroughChunks, walkthroughClauseNumbers, walkthroughOrder } from '../src/components/SentenceWalkthrough';

const sentence = { id: 's', japanese: '私は本を読みます。' };
const chunk = (id: string, order: number, japanese: string, role: string, kind?: 'zero_ga'): AnalysisChunk =>
  ({ id, order, japanese, role, literalEnglish: `lit ${id}`, kind });

describe('walkthroughChunks', () => {
  it('uses a saved analysis that matches the sentence and skips inferred zero-ga chunks', () => {
    const result = walkthroughChunks(sentence, [
      chunk('z', 0, '', 'subject', 'zero_ga'),
      chunk('b', 2, '本を', 'object'),
      chunk('a', 1, '私は', 'topic'),
      chunk('c', 3, '読みます。', 'engine'),
    ]);
    expect(result.source).toBe('saved');
    expect(result.chunks.map((item) => item.japanese)).toEqual(['私は', '本を', '読みます。']);
    expect(result.chunks[0]!.literalEnglish).toBe('lit a');
  });

  it('falls back to a heuristic draft when there is no analysis or it no longer matches the text', () => {
    for (const saved of [undefined, [], [chunk('x', 0, '別の文', 'engine')]]) {
      const result = walkthroughChunks(sentence, saved);
      expect(result.source).toBe('draft');
      expect(result.chunks.map((item) => item.japanese).join('')).toBe(sentence.japanese);
    }
  });

  it('teaches the engine first, then the rest in source order', () => {
    const ordered = walkthroughOrder([{ role: 'topic', id: 1 }, { role: 'engine', id: 2 }, { role: 'object', id: 3 }]);
    expect(ordered.map((item) => item.id)).toEqual([2, 1, 3]);
  });

  it('keeps each clause together: its engine, its parts, then the next clause', () => {
    // 友だちが / 貸してくれた(engine) / 本を / 読みました(engine)
    const ordered = walkthroughOrder([
      { role: 'subject', id: 'tomodachi' }, { role: 'engine', id: 'kashite' }, { role: 'object', id: 'hon' }, { role: 'engine', id: 'yomimashita' },
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['kashite', 'tomodachi', 'yomimashita', 'hon']);
  });

  it('puts a clause connector before the clause it leads into, ahead of that clause\'s engine', () => {
    const ordered = walkthroughOrder([
      { role: 'time', id: 'a' }, { role: 'engine', id: 'e1' }, { role: 'clause connector', id: 'c' }, { role: 'object', id: 'o' }, { role: 'engine', id: 'e2' },
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['e1', 'a', 'c', 'e2', 'o']);
  });

  it('numbers clauses in source order and never drops or duplicates a chunk', () => {
    const chunks = [{ role: 'subject' }, { role: 'engine' }, { role: 'object' }, { role: 'engine' }, { role: 'sentence ending' }];
    expect(walkthroughOrder(chunks)).toHaveLength(chunks.length);
    expect(new Set(walkthroughOrder(chunks)).size).toBe(chunks.length);
    expect([...walkthroughClauseNumbers(chunks).values()]).toEqual([1, 1, 2, 2, 2]);
    expect(walkthroughOrder([])).toEqual([]);
  });
});
