/**
 * Staged sentence progress (sentence-first plan, Phase 3): a derived, read-only
 * view of lesson evidence. Only stages 1-4 (understanding) are measurable so
 * far; expression stages are reported as "not tried" and cap the headline, so
 * reading alone can never reach 100%. Nothing here is stored or scheduled.
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

  const provisional = structure.supported.total === 0 || vocabulary.supported.total === 0;
  const stages: SentenceJourney['stages'] = [
    { id: 'guided', label: 'Guided understanding', fraction: s1, note: s1 ? 'Walkthrough finished' : 'Walk through the sentence' },
    { id: 'supported', label: 'Supported recognition', fraction: s2, note: s2 === null ? 'Not assessed: no targets identified' : 'Targets recognised with some support' },
    { id: 'independent', label: 'Independent comprehension', fraction: s3, note: s3 === null ? 'Not assessed: no targets identified' : 'Targets with the word hidden, plus a gist check on a later day' },
    { id: 'retained', label: 'Revisit and retain', fraction: s4, note: 'A second successful gist check on another day' },
    { id: 'supported_expression', label: 'Supported expression', fraction: 0, note: 'Not tried yet' },
    { id: 'independent_expression', label: 'Independent expression', fraction: 0, note: 'Not tried yet' },
  ];

  const hasEvidence = mine.length > 0 || vocabulary.supported.done > 0;
  const percent = hasEvidence
    ? Math.round((100 * stages.reduce((sum, stage) => sum + (stage.fraction ?? 0), 0)) / stages.length)
    : undefined;

  return { stages, vocabulary, structure, provisional, percent, gist: { checkedAfterGap: afterGapDays.size, hasAny: gistGotIt.length > 0 } };
}
