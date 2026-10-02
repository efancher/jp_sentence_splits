/**
 * Pure helpers for in-passage lesson activities (sentence-first plan, Phase 2):
 * picking a real second occurrence for "Compare uses" and summarising what has
 * already been practised or shown. Nothing here touches FSRS.
 */
import type { SentenceLearningEvent } from '../domain/types';
import { findSetExpressions, SET_EXPRESSIONS } from './setExpressions';
import { isGlossOnlySuggestion } from './vocabularySuggestions';

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
  /** Own-sentence transfer attempts for this target, and those the learner judged as using it for a new meaning. Never mixed into `practised`/`independent`. */
  transferAttempts: number;
  transferSucceeded: number;
  recheckAttempts: number;
  recheckSucceeded: number;
  heldBackChecks: number;
  heldBackGotIt: number;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
};

/** The most recent own-sentence attempt for a target that is at least a calendar day old and not yet re-checked. */
export function findDueTransferRecheck(
  events: SentenceLearningEvent[],
  targetKey: string,
  now: Date,
): { answer: string; daysAgo: number } | undefined {
  const own = events
    .filter((event) => event.target?.key === targetKey && (event.action === 'transfer_attempt' || event.action === 'transfer_recheck') && event.timestamp)
    .sort((a, b) => (a.timestamp! < b.timestamp! ? 1 : -1));
  const latest = own[0];
  if (!latest || latest.action !== 'transfer_attempt' || !latest.learnerAnswer) return undefined;
  const daysAgo = localDay(now.toISOString()) - localDay(latest.timestamp!);
  return daysAgo >= 1 ? { answer: latest.learnerAnswer, daysAgo } : undefined;
}

export function summariseTargetActivity(events: SentenceLearningEvent[], targetKey: string): TargetActivitySummary {
  const summary: TargetActivitySummary = { independent: 0, practised: 0, gotIt: 0, neededHelp: 0, comparedSentenceIds: new Set(), transferAttempts: 0, transferSucceeded: 0, recheckAttempts: 0, recheckSucceeded: 0, heldBackChecks: 0, heldBackGotIt: 0 };
  for (const event of events) {
    if (event.target?.key !== targetKey) continue;
    if (event.action === 'target_practice') {
      summary.practised += 1;
      if (event.outcome === 'got_it') summary.gotIt += 1;
      if (event.outcome === 'got_it' && event.support === 'target_masked') summary.independent += 1;
      if (event.outcome === 'needed_help') summary.neededHelp += 1;
    } else if (event.action === 'transfer_attempt') {
      summary.transferAttempts += 1;
      if (event.outcome === 'got_it') summary.transferSucceeded += 1;
    } else if (event.action === 'held_back_check') {
      summary.heldBackChecks += 1;
      if (event.outcome === 'got_it') summary.heldBackGotIt += 1;
    } else if (event.action === 'transfer_recheck') {
      summary.recheckAttempts += 1;
      if (event.outcome === 'got_it') summary.recheckSucceeded += 1;
    } else if (event.action === 'compare_uses_viewed' && event.exposedSentenceId) {
      summary.comparedSentenceIds.add(event.exposedSentenceId);
    }
  }
  return summary;
}

/**
 * A real occurrence of the target the learner has not met in this target's lesson: not the lesson
 * sentence, not one shown in Compare uses / as a transfer model / previously held-back, and not a
 * sentence where they already practised it. Needs a reliably located span, so the mask is exact.
 */
export function pickHeldBackContext(
  target: CompareTarget,
  sentences: CompareSentence[],
  currentSentenceId: string,
  events: SentenceLearningEvent[],
): CompareExcerpt | undefined {
  const met = new Set<string>([currentSentenceId]);
  for (const event of events) {
    if (event.target?.key !== target.key) continue;
    met.add(event.sentenceId);
    if (event.exposedSentenceId) met.add(event.exposedSentenceId);
  }
  const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const current = byId.get(currentSentenceId);
  if (!current) return undefined;
  return [...new Set(target.sentenceIds)]
    .filter((id) => !met.has(id) && byId.has(id))
    .map((id) => excerpt(target, byId.get(id)!))
    .filter((item) => item.span)
    .sort((a, b) => Math.abs(a.position - current.position) - Math.abs(b.position - current.position))[0];
}

export interface SentenceProgress {
  walkedThrough: boolean;
  targetsPractised: number;
  /** Kept separate: one modality never certifies the other. */
  writtenAttempts: number;
  spokenAttempts: number;
  /** Latest whole-sentence gist self-judgement, if any. */
  gist?: 'got_it' | 'needed_help';
}

