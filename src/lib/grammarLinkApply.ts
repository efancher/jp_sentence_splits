import type { GrammarPattern } from '../domain/types';
import { locateGrammarSpan, type ParsedGrammarLink } from './grammarLinkReply';
import { normalizeGrammarPatternKey } from './grammarPatterns';

/** Quoted gloss the learner's names sometimes carry, e.g. "（状態描写）" or " (polite question)". */
function loosely(name: string): string {
  return normalizeGrammarPatternKey(name.replace(/[（(][^）)]*[）)]/g, ''));
}

/**
 * The learner's pattern the assistant meant by `name`: exact canonical key first, then another spelling the pattern
 * is known by (aliases keep the names of merged duplicates), then the same ignoring a trailing gloss. Null when it is
 * a pattern the learner does not have yet.
 */
export function resolveGrammarPattern(
  name: string,
  patterns: readonly Pick<GrammarPattern, 'id' | 'canonicalName' | 'normalizedKey' | 'aliases'>[],
): string | null {
  const key = normalizeGrammarPatternKey(name);
  if (!key) return null;
  const byCanonical = patterns.find((pattern) => pattern.normalizedKey === key);
  if (byCanonical) return byCanonical.id;
  const byAlias = patterns.find((pattern) => pattern.aliases.some((alias) => normalizeGrammarPatternKey(alias) === key));
  if (byAlias) return byAlias.id;
  const loose = loosely(name);
  if (!loose) return null;
  const byLoose = patterns.filter(
    (pattern) => loosely(pattern.canonicalName) === loose || pattern.aliases.some((alias) => loosely(alias) === loose),
  );
  return byLoose.length === 1 ? byLoose[0]!.id : null;
}

export interface PlannedGrammarLink {
  /** Resolved existing pattern, or null when `newPattern` should be created first. */
  patternId: string | null;
  newPattern: { name: string; template: string; meaning: string } | null;
  start: number;
  end: number;
  surfaceForm: string;
  note: string;
}

/**
 * Turns one sentence's parsed links into what to save. A span that is not in the sentence is dropped (reported in
 * `dropped`), and a pattern named twice in one sentence keeps only its first span (one link per sentence and pattern).
 */
export function planGrammarLinks(
  sentence: string,
  links: readonly ParsedGrammarLink[],
  patterns: readonly Pick<GrammarPattern, 'id' | 'canonicalName' | 'normalizedKey' | 'aliases'>[],
): { planned: PlannedGrammarLink[]; dropped: string[] } {
  const planned: PlannedGrammarLink[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const where = locateGrammarSpan(sentence, link.span);
    if (!where) {
      dropped.push(`${link.name}: "${link.span}" is not in the sentence`);
      continue;
    }
    const patternId = resolveGrammarPattern(link.name, patterns);
    const key = patternId ?? `new:${normalizeGrammarPatternKey(link.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    planned.push({
      patternId,
      newPattern: patternId ? null : { name: link.name, template: link.template, meaning: link.meaning },
      start: where.start,
      end: where.end,
      surfaceForm: where.surfaceForm,
      note: link.note,
    });
  }
  return { planned, dropped };
}
