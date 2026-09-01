import type { GrammarPattern, GrammarRelationshipType } from '../domain/types';
import { hashString } from './ids';
import { stripMarkup } from './normalize';

/** Human-readable labels for GrammarRelationshipType, for the detail page's "Related patterns" section. */
export const GRAMMAR_RELATIONSHIP_TYPE_LABELS: Record<GrammarRelationshipType, string> = {
  similar_meaning: 'Similar meaning',
  contrast: 'Contrasts with',
  commonly_confused: 'Commonly confused with',
  stronger_stance: 'Stronger stance than',
  weaker_stance: 'Weaker stance than',
  formal_variant: 'Formal variant of',
  structural_relative: 'Structurally related to',
};

export const GRAMMAR_RELATIONSHIP_TYPES: GrammarRelationshipType[] = [
  'similar_meaning',
  'contrast',
  'commonly_confused',
  'stronger_stance',
  'weaker_stance',
  'formal_variant',
  'structural_relative',
];

/**
 * Dedup key for GrammarPattern.canonicalName (see ensureGrammarPattern,
 * src/db/repository.ts). Strips leading/trailing tilde/wave-dash markers
 * (～/〜, both common in grammar-reference notation) and whitespace, then
 * NFC-normalizes, so "～わけがない", "〜わけがない", and "わけがない" all
 * resolve to the same canonical pattern.
 *
 * Deliberately *not* kanji/kana-variant-aware (e.g. 訳がない vs わけがない
 * still produce distinct keys) — that requires either a curated lookup or
 * AI-assisted merge-on-confirm, not exact-match dedup. A middle wave-dash is
 * preserved (e.g. "しか～ない"), since there it marks a real gap in the
 * pattern, not an attachment-point decoration.
 */
export function normalizeGrammarPatternKey(canonicalName: string): string {
  const text = stripMarkup(canonicalName).normalize('NFC');
  return text.replace(/^[~〜～\s]+|[~〜～\s]+$/g, '');
}

/**
 * Weak, informational check for the `grammar_production` review card
 * (docs/ROADMAP.md "Grammar production ladder"): did the learner's typed
 * sentence actually use the construction? Normalizes both sides the same
 * way `normalizeGrammarPatternKey` does, then requires every wave-dash-
 * separated fragment of the pattern to appear in the response (in any
 * position — surface order isn't checked, since a produced sentence
 * legitimately reorders around the pattern). Purely a "you used it / you
 * didn't" hint shown on reveal — the learner still self-rates meaning and
 * naturalness, which no substring check can judge. Returns false for an
 * empty/blank response or an un-normalizable pattern.
 */
export function grammarPatternUsedIn(response: string, canonicalName: string): boolean {
  const core = normalizeGrammarPatternKey(canonicalName);
  if (!core) return false;
  const normalizedResponse = stripMarkup(response).normalize('NFC').trim();
  if (!normalizedResponse) return false;
  const fragments = core.split(/[~〜～]/).map((part) => part.trim()).filter(Boolean);
  if (fragments.length === 0) return false;
  return fragments.every((fragment) => normalizedResponse.includes(fragment));
}

export interface SentenceBlank {
  before: string;
  match: string;
  after: string;
}

/**
 * Best-effort blank for a grammar_completion review card (design brief
 * §11E): finds the first occurrence of the pattern's (tilde-stripped)
 * canonicalName as a literal substring of the sentence. Returns null when
 * it doesn't appear verbatim — common for conjugated/colloquial variants
 * (e.g. the sentence has わけない but the canonical name is わけがない) —
 * callers should fall back to showing the full, unblanked sentence rather
 * than guessing at a span. True span-based blanking would need real
 * start/end offsets on SentenceGrammar, which nothing populates yet (see
 * docs/STATUS.md).
 */
export function blankPatternInSentence(
  japanese: string,
  canonicalName: string,
): SentenceBlank | null {
  const needle = normalizeGrammarPatternKey(canonicalName);
  if (!needle) return null;
  const index = japanese.indexOf(needle);
  if (index === -1) return null;
  return {
    before: japanese.slice(0, index),
    match: needle,
    after: japanese.slice(index + needle.length),
  };
}

export type GrammarLearnerState =
  | 'encountered'
  | 'noticed'
  | 'recognized'
  | 'distinguished'
  | 'productive';

/**
 * Derives the design brief's Encountered -> Noticed -> Recognized ->
 * Distinguished -> Productive ladder (§9) from accumulated evidence —
 * never a manually-set field. `contrastProficient` (grammar-learning
 * system Phase 9 slice) reflects FSRS proficiency on the pattern's own
 * `grammar_contrast` study item — "can you tell this apart from a pattern
 * you actually confuse it with," not just "recall the right one from a
 * pool" (grammar_completion tests the latter). Omitted/false simply means
 * no contrast evidence exists yet (e.g. the pattern has no
 * `GrammarRelationship` to contrast against), which is the common case and
 * caps a pattern at `recognized`. The top tier, Productive, is still
 * architecturally reachable (the type exists) but nothing produces its
 * evidence yet — that needs a production/transformation activity (design
 * brief §11 D/F/G), deliberately still deferred — see docs/STATUS.md.
 */
export function computeGrammarLearnerState(input: {
  encounterCount: number;
  confirmedCount: number;
  tracked: boolean;
  proficient: boolean;
  contrastProficient?: boolean;
}): GrammarLearnerState {
  if (input.tracked && input.proficient && input.contrastProficient) return 'distinguished';
  if (input.tracked && input.proficient) return 'recognized';
  if (input.confirmedCount > 0) return 'noticed';
  return 'encountered';
}

