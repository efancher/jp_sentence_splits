import { describe, expect, it } from 'vitest';

import type { ContextWalkthrough } from '../src/domain/types';
import { buildClauseMap } from '../src/lib/clauseMap';

const japanese = '私は動物が好きなので、動物と一緒に住みたいです。';
const chunks = [
  { japanese: '私は', role: 'topic', start: 0, end: 2 },
  { japanese: '動物が', role: 'object', start: 2, end: 5 },
  { japanese: '好き', role: 'engine', literalEnglish: 'like', start: 5, end: 7 },
  { japanese: 'なので、', role: 'clause connector', literalEnglish: 'because', start: 7, end: 11 },
  { japanese: '動物と', role: 'companion', start: 11, end: 14 },
  { japanese: '一緒に', role: 'manner', start: 14, end: 17 },
  { japanese: '住みたいです。', role: 'engine', start: 17, end: 24 },
];
const step = (text: string, gloss: string) => {
  const start = japanese.indexOf(text);
  return { text, start, end: start + text.length, gloss, explanation: 'x' };
};

describe('buildClauseMap', () => {
  it('splits at the connector, which links rather than belongs to the clause', () => {
    const map = buildClauseMap(chunks, japanese)!;
    expect(map.map((entry) => entry.text)).toEqual(['私は動物が好き', '動物と一緒に住みたいです。']);
    expect(map[0]!.connector).toBeUndefined();
    expect(map[1]!.connector).toEqual({ text: 'なので、', gloss: 'because' });
  });

  it('adds top-level step glosses per clause', () => {
    const walkthrough: ContextWalkthrough = {
      natural: 'x',
      steps: [step('動物が好き', 'like animals'), step('動物', 'animals'), step('住みたいです', 'want to live')],
    };
    const map = buildClauseMap(chunks, japanese, walkthrough)!;
    expect(map[0]!.stepGlosses.map((item) => item.gloss)).toEqual(['like animals']);
    expect(map[1]!.stepGlosses.map((item) => item.gloss)).toContain('want to live');
  });

  it('returns nothing for a one-clause sentence', () => {
    expect(buildClauseMap(chunks.slice(0, 3), japanese)).toBeUndefined();
  });
});
