import { lemmaKey, lemmaWeight, scoreSentence, unlockValueByLemma, type LemmaSource } from './unknownLemmas';

/** A sentence with 1..this many unknown content lemmas is an "i+1" sentence. */
export const I_PLUS_ONE_MAX_UNKNOWN = 2;
/** Every Nth new sentence is a stretch sentence (3+ unknown lemmas) so the pool of i+1 sentences cannot become a rut. */
export const I_PLUS_ONE_STRETCH_EVERY = 5;

export interface IPlusOneItem {
  sentenceId: string;
  suggestions: readonly LemmaSource[] | undefined;
  /** Curated grammar entry ids the sentence carries (see `curatedGrammarByPattern`); counted only when `knownGrammar` is passed. */
  grammar?: readonly string[];
}

/**
 * Orders a book's not-yet-introduced sentences by how much the learner already
 * knows of them (docs/ROADMAP.md, "organic vocabulary/grammar growth"). Pure:
 * `items` arrive in reading order and the result is a permutation of them, so
 * nothing is dropped, gated or starved — only reordered.
 *
 * Tiers, in the order they are served:
 * 1. i+1: 1-2 unknown pieces (content lemmas plus, when `knownGrammar` is
 *    given, unmet curated grammar entries), those whose unknown words unlock the
 *    most other sentences first (`unlockValueByLemma`, with fillers, discourse
 *    markers and names down-weighted by `lemmaWeight`), then fewer unknowns,
 *    then reading order.
 * 2. all-known: no unknown lemma (little to learn, but never wasted).
 * 3. stretch: 3+ unknowns, fewest unknowns first. Every
 *    `I_PLUS_ONE_STRETCH_EVERY`th slot is drawn from here while i+1 sentences
 *    remain, so a harder sentence still arrives regularly.
 * 4. not scorable: untokenized or no content words, in reading order, last —
 *    never "zero unknowns", so they cannot jump the queue.
 *
 * Each pool falls through to the next when empty.
 */
export function orderByIPlusOne(
  items: readonly IPlusOneItem[],
  known: ReadonlySet<string>,
  options: { maxUnknown?: number; stretchEvery?: number; knownGrammar?: ReadonlySet<string> } = {},
): string[] {
  const maxUnknown = options.maxUnknown ?? I_PLUS_ONE_MAX_UNKNOWN;
  const stretchEvery = options.stretchEvery ?? I_PLUS_ONE_STRETCH_EVERY;

  const knownGrammar = options.knownGrammar;
  const scored = items.map((item, position) => {
    const score = scoreSentence(item.suggestions, known);
    const unknown = score.scorable ? score.unknown : [];
    // Curated grammar the learner hasn't met counts like an unknown word, so "1-2 new pieces" covers both.
    const grammarUnknown = knownGrammar ? (item.grammar ?? []).filter((id) => !knownGrammar.has(id)).length : 0;
    return {
      id: item.sentenceId,
      position,
      scorable: score.scorable,
      unknown,
      count: unknown.length + grammarUnknown,
    };
  });
  const weights = new Map<string, number>();
  for (const item of items) {
    for (const suggestion of item.suggestions ?? []) {
      if (!suggestion.selectedByDefault) continue;
      const key = lemmaKey(suggestion.expression, suggestion.reading);
      if (!weights.has(key)) weights.set(key, lemmaWeight(suggestion.expression, suggestion.pos));
    }
  }
  const value = unlockValueByLemma(
    scored.filter((entry) => entry.scorable).map((entry) => entry.unknown),
    maxUnknown,
    (key) => weights.get(key) ?? 1,
  );
  const unlock = (entry: (typeof scored)[number]) =>
    entry.unknown.reduce((sum, key) => sum + (value.get(key) ?? 0), 0);

  const ready: typeof scored = [];
  const allKnown: typeof scored = [];
  const stretch: typeof scored = [];
  const unscorable: typeof scored = [];
  for (const entry of scored) {
    if (!entry.scorable) unscorable.push(entry);
    else if (entry.count === 0) allKnown.push(entry);
    else if (entry.count <= maxUnknown) ready.push(entry);
    else stretch.push(entry);
  }
  ready.sort((a, b) => unlock(b) - unlock(a) || a.count - b.count || a.position - b.position);
  stretch.sort((a, b) => a.count - b.count || a.position - b.position);

  const ordered: string[] = [];
  const take = (queue: typeof scored) => ordered.push(queue.shift()!.id);
  while (ready.length + allKnown.length + stretch.length + unscorable.length > 0) {
    const slot = ordered.length + 1;
    if (stretchEvery > 0 && slot % stretchEvery === 0 && stretch.length > 0 && ready.length > 0) take(stretch);
    else if (ready.length > 0) take(ready);
    else if (allKnown.length > 0) take(allKnown);
    else if (stretch.length > 0) take(stretch);
    else take(unscorable);
  }
  return ordered;
}
