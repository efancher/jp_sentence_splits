/**
 * Read-only: replays every stored pitch-drill take (`pitch_drill_takes`) through
 * the grader and lines the verdicts up against the learner's own after-take
 * labels ("Felt right" / "Felt off"). This is what the takes are kept for —
 * judging a grader change on real recordings instead of on the dictionary alone.
 *
 * Per scored word it prints: the label, what was logged at the time, the
 * per-mora-vs-mean rule alone ("raw", the pre-2026-09-21 grader), the current
 * grader (`gradeLearnerMorae`: fit may rescue, flat flagged), and the fitted
 * contrast in semitones. Then a summary of how each verdict lines up with the
 * labels. Labels are one person's ear on a handful of takes — read them as a
 * prompt to look, not as ground truth.
 *
 * Usage: npm run replay:pitch-drill-takes
 */
import { segmentIntoMorae } from '../src/lib/mora';
import {
  classifyLearnerMorae,
  followingMoraSpan,
  gradeLearnerMorae,
  type PitchAccentTarget,
} from '../src/lib/pitchAccentObservations';
import { expectedPitchShape } from '../src/lib/pitchAccentShape';
import type { PitchAnalysisPayload } from '../src/lib/pitch';
import type { WordAlignment } from '../src/domain/types';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface TakeRow {
  id: string;
  taken_at: string;
  transcript: string;
  alignment: { words: WordAlignment[] } | null;
  pitch: PitchAnalysisPayload | null;
  targets: PitchAccentTarget[];
  results: { surfaceForm: string; mismatch: boolean }[];
  labels: Record<string, 'right' | 'off'>;
}

async function main() {
  const supabase = await createScriptSupabaseClient();
  const { data, error } = await supabase
    .from('pitch_drill_takes')
    .select('id,taken_at,transcript,alignment,pitch,targets,results,labels')
    .order('taken_at');
  if (error) throw new Error(error.message);
  const takes = (data ?? []) as TakeRow[];
  console.log(`${takes.length} stored take(s).\n`);

  type Row = { label?: 'right' | 'off'; logged: boolean; raw: boolean; graded: boolean; flat: boolean };
  const rows: Row[] = [];

  for (const take of takes) {
    if (!take.alignment || !take.pitch) continue;
    const audible = take.alignment.words.filter((w) => w.text && w.text !== '<eps>');
    for (const target of take.targets) {
      const wordIndex = audible.findIndex((w) => w.text === target.surfaceForm);
      const logged = take.results.find((r) => r.surfaceForm === target.surfaceForm)?.mismatch ?? false;
      const label = take.labels?.[target.surfaceForm];
      if (wordIndex < 0) {
        console.log(`${take.taken_at.slice(0, 16)} ${target.surfaceForm}: not located in the take`);
        continue;
      }
      const moraCount = segmentIntoMorae(target.reading).length;
      const position = target.pitchAccentPositions[0]!;
      const span = followingMoraSpan(audible, wordIndex, target.followingMora);
      const raw = classifyLearnerMorae(audible[wordIndex]!, moraCount, take.pitch, span);
      const graded = gradeLearnerMorae(audible[wordIndex]!, moraCount, take.pitch, span, position);
      if (!raw || !graded) {
        console.log(`${take.taken_at.slice(0, 16)} ${target.surfaceForm}: too little voiced signal`);
        continue;
      }
      const expected = expectedPitchShape(moraCount, position, raw.measuredFollowing).join('');
      const rawShape = raw.classes.join('');
      const gradedShape = graded.classes.join('');
      const rawMismatch = rawShape !== expected;
      const gradedMismatch = graded.flat || gradedShape !== expected;
      rows.push({ label, logged, raw: rawMismatch, graded: gradedMismatch, flat: graded.flat });
      const means = raw.bucketMeans.map((m) => (m === null ? '·' : m.toFixed(1))).join(' ');
      console.log(
        `${take.taken_at.slice(0, 16)}  ${target.surfaceForm.padEnd(6)} label=${(label ?? '—').padEnd(5)} expected=${expected.padEnd(6)} raw=${rawShape.padEnd(6)} graded=${gradedShape.padEnd(6)}${graded.flat ? ' FLAT' : '     '} contrast=${graded.contrastSemitones?.toFixed(1) ?? '—'} st  mora means: ${means}`,
      );
    }
  }

  const labelled = rows.filter((r) => r.label);
  console.log(`\n${labelled.length} labelled word(s) of ${rows.length}.`);
  for (const label of ['right', 'off'] as const) {
    const group = labelled.filter((r) => r.label === label);
    if (!group.length) continue;
    const said = (pick: (r: Row) => boolean) => `${group.filter(pick).length}/${group.length}`;
    console.log(
      `  felt ${label.padEnd(5)}: logged-at-the-time flagged ${said((r) => r.logged)}, raw rule flagged ${said((r) => r.raw)}, current grader flagged ${said((r) => r.graded)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
