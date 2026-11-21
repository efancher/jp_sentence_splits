import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/lib/episodePreparation';

describe('extractJson inner straight quotes', () => {
  it('escapes unescaped quotes inside string values', () => {
    const reply = '{"walkthroughs":{"S11":[{"text":"ね","note":"Here "ね" seeks agreement, and "よ" asserts."}]}}';
    expect(extractJson(reply)).toEqual({
      walkthroughs: { S11: [{ text: 'ね', note: 'Here "ね" seeks agreement, and "よ" asserts.' }] },
    });
  });

  it('accepts raw newlines and tabs inside strings', () => {
    expect(extractJson('{"a":{"note":"x\ny\tz"}}')).toEqual({ a: { note: 'x\ny\tz' } });
  });

  it('ignores trailing prose that contains braces', () => {
    expect(extractJson('{"a":{"b":"c"}}\nHope that helps {ok}')).toEqual({ a: { b: 'c' } });
  });

  it('leaves valid JSON untouched', () => {
    expect(extractJson('{"a":"b \\"c\\"","d":[1,2]}')).toEqual({ a: 'b "c"', d: [1, 2] });
  });
});
