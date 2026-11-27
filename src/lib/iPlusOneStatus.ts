/** One not-yet-introduced sentence as the i+1 status sees it. */
export interface IPlusOneStatusEntry {
  sentenceId: string;
  /** Position in the i+1 order (lower = sooner). */
  rank: number;
  /** Words and grammar patterns in it the learner has not met; empty = nothing new. */
  newPieces: readonly string[];
}

export interface IPlusOneNextStep {
  sentenceId: string;
  /** What the learner meets for the first time in this sentence. */
  newPieces: string[];
  /** Other waiting sentences that would have nothing new left once these pieces (and earlier steps') are known. */
  unlocks: number;
}

export interface IPlusOneStatus {
  /** Waiting sentences with nothing new in them. */
  readyNow: number;
  /** Of those, how many the planner serves before the next sentence that brings something new. */
  beforeNext: number;
  /** Waiting sentences one or two new pieces away. */
  nearlyReady: number;
  /** Waiting sentences three or more new pieces away. */
  further: number;
  /** The next sentences that bring new pieces, in order, with a running unlock count. */
  next: IPlusOneNextStep[];
}

/**
 * Summarises where the learner is on the i+1 path, given every waiting (not introduced) scorable sentence.
 * Pure. `next` walks the planner's order: each step is the earliest-ranked sentence still carrying new pieces; its
 * pieces join the known set, and `unlocks` counts the other sentences that this makes fully readable.
 */
export function summariseIPlusOne(
  entries: readonly IPlusOneStatusEntry[],
  maxSteps = 3,
  maxNearly = 2,
): IPlusOneStatus {
  const byRank = [...entries].sort((a, b) => a.rank - b.rank);
  const readyNow = byRank.filter((entry) => entry.newPieces.length === 0);
  const waiting = byRank.filter((entry) => entry.newPieces.length > 0);
  const firstNew = waiting[0];
  const beforeNext = firstNew ? readyNow.filter((entry) => entry.rank < firstNew.rank).length : readyNow.length;

  const learned = new Set<string>();
  const remaining = [...waiting];
  const next: IPlusOneNextStep[] = [];
  while (next.length < maxSteps && remaining.length > 0) {
    const step = remaining.shift()!;
    for (const piece of step.newPieces) learned.add(piece);
    let unlocks = 0;
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (remaining[i]!.newPieces.every((piece) => learned.has(piece))) {
        unlocks += 1;
        remaining.splice(i, 1);
      }
    }
    next.push({ sentenceId: step.sentenceId, newPieces: [...step.newPieces], unlocks });
  }

  return {
    readyNow: readyNow.length,
    beforeNext,
    nearlyReady: waiting.filter((entry) => entry.newPieces.length <= maxNearly).length,
    further: waiting.filter((entry) => entry.newPieces.length > maxNearly).length,
    next,
  };
}