/** Derived, read-only view of lesson evidence for one sentence; never persisted or scheduled. */
export function summariseSentenceProgress(events: SentenceLearningEvent[], sentenceId: string): SentenceProgress {
  const progress: SentenceProgress = { walkedThrough: false, targetsPractised: 0, writtenAttempts: 0, spokenAttempts: 0 };
  const keys = new Set<string>();
  let latestGist = '';
  for (const event of events) {
    if (event.sentenceId !== sentenceId) continue;
    if (event.action === 'walkthrough_completed') progress.walkedThrough = true;
    else if (event.action === 'target_practice' && event.target) keys.add(event.target.key);
    else if (event.action === 'expression_attempt') {
      if (event.modality === 'spoken') progress.spokenAttempts += 1;
      else progress.writtenAttempts += 1;
    }
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
  if (progress.writtenAttempts > 0) parts.push(`written ${progress.writtenAttempts}×`);
  if (progress.spokenAttempts > 0) parts.push(`spoken ${progress.spokenAttempts}×`);
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
type GlossSuggestion = {
  expression: string;
  reading: string;
  english?: string;
  selectedByDefault: boolean;
  surface?: string;
  start?: number;
  end?: number;
  pos?: string;
  source?: string;
};
type GlossWord = { expression: string; reading: string; english: string; glossOnly?: boolean };

/** Pronouns, function adverbs and kana formal nouns: glossed while help is high, never study items. */
function isGlossOnly(suggestion: GlossSuggestion): boolean {
  const { surface, pos, source } = suggestion;
  if (surface === undefined || pos === undefined || source !== 'morphology') return false;
  return isGlossOnlySuggestion({ ...suggestion, surface, pos, source });
}

export function glossableWords(
  suggestions: GlossSuggestion[],
  savedMeanings: ReadonlyMap<string, string> = new Map(),
): GlossWord[] {
  const seen = new Set<string>();
  const words: GlossWord[] = [];
  const phraseAt = new Map(findSetExpressions(suggestions).map((match) => [match.first, match]));
  let skipUntil = -1;
  for (const [index, suggestion] of suggestions.entries()) {
    const phrase = phraseAt.get(index);
    if (phrase) {
      skipUntil = phrase.last;
      if (!seen.has(phrase.key)) {
        seen.add(phrase.key);
        words.push({ expression: phrase.key, ...SET_EXPRESSIONS.get(phrase.key)!, glossOnly: true });
      }
    }
    if (index <= skipUntil) continue;
    const glossOnly = isGlossOnly(suggestion);
    if ((!suggestion.selectedByDefault && !glossOnly) || seen.has(suggestion.expression)) continue;
    const saved = savedMeanings.get(suggestion.expression);
    const english = suggestion.english?.trim() || (saved ? shortMeaning(saved) : '');
    if (!english) continue;
    seen.add(suggestion.expression);
    words.push({ expression: suggestion.expression, reading: suggestion.reading, english, ...(glossOnly ? { glossOnly } : {}) });
  }
  return words;
}

export interface SentenceWordHelp {
  /** Content words in the sentence (glossed or not). */
  total: number;
  /** Glossed words the learner does not yet know, shown by default. */
  newWords: GlossWord[];
  /** Every glossed word, known or not, for "show all". */
  allWords: GlossWord[];
  /** Unknown content words, including ones with no gloss available. */
  unknownCount: number;
}

/**
 * How much word help a sentence should show by default: only words the learner
 * has not shown they can recall. A word counts as known when its expression is
 * in `knownExpressions` (reading-proficient saved vocabulary).
 */
export function sentenceWordHelp(
  suggestions: GlossSuggestion[],
  knownExpressions: ReadonlySet<string>,
  savedMeanings: ReadonlyMap<string, string> = new Map(),
): SentenceWordHelp {
  const content = new Set(suggestions.filter((item) => item.selectedByDefault).map((item) => item.expression));
  const allWords = glossableWords(suggestions, savedMeanings);
  const unknownCount = [...content].filter((expression) => !knownExpressions.has(expression)).length;
  // Gloss-only words (pronouns etc.) fade out of the default list once most of the sentence is known.
  const highHelp = unknownCount * 2 > content.size;
  return {
    total: content.size,
    allWords,
    newWords: allWords.filter((word) => !knownExpressions.has(word.expression) && (!word.glossOnly || highHelp)),
    unknownCount,
  };
}
