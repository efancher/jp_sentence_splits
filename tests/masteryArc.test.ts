import { describe, expect, it } from 'vitest';

import { buildSentenceMasteryArc, rankSentenceMasteryArcs } from '../src/lib/masteryArc';

describe('buildSentenceMasteryArc', () => {
  it('defaults every rung to null (not applicable) when nothing is passed', () => {
    const arc = buildSentenceMasteryArc('s1', {});
    expect(arc.rungs.every((rung) => rung.status === null)).toBe(true);
    expect(arc.complete).toBe(true);
    expect(arc.nextRung).toBeNull();
    expect(arc.clearedCount).toBe(0);
    expect(arc.applicableCount).toBe(0);
  });

  it('is not complete while a real rung is false, and reports it as next', () => {
    const arc = buildSentenceMasteryArc('s1', {
      vocabConfirmed: true,
      readingProficient: true,
      listeningProficient: false,
      pitchProficient: true,
    });
    expect(arc.complete).toBe(false);
    expect(arc.nextRung?.key).toBe('listeningProficient');
    expect(arc.clearedCount).toBe(3);
    expect(arc.applicableCount).toBe(4);
  });

  it('finds the first false rung in ladder order, not input order', () => {
    const arc = buildSentenceMasteryArc('s1', {
      pitchProficient: false,
      vocabConfirmed: false,
    });
    expect(arc.nextRung?.key).toBe('vocabConfirmed');
  });

  it('is complete when every applicable rung is true, even with null rungs mixed in', () => {
    const arc = buildSentenceMasteryArc('s1', {
      vocabConfirmed: true,
      readingProficient: true,
      listeningProficient: null,
      conjugationsProficient: null,
      shadowed: true,
    });
    expect(arc.complete).toBe(true);
    expect(arc.nextRung).toBeNull();
    expect(arc.clearedCount).toBe(3);
    expect(arc.applicableCount).toBe(3);
  });
});

describe('rankSentenceMasteryArcs', () => {
  function arc(sentenceId: string, statuses: Record<string, boolean | null>) {
    return buildSentenceMasteryArc(sentenceId, statuses as any);
  }

  it('excludes complete arcs and arcs with no progress at all', () => {
    const complete = arc('s-complete', { vocabConfirmed: true, readingProficient: true });
    const unstarted = arc('s-unstarted', { vocabConfirmed: false });
    const inProgress = arc('s-progress', { vocabConfirmed: true, readingProficient: false });
    const ranked = rankSentenceMasteryArcs([complete, unstarted, inProgress]);
    expect(ranked.map((a) => a.sentenceId)).toEqual(['s-progress']);
  });

  it('orders by fewest remaining rungs first ("one rung left" surfaces before "five left")', () => {
    const almostDone = arc('s-almost', {
      vocabConfirmed: true,
      readingProficient: true,
      listeningProficient: true,
      conjugationsProficient: false,
    });
    const justStarted = arc('s-started', {
      vocabConfirmed: true,
      readingProficient: false,
      listeningProficient: false,
      conjugationsProficient: false,
    });
    const ranked = rankSentenceMasteryArcs([justStarted, almostDone]);
    expect(ranked.map((a) => a.sentenceId)).toEqual(['s-almost', 's-started']);
  });

  it('breaks ties by sentenceId for a stable order', () => {
    const a = arc('s-b', { vocabConfirmed: true, readingProficient: false });
    const b = arc('s-a', { vocabConfirmed: true, readingProficient: false });
    const ranked = rankSentenceMasteryArcs([a, b]);
    expect(ranked.map((r) => r.sentenceId)).toEqual(['s-a', 's-b']);
  });

  it('respects the limit', () => {
    const arcs = Array.from({ length: 5 }, (_, i) =>
      arc(`s-${i}`, { vocabConfirmed: true, readingProficient: false }),
    );
    expect(rankSentenceMasteryArcs(arcs, 2)).toHaveLength(2);
  });
});
