/**
 * Whole-episode teaching priorities (sentence-first plan, Phase 0). A pure,
 * deterministic first pass over links that already exist: it groups
 * occurrences across an episode's sentences and proposes a small focus set
 * with human-readable reasons. It is a draft, not a verdict — no persistence,
 * no scheduling effect, and reading never waits on it. An AI preparation pass
 * can later replace/refine the same output shape.
 */

export interface FocusVocabularyLink {
  sentenceId: string;
  vocabularyItemId: string;
  surfaceForm?: string;
}

export interface FocusVocabularyItem {
  id: string;
  expression: string;
  reading: string;
  meaning: string;
  partOfSpeech?: string;
}

export interface FocusGrammarLink {
  sentenceId: string;
  grammarPatternId: string;
  surfaceForm?: string;
}

export interface FocusGrammarPattern {
  id: string;
  canonicalName: string;
  shortMeaning: string;
}

export interface EpisodeFocusInput {
  /** Sentence ids in episode order. */
  sentenceIds: string[];
  vocabularyLinks: FocusVocabularyLink[];
  vocabularyItems: FocusVocabularyItem[];
  grammarLinks: FocusGrammarLink[];
  grammarPatterns: FocusGrammarPattern[];
  /** Vocabulary the learner already retains well; not proposed again. */
  knownVocabularyItemIds?: ReadonlySet<string>;
  /** Grammar patterns the learner already retains well. */
  knownGrammarPatternIds?: ReadonlySet<string>;
  maxFocus?: number;
}

export interface EpisodeFocusTarget {
  kind: 'vocabulary' | 'grammar';
  id: string;
  label: string;
  detail: string;
  sentenceIds: string[];
  reasons: string[];
}

export interface EpisodeGlossOnlyTarget {
  id: string;
  label: string;
  sentenceIds: string[];
  reason: string;
}

export interface EpisodeFocus {
  sentenceCount: number;
  focus: EpisodeFocusTarget[];
  glossOnly: EpisodeGlossOnlyTarget[];
}

export const DEFAULT_MAX_FOCUS = 6;

const DISCOURSE_POS_PREFIXES = ['感動詞', '接続詞', 'フィラー'];
const KANA_ONLY = /^[぀-ゟ゠-ヿーー]+$/;

/**
 * A short kana-only interjection/connective (ええと, さあ, でも) has no unique
 * completion from context, so it is a poor recall target. It stays available
 * as a gloss; the learner can still study it deliberately.
 */
export function isUnderdeterminedDiscourse(item: FocusVocabularyItem): boolean {
  const pos = item.partOfSpeech?.trim() ?? '';
  if (!DISCOURSE_POS_PREFIXES.some((prefix) => pos.startsWith(prefix))) return false;
  return KANA_ONLY.test(item.expression) && item.expression.length <= 4;
}

function distinctInOrder(ids: string[], order: Map<string, number>): string[] {
  return [...new Set(ids)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

export function buildEpisodeFocus(input: EpisodeFocusInput): EpisodeFocus {
  const order = new Map(input.sentenceIds.map((id, index) => [id, index]));
  const inEpisode = (sentenceId: string) => order.has(sentenceId);
  const maxFocus = input.maxFocus ?? DEFAULT_MAX_FOCUS;
  const known = input.knownVocabularyItemIds ?? new Set<string>();
  const knownGrammar = input.knownGrammarPatternIds ?? new Set<string>();

  const vocabularyById = new Map(input.vocabularyItems.map((item) => [item.id, item]));
  const vocabularyOccurrences = new Map<string, FocusVocabularyLink[]>();
  for (const link of input.vocabularyLinks) {
    if (!inEpisode(link.sentenceId) || !vocabularyById.has(link.vocabularyItemId)) continue;
    const list = vocabularyOccurrences.get(link.vocabularyItemId) ?? [];
    list.push(link);
    vocabularyOccurrences.set(link.vocabularyItemId, list);
  }

  const candidates: Array<EpisodeFocusTarget & { score: number; first: number }> = [];
  const glossOnly: EpisodeGlossOnlyTarget[] = [];

  for (const [id, links] of vocabularyOccurrences) {
    const item = vocabularyById.get(id)!;
    const sentenceIds = distinctInOrder(links.map((link) => link.sentenceId), order);
    if (sentenceIds.length < 2 || known.has(id)) continue;
    if (isUnderdeterminedDiscourse(item)) {
      glossOnly.push({
        id,
        label: item.expression,
        sentenceIds,
        reason: 'Short discourse expression: several wordings fit, so it stays a gloss rather than a recall question.',
      });
      continue;
    }
    const forms = new Set(links.map((link) => link.surfaceForm).filter(Boolean));
    const reasons = [`Appears in ${sentenceIds.length} sentences of this episode`];
    if (forms.size > 1) reasons.push(`Seen in ${forms.size} different forms`);
    candidates.push({
      kind: 'vocabulary',
      id,
      label: item.expression,
      detail: [item.reading !== item.expression ? item.reading : '', item.meaning].filter(Boolean).join(' · '),
      sentenceIds,
      reasons,
      score: sentenceIds.length + 0.5 * Math.max(0, forms.size - 1),
      first: order.get(sentenceIds[0]!) ?? 0,
    });
  }

  const patternById = new Map(input.grammarPatterns.map((pattern) => [pattern.id, pattern]));
  const grammarOccurrences = new Map<string, FocusGrammarLink[]>();
  for (const link of input.grammarLinks) {
    if (!inEpisode(link.sentenceId) || !patternById.has(link.grammarPatternId)) continue;
    const list = grammarOccurrences.get(link.grammarPatternId) ?? [];
    list.push(link);
    grammarOccurrences.set(link.grammarPatternId, list);
  }
  for (const [id, links] of grammarOccurrences) {
    const pattern = patternById.get(id)!;
    const sentenceIds = distinctInOrder(links.map((link) => link.sentenceId), order);
    if (sentenceIds.length < 2 || knownGrammar.has(id)) continue;
    const forms = new Set(links.map((link) => link.surfaceForm).filter(Boolean));
    const reasons = [`Construction recurs in ${sentenceIds.length} sentences`];
    if (forms.size > 1) reasons.push(`Seen in ${forms.size} different forms`);
    candidates.push({
      kind: 'grammar',
      id,
      label: pattern.canonicalName,
      detail: pattern.shortMeaning,
      sentenceIds,
      reasons,
      // Structure decides how a passage is read, so it outranks an equally frequent word.
      score: sentenceIds.length + 1 + 0.5 * Math.max(0, forms.size - 1),
      first: order.get(sentenceIds[0]!) ?? 0,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.first - b.first || a.id.localeCompare(b.id));
  return {
    sentenceCount: input.sentenceIds.length,
    focus: candidates.slice(0, maxFocus).map(({ score: _score, first: _first, ...target }) => target),
    glossOnly: glossOnly.sort((a, b) => b.sentenceIds.length - a.sentenceIds.length),
  };
}
