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
