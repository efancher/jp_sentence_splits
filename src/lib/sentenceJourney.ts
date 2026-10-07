/**
 * Staged sentence progress (sentence-first plan, Phase 3): a derived, read-only
 * view of lesson evidence. Stages 1-4 are understanding; 5-6 need the learner's own
 * Japanese attempts, so reading alone can never reach 100%. Nothing here is stored or scheduled.
 */
import type { SentenceLearningEvent } from '../domain/types';

export interface JourneyVocabularyTarget {
  expression: string;
  surface?: string;
}

export interface JourneyStructureTarget {
  key: string;
  label: string;
}

export interface JourneyInput {
  sentenceId: string;
  events: SentenceLearningEvent[];
  /** Content words of the sentence. */
  vocabulary: JourneyVocabularyTarget[];
  /** Expressions the learner already retains from earlier reviews (older evidence, support unknown). */
  knownExpressions: ReadonlySet<string>;
  /** Structure/expression focus targets prepared for this sentence. */
  structure: JourneyStructureTarget[];
}

export interface CoverageCount {
  done: number;
  total: number;
}

export interface SentenceJourney {
  stages: { id: string; label: string; fraction: number | null; note: string }[];
  vocabulary: { supported: CoverageCount; independent: CoverageCount };
  structure: { supported: CoverageCount; independent: CoverageCount };
  /** True while structure targets are unidentified or nothing is applicable: never counted as complete. */
  provisional: boolean;
  /** 0-100, or undefined when there is no lesson evidence at all. */
  percent?: number;
  gist: { checkedAfterGap: number; hasAny: boolean };
}

function day(timestamp: string): string {
  return new Date(timestamp).toDateString();
}

function mean(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

const ratio = (count: CoverageCount): number | null => (count.total > 0 ? count.done / count.total : null);

export function buildSentenceJourney(input: JourneyInput): SentenceJourney {
  const mine = input.events.filter((event) => event.sentenceId === input.sentenceId);
  const practice = mine.filter((event) => event.action === 'target_practice' && event.outcome === 'got_it' && event.target);
  const supportedLabels = new Set(practice.map((event) => event.target!.label));
  const independentLabels = new Set(practice.filter((event) => event.support === 'target_masked').map((event) => event.target!.label));
  const supportedKeys = new Set(practice.map((event) => event.target!.key));
  const independentKeys = new Set(practice.filter((event) => event.support === 'target_masked').map((event) => event.target!.key));

  const vocab = [...new Map(input.vocabulary.map((word) => [word.expression, word])).values()];
  const hasLabel = (labels: Set<string>, word: JourneyVocabularyTarget) =>
    labels.has(word.expression) || (word.surface !== undefined && labels.has(word.surface));
  const vocabulary = {
    supported: { done: vocab.filter((w) => input.knownExpressions.has(w.expression) || hasLabel(supportedLabels, w)).length, total: vocab.length },
    independent: { done: vocab.filter((w) => input.knownExpressions.has(w.expression) || hasLabel(independentLabels, w)).length, total: vocab.length },
  };
  const structure = {
    supported: { done: input.structure.filter((t) => supportedKeys.has(t.key)).length, total: input.structure.length },
    independent: { done: input.structure.filter((t) => independentKeys.has(t.key)).length, total: input.structure.length },
  };

  const walkedDays = mine.filter((event) => event.action === 'walkthrough_completed').map((event) => day(event.timestamp)).sort();
  const firstExposureDay = walkedDays[0];
  const firstExposureTime = mine.filter((event) => event.action === 'walkthrough_completed').map((event) => event.timestamp).sort()[0];
  const gistGotIt = mine.filter((event) => event.action === 'gist_check' && event.outcome === 'got_it');
  const afterGapDays = new Set(
    gistGotIt
      .filter((event) => firstExposureTime !== undefined && day(event.timestamp) !== firstExposureDay && event.timestamp > firstExposureTime)
      .map((event) => day(event.timestamp)),
  );

  const s1 = walkedDays.length > 0 ? 1 : 0;
  const s2 = mean([ratio(vocabulary.supported), ratio(structure.supported)]);
  const independentCoverage = mean([ratio(vocabulary.independent), ratio(structure.independent)]);
  const s3 = independentCoverage === null ? null : (independentCoverage + (afterGapDays.size >= 1 ? 1 : 0)) / 2;
  const s4 = afterGapDays.size >= 2 ? 1 : 0;

  const attempts = mine.filter((event) => event.action === 'expression_attempt' && event.unitsTotal);
  const s5 = attempts.reduce((best, event) => Math.max(best, (event.unitsExpressed ?? 0) / event.unitsTotal!), 0);
  // Independent: no cue shown, every unit carried, and on a later day than the first walkthrough (not an immediate copy of the just-seen line).
  const independentAttempt = attempts.some(
    (event) =>
      event.outcome === 'got_it' &&
      (event.scaffold ?? 'none') === 'none' &&
      firstExposureTime !== undefined &&
      event.timestamp > firstExposureTime &&
      day(event.timestamp) !== firstExposureDay,
  );
  const s6 = independentAttempt ? 1 : 0;

  const provisional = structure.supported.total === 0 || vocabulary.supported.total === 0;
  const stages: SentenceJourney['stages'] = [
    { id: 'guided', label: 'Guided understanding', fraction: s1, note: s1 ? 'Walkthrough finished' : 'Walk through the sentence' },
    { id: 'supported', label: 'Supported recognition', fraction: s2, note: s2 === null ? 'Not assessed: no targets identified' : 'Targets recognised with some support' },
    { id: 'independent', label: 'Independent comprehension', fraction: s3, note: s3 === null ? 'Not assessed: no targets identified' : 'Targets with the word hidden, plus a gist check on a later day' },
    { id: 'retained', label: 'Revisit and retain', fraction: s4, note: 'A second successful gist check on another day' },
    { id: 'supported_expression', label: 'Supported expression', fraction: s5, note: attempts.length ? 'Best attempt: meaning parts you carried, frame or not' : 'Not tried yet' },
    { id: 'independent_expression', label: 'Independent expression', fraction: s6, note: 'No cues, every part carried, on a later day than the first walkthrough' },
  ];

  const hasEvidence = mine.length > 0 || vocabulary.supported.done > 0;
  const percent = hasEvidence
    ? Math.round((100 * stages.reduce((sum, stage) => sum + (stage.fraction ?? 0), 0)) / stages.length)
    : undefined;

  return { stages, vocabulary, structure, provisional, percent, gist: { checkedAfterGap: afterGapDays.size, hasAny: gistGotIt.length > 0 } };
}

/**
 * Sentences walked through on an earlier day with no independent (cue-free,
 * complete) expression attempt yet. A suggestion, not a schedule: nothing is
 * stored, and it never competes with the review queue.
 */
export function sentencesReadyToRevisit(events: SentenceLearningEvent[], now: Date = new Date()): string[] {
  const today = now.toDateString();
  const firstWalk = new Map<string, string>();
  const independent = new Set<string>();
  for (const event of events) {
    if (event.action === 'walkthrough_completed') {
      const seen = firstWalk.get(event.sentenceId);
      if (seen === undefined || event.timestamp < seen) firstWalk.set(event.sentenceId, event.timestamp);
    } else if (event.action === 'expression_attempt' && event.outcome === 'got_it' && (event.scaffold ?? 'none') === 'none') {
      independent.add(event.sentenceId);
    }
  }
  return [...firstWalk.entries()]
    .filter(([id, at]) => !independent.has(id) && day(at) !== today)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id]) => id);
}

