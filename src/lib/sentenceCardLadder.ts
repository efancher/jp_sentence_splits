import type { StudyItem } from '../domain/types';
import { dictationTileIndex, EAR_TILES_ACTIVITY } from './earTiles';
import { isSentenceCardActivityType } from './sentenceLed';

/**
 * The `/study-items` page's per-sentence view of the sentence-led card ladder: a met sentence's
 * `reading_in_context` card, its audio cards (`listening`, then `ear_tiles` unlocking one
 * `dictation_tile:N` card per tile) and when the next of them is due. Read-only; the retired
 * word/grammar drill cards are not part of it.
 */
export type LadderStage = 'read' | 'listening' | 'ear_tiles' | 'dictation';

export const LADDER_STAGES: readonly LadderStage[] = ['read', 'listening', 'ear_tiles', 'dictation'];

export const LADDER_STAGE_LABELS: Record<LadderStage, string> = {
  read: 'Read',
  listening: 'Listening',
  ear_tiles: 'Ear tiles',
  dictation: 'Dictation',
};

/** The ladder stage a sentence card belongs to, or null for anything else (pitch, retired drills). */
export function ladderStageOf(activityType: string): LadderStage | null {
  if (!isSentenceCardActivityType(activityType)) return null;
  if (activityType === 'reading_in_context') return 'read';
  if (activityType === 'listening') return 'listening';
  if (activityType === EAR_TILES_ACTIVITY) return 'ear_tiles';
  // The retired whole-sentence `dictation` card and the per-tile `dictation_tile:N` cards.
  return 'dictation';
}

export interface SentenceLadderRow {
  sentenceId: string;
  /** This sentence's ladder cards by stage; dictation holds one card per tile, ordered by tile. */
  stages: Record<LadderStage, StudyItem[]>;
  /** Earliest due date across its ladder cards; absent when it has none yet. */
  nextDue?: string;
  dueNowCount: number;
  lapses: number;
}

export function buildSentenceLadderRows(
  sentenceIds: Iterable<string>,
  studyItems: readonly StudyItem[],
  nowIso: string,
): SentenceLadderRow[] {
  const rows = new Map<string, SentenceLadderRow>();
  for (const sentenceId of sentenceIds) {
    rows.set(sentenceId, {
      sentenceId,
      stages: { read: [], listening: [], ear_tiles: [], dictation: [] },
      dueNowCount: 0,
      lapses: 0,
    });
  }
  for (const item of studyItems) {
    if (item.subjectType !== 'sentence') continue;
    const row = rows.get(item.subjectId);
    const stage = ladderStageOf(item.activityType);
    if (!row || !stage) continue;
    row.stages[stage].push(item);
    if (!row.nextDue || item.fsrsState.due < row.nextDue) row.nextDue = item.fsrsState.due;
    if (item.fsrsState.due <= nowIso) row.dueNowCount += 1;
    row.lapses += item.fsrsState.lapses;
  }
  for (const row of rows.values()) {
    row.stages.dictation.sort(
      (a, b) => (dictationTileIndex(a.activityType) ?? -1) - (dictationTileIndex(b.activityType) ?? -1),
    );
  }
  return [...rows.values()];
}

export type LadderFilter = 'due' | 'all' | 'lapsed';

/** Due: soonest first. Lapsed: most lapses first. All: by next due, sentences with no cards yet last. */
export function filterSentenceLadderRows<Row extends SentenceLadderRow>(rows: readonly Row[], filter: LadderFilter): Row[] {
  const byDue = (a: SentenceLadderRow, b: SentenceLadderRow) =>
    (a.nextDue ?? '￿').localeCompare(b.nextDue ?? '￿');
  if (filter === 'due') return rows.filter((row) => row.dueNowCount > 0).sort(byDue);
  if (filter === 'lapsed') return rows.filter((row) => row.lapses > 0).sort((a, b) => b.lapses - a.lapses || byDue(a, b));
  return [...rows].sort(byDue);
}

export interface LadderStageCount {
  stage: LadderStage;
  sentences: number;
  due: number;
}

/** How many met sentences have reached each stage, and how many of those stage's cards are due now. */
export function countLadderStages(rows: readonly SentenceLadderRow[], nowIso: string): LadderStageCount[] {
  return LADDER_STAGES.map((stage) => {
    let sentences = 0;
    let due = 0;
    for (const row of rows) {
      const cards = row.stages[stage];
      if (cards.length > 0) sentences += 1;
      due += cards.filter((card) => card.fsrsState.due <= nowIso).length;
    }
    return { stage, sentences, due };
  });
}
