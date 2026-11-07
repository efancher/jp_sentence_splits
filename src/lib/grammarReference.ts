/**
 * Matching of the learner's own grammar patterns to a curated reference list
 * (OpenJLPT, CC BY-SA 4.0 — fetched by `diagnose:grammar-reference`, never
 * vendored). A pattern that resolves to a curated entry is "high confidence"
 * for i+1 sequencing (docs/ROADMAP.md); AI-suggested patterns that don't
 * resolve stay out of the unknown count.
 *
 * Normalisation drops the wave dash markers, whitespace, trailing `(note)` /
 * `（note）` disambiguators and punctuation, so `～なくてもいい` and
 * `〜なくてもいい` and `〜なくてもいい（permission）` all share one key.
 */
export interface ReferencePattern {
  id?: string;
  pattern: string;
  reading?: string;
  level?: string;
  formation?: string;
  tags?: string[];
}

export interface OwnPattern {
  id: string;
  canonicalName: string;
  aliases?: readonly string[];
}

export function normalizePatternKey(raw: string): string {
  return raw
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[〜～~\s　?？!！。、.,]/g, '')
    .trim();
}

/** Every normalised form a reference entry can be found under (pattern, `/`-variants, reading). */
export function referenceKeys(entry: ReferencePattern): string[] {
  const keys = new Set<string>();
  for (const source of [entry.pattern, entry.reading ?? '']) {
    for (const variant of source.split(/\s*[/・]\s*/)) {
      const key = normalizePatternKey(variant);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

export function buildReferenceIndex(entries: readonly ReferencePattern[]): Map<string, ReferencePattern[]> {
  const index = new Map<string, ReferencePattern[]>();
  for (const entry of entries) {
    for (const key of referenceKeys(entry)) {
      const bucket = index.get(key);
      if (bucket) {
        if (!bucket.includes(entry)) bucket.push(entry);
      } else {
        index.set(key, [entry]);
      }
    }
  }
  return index;
}

export interface PatternMatch {
  entries: ReferencePattern[];
  /** True when the normalised key maps to several curated entries (e.g. one pattern with several `（note）` senses). */
  ambiguous: boolean;
}

/** The curated entries a learner pattern resolves to via its name or aliases, or null. */
export function matchOwnPattern(
  own: OwnPattern,
  index: ReadonlyMap<string, ReferencePattern[]>,
): PatternMatch | null {
  const entries: ReferencePattern[] = [];
  for (const name of [own.canonicalName, ...(own.aliases ?? [])]) {
    for (const variant of name.split(/\s*[/・]\s*/)) {
      const key = normalizePatternKey(variant);
      for (const entry of index.get(key) ?? []) if (!entries.includes(entry)) entries.push(entry);
    }
  }
  return entries.length > 0 ? { entries, ambiguous: entries.length > 1 } : null;
}

/**
 * Learner pattern id -> the one curated entry id it resolves to. Ambiguous matches (several curated senses) and
 * patterns without a curated id are left out: only high-confidence links may count as grammar the learner is missing.
 */
export function curatedGrammarByPattern(
  patterns: readonly OwnPattern[],
  index: ReadonlyMap<string, ReferencePattern[]>,
): Map<string, string> {
  const byPattern = new Map<string, string>();
  for (const own of patterns) {
    const match = matchOwnPattern(own, index);
    const id = match && !match.ambiguous ? match.entries[0]!.id : undefined;
    if (id) byPattern.set(own.id, id);
  }
  return byPattern;
}
