/**
 * Fixed phrases whose pieces gloss misleadingly on their own (について → に +
 * つく "to attach"). Matched over adjacent stored suggestions by concatenated
 * surface; the phrase gets one gloss-only entry and its pieces are skipped.
 * Never study items — see `isGlossOnlySuggestion` for the single-word tier.
 */
export const SET_EXPRESSIONS: ReadonlyMap<string, { reading: string; english: string }> = new Map([
  ['について', { reading: 'について', english: 'about / concerning' }],
  ['に対して', { reading: 'にたいして', english: 'toward / in contrast to' }],
  ['にとって', { reading: 'にとって', english: 'for (someone) / from the viewpoint of' }],
  ['によって', { reading: 'によって', english: 'by / depending on' }],
  ['において', { reading: 'において', english: 'at / in (a place or situation)' }],
  ['として', { reading: 'として', english: 'as / in the role of' }],
  ['という', { reading: 'という', english: 'called / that (quoting or naming)' }],
  ['かもしれない', { reading: 'かもしれない', english: 'might / maybe' }],
  ['かもしれません', { reading: 'かもしれません', english: 'might / maybe' }],
  ['なければならない', { reading: 'なければならない', english: 'must / have to' }],
  ['なくてはいけない', { reading: 'なくてはいけない', english: 'must / have to' }],
  ['てはいけない', { reading: 'てはいけない', english: 'must not' }],
  ['わけではない', { reading: 'わけではない', english: "it's not that…" }],
]);

const MAX_SPAN = 6;

interface SpanSuggestion {
  surface?: string;
  start?: number;
  end?: number;
  source?: string;
}

/** Non-overlapping, longest-first matches as `[firstIndex, lastIndex, key]`. */
export function findSetExpressions(suggestions: SpanSuggestion[]): { first: number; last: number; key: string }[] {
  const found: { first: number; last: number; key: string }[] = [];
  let i = 0;
  while (i < suggestions.length) {
    let match: { last: number; key: string } | undefined;
    let text = '';
    for (let j = i; j < Math.min(suggestions.length, i + MAX_SPAN); j += 1) {
      const current = suggestions[j]!;
      const previous = suggestions[j - 1];
      if (current.source !== 'morphology' || current.surface === undefined || current.start === undefined || current.end === undefined) break;
      if (j > i && previous?.end !== current.start) break;
      text += current.surface;
      if (SET_EXPRESSIONS.has(text)) match = { last: j, key: text };
    }
    if (match) {
      found.push({ first: i, last: match.last, key: match.key });
      i = match.last + 1;
    } else {
      i += 1;
    }
  }
  return found;
}
