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

/** The span of this target in this sentence: its validated occurrence when known, else the first literal match. */
export function locateTargetSpan(target: CompareTarget, sentence: CompareSentence): { start: number; end: number } | undefined {
  return excerpt(target, sentence).span;
}

const GAP = '＿＿＿';

/** The sentence with exactly the given occurrence replaced by a gap (not the first text match of a repeated word). */
export function maskSpan(japanese: string, span: { start: number; end: number }): string {
  return `${japanese.slice(0, span.start)}${GAP}${japanese.slice(span.end)}`;
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
  /** Self-reported got-it with the target masked and the answer not yet shown. Revealed-answer practice never counts. */
  independent: number;
  practised: number;
  gotIt: number;
  neededHelp: number;
  comparedSentenceIds: Set<string>;
}

export function summariseTargetActivity(events: SentenceLearningEvent[], targetKey: string): TargetActivitySummary {
  const summary: TargetActivitySummary = { independent: 0, practised: 0, gotIt: 0, neededHelp: 0, comparedSentenceIds: new Set() };
  for (const event of events) {
    if (event.target?.key !== targetKey) continue;
    if (event.action === 'target_practice') {
      summary.practised += 1;
      if (event.outcome === 'got_it') summary.gotIt += 1;
      if (event.outcome === 'got_it' && event.support === 'target_masked') summary.independent += 1;
      if (event.outcome === 'needed_help') summary.neededHelp += 1;
    } else if (event.action === 'compare_uses_viewed' && event.exposedSentenceId) {
      summary.comparedSentenceIds.add(event.exposedSentenceId);
    }
  }
  return summary;
}

export interface SentenceProgress {
  walkedThrough: boolean;
  targetsPractised: number;
  expressionAttempts: number;
  /** Latest whole-sentence gist self-judgement, if any. */
  gist?: 'got_it' | 'needed_help';
}

/** Derived, read-only view of lesson evidence for one sentence; never persisted or scheduled. */
export function summariseSentenceProgress(events: SentenceLearningEvent[], sentenceId: string): SentenceProgress {
  const progress: SentenceProgress = { walkedThrough: false, targetsPractised: 0, expressionAttempts: 0 };
  const keys = new Set<string>();
  let latestGist = '';
  for (const event of events) {
    if (event.sentenceId !== sentenceId) continue;
    if (event.action === 'walkthrough_completed') progress.walkedThrough = true;
    else if (event.action === 'target_practice' && event.target) keys.add(event.target.key);
    else if (event.action === 'expression_attempt') progress.expressionAttempts += 1;
    else if (event.action === 'gist_check' && event.outcome && event.timestamp >= latestGist) {
      latestGist = event.timestamp;
      progress.gist = event.outcome;
    }
  }
  progress.targetsPractised = keys.size;
  return progress;
}

export function describeSentenceProgress(progress: SentenceProgress): string {
  const parts: string[] = [];
  if (progress.walkedThrough) parts.push('walked through');
  if (progress.targetsPractised > 0) parts.push(`${progress.targetsPractised} ${progress.targetsPractised === 1 ? 'target' : 'targets'} practised`);
  if (progress.expressionAttempts > 0) parts.push(`said in Japanese ${progress.expressionAttempts}×`);
  if (progress.gist === 'got_it') parts.push('gist: had it');
  else if (progress.gist === 'needed_help') parts.push('gist: needed help');
  return parts.join(' · ');
}

export const SENTENCE_TARGET_LIMIT = 3;

/**
 * Which of a sentence's focus targets to offer first: ones never practised,
 * then ones the learner still needed help with, then ones they mostly had.
 * Episode priority order breaks ties. Nothing is dropped — the rest stay one
 * tap away — so this only orders and caps what a single sentence shows.
 */
export function selectSentenceTargets<T extends { id: string }>(
  targets: T[],
  events: SentenceLearningEvent[],
  limit = SENTENCE_TARGET_LIMIT,
): { shown: T[]; hidden: T[] } {
  const rank = (target: T) => {
    const activity = summariseTargetActivity(events, target.id);
    if (activity.practised === 0) return 0;
    return activity.neededHelp >= activity.gotIt ? 1 : 2;
  };
  const ordered = targets
    .map((target, index) => ({ target, index, rank: rank(target) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.target);
  return { shown: ordered.slice(0, limit), hidden: ordered.slice(limit) };
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
