/**
 * Backfills `vocabulary_items.meaning_mnemonic` / `reading_mnemonic` from
 * WaniKani vocabulary subjects, for items with no mnemonic yet — surfaced
 * only as optional scaffolding on review cards (`ReviewPage`'s "Show
 * mnemonic").
 *
 * Matches on `expression` (against a WK vocabulary subject's `characters`),
 * using `reading` as a tiebreaker when more than one WK subject shares a
 * spelling (homophones). Only the ~6.5k words in WaniKani's catalog get
 * filled; everything else stays blank and is retried harmlessly next run.
 *
 * The raw WaniKani payloads are cached in `wanikani_subjects` first
 * (incremental `updated_after` pull), so a re-run — or the usual dry-run
 * then --apply — doesn't re-page the whole catalog. `--skip-wk-sync` reads
 * straight from that cache without touching the WaniKani API (no token
 * needed). Dry-run by default; --apply required to write. Idempotent: only
 * items missing both mnemonics are selected.
 *
 * Usage: WANIKANI_API_TOKEN=... npm run backfill:wanikani-mnemonics -- [--apply] [--skip-wk-sync]
 */
import { requireEnv } from './lib/env';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import {
  wanikaniVocabSubjectToMnemonics,
  type VocabMnemonics,
  type WkVocabSubject,
} from './lib/wanikani';
import {
  readCachedWanikaniSubjects,
  syncWanikaniSubjectCache,
} from './lib/wanikaniCache';

const VOCAB_TYPES = ['vocabulary', 'kana_vocabulary'];

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
}

async function fetchItemsMissingMnemonics(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<VocabularyItemRow[]> {
  const all = await fetchAll(
    supabase,
    'vocabulary_items',
    'id, expression, reading, meaning_mnemonic, reading_mnemonic',
    ownerId,
    (row) => ({
      id: String(row.id),
      expression: String(row.expression),
      reading: String(row.reading ?? ''),
      meaningMnemonic: String(row.meaning_mnemonic ?? ''),
      readingMnemonic: String(row.reading_mnemonic ?? ''),
    }),
  );
  return all
    .filter((row) => !row.meaningMnemonic.trim() && !row.readingMnemonic.trim())
    .map(({ id, expression, reading }) => ({ id, expression, reading }));
}

/** Picks the best WK subject for an item: exact reading match wins, else the first for that spelling. */
function pickMatch(
  candidates: VocabMnemonics[] | undefined,
  reading: string,
): VocabMnemonics | null {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const byReading = candidates.find((c) => c.readings.includes(reading));
  return byReading ?? candidates[0];
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const skipWkSync = argv.includes('--skip-wk-sync');
  const token = skipWkSync ? '' : requireEnv('WANIKANI_API_TOKEN');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  if (skipWkSync) {
    console.log('Skipping WaniKani API sync — reading vocabulary subjects from the cache.');
  } else {
    console.log('Syncing WaniKani vocabulary subjects into the cache...');
    const { fetched } = await syncWanikaniSubjectCache(supabase, user.id, token, VOCAB_TYPES);
    console.log(`  ${fetched} subject(s) changed since last sync.`);
  }

  const [items, subjects] = await Promise.all([
    fetchItemsMissingMnemonics(supabase, user.id),
    readCachedWanikaniSubjects<WkVocabSubject>(supabase, user.id, VOCAB_TYPES),
  ]);
  console.log(
    `Found ${items.length} item(s) with no mnemonic. Read ${subjects.length} WK vocabulary subjects from the cache.`,
  );
  if (!items.length) return;

  const byCharacters = new Map<string, VocabMnemonics[]>();
  for (const subject of subjects) {
    const mnemonics = wanikaniVocabSubjectToMnemonics(subject);
    if (!mnemonics) continue;
    const list = byCharacters.get(mnemonics.characters) ?? [];
    list.push(mnemonics);
    byCharacters.set(mnemonics.characters, list);
  }

  let matched = 0;
  let notFound = 0;
  for (const item of items) {
    const match = pickMatch(byCharacters.get(item.expression), item.reading);
    if (!match) {
      notFound += 1;
      continue;
    }
    matched += 1;
    const parts = [
      match.meaningMnemonic ? 'meaning' : null,
      match.readingMnemonic ? 'reading' : null,
    ].filter(Boolean);
    console.log(`  ${item.expression} [${item.reading}] — ${parts.join(' + ')}`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({
          meaning_mnemonic: match.meaningMnemonic,
          reading_mnemonic: match.readingMnemonic,
        })
        .eq('id', item.id);
      if (error) {
        throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${matched} item(s) ${apply ? 'updated' : 'would be updated'}, ${notFound} had no WaniKani match.`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
