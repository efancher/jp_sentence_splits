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
  /** Sentences of the same episode the learner has already started (see `episodeMomentumBoost`). */
  momentum?: number;
}

/** Started sentences in an episode beyond this add nothing more, so a huge episode cannot swamp everything else. */
export const EPISODE_MOMENTUM_CAP = 10;
/** The largest share (+50%) a fully warmed-up episode adds to a ready sentence's unlock value. */
export const EPISODE_MOMENTUM_WEIGHT = 0.5;

/** Multiplier on a ready sentence's unlock value: episodes with many started sentences are favoured (motivation, context). */
export function episodeMomentumBoost(started: number | undefined): number {
  return 1 + (EPISODE_MOMENTUM_WEIGHT * Math.min(Math.max(started ?? 0, 0), EPISODE_MOMENTUM_CAP)) / EPISODE_MOMENTUM_CAP;
}

/**
 * Orders a book's not-yet-introduced sentences by how much the learner already
 * knows of them (docs/ROADMAP.md, "organic vocabulary/grammar growth"). Pure:
 * `items` arrive in reading order and the result is a permutation of them, so
 * nothing is dropped, gated or starved — only reordered.
 *
 * Tiers, in the order they are served:
 * 1. i+1: 1-2 unknown pieces (content lemmas plus, when `knownGrammar` is
 *    given, unmet curated grammar entries). Sentences carrying a word the
 *    learner has met but not yet settled (`reinforce`) come first, so a new
 *    word is revisited soon; within each group, those whose unknown words unlock the
 *    most other sentences first (`unlockValueByLemma`, with fillers, discourse
 *    markers and names down-weighted by `lemmaWeight`), then fewer unknowns,
 *    then episodes with more already-started sentences, then reading order. The
 *    unlock value is lifted by up to +50% for such episodes (`episodeMomentumBoost`)
 *    so they are favoured without overriding a much more useful word.
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
  options: {
    maxUnknown?: number;
    stretchEvery?: number;
    knownGrammar?: ReadonlySet<string>;
    /** Weight of an unmet grammar entry (default 1); see `grammarLevelCosts`. */
    grammarCost?: ReadonlyMap<string, number>;
    /** Lemmas already met but not yet known (`partlyMetLemmas`): ready sentences carrying one are offered first, to reinforce. */
    reinforce?: ReadonlySet<string>;
  } = {},
): string[] {
  const maxUnknown = options.maxUnknown ?? I_PLUS_ONE_MAX_UNKNOWN;
  const stretchEvery = options.stretchEvery ?? I_PLUS_ONE_STRETCH_EVERY;

  const knownGrammar = options.knownGrammar;
  const scored = items.map((item, position) => {
    const score = scoreSentence(item.suggestions, known);
    const unknown = score.scorable ? score.unknown : [];
    // Curated grammar the learner hasn't met counts like an unknown word, so "1-2 new pieces" covers both.
    const grammarUnknown = knownGrammar
      ? (item.grammar ?? [])
          .filter((id) => !knownGrammar.has(id))
          .reduce((sum, id) => sum + (options.grammarCost?.get(id) ?? 1), 0)
      : 0;
    return {
      id: item.sentenceId,
      position,
      scorable: score.scorable,
      unknown,
      count: unknown.length + grammarUnknown,
      reinforces: options.reinforce ? unknown.some((key) => options.reinforce!.has(key)) : false,
      momentum: item.momentum ?? 0,
    };
  });
  const weights = lemmaWeightsOf(items);
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
  const lift = (entry: (typeof scored)[number]) => unlock(entry) * episodeMomentumBoost(entry.momentum);
  ready.sort(
    (a, b) =>
      Number(b.reinforces) - Number(a.reinforces) ||
      lift(b) - lift(a) || a.count - b.count || b.momentum - a.momentum || a.position - b.position,
  );
  stretch.sort((a, b) => a.count - b.count || b.momentum - a.momentum || a.position - b.position);

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

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
/** Share of a level's patterns (those the pool actually uses) the learner must have met before the next level opens. */
export const GRAMMAR_LEVEL_OPEN_AT = 0.6;

/**
 * Level-aware pacing for grammar: the frontier is the easiest JLPT level whose in-use patterns are less than
 * `GRAMMAR_LEVEL_OPEN_AT` met; an unmet pattern costs 1 plus its levels above the frontier, so an N2 pattern is
 * not offered as "one new piece" while N4 is still being met. Entries without a level cost 1. Only entries
 * costing more than 1 are returned.
 */
export function grammarLevelCosts(
  entries: ReadonlyMap<string, string | undefined>,
  known: ReadonlySet<string>,
): Map<string, number> {
  const rank = (level: string | undefined) => LEVELS.indexOf(level as (typeof LEVELS)[number]);
  let frontier = LEVELS.length - 1;
  for (let i = 0; i < LEVELS.length; i += 1) {
    const ids = [...entries].filter(([, level]) => rank(level) === i).map(([id]) => id);
    if (ids.length > 0 && ids.filter((id) => known.has(id)).length / ids.length < GRAMMAR_LEVEL_OPEN_AT) {
      frontier = i;
      break;
    }
  }
  const costs = new Map<string, number>();
  for (const [id, level] of entries) {
    const r = rank(level);
    if (r > frontier) costs.set(id, 1 + r - frontier);
  }
  return costs;
}

/** Introduced sentences a curated grammar entry must appear in before it counts as met (one sighting is not enough). */
export const GRAMMAR_MIN_EXPOSURES = 2;

/**
 * Curated grammar entries the learner counts as met: seen in at least `GRAMMAR_MIN_EXPOSURES` introduced sentences
 * and not currently shaky (the learner tapped it and its weakest facet is below the reader's known bar). A
 * sequencing signal only; it never grades or schedules anything.
 */
export function knownGrammarEntries(
  exposures: ReadonlyMap<string, number>,
  shaky: ReadonlySet<string> = new Set(),
  minExposures: number = GRAMMAR_MIN_EXPOSURES,
): Set<string> {
  const known = new Set<string>();
  for (const [id, count] of exposures) if (count >= minExposures && !shaky.has(id)) known.add(id);
  return known;
}

/** Default weight of each content lemma across `items` (`lemmaWeight`, first sighting wins). */
function lemmaWeightsOf(items: readonly IPlusOneItem[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const item of items) {
    for (const suggestion of item.suggestions ?? []) {
      if (!suggestion.selectedByDefault) continue;
      const key = lemmaKey(suggestion.expression, suggestion.reading);
      if (!weights.has(key)) weights.set(key, lemmaWeight(suggestion.expression, suggestion.pos));
    }
  }
  return weights;
}

/**
 * Strict i+1 (`settings.iPlusOneStrict`): grows the learner's word/grammar list one piece at a time, as if the
 * sentences were studied in the order returned. Pure, and a permutation of `items` like `orderByIPlusOne`.
 *
 * 1. Every sentence with nothing outside the list comes first (episodes with more started sentences first, then
 *    reading order).
 * 2. Only when none is left is one new piece added: the cost-1 piece (a word, or a curated grammar entry at the
 *    learner's level) whose sentences have it as their only new piece, preferring a word already met once
 *    (`reinforce`), then the most such sentences (scaled by `lemmaWeight`). The sentence introducing it comes next,
 *    and the piece joins the list, so step 1 then serves every sentence it completed before anything else is added.
 * 3. With no single-piece sentence left, the cheapest remaining sentence brings in all its pieces at once.
 *
 * No stretch cadence. Not-scorable sentences come last in reading order.
 */
export function orderByStrictIPlusOne(
  items: readonly IPlusOneItem[],
  known: ReadonlySet<string>,
  options: {
    knownGrammar?: ReadonlySet<string>;
    grammarCost?: ReadonlyMap<string, number>;
    reinforce?: ReadonlySet<string>;
  } = {},
): string[] {
  interface Entry {
    id: string;
    position: number;
    momentum: number;
    /** Pieces outside the list (`w:<lemma key>` / `g:<entry id>`) and their cost. */
    pieces: Map<string, number>;
    cost: number;
    done: boolean;
  }
  const weights = lemmaWeightsOf(items);
  const isWord = (piece: string) => piece.startsWith('w:');
  const weightOf = (piece: string) => (isWord(piece) ? weights.get(piece.slice(2)) ?? 1 : 1);
  const reinforces = (piece: string) => isWord(piece) && (options.reinforce?.has(piece.slice(2)) ?? false);

  const entries: Entry[] = [];
  const unscorable: string[] = [];
  items.forEach((item, position) => {
    const score = scoreSentence(item.suggestions, known);
    if (!score.scorable) {
      unscorable.push(item.sentenceId);
      return;
    }
    const pieces = new Map<string, number>(score.unknown.map((key) => [`w:${key}`, 1]));
    if (options.knownGrammar) {
      for (const id of item.grammar ?? []) {
        if (!options.knownGrammar.has(id)) pieces.set(`g:${id}`, options.grammarCost?.get(id) ?? 1);
      }
    }
    const cost = [...pieces.values()].reduce((sum, value) => sum + value, 0);
    entries.push({ id: item.sentenceId, position, momentum: item.momentum ?? 0, pieces, cost, done: false });
  });

  const byPiece = new Map<string, Entry[]>();
  /** Not-yet-served sentences whose only new piece is the key (cost 1). */
  const sole = new Map<string, Set<Entry>>();
  const addSole = (entry: Entry) => {
    const [piece] = entry.pieces.keys();
    const set = sole.get(piece!) ?? new Set<Entry>();
    set.add(entry);
    sole.set(piece!, set);
  };
  const dropSole = (entry: Entry) => {
    const [piece] = entry.pieces.keys();
    const set = sole.get(piece!);
    set?.delete(entry);
    if (set?.size === 0) sole.delete(piece!);
  };
  for (const entry of entries) {
    for (const piece of entry.pieces.keys()) {
      const list = byPiece.get(piece) ?? [];
      list.push(entry);
      byPiece.set(piece, list);
    }
    if (entry.cost === 1) addSole(entry);
  }

  const easiest = (a: Entry, b: Entry) => b.momentum - a.momentum || a.position - b.position;
  const ready: Entry[] = entries.filter((entry) => entry.cost === 0).sort(easiest);
  let readyAt = 0;
  const ordered: string[] = [];
  const serve = (entry: Entry) => {
    if (entry.cost === 1) dropSole(entry);
    entry.done = true;
    ordered.push(entry.id);
  };
  const learned = new Set<string>();
  const learn = (pieces: readonly string[]) => {
    const unlocked: Entry[] = [];
    for (const piece of pieces) {
      if (learned.has(piece)) continue;
      learned.add(piece);
      for (const entry of byPiece.get(piece) ?? []) {
        if (entry.done || !entry.pieces.has(piece)) continue;
        if (entry.cost === 1) dropSole(entry);
        entry.cost -= entry.pieces.get(piece)!;
        entry.pieces.delete(piece);
        if (entry.pieces.size === 0) unlocked.push(entry);
        else if (entry.cost === 1) addSole(entry);
      }
    }
    // Only called once `ready` is used up, so the sentences a new piece completed are served next.
    ready.push(...unlocked.sort(easiest));
  };

  while (ordered.length < entries.length) {
    if (readyAt < ready.length) {
      const entry = ready[readyAt++]!;
      if (!entry.done) serve(entry);
      continue;
    }
    // Ties go to the piece whose first sentence is easiest (momentum, then reading order).
    const firstOf = (set: Set<Entry>) => [...set].reduce((a, b) => (easiest(b, a) < 0 ? b : a));
    let best: { piece: string; set: Set<Entry>; reinforce: number; value: number } | undefined;
    for (const [piece, set] of sole) {
      const candidate = { piece, set, reinforce: Number(reinforces(piece)), value: weightOf(piece) * set.size };
      if (
        !best ||
        (candidate.reinforce - best.reinforce ||
          candidate.value - best.value ||
          easiest(firstOf(best.set), firstOf(set))) > 0
      ) {
        best = candidate;
      }
    }
    if (best) {
      serve(firstOf(best.set));
      learn([best.piece]);
      continue;
    }
    const reinforcing = (entry: Entry) => [...entry.pieces.keys()].filter(reinforces).length;
    const cheaper = (a: Entry, b: Entry) =>
      a.cost - b.cost || reinforcing(b) - reinforcing(a) || easiest(a, b);
    let cheapest: Entry | undefined;
    for (const entry of entries) {
      if (!entry.done && (!cheapest || cheaper(entry, cheapest) < 0)) cheapest = entry;
    }
    const pieces = [...cheapest!.pieces.keys()];
    serve(cheapest!);
    learn(pieces);
  }
  return [...ordered, ...unscorable];
}
