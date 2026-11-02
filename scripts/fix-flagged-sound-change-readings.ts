/**
 * Apply the open "Reading check" flags (chunk_issue_reports, source
 * `meaning_checks`) that are plain compound sound changes — rendaku
 * (頃 ころ→ごろ) or gemination (六 ろく→ろっ) — to the sentences' furigana.
 * Same rule `checkSentenceReading` applies at import; this catches sentences
 * flagged before that rule existed. Other flags (年 ねん/とし, 他 た/ほか, …)
 * need a human and are only counted.
 *
 * Dry-run by default; --apply writes sentences.inline_reading (and
 * reading_only when it was the plain kana of the old furigana). Idempotent.
 * Reports are not resolved here — mark them resolved in the app.
 *
 * Usage: npm run fix:flagged-sound-change-readings -- [--apply]
 */
import { applyReadingFlagFix, parseReadingFlagNote, type ReadingFlag } from '../src/lib/readingFlagFix';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: reports, error } = await supabase
    .from('chunk_issue_reports')
    .select('id, sentence_id, note')
    .eq('owner_id', user.id)
    .eq('source', 'meaning_checks')
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('created_at');
  if (error) throw new Error(`Failed to fetch reports: ${error.message}`);

  const bySentence = new Map<string, ReadingFlag[]>();
  let skipped = 0;
  for (const report of reports ?? []) {
    const flag = parseReadingFlagNote(String(report.note ?? ''));
    if (!flag || !report.sentence_id) {
      skipped += 1;
      continue;
    }
    bySentence.set(report.sentence_id, [...(bySentence.get(report.sentence_id) ?? []), flag]);
  }

  let fixed = 0;
  let needsHuman = 0;
  for (const [sentenceId, flags] of bySentence) {
    const { data: row, error: readError } = await supabase
      .from('sentences')
      .select('id, japanese, reading_only, inline_reading')
      .eq('id', sentenceId)
      .is('deleted_at', null)
      .maybeSingle();
    if (readError) throw new Error(`Failed to fetch ${sentenceId}: ${readError.message}`);
    if (!row) continue;
    let sentence = {
      inlineReading: row.inline_reading as string | null,
      readingOnly: row.reading_only as string | null,
    };
    let changed = false;
    for (const flag of flags) {
      const fix = applyReadingFlagFix(sentence, flag);
      if (!fix) {
        needsHuman += 1;
        continue;
      }
      console.log(`  ${row.id}  ${row.japanese}`);
      console.log(`    ${flag.base}: ${flag.furigana} -> ${flag.assistant}`);
      sentence = { inlineReading: fix.inlineReading, readingOnly: fix.readingOnly ?? sentence.readingOnly };
      changed = true;
    }
    if (!changed) continue;
    fixed += 1;
    if (apply) {
      const { error: updateError } = await supabase
        .from('sentences')
        .update({ inline_reading: sentence.inlineReading, reading_only: sentence.readingOnly })
        .eq('id', row.id);
      if (updateError) throw new Error(`Failed to update ${row.id}: ${updateError.message}`);
    }
  }

  console.log(
    `\n${fixed} sentence(s) ${apply ? 'fixed' : 'would be fixed'}; ${needsHuman} flag(s) need a human; ${skipped} unparseable.`,
  );
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
