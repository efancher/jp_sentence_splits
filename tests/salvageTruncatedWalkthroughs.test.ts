import { describe, expect, it } from 'vitest';
import { salvageTruncatedWalkthroughs } from '../src/lib/assistRepair';

describe('salvageTruncatedWalkthroughs', () => {
  const entry = (n: number) => `"S${n}": { "words": [ {"text": "歴史", "gloss": "history {x}"} ], "clauses": [ {"clause": "a"} ] }`;

  it('keeps the sentences that finished before the cut-off', () => {
    const reply = `{ "version": 1, "walkthroughs": { ${entry(21)}, ${entry(22)}, "S23": { "words": [ {"text": "を", "gloss": "mar`;
    const out = salvageTruncatedWalkthroughs(reply);
    expect(Object.keys(JSON.parse(out!).walkthroughs)).toEqual(['S21', 'S22']);
  });

  it('handles array-shaped entries and code fences', () => {
    const reply = '```json\n{"walkthroughs":{"S1":[{"text":"a"}],"S2":[{"text":"b"';
    expect(Object.keys(JSON.parse(salvageTruncatedWalkthroughs(reply)!).walkthroughs)).toEqual(['S1']);
  });

  it('returns null when no sentence finished', () => {
    expect(salvageTruncatedWalkthroughs('{ "version": 1, "walkthroughs": { "S21": { "words": [ {"text": "歴')).toBeNull();
  });
});
