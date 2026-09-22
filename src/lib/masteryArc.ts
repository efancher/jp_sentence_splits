/**
 * Per-sentence mastery arc (docs/ROADMAP.md "Per-sentence mastery arc") —
 * one ladder per encountered sentence: vocab confirmed → words
 * reading-proficient → listening-proficient → conjugations → grammar
 * recognized → reading_in_context mature → shadowed → pitch known. Turns
 * the flat multi-card review queue into a visible arc instead of a pile of
 * unrelated due dates.
 *
 * Pure, no Dexie/network — same convention as `skillCoverage.ts`/
 * `bookCoverage.ts`. `src/db/repository.ts#getSentenceMasteryArcs` does the
 * only fetching, reusing the same proficiency primitives every other gate
 * in this app is built from (`getProficientReadingVocabularyItemIds`,
 * `getProficientPitchAccentVocabularyItemIds`, `MATURE_MIN_SCHEDULED_DAYS`,
 * `computeGrammarLearnerState`'s "tracked && proficient" bar) rather than
 * inventing a new proficiency concept for this view alone.
 *
 * `null` (not `false`) means "nothing to gate on" — a sentence with no
 * inflectable words has no conjugation rung to climb, a sentence with no
 * audio can't be shadowed or listened to. A `null` rung never blocks
 * completeness; only a real `false` does.
 */

export type MasteryRungStatus = true | false | null;

export type MasteryRungKey =
  | 'vocabConfirmed'
  | 'readingProficient'
  | 'listeningProficient'
  | 'conjugationsProficient'
  | 'grammarRecognized'
  | 'contextMature'
  | 'shadowed'
  | 'pitchProficient';

export interface MasteryRung {
  key: MasteryRungKey;
  label: string;
  status: MasteryRungStatus;
}

export interface SentenceMasteryArc {
  sentenceId: string;
  rungs: MasteryRung[];
  /** Every rung is `true` or `null` — nothing left to climb. */
  complete: boolean;
  /** The first `false` rung, in ladder order — where to focus next. `null` once `complete`. */
  nextRung: MasteryRung | null;
  /** Rungs that are actually `true` (for "N of M" progress display) — `null` rungs count toward neither side. */
  clearedCount: number;
  /** `true` + `false` rungs — the denominator for `clearedCount` (excludes `null`/not-applicable rungs). */
  applicableCount: number;
}

const RUNG_DEFS: { key: MasteryRungKey; label: string }[] = [
  { key: 'vocabConfirmed', label: 'Vocabulary confirmed' },
  { key: 'readingProficient', label: 'Words reading-proficient' },
  { key: 'listeningProficient', label: 'Words heard successfully' },
  { key: 'conjugationsProficient', label: 'Conjugations in context' },
  { key: 'grammarRecognized', label: 'Grammar recognized' },
  { key: 'contextMature', label: 'Reading in context, mature' },
  { key: 'shadowed', label: 'Shadowed' },
  { key: 'pitchProficient', label: 'Pitch accent known' },
];

export function buildSentenceMasteryArc(
  sentenceId: string,
  statusByKey: Partial<Record<MasteryRungKey, MasteryRungStatus>>,
): SentenceMasteryArc {
  const rungs = RUNG_DEFS.map((def) => ({ ...def, status: statusByKey[def.key] ?? null }));
  const nextRung = rungs.find((rung) => rung.status === false) ?? null;
  const clearedCount = rungs.filter((rung) => rung.status === true).length;
  const applicableCount = rungs.filter((rung) => rung.status !== null).length;
  return {
    sentenceId,
    rungs,
    complete: nextRung === null,
    nextRung,
    clearedCount,
    applicableCount,
  };
}

/**
 * Incomplete arcs only, furthest-along first (fewest rungs left, i.e. the
 * "one rung left" cases the ROADMAP entry calls out) — ties broken by
 * `sentenceId` for a stable order. Complete arcs and arcs with nothing
 * applicable yet (a sentence whose vocabulary isn't even confirmed) are
 * both excluded: neither has anything actionable to show here.
 */
export function rankSentenceMasteryArcs(
  arcs: readonly SentenceMasteryArc[],
  limit = 20,
): SentenceMasteryArc[] {
  return arcs
    .filter((arc) => !arc.complete && arc.clearedCount > 0)
    .sort((a, b) => {
      const remaining = a.applicableCount - a.clearedCount - (b.applicableCount - b.clearedCount);
      if (remaining !== 0) return remaining;
      return a.sentenceId < b.sentenceId ? -1 : a.sentenceId > b.sentenceId ? 1 : 0;
    })
    .slice(0, limit);
}