/** Human-readable labels for GrammarLearnerState, for badges on the list/detail pages. */
export const GRAMMAR_LEARNER_STATE_LABELS: Record<GrammarLearnerState, string> = {
  encountered: 'Encountered',
  noticed: 'Noticed',
  recognized: 'Recognized',
  distinguished: 'Distinguished',
  productive: 'Productive',
};

export type GrammarPriorityBucket =
  | 'worth_learning_now'
  | 'developing'
  | 'strong'
  | 'recently_encountered';

export const GRAMMAR_PRIORITY_BUCKET_LABELS: Record<GrammarPriorityBucket, string> = {
  worth_learning_now: 'Worth learning now',
  developing: 'Developing',
  strong: 'Strong',
  recently_encountered: 'Recently encountered',
};

/** Display order for the /grammar dashboard sections — most actionable first. */
export const GRAMMAR_PRIORITY_BUCKET_ORDER: GrammarPriorityBucket[] = [
  'worth_learning_now',
  'developing',
  'recently_encountered',
  'strong',
];

export interface GrammarPriorityInput {
  encounterCount: number;
  tracked: boolean;
  state: GrammarLearnerState;
  /** Among the tracked pattern's most recent grammar_comprehension reviews. */
  recentAgainCount: number;
  recentReviewCount: number;
}

/**
 * A simple, explainable heuristic (design brief §14 explicitly prefers this
 * over opaque scoring) grouping a pattern for the /grammar dashboard — four
 * buckets, each derivable at a glance from the same fields
 * explainGrammarPriority renders as prose, not a numeric score nobody can
 * audit.
 */
export function computeGrammarPriorityBucket(
  input: GrammarPriorityInput,
): GrammarPriorityBucket {
  const recognizedOrBetter = input.state === 'recognized' || input.state === 'distinguished';
  if (recognizedOrBetter && input.recentAgainCount === 0) return 'strong';
  if (input.tracked) return 'developing';
  if (input.encounterCount >= 3) return 'worth_learning_now';
  return 'recently_encountered';
}

/** Explainable one-liner behind a bucket assignment — design brief §14's own worked example. */
export function explainGrammarPriority(
  input: GrammarPriorityInput & { distinctSourceCount: number },
): string {
  const parts = [`Encountered ${input.encounterCount} time${input.encounterCount === 1 ? '' : 's'}`];
  if (input.distinctSourceCount > 1) {
    parts.push(`across ${input.distinctSourceCount} sources`);
  }
  if (input.tracked && input.recentReviewCount > 0) {
    parts.push(
      `needed help on ${input.recentAgainCount} of the last ${input.recentReviewCount} review${
        input.recentReviewCount === 1 ? '' : 's'
      }`,
    );
  } else if (!input.tracked) {
    parts.push('not tracked yet');
  }
  return `${parts.join(', ')}.`;
}

/** Default number of options on a grammar_completion multiple-choice card, including the correct one. */
export const GRAMMAR_COMPLETION_CHOICE_COUNT = 4;

/**
 * Multiple-choice options for a grammar_completion card: the correct
 * pattern plus up to `count - 1` distractors drawn from `otherPatterns`
 * (design brief §7/§8 — "distractors from confusable pairs when
 * available" is a natural future extension here once GrammarRelationship
 * data exists; for now this draws from the whole corpus). Both the
 * distractor pick and the final option order are deterministic, seeded
 * from the pattern's own id (same hash-based approach as
 * ReviewPage.tsx's pickTransformationTarget) — the same pattern always
 * gets the same choices in the same order across reloads/re-renders,
 * rather than reshuffling on every render.
 *
 * `relatedPatternIds` (design brief §7/§8, grammar-learning system Phase
 * 8) — patterns explicitly linked to the correct one via
 * `GrammarRelationship` are ranked ahead of the rest of the corpus: a
 * distractor the learner has actually flagged as confusable (via the
 * detail page's "Related patterns" control) is a more useful contrast
 * than a random unrelated one. Falls back to the whole-corpus hash order
 * when no relationships exist yet, same as before this parameter existed.
 */
export function buildGrammarCompletionChoices(
  pattern: GrammarPattern,
  otherPatterns: readonly GrammarPattern[],
  count = GRAMMAR_COMPLETION_CHOICE_COUNT,
  relatedPatternIds: ReadonlySet<string> = new Set(),
): GrammarPattern[] {
  const ranked = [...otherPatterns].sort((a, b) => {
    const relatedA = relatedPatternIds.has(a.id) ? 0 : 1;
    const relatedB = relatedPatternIds.has(b.id) ? 0 : 1;
    if (relatedA !== relatedB) return relatedA - relatedB;
    const ha = Number.parseInt(hashString(`${pattern.id}:pick:${a.id}`), 16);
    const hb = Number.parseInt(hashString(`${pattern.id}:pick:${b.id}`), 16);
    return ha - hb;
  });
  const distractors = ranked.slice(0, Math.max(0, count - 1));
  const choices = [pattern, ...distractors];
  return choices.sort((a, b) => {
    const ha = Number.parseInt(hashString(`${pattern.id}:order:${a.id}`), 16);
    const hb = Number.parseInt(hashString(`${pattern.id}:order:${b.id}`), 16);
    return ha - hb;
  });
}
