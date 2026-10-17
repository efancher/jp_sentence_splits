/**
 * Read-only summary of learner reactions to the ungraded clause-question
 * preview (`clause_question_feedback`), to inform the independent review of the
 * draft references before any auto-grading (docs/research/GLOSS_CLAUSE_PILOT.md).
 *
 * The current reaction per question is its most recent row. A question is a
 * review priority when it is disputed — most strongly when the learner disputed
 * it after picking the draft answer's rival (they think another answer works)
 * rather than after missing the draft answer.
 *
 * Usage: npm run diagnose:clause-feedback
 * Never writes. Needs the usual script credentials in .env.
 */
import { CLAUSE_PILOT } from '../src/data/clausePilot';
import { requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface Row {
  id: string;
  timestamp: string;
  sentence_id: string;
  reference_id: string;
  value: 'helpful' | 'disputed';
  chosen_option: string | null;
  draft_answer: string;
}

async function main() {
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('clause_question_feedback')
      .select('id, timestamp, sentence_id, reference_id, value, chosen_option, draft_answer')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`Failed to fetch clause_question_feedback: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  if (!rows.length) {
    console.log('No clause-question feedback recorded yet.');
    return;
  }

  const latest = new Map<string, Row>();
  for (const row of rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))) {
    latest.set(row.reference_id, row);
  }
  const current = [...latest.values()];
  const disputed = current.filter((row) => row.value === 'disputed');
  const byId = new Map(CLAUSE_PILOT.map((reference) => [reference.id, reference]));

  console.log(`${rows.length} reaction(s) on ${current.length} question(s): ${current.length - disputed.length} helpful, ${disputed.length} disputed (latest per question).`);
  const flipped = new Set(rows.map((row) => row.reference_id)).size;
  console.log(`${flipped} question(s) reacted to; ${rows.length - current.length} earlier reaction(s) superseded by a later one.`);

  if (disputed.length) console.log('\nDisputed — review these references first:');
  for (const row of disputed) {
    const reference = byId.get(row.reference_id);
    const pickedDraft = row.chosen_option === null ? 'no pick recorded' : row.chosen_option === row.draft_answer ? 'picked the draft answer' : `picked "${row.chosen_option}"`;
    console.log(`  ${row.reference_id} (${pickedDraft})${reference ? '' : ' [question no longer in catalog]'}`);
    console.log(`    ${(reference?.source ?? row.sentence_id).slice(0, 60)} | draft answer: ${row.draft_answer}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
