/**
 * One-time correction for sentences whose morphology-derived reading spells
 * 和菓子 as わかし. unidic-lite splits it into 和 / 菓子 and reads 菓子 as かし;
 * the word is わがし (rendaku). Surfaced by the sentence walkthrough.
 *
 * The morphology service now carries `wagashi_override`
 * (server/youtube-mining/app/readings.py); this fixes rows already written:
 *   - `inline_reading`: `和[わ]菓子[かし]` -> `和[わ]菓子[がし]`
 *   - `reading_only`:   `わかし` -> `わがし`
 *   - `vocabulary_suggestions` entries with surface 菓子 directly after a 和
 *     suggestion (start/end adjacency) -> reading がし
 *
 * Dry-run by default; --apply required to write. Idempotent.
 *
 * Usage: npm run fix:wagashi-readings -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface Suggestion {
  surface?: string;
  reading?: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

interface SentenceRow {
  id: string;
  japanese: string;
  inline_reading: string | null;
  reading_only: string | null;
  vocabulary_suggestions: Suggestion[] | null;
}

const INLINE_OLD = '和[わ]菓子[かし]';
const INLINE_NEW = '和[わ]菓子[がし]';
const READING_OLD = 'わかし';
const READING_NEW = 'わがし';

function fixSuggestions(list: Suggestion[] | null): { next: Suggestion[] | null; changed: number } {
  if (!list) return { next: list, changed: 0 };
  let changed = 0;
  const next = list.map((entry) => {
    if (entry.surface !== '菓子' || entry.reading !== 'かし') return entry;
    const prev = list.find((other) => other.surface === '和' && other.end === entry.start);
    if (!prev) return entry;
    changed += 1;
    return { ...entry, reading: 'がし' };
  });
  return { next: changed ? next : list, changed };
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data, error } = await supabase
    .from('sentences')
    .select('id, japanese, inline_reading, reading_only, vocabulary_suggestions')
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .ilike('japanese', '%和菓子%');
  if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);

  const rows = (data ?? []) as unknown as SentenceRow[];
  console.log(`Fetched ${rows.length} sentence(s) containing 和菓子.`);

  let fixed = 0;
  for (const row of rows) {
    const inline = row.inline_reading ?? '';
    const newInline = inline.split(INLINE_OLD).join(INLINE_NEW);
    const readingOnly = row.reading_only ?? '';
    const newReadingOnly = readingOnly.split(READING_OLD).join(READING_NEW);
    const sug = fixSuggestions(row.vocabulary_suggestions);

    const patch: Record<string, unknown> = {};
    if (newInline !== inline) patch.inline_reading = newInline;
    if (newReadingOnly !== readingOnly) patch.reading_only = newReadingOnly;
    if (sug.changed) patch.vocabulary_suggestions = sug.next;
    if (Object.keys(patch).length === 0) continue;

    fixed += 1;
    console.log(`\n  ${row.id}  ${row.japanese}`);
    if (patch.inline_reading) console.log(`    inline_reading: "${inline}" -> "${newInline}"`);
    if (patch.reading_only) console.log(`    reading_only:   "${readingOnly}" -> "${newReadingOnly}"`);
    if (sug.changed) console.log(`    vocabulary_suggestions: ${sug.changed} entry(ies) かし -> がし`);

    if (apply) {
      const { error: updateError } = await supabase.from('sentences').update(patch).eq('id', row.id);
      if (updateError) throw new Error(`Failed to update sentence ${row.id}: ${updateError.message}`);
    }
  }

  console.log(`\nDone. ${fixed} sentence(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
