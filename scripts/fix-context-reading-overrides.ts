/**
 * One-time correction for three known unidic-lite mis-readings, all found
 * while triaging learner card-issue reports (npm run issues:list):
 *
 * - 日本/日本語 read にっぽん(ご) instead of the overwhelmingly standard
 *   spoken にほん(ご) — a report on 日本語コンテッペイ。("Nihongo con Teppei",
 *   the podcast's own title) flagged this, and it turned out every one of
 *   42 corpus sentences containing 日本 got にっぽん. The one real exception
 *   is the political party name 日本維新の会, whose official reading is
 *   にっぽんいしんのかい — those 3 sentences are left untouched.
 * - 時々 read じじ instead of ときどき (sent_ec71312e) — one sentence, a
 *   different corpus sentence with the same word already read it correctly.
 * - 高原 read たかはら (the surname reading) instead of こうげん
 *   ("highland/plateau", the sense actually used in context) in
 *   sent_cc7e28a5 — a duplicate vocabulary_items row for 高原/こうげん
 *   already exists, so this also repoints that sentence's
 *   sentence_vocabulary link and retires the wrong duplicate rather than
 *   updating its reading in place (would collide with the uniqueness
 *   constraint on (expression, reading)).
 *
 * `server/youtube-mining/app/readings.py` READING_OVERRIDES now also maps
 * 日本 -> にほん so future mining doesn't reintroduce the first bug; this
 * script fixes the rows already written before that change.
 *
 * Dry-run by default; --apply required to write. Idempotent: only rows that
 * still contain the wrong reading are selected.
 *
 * Usage: npm run fix:context-reading-overrides -- [--apply]
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

// The official party name 日本維新の会 keeps にっぽん — never touch these.
const NIPPON_ISHIN_EXCEPTIONS = new Set(['sent_66b57214', 'sent_35ae0c27', 'sent_e077bc70']);

function replaceVocabReading(
  list: VocabEntry[] | null,
  expression: string,
  oldReading: string,
  newReading: string,
): { next: VocabEntry[] | null; changed: number } {
  if (!list) return { next: list, changed: 0 };
  let changed = 0;
  const next = list.map((entry) => {
    const matchesExpr = entry.expression === expression || entry.surface === expression;
    if (matchesExpr && entry.reading === oldReading) {
      changed += 1;
      return { ...entry, reading: newReading };
    }
    return entry;
  });
  return { next: changed ? next : list, changed };
}

// Applies one (inline furigana, reading_only, vocab-list) fix to the
// sentence's *current* working state, so multiple fixes on the same
// sentence thread through in sequence instead of each starting fresh from
// the original row (which would let a later fix silently drop an earlier
// one on the rare sentence that needs more than one).
function applySentenceFix(
  state: {
    inlineReading: string;
    readingOnly: string;
    vocabularySuggestions: VocabEntry[] | null;
    targetVocabulary: VocabEntry[] | null;
  },
  inlineOld: string,
  inlineNew: string,
  readingOnlyOld: string,
  readingOnlyNew: string,
  vocabExpression: string,
  vocabOldReading: string,
  vocabNewReading: string,
): boolean {
  const inlineHit = state.inlineReading.includes(inlineOld);
  if (!inlineHit) return false;

  state.inlineReading = state.inlineReading.split(inlineOld).join(inlineNew);
  if (state.readingOnly.includes(readingOnlyOld)) {
    state.readingOnly = state.readingOnly.split(readingOnlyOld).join(readingOnlyNew);
  }
  const sug = replaceVocabReading(state.vocabularySuggestions, vocabExpression, vocabOldReading, vocabNewReading);
  const tgt = replaceVocabReading(state.targetVocabulary, vocabExpression, vocabOldReading, vocabNewReading);
  if (sug.changed) state.vocabularySuggestions = sug.next;
  if (tgt.changed) state.targetVocabulary = tgt.next;
  return true;
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
    .or(
      'inline_reading.ilike.%日本[にっぽん]%,inline_reading.ilike.%時々[じじ]%,inline_reading.ilike.%高原[たかはら]%',
    );
  if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);

  const rows = (data ?? []) as unknown as SentenceRow[];
  console.log(`Fetched ${rows.length} candidate sentence(s).`);

  let fixed = 0;
  for (const row of rows) {
    if (NIPPON_ISHIN_EXCEPTIONS.has(row.id)) {
      console.log(`\n  ${row.id}  ${row.japanese}  (skipped — 日本維新の会 keeps にっぽん)`);
      continue;
    }

    const state = {
      inlineReading: row.inline_reading ?? '',
      readingOnly: row.reading_only ?? '',
      vocabularySuggestions: row.vocabulary_suggestions,
      targetVocabulary: row.target_vocabulary,
    };
    const before = { inline: state.inlineReading, readingOnly: state.readingOnly };

    applySentenceFix(state, '日本[にっぽん]', '日本[にほん]', 'にっぽん', 'にほん', '日本', 'にっぽん', 'にほん');
    applySentenceFix(state, '時々[じじ]', '時々[ときどき]', 'じじ', 'ときどき', '時々', 'じじ', 'ときどき');
    applySentenceFix(state, '高原[たかはら]', '高原[こうげん]', 'たかはら', 'こうげん', '高原', 'たかはら', 'こうげん');

    if (state.inlineReading === before.inline && state.readingOnly === before.readingOnly) continue;

    const merged: Record<string, unknown> = {
      inline_reading: state.inlineReading,
      reading_only: state.readingOnly,
      vocabulary_suggestions: state.vocabularySuggestions,
      target_vocabulary: state.targetVocabulary,
    };

    fixed += 1;
    console.log(`\n  ${row.id}  ${row.japanese}`);
    console.log(`    inline_reading -> "${state.inlineReading}"`);
    console.log(`    reading_only   -> "${state.readingOnly}"`);

    if (apply) {
      const { error: updateError } = await supabase.from('sentences').update(merged).eq('id', row.id);
      if (updateError) throw new Error(`Failed to update sentence ${row.id}: ${updateError.message}`);
    }
  }
  console.log(`\n${fixed} sentence(s) ${apply ? 'fixed' : 'would be fixed'}.`);

  // vocabulary_items table rows.
  const vocabFixes: { expression: string; oldReading: string; newReading: string }[] = [
    { expression: '日本', oldReading: 'にっぽん', newReading: 'にほん' },
    { expression: '日本語', oldReading: 'にっぽんご', newReading: 'にほんご' },
  ];
  for (const { expression, oldReading, newReading } of vocabFixes) {
    const { data: item, error: itemError } = await supabase
      .from('vocabulary_items')
      .select('id, expression, reading')
      .eq('owner_id', user.id)
      .eq('expression', expression)
      .eq('reading', oldReading)
      .is('deleted_at', null)
      .maybeSingle();
    if (itemError) throw new Error(`Failed to fetch vocabulary_item ${expression}: ${itemError.message}`);
    if (!item) continue;
    console.log(`\nvocabulary_items: ${expression} "${oldReading}" -> "${newReading}" (${item.id})`);
    if (apply) {
      const { error: updateError } = await supabase
        .from('vocabulary_items')
        .update({ reading: newReading })
        .eq('id', item.id);
      if (updateError) throw new Error(`Failed to update vocabulary_item ${item.id}: ${updateError.message}`);
    }
  }

  // 高原/たかはら duplicate: repoint its sentence_vocabulary link to the
  // existing correct 高原/こうげん item, then retire the duplicate.
  const { data: wrongItem } = await supabase
    .from('vocabulary_items')
    .select('id')
    .eq('owner_id', user.id)
    .eq('expression', '高原')
    .eq('reading', 'たかはら')
    .is('deleted_at', null)
    .maybeSingle();
  const { data: correctItem } = await supabase
    .from('vocabulary_items')
    .select('id')
    .eq('owner_id', user.id)
    .eq('expression', '高原')
    .eq('reading', 'こうげん')
    .is('deleted_at', null)
    .maybeSingle();
  if (wrongItem && correctItem) {
    const { data: links } = await supabase
      .from('sentence_vocabulary')
      .select('id')
      .eq('vocabulary_item_id', wrongItem.id)
      .is('deleted_at', null);
    const { data: studyItems } = await supabase
      .from('study_items')
      .select('id')
      .eq('subject_id', wrongItem.id)
      .is('deleted_at', null);
    console.log(
      `\n高原 duplicate: repointing ${links?.length ?? 0} sentence_vocabulary link(s) from ` +
        `${wrongItem.id} (たかはら) to ${correctItem.id} (こうげん); retiring duplicate. ` +
        `${studyItems?.length ?? 0} study_item(s) on the duplicate (none expected).`,
    );
    if (apply) {
      for (const link of links ?? []) {
        const { error: linkError } = await supabase
          .from('sentence_vocabulary')
          .update({ vocabulary_item_id: correctItem.id })
          .eq('id', link.id);
        if (linkError) throw new Error(`Failed to repoint sentence_vocabulary ${link.id}: ${linkError.message}`);
      }
      for (const studyItem of studyItems ?? []) {
        const { error: studyError } = await supabase
          .from('study_items')
          .update({ subject_id: correctItem.id })
          .eq('id', studyItem.id);
        if (studyError) throw new Error(`Failed to repoint study_item ${studyItem.id}: ${studyError.message}`);
      }
      const { error: deleteError } = await supabase
        .from('vocabulary_items')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', wrongItem.id);
      if (deleteError) throw new Error(`Failed to retire duplicate vocabulary_item ${wrongItem.id}: ${deleteError.message}`);
    }
  }

  if (!apply) console.log('\nDry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
