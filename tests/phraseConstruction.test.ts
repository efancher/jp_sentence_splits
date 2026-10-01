import { describe, expect, it } from 'vitest';

import {
  constructionRule,
  layerDepth,
  layersOverlapping,
  orderLayers,
  parseConstructions,
  pickConstructionCompare,
  validLayersFor,
  type LayerWithSentence,
} from '../src/lib/phraseConstruction';

const ctx = {
  sentences: [
    { id: 's1', japanese: '本を読んでいるのが好きだ。' },
    { id: 's2', japanese: '音楽を聞いているのが楽しい。' },
    { id: 's3', japanese: '雨が降った。' },
  ],
};
const layer = (text: string, key: string, operation: string, extra: Record<string, unknown> = {}) => ({
  text, key, operation, attach: 'attaches', contribution: 'does something here', ...extra,
});

describe('parseConstructions', () => {
  const raw = {
    S1: [
      layer('読んで', 'te_form', 'inflection', { from: '読む' }),
      layer('読んでいる', 'te_iru', 'helper', { use: 'ongoing' }),
      layer('本を読んでいるの', 'no_nominaliser', 'role_change', { scope: 'the whole clause' }),
    ],
  };

  it('keeps nested layers with computed spans and orders inner first', () => {
    const { drafts, rejected } = parseConstructions(raw, ctx);
    expect(rejected).toEqual([]);
    const layers = drafts.get('s1')!;
    expect(layers.every((l) => ctx.sentences[0]!.japanese.slice(l.start, l.end) === l.text)).toBe(true);
    expect(orderLayers(layers).map((l) => l.key)).toEqual(['te_form', 'te_iru', 'no_nominaliser']);
    expect(layerDepth(layers, layers[0]!)).toBe(2);
    expect(layerDepth(layers, layers[2]!)).toBe(0);
  });

  it('rejects bad layers individually and keeps the rest', () => {
    const { drafts, rejected } = parseConstructions(
      { S1: [layer('存在しない', 'te_form', 'inflection'), layer('読んで', 'te_form', 'inflection'), layer('んでい', 'te_iru', 'helper'), layer('好き', 'weird_thing', 'inflection')], S9: [] },
      ctx,
    );
    expect(drafts.get('s1')!.map((l) => l.text)).toEqual(['読んで']);
    expect(rejected.length).toBe(4);
  });

  it('rejects ambiguous quotes and accepts unknown keys only with a rule', () => {
    const ambiguous = parseConstructions(
      { S1: [layer('を', 'te_form', 'inflection'), layer('の', 'no_nominaliser', 'role_change')] },
      { sentences: [{ id: 'x', japanese: 'ををの' }] },
    );
    expect(ambiguous.drafts.get('x')?.map((l) => l.text)).toEqual(['の']);
    const withRule = parseConstructions(
      { S1: [layer('好き', 'special_adj', 'inflection', { rule: { formation: 'stem + だ', function: 'states' } })] },
      ctx,
    );
    expect(constructionRule(withRule.drafts.get('s1')![0]!)?.source).toBe('draft');
  });

  it('lets the catalog decide the operation', () => {
    const { drafts } = parseConstructions({ S1: [layer('読んでいる', 'te_iru', 'inflection')] }, ctx);
    expect(drafts.get('s1')![0]!.operation).toBe('helper');
  });

  it('handles a non-object reply and plain verb inflection', () => {
    expect(parseConstructions([], ctx).rejected.length).toBe(1);
    const { drafts } = parseConstructions({ S3: [layer('降った', 'ta_form', 'inflection', { from: '降る' })] }, ctx);
    expect(constructionRule(drafts.get('s3')![0]!)?.source).toBe('catalog');
  });
});

describe('validation and compare', () => {
  const sentences = ctx.sentences.map((s, i) => ({ ...s, position: i + 1 }));
  const { drafts } = parseConstructions(
    {
      S1: [layer('本を読んでいるの', 'no_nominaliser', 'role_change', { use: 'subject' })],
      S2: [layer('聞いているの', 'no_nominaliser', 'role_change', { use: 'subject' })],
    },
    ctx,
  );
  const all: LayerWithSentence[] = [...drafts].flatMap(([sentenceId, ls]) => ls.map((l) => ({ ...l, sentenceId })));
  const current = { sentenceId: 's1', layer: drafts.get('s1')![0]! };

  it('drops layers whose text no longer matches the sentence', () => {
    expect(validLayersFor('別の文です。', drafts.get('s1'))).toEqual([]);
    expect(validLayersFor(ctx.sentences[0]!.japanese, drafts.get('s1'))).toHaveLength(1);
    expect(validLayersFor('x', undefined)).toEqual([]);
  });

  it('compares the same construction on different words', () => {
    const cmp = pickConstructionCompare(current, all, sentences, new Set());
    expect(cmp?.other.sentenceId).toBe('s2');
    expect(cmp?.differentWords).toBe(true);
    expect(cmp?.remainingUnseen).toBe(0);
  });

  it('omits comparison when there is no other reliable occurrence', () => {
    expect(pickConstructionCompare(current, all.filter((a) => a.sentenceId === 's1'), sentences, new Set())).toBeUndefined();
    const stale = sentences.map((s) => (s.id === 's2' ? { ...s, japanese: '変わった文。' } : s));
    expect(pickConstructionCompare(current, all, stale, new Set())).toBeUndefined();
  });

  it('finds the layer best matching a target span', () => {
    const ls = parseConstructions({ S1: [layer('読んで', 'te_form', 'inflection'), layer('読んでいる', 'te_iru', 'helper')] }, ctx).drafts.get('s1')!;
    expect(layersOverlapping(ls, { start: 2, end: 5 })[0]!.key).toBe('te_form');
    expect(layersOverlapping(ls, { start: 10, end: 12 })).toEqual([]);
  });
});
