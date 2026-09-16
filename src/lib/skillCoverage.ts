/**
 * "Skill coverage" (docs/ROADMAP.md — "Skill-imbalance metric"). Of the
 * words you can recognize (reading_retrieval/cloze proficient), what
 * fraction have also reached proficiency on the other skills the
 * 2026-09-16 card-type/skill graph identified as separate: producing the
 * reading (reading_production), pitch (pitch_accent), and being heard
 * successfully in a sentence (word_listening, on at least one occurrence).
 * A gap here is the concrete "listening trails reading by ~N words" signal
 * the graph work was trying to make visible, instead of a hunch.
 *
 * Pure, no Dexie/network — same convention as `progressReport.ts`. All
 * four input sets are vocabulary item ids; `recognizedIds` is the
 * denominator, the rest are checked for membership.
 * `src/db/repository.ts#getSkillCoverage` does the only fetching.
 */

export interface SkillCoverageInput {
  /** Reading-recognition-proficient (reading_retrieval/cloze) — the denominator. */
  recognizedIds: string[];
  productionProficientIds: ReadonlySet<string>;
  pitchProficientIds: ReadonlySet<string>;
  /** Vocabulary item ids with at least one proficient word_listening occurrence. */
  heardProficientIds: ReadonlySet<string>;
}

export interface SkillCoverageRung {
  label: string;
  count: number;
  /** count / recognized total, or null when there's nothing recognized yet. */
  share: number | null;
}

export interface SkillCoverage {
  hasData: boolean;
  recognized: number;
  rungs: SkillCoverageRung[];
}

export function buildSkillCoverage(input: SkillCoverageInput): SkillCoverage {
  const { recognizedIds, productionProficientIds, pitchProficientIds, heardProficientIds } = input;
  const total = recognizedIds.length;
  const share = (count: number): number | null => (total > 0 ? count / total : null);

  const countIn = (set: ReadonlySet<string>) =>
    recognizedIds.filter((id) => set.has(id)).length;

  const production = countIn(productionProficientIds);
  const pitch = countIn(pitchProficientIds);
  const heard = countIn(heardProficientIds);

  return {
    hasData: total > 0,
    recognized: total,
    rungs: [
      { label: 'Can produce the reading', count: production, share: share(production) },
      { label: 'Pitch known', count: pitch, share: share(pitch) },
      { label: 'Heard successfully in a sentence', count: heard, share: share(heard) },
    ],
  };
}
