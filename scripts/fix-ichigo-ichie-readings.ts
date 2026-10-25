/**
 * One-time correction for sentences whose morphology-derived reading spells
 * 一期一会 as いちきいちえ. unidic-lite splits it into 一 / 期 / 一会 and reads
 * the middle 期 as き; the fixed phrase is いちごいちえ (rendaku). Surfaced by
 * the sentence walkthrough furigana for "今日はみなさんに、一期一会という言葉を
 * 紹介したいと思います。" not matching the audio.
 *
 * The morphology service now carries `ichigo_override`
 * (server/youtube-mining/app/readings.py) so future segmentation/mining emits
 * ご; this script fixes the rows already written.
 *
 *   - `inline_reading`: `期[き]` between `一[いち]` and `一会[いちえ]` -> `期[ご]`
 *   - `reading_only`:   `いちきいちえ` -> `いちごいちえ`
 *   - `vocabulary_suggestions` / `target_vocabulary`: entries whose expression
 *     or surface is 一期一会 and whose reading is いちきいちえ
 *
 * Dry-run by default; --apply required to write. Idempotent: only rows that
 * still contain the wrong reading are changed.
 *
 * Usage: npm run fix:ichigo-ichie-readings -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface VocabEntry {
  expression?: string;
  surface?: string;
  reading?: string;
  furigana?: string;
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

const PHRASE = '一期一会';
const READING_OLD = 'いちきいちえ';
const READING_NEW = 'いちごいちえ';
const INLINE_OLD = '一[いち]期[き]一会[いちえ]';
const INLINE_NEW = '一[いち]期[ご]一会[いちえ]';
// The gloss "一期は一生" (the 一期 half, explained on its own) is also いちご.
const PART_INLINE_OLD = '一[いち]期[き]は一生[いっしょう]';
const PART_INLINE_NEW = '一[いち]期[ご]は一生[いっしょう]';
const PART_READING_OLD = 'いちきはいっしょう';
const PART_READING_NEW = 'いちごはいっしょう';

function fixVocabList(list: VocabEntry[] | null): { next: VocabEntry[] | null; changed: number } {
  if (!list) return { next: list, changed: 0 };
  let changed = 0;
  const next = list.map((entry) => {
    if ((entry.expression !== PHRASE && entry.surface !== PHRASE) || entry.reading !== READING_OLD) {
      return entry;
    }
    changed += 1;
    const patched: VocabEntry = { ...entry, reading: READING_NEW };
    if (typeof entry.furigana === 'string') {
      patched.furigana = entry.furigana.split(INLINE_OLD).join(INLINE_NEW);
    }
    return patched;
  });
  return { next: changed ? next : list, changed };
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data, error } = await supabase
    .from('sentences')
    .select('id, japanese, inline_reading, reading_only, vocabulary_suggestions, target_vocabulary')
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .ilike('japanese', `%${PHRASE}%`);
  if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);

  const rows = (data ?? []) as unknown as SentenceRow[];
  console.log(`Fetched ${rows.length} sentence(s) containing ${PHRASE}.`);

  let fixed = 0;
  for (const row of rows) {
    const inline = row.inline_reading ?? '';
    const newInline = inline
      .split(INLINE_OLD).join(INLINE_NEW)
      .split(PART_INLINE_OLD).join(PART_INLINE_NEW);

    const readingOnly = row.reading_only ?? '';
    const newReadingOnly = readingOnly
      .split(READING_OLD).join(READING_NEW)
      .split(PART_READING_OLD).join(PART_READING_NEW);

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
    if (sug.changed) console.log(`    vocabulary_suggestions: ${sug.changed} entry(ies) ${READING_OLD} -> ${READING_NEW}`);
    if (tgt.changed) console.log(`    target_vocabulary: ${tgt.changed} entry(ies) ${READING_OLD} -> ${READING_NEW}`);

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
