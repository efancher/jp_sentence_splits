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
import { DETECTION_GUARDS, SHORT_LITERAL_FORMS } from './grammarDetectionGuards';

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

const LITERAL = /^[぀-ヿ一-鿿]+$/;
/** Longest gap allowed between the two halves of a split pattern such as 〜やら〜やら. */
const SEGMENT_WINDOW = 20;
/** Shorter literals (〜は, 〜で, 〜し) match far too often to say anything about a sentence. */
const MIN_LITERAL_LENGTH = 3;

/** The fixed text of each alternative of a curated entry, e.g. 〜の中で〜が一番 -> [['の中で', 'が一番']]. */
export function detectableSegments(entry: ReferencePattern): string[][] {
  const alternatives: string[][] = [];
  for (const variant of entry.pattern.split(/\s*[/・]\s*/)) {
    const segments = variant
      .replace(/[（(][^）)]*[）)]/g, '')
      .split(/[〜～]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    const length = segments.reduce((sum, segment) => sum + segment.length, 0);
    if (segments.length > 0 && length >= MIN_LITERAL_LENGTH && segments.every((segment) => LITERAL.test(segment))) {
      alternatives.push(segments);
    }
  }
  // Short entries measured as precise enough (see SHORT_LITERAL_FORMS) are detected by their fixed text anyway.
  const shortForms = alternatives.length === 0 && entry.id ? SHORT_LITERAL_FORMS[entry.id] : undefined;
  if (shortForms) return shortForms.map((form) => [form]);
  return alternatives;
}

/**
 * Finds curated grammar in a sentence's text without any AI link: each entry's fixed text must appear (split
 * patterns in order, close together). Entries whose fixed text is shared by another entry (different senses of one
 * form) are skipped, and a match inside a longer entry's match (ところ inside たところで) is dropped. Optional
 * `words` (the sentence's content-word spans from morphology) stop a match starting partway through a word.
 */
export type TextSpan = { start: number; end: number };

/**
 * The content-word spans that a grammar match must not start inside. い-adjective tokens are left out: they carry their
 * own inflection (楽しかっ + た), so 〜かった legitimately starts partway through one, unlike 分かっ + た.
 */
export function wordSpansForDetection(
  tokens: readonly { start: number; end: number; pos: string; selectedByDefault: boolean }[],
): TextSpan[] {
  return tokens
    .filter((token) => token.selectedByDefault && !token.pos.startsWith('形容詞'))
    .map(({ start, end }) => ({ start, end }));
}

export function buildGrammarDetector(
  entries: readonly ReferencePattern[],
): (japanese: string, words?: readonly TextSpan[]) => string[] {
  const detectable = entries
    .filter((entry) => entry.id)
    .map((entry) => ({ id: entry.id!, alternatives: detectableSegments(entry) }))
    .filter((entry) => entry.alternatives.length > 0);
  const owners = new Map<string, string[]>();
  for (const { id, alternatives } of detectable) {
    for (const key of new Set(alternatives.map((segments) => segments.join('〜')))) {
      owners.set(key, [...(owners.get(key) ?? []), id]);
    }
  }
  // Shared text (different senses of one form) is only usable when every owner has a guard that rejects the other
  // senses' contexts; otherwise the form stays ambiguous and is skipped.
  const resolvable = (key: string) => {
    const ids = owners.get(key) ?? [];
    return ids.length === 1 || ids.every((id) => DETECTION_GUARDS[id]);
  };
  const usable = detectable
    .map((entry) => ({
      id: entry.id,
      alternatives: entry.alternatives.filter((segments) => resolvable(segments.join('〜'))),
    }))
    .filter((entry) => entry.alternatives.length > 0);

  /** Span of the segments found in order and close together, or null. */
  const locate = (
    id: string,
    japanese: string,
    segments: readonly string[],
    words: readonly TextSpan[],
  ): { start: number; end: number } | null => {
    const guard = DETECTION_GUARDS[id];
    // A match may not begin partway through a word (かった inside 分かった), nor be one the entry's guard rejects.
    for (let start = japanese.indexOf(segments[0]!); start >= 0; start = japanese.indexOf(segments[0]!, start + 1)) {
      if (words.some((word) => start > word.start && start < word.end)) continue;
      let end = start + segments[0]!.length;
      let complete = true;
      for (const segment of segments.slice(1)) {
        const at = japanese.indexOf(segment, end);
        if (at < 0 || at - end > SEGMENT_WINDOW) {
          complete = false;
          break;
        }
        end = at + segment.length;
      }
      if (!complete) return null;
      if (guard?.({ before: japanese.slice(0, start), matched: japanese.slice(start, end), after: japanese.slice(end) })) continue;
      return { start, end };
    }
    return null;
  };

  return (japanese, words = []) => {
    const spans: Array<{ id: string; start: number; end: number }> = [];
    for (const { id, alternatives } of usable) {
      for (const segments of alternatives) {
        let found = locate(id, japanese, segments, words);
        // A pattern ending in a る-verb (〜ことがある) still shows up conjugated (あります, あった).
        const last = segments[segments.length - 1]!;
        const stem = [...segments.slice(0, -1), last.slice(0, -1)];
        if (!found && last.endsWith('る') && stem.join('').length >= MIN_LITERAL_LENGTH) {
          found = locate(id, japanese, stem, words);
        }
        if (found) {
          spans.push({ id, ...found });
          break;
        }
      }
    }
    return spans
      .filter(
        (span) =>
          !spans.some(
            (other) =>
              other !== span &&
              other.start <= span.start &&
              other.end >= span.end &&
              other.end - other.start > span.end - span.start,
          ),
      )
      .map((span) => span.id);
  };
}