/** Calendar days to wait before re-offering a sentence, by how many separate days it has already had a fresh try. */
export const FRESH_TRY_GAP_DAYS = [1, 3, 7, 14, 30];

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * `sentencesReadyToRevisit` narrowed to sentences whose spacing has elapsed: the
 * wait grows with each day you've already attempted saying it (1, 3, 7, 14, 30
 * days), measured from the last attempt (or the first walkthrough if none).
 * Used for planning only; the Reader's list still shows every candidate.
 */
export function sentencesDueForFreshTry(events: SentenceLearningEvent[], now: Date = new Date()): string[] {
  const attemptDays = new Map<string, Set<string>>();
  const lastAttempt = new Map<string, string>();
  const firstWalk = new Map<string, string>();
  for (const event of events) {
    if (event.action === 'expression_attempt') {
      const days = attemptDays.get(event.sentenceId) ?? new Set<string>();
      days.add(day(event.timestamp));
      attemptDays.set(event.sentenceId, days);
      const last = lastAttempt.get(event.sentenceId);
      if (last === undefined || event.timestamp > last) lastAttempt.set(event.sentenceId, event.timestamp);
    } else if (event.action === 'walkthrough_completed') {
      const seen = firstWalk.get(event.sentenceId);
      if (seen === undefined || event.timestamp < seen) firstWalk.set(event.sentenceId, event.timestamp);
    }
  }
  return sentencesReadyToRevisit(events, now).filter((id) => {
    const since = lastAttempt.get(id) ?? firstWalk.get(id);
    if (since === undefined) return false;
    const tries = attemptDays.get(id)?.size ?? 0;
    const gap = FRESH_TRY_GAP_DAYS[Math.min(tries, FRESH_TRY_GAP_DAYS.length - 1)]!;
    return daysBetween(since, now) >= gap;
  });
}
