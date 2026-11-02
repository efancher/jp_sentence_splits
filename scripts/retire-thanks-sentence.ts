/**
 * One-off: retire the bogus "ご視聴ありがとうございました。" sentence from every
 * book. It was imported from the Slow Japanese outro, but the host never says
 * it (Whisper hears ありがとうございます / じゃあね, then an English outro), so no
 * clip can ever match its text. Mirrors `cascadeRetireSentenceLocal`: the
 * sentence's book links, analysis, extras, vocabulary/grammar links, study
 * items and the sentence row itself. Its reference_audio rows were retired by
 * retire-bad-thanks-clips.ts.
 *
 * Soft-delete only (`deleted_at`) so clients learn of it on next pull.
 * Dry-run by default.
 *
 * Usage: npx tsx scripts/retire-thanks-sentence.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const SENTENCE_ID = 'sent_d51e885f';
const EXPECTED_TEXT = 'ご視聴ありがとうございました。';

type Target = { table: string; keyColumn: string; key: string; label: string };

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const live = async (table: string, column: string, value: string, select: string) => {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('owner_id', user.id)
      .eq(column, value)
      .is('deleted_at', null);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as unknown as Array<Record<string, string>>;
  };

  const sentence = await live('sentences', 'id', SENTENCE_ID, 'id, japanese');
  if (sentence.length === 0) {
    console.log('Sentence already retired. Nothing to do.');
    return;
  }
  if (sentence[0]!.japanese !== EXPECTED_TEXT) {
    throw new Error(`Refusing: sentence text is "${sentence[0]!.japanese}", expected "${EXPECTED_TEXT}".`);
  }

  const targets: Target[] = [];
  const add = (table: string, keyColumn: string, rows: Array<Record<string, string>>, label: string) => {
    for (const row of rows) targets.push({ table, keyColumn, key: row[keyColumn]!, label });
  };
  add('book_sentences', 'id', await live('book_sentences', 'sentence_id', SENTENCE_ID, 'id, book_id'), 'book link');
  add('reference_audio', 'id', await live('reference_audio', 'sentence_id', SENTENCE_ID, 'id'), 'reference audio');
  add('analyses', 'sentence_id', await live('analyses', 'sentence_id', SENTENCE_ID, 'sentence_id'), 'analysis');
  add('inbox', 'sentence_id', await live('inbox', 'sentence_id', SENTENCE_ID, 'sentence_id'), 'inbox');
  add('sentence_extras', 'id', await live('sentence_extras', 'id', SENTENCE_ID, 'id'), 'extras');
  add('sentence_vocabulary', 'id', await live('sentence_vocabulary', 'sentence_id', SENTENCE_ID, 'id'), 'vocabulary link');
  add('sentence_grammar', 'id', await live('sentence_grammar', 'sentence_id', SENTENCE_ID, 'id'), 'grammar link');
  add('study_items', 'id', await live('study_items', 'subject_id', SENTENCE_ID, 'id'), 'study item');
  add('sentences', 'id', sentence, 'sentence');

  console.log(`Retiring "${EXPECTED_TEXT}" (${SENTENCE_ID}):`);
  for (const t of targets) console.log(`  ${t.table.padEnd(20)} ${t.key}  (${t.label})`);
  if (!apply) {
    console.log(`\nDry run — ${targets.length} row(s) would be soft-deleted. Re-run with --apply.`);
    return;
  }

  const nowIso = new Date().toISOString();
  for (const t of targets) {
    const { error } = await supabase
      .from(t.table)
      .update({ deleted_at: nowIso })
      .eq(t.keyColumn, t.key)
      .eq('owner_id', user.id);
    if (error) throw new Error(`soft-delete ${t.table} ${t.key}: ${error.message}`);
  }
  console.log(`\nSoft-deleted ${targets.length} row(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
