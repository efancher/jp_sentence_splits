/**
 * One-time correction of one AI-suggested sentence_grammar.occurrence_explanation. For
 * 最後まで聞いてくれてありがとうございます the stored text ("thanks listeners for the favor of listening
 * until the end") folded the thanking (ありがとう) into the ～てくれて pattern, which led a learner to read the
 * Grammar check as "what does ありがとう do". The pattern only marks the listening as a favour done for the
 * speaker, and the て links it to the thanks.
 *
 * Scoped to one row id and only when the stored text still equals the old text, so a re-run (or a hand edit
 * since) writes nothing. Dry-run by default; --apply required to write.
 *
 * Usage: npx tsx scripts/fix-tekureru-occurrence-explanation.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const ROW_ID = 'sentence_grammar_13088d7e-2fc9-43d3-2127-6fcb1de6a166';
const OLD_TEXT = 'thanks listeners for the favor of listening until the end';
const NEW_TEXT =
  'you listened for the speaker’s benefit (the favour the thanks is for); the て links it to ありがとうございます, which does the thanking';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data, error } = await supabase
    .from('sentence_grammar')
    .select('id, surface_form, occurrence_explanation, deleted_at')
    .eq('id', ROW_ID)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to read ${ROW_ID}: ${error.message}`);
  if (!data || data.deleted_at) {
    console.log('Row not found (or deleted); nothing to do.');
    return;
  }
  if (data.occurrence_explanation !== OLD_TEXT) {
    console.log(`Stored text is no longer the original (${JSON.stringify(data.occurrence_explanation)}); leaving it alone.`);
    return;
  }
  console.log(`${data.surface_form}:\n  before: ${OLD_TEXT}\n  after:  ${NEW_TEXT}`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
    return;
  }
  const { error: updateError } = await supabase
    .from('sentence_grammar')
    .update({ occurrence_explanation: NEW_TEXT })
    .eq('id', ROW_ID)
    .eq('owner_id', user.id);
  if (updateError) throw new Error(`Failed to update ${ROW_ID}: ${updateError.message}`);
  console.log('Updated 1 row.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
