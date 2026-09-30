/**
 * Pure helpers for in-passage lesson activities (sentence-first plan, Phase 2):
 * picking a real second occurrence for "Compare uses" and summarising what has
 * already been practised or shown. Nothing here touches FSRS.
 */
import type { SentenceLearningEvent } from '../domain/types';

export interface CompareOccurrence {
  sentenceId: string;
  start: number;
  end: number;
}

export interface CompareTarget {
  key: string;
  label: string;
  sentenceIds: string[];
  occurrences?: CompareOccurrence[];
}

export interface CompareSentence {
  id: string;
  japanese: string;
  /** 1-based position in the episode, for a caption. */
  position: number;
}

export interface CompareExcerpt {
  sentenceId: string;
  position: number;
  japanese: string;
  /** Character span to highlight; absent when the target cannot be located reliably. */
  span?: { start: number; end: number };
}

function excerpt(target: CompareTarget, sentence: CompareSentence): CompareExcerpt {
  const known = target.occurrences?.find((occurrence) => occurrence.sentenceId === sentence.id);
  if (known && known.end <= sentence.japanese.length && known.start < known.end) {
    return { sentenceId: sentence.id, position: sentence.position, japanese: sentence.japanese, span: { start: known.start, end: known.end } };
  }
  const at = target.label ? sentence.japanese.indexOf(target.label) : -1;
  return {
    sentenceId: sentence.id,
    position: sentence.position,
    japanese: sentence.japanese,
    span: at >= 0 ? { start: at, end: at + target.label.length } : undefined,
  };
}

/**
 * The current sentence next to another real occurrence of the same target.
 * Prefers an example the learner has not been shown yet, then the nearest one
 * in the episode. `undefined` when there is no second real occurrence.
 */
export function pickCompareUses(
  target: CompareTarget,
  sentences: CompareSentence[],
  currentSentenceId: string,
  exposedSentenceIds: ReadonlySet<string>,
): { current: CompareExcerpt; other: CompareExcerpt; remainingUnseen: number } | undefined {
  const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const current = byId.get(currentSentenceId);
  if (!current) return undefined;
  const others = [...new Set(target.sentenceIds)]
    .filter((id) => id !== currentSentenceId && byId.has(id))
    .map((id) => byId.get(id)!)
    .sort((a, b) => Math.abs(a.position - current.position) - Math.abs(b.position - current.position));
  if (others.length === 0) return undefined;
  const unseen = others.filter((sentence) => !exposedSentenceIds.has(sentence.id));
  const chosen = unseen[0] ?? others[0]!;
  return {
    current: excerpt(target, current),
    other: excerpt(target, chosen),
    remainingUnseen: Math.max(0, unseen.length - (unseen[0] ? 1 : 0)),
  };
}

export interface TargetActivitySummary {
  practised: number;
  gotIt: number;
  neededHelp: number;
  comparedSentenceIds: Set<string>;
}

export function summariseTargetActivity(events: SentenceLearningEvent[], targetKey: string): TargetActivitySummary {
  const summary: TargetActivitySummary = { practised: 0, gotIt: 0, neededHelp: 0, comparedSentenceIds: new Set() };
  for (const event of events) {
    if (event.target?.key !== targetKey) continue;
    if (event.action === 'target_practice') {
      summary.practised += 1;
      if (event.outcome === 'got_it') summary.gotIt += 1;
      if (event.outcome === 'needed_help') summary.neededHelp += 1;
    } else if (event.action === 'compare_uses_viewed' && event.exposedSentenceId) {
      summary.comparedSentenceIds.add(event.exposedSentenceId);
    }
  }
  return summary;
}

/** Short gloss from a saved vocabulary meaning: first sense only, capped. */
function shortMeaning(meaning: string): string {
  const first = meaning.split(/[;\n]/)[0]!.trim();
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

/**
 * Content words with a gloss, deduplicated — the help shown beside a sentence.
 * A suggestion with no English of its own falls back to the meaning of a saved
 * vocabulary item with the same expression, when there is one.
 */
export function glossableWords(
  suggestions: { expression: string; reading: string; english?: string; selectedByDefault: boolean }[],
  savedMeanings: ReadonlyMap<string, string> = new Map(),
): { expression: string; reading: string; english: string }[] {
  const seen = new Set<string>();
  const words: { expression: string; reading: string; english: string }[] = [];
  for (const suggestion of suggestions) {
    if (!suggestion.selectedByDefault || seen.has(suggestion.expression)) continue;
    const saved = savedMeanings.get(suggestion.expression);
    const english = suggestion.english?.trim() || (saved ? shortMeaning(saved) : '');
    if (!english) continue;
    seen.add(suggestion.expression);
    words.push({ expression: suggestion.expression, reading: suggestion.reading, english });
  }
  return words;
}

export interface SentenceWordHelp {
  /** Content words in the sentence (glossed or not). */
  total: number;
  /** Glossed words the learner does not yet know, shown by default. */
  newWords: { expression: string; reading: string; english: string }[];
  /** Every glossed word, known or not, for "show all". */
  allWords: { expression: string; reading: string; english: string }[];
  /** Unknown content words, including ones with no gloss available. */
  unknownCount: number;
}

/**
 * How much word help a sentence should show by default: only words the learner
 * has not shown they can recall. A word counts as known when its expression is
 * in `knownExpressions` (reading-proficient saved vocabulary).
 */
export function sentenceWordHelp(
  suggestions: { expression: string; reading: string; english?: string; selectedByDefault: boolean }[],
  knownExpressions: ReadonlySet<string>,
  savedMeanings: ReadonlyMap<string, string> = new Map(),
): SentenceWordHelp {
  const content = new Set(suggestions.filter((item) => item.selectedByDefault).map((item) => item.expression));
  const allWords = glossableWords(suggestions, savedMeanings);
  return {
    total: content.size,
    allWords,
    newWords: allWords.filter((word) => !knownExpressions.has(word.expression)),
    unknownCount: [...content].filter((expression) => !knownExpressions.has(expression)).length,
  };
}
