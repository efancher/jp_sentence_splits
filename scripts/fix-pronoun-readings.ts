/**
 * One-time correction for sentences whose morphology-derived reading spells
 * the standalone pronoun 私 as わたくし instead of わたし. unidic-lite
 * lemmatizes 私 (代名詞) with the formal reading ワタクシ, so every sentence
 * re-segmented through `applyResegmentation` (which regenerates
 * `inline_reading` + `vocabulary_suggestions` from the fugashi/unidic-lite
 * service) picked up わたくし — surfaced by a card-issue-style question on
 * "私と同い年です。" in *Easy Japanese Drama: After Work*.
 *
 * The morphology service now carries a `READING_OVERRIDES` map
 * (server/youtube-mining/app/readings.py) so future segmentation/mining
 * emits わたし; this script fixes the rows already written.
 *
 * Sweep, not a hand-list — the correction is mechanical:
 *   - `inline_reading`: `私[わたくし]` -> `私[わたし]`
 *   - `reading_only`:   `わたくし` -> `わたし` (only when the same row's
 *     inline_reading carried the 私[わたくし] furigana, so we never touch a
 *     sentence that legitimately says わたくし for some other reason)
 *   - `vocabulary_suggestions` / `target_vocabulary` JSON: entries with
 *     expression/surface 私 and reading わたくし -> わたし
 *
 * Dry-run by default; --apply required to write. Idempotent: only rows that
 * still contain わたくし in one of those places are selected. Sentences that
 * already read わたし don't match and are left alone.
 *
 * Usage: npm run fix:pronoun-readings -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface VocabEntry {
  expression?: string;
  surface?: string;
  reading?: string;
  [key: string]: unknown;
}

interface SentenceRow {
  id: string;
  japanese: string;
  inline_reading: string | null;
  reading_only: string | null;
  vocabulary_suggestions: VocabEntry[] | null;
  target_vocabulary: VocabEntry[] | null;
}

const INLINE_OLD = '私[わたくし]';
const INLINE_NEW = '私[わたし]';

function fixVocabList(list: VocabEntry[] | null): { next: VocabEntry[] | null; changed: number } {
  if (!list) return { next: list, changed: 0 };
  let changed = 0;
  const next = list.map((entry) => {
    const isWatashi = entry.expression === '私' || entry.surface === '私';
    if (isWatashi && entry.reading === 'わたくし') {
      changed += 1;
      return { ...entry, reading: 'わたし' };
    }
    return entry;
  });
  return { next: changed ? next : list, changed };
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  // Any row that mentions わたくし in inline_reading OR carries a わたくし
  // vocab suggestion. `or` with a JSON contains filter keeps the fetch tight.
  const { data, error } = await supabase
    .from('sentences')
    .select(
      'id, japanese, inline_reading, reading_only, vocabulary_suggestions, target_vocabulary',
    )
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .or(
      `inline_reading.ilike.%${INLINE_OLD}%,vocabulary_suggestions.cs.[{"reading":"わたくし"}],target_vocabulary.cs.[{"reading":"わたくし"}]`,
    );
  if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);

  const rows = (data ?? []) as unknown as SentenceRow[];
  console.log(`Fetched ${rows.length} candidate sentence(s).`);

  let fixed = 0;
  for (const row of rows) {
    const inline = row.inline_reading ?? '';
    const inlineHit = inline.includes(INLINE_OLD);
    const newInline = inlineHit ? inline.split(INLINE_OLD).join(INLINE_NEW) : inline;

    const readingOnly = row.reading_only ?? '';
    const newReadingOnly =
      inlineHit && readingOnly.includes('わたくし')
        ? readingOnly.split('わたくし').join('わたし')
        : readingOnly;

    const sug = fixVocabList(row.vocabulary_suggestions);
    const tgt = fixVocabList(row.target_vocabulary);

    const patch: Record<string, unknown> = {};
    if (newInline !== inline) patch.inline_reading = newInline;
    if (newReadingOnly !== readingOnly) patch.reading_only = newReadingOnly;
    if (sug.changed) patch.vocabulary_suggestions = sug.next;
    if (tgt.changed) patch.target_vocabulary = tgt.next;
    if (Object.keys(patch).length === 0) continue;

    fixed += 1;
    console.log(`\n  ${row.id}  ${row.japanese}`);
    if (patch.inline_reading) console.log(`    inline_reading: "${inline}" -> "${newInline}"`);
    if (patch.reading_only) console.log(`    reading_only:   "${readingOnly}" -> "${newReadingOnly}"`);
    if (sug.changed) console.log(`    vocabulary_suggestions: ${sug.changed} entry(ies) わたくし -> わたし`);
    if (tgt.changed) console.log(`    target_vocabulary: ${tgt.changed} entry(ies) わたくし -> わたし`);

    if (apply) {
      const { error: updateError } = await supabase
        .from('sentences')
        .update(patch)
        .eq('id', row.id);
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
