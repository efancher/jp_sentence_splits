/**
 * Strip a leading non-speech caption ("[音楽]", "[息をのむ音]") out of a
 * sentence's `reading_only` / `inline_reading` so it stops leaking into
 * ShadowPage's mora/hiragana row.
 *
 * These captions came from YouTube auto-caption SFX cues; the mining
 * pipeline now removes them at parse time (`subtitles._NON_SPEECH_RE`), so
 * this only cleans up rows imported before that. `japanese` itself is left
 * alone on purpose: the pre-2026-08-23 auto-caption imports it belongs to
 * are slated for a full re-mine (docs/STATUS.md), and every vocabulary
 * suggestion / selection offset is keyed to the exact current string —
 * shifting them here would be a much bigger and riskier change than the
 * reading-row fix the user actually asked for.
 *
 * Dry-run by default; --apply required to write.
 *
 * Usage: npm run fix:caption-artifacts -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const OPEN = new Set(['[', '［', '【']);
const CLOSE = new Set([']', '］', '】']);

/** Remove a leading bracket group, tolerating the nested "[..]" that
 *  inline_reading's own ruby markup puts inside a caption. */
function stripLeadingCaption(value: string): string {
  const text = value.trimStart();
  if (!OPEN.has(text[0] ?? '')) return value;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (OPEN.has(char)) depth += 1;
    else if (CLOSE.has(char)) {
      depth -= 1;
      if (depth === 0) return text.slice(i + 1).trimStart();
    }
  }
  return value;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data, error } = await supabase
    .from('sentences')
    .select('id, japanese, reading_only, inline_reading')
    .eq('owner_id', user.id)
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);

  let fixed = 0;
  for (const row of data ?? []) {
    if (!OPEN.has(String(row.japanese).trimStart()[0] ?? '')) continue;
    const readingOnly = String(row.reading_only ?? '');
    const inlineReading = String(row.inline_reading ?? '');
    const nextReadingOnly = stripLeadingCaption(readingOnly);
    const nextInlineReading = stripLeadingCaption(inlineReading);
    if (nextReadingOnly === readingOnly && nextInlineReading === inlineReading) continue;

    fixed += 1;
    console.log(`  ${row.id}  ${row.japanese}`);
    if (nextReadingOnly !== readingOnly) {
      console.log(`    reading_only:   "${readingOnly}" -> "${nextReadingOnly}"`);
    }
    if (nextInlineReading !== inlineReading) {
      console.log(`    inline_reading: "${inlineReading}" -> "${nextInlineReading}"`);
    }

    if (apply) {
      const { error: updateError } = await supabase
        .from('sentences')
        .update({ reading_only: nextReadingOnly, inline_reading: nextInlineReading })
        .eq('id', row.id);
      if (updateError) {
        throw new Error(`Failed to update sentence ${row.id}: ${updateError.message}`);
      }
    }
  }

  console.log(`\nDone. ${fixed} sentence(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
