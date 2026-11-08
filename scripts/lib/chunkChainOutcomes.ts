/**
 * Pure summary for scripts/diagnose-chunk-chain-outcomes.ts: did the chunk chain help? Compares, per
 * chain visit, the optional cold whole-sentence try (`chain-cold:0`) with how the chain ended on the
 * whole sentence (`chain-rung:<top>` where that rung was the last one climbed to). Self-ratings only.
 */
export interface ChainEventRow {
  visitId: string;
  sentenceId: string;
  targetKey: string | null;
  outcome: string | null;
  timestamp: string;
}

export type ChainOutcome = 'got_it' | 'close' | 'needed_help';
const ORDER: ChainOutcome[] = ['needed_help', 'close', 'got_it'];

export interface ChainVisitComparison {
  visitId: string;
  sentenceId: string;
  cold: ChainOutcome;
  /** Rating of the highest rung the visit rated (the whole sentence only if the chain reached it). */
  top: ChainOutcome | null;
  reachedWhole: boolean;
}

export interface ChainOutcomeSummary {
  chainVisits: number;
  coldVisits: number;
  comparable: number;
  /** Cold vs the visit's last rating: better = chain-end outcome beat the cold one. */
  better: number;
  same: number;
  worse: number;
  coldGotIt: number;
  topGotIt: number;
  comparisons: ChainVisitComparison[];
}

const asOutcome = (value: string | null): ChainOutcome | null =>
  value === 'got_it' || value === 'close' || value === 'needed_help' ? value : null;

export function summariseChainOutcomes(events: readonly ChainEventRow[]): ChainOutcomeSummary {
  const byVisit = new Map<string, ChainEventRow[]>();
  for (const event of events) {
    if (!event.targetKey?.startsWith('chain-')) continue;
    byVisit.set(event.visitId, [...(byVisit.get(event.visitId) ?? []), event]);
  }
  const summary: ChainOutcomeSummary = {
    chainVisits: byVisit.size, coldVisits: 0, comparable: 0, better: 0, same: 0, worse: 0, coldGotIt: 0, topGotIt: 0, comparisons: [],
  };
  for (const [visitId, rows] of byVisit) {
    const sorted = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const cold = asOutcome(sorted.find((row) => row.targetKey === 'chain-cold:0')?.outcome ?? null);
    if (!cold) continue;
    summary.coldVisits += 1;
    const rungs = sorted.filter((row) => row.targetKey?.startsWith('chain-rung:'));
    const last = rungs[rungs.length - 1];
    const top = asOutcome(last?.outcome ?? null);
    if (!last || !top) continue;
    // Rungs are numbered shortest-first, so the whole sentence is the highest index rated.
    const highest = Math.max(...rungs.map((row) => Number(row.targetKey!.slice('chain-rung:'.length))));
    summary.comparable += 1;
    summary.comparisons.push({ visitId, sentenceId: sorted[0]!.sentenceId, cold, top, reachedWhole: Number(last.targetKey!.slice('chain-rung:'.length)) === highest && highest > 0 });
    const delta = ORDER.indexOf(top) - ORDER.indexOf(cold);
    if (delta > 0) summary.better += 1;
    else if (delta < 0) summary.worse += 1;
    else summary.same += 1;
    if (cold === 'got_it') summary.coldGotIt += 1;
    if (top === 'got_it') summary.topGotIt += 1;
  }
  return summary;
}
