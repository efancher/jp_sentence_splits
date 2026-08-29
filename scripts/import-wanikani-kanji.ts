/**
 * Bulk-imports the WaniKani kanji catalog into Supabase `kanji`.
 * Catalog ingestion (every non-hidden kanji subject), not personal SRS
 * progress — re-runnable, idempotent on `character`.
 *
 * Usage: npm run import:wanikani-kanji
 */
import { kanjiSchema } from '../src/domain/schemas';

import { requireEnv } from './lib/env';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { fetchWanikaniKanjiSubjects, wanikaniSubjectToKanjiFields } from './lib/wanikani';

const UPSERT_BATCH_SIZE = 500;
const SELECT_PAGE_SIZE = 1000;

async function fetchExistingCharacterIds(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('kanji')
      .select('id, character')
      .eq('owner_id', ownerId)
      .is('deleted_at', null)
      .range(from, from + SELECT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch existing kanji: ${error.message}`);
    for (const row of data ?? []) {
      map.set(row.character as string, row.id as string);
    }
    if (!data || data.length < SELECT_PAGE_SIZE) break;
    from += SELECT_PAGE_SIZE;
  }
  return map;
}

async function main() {
  const token = requireEnv('WANIKANI_API_TOKEN');
  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  console.log('Fetching WaniKani kanji catalog and existing rows...');
  const [subjects, existingIds] = await Promise.all([
    fetchWanikaniKanjiSubjects(token),
    fetchExistingCharacterIds(supabase, user.id),
  ]);
  console.log(`Fetched ${subjects.length} non-hidden kanji subjects.`);
  console.log(`Found ${existingIds.size} existing kanji rows for this owner.`);

  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  const rows = subjects
    .map(wanikaniSubjectToKanjiFields)
    .filter((fields) => fields !== null)
    .map((fields) => {
      const existingId = existingIds.get(fields.character);
      if (existingId) updated += 1;
      else created += 1;
      const id = existingId ?? `kanji_${crypto.randomUUID()}`;
      const parsed = kanjiSchema.parse({
        id,
        character: fields.character,
        meanings: fields.meanings,
        onyomi: fields.onyomi,
        kunyomi: fields.kunyomi,
        nanori: fields.nanori,
        meaningMnemonic: fields.meaningMnemonic ?? undefined,
        meaningHint: fields.meaningHint ?? undefined,
        readingMnemonic: fields.readingMnemonic ?? undefined,
        readingHint: fields.readingHint ?? undefined,
        externalId: fields.externalId,
        createdAt: now,
        updatedAt: now,
      });
      return {
        id: parsed.id,
        owner_id: user.id,
        character: parsed.character,
        meanings: parsed.meanings,
        onyomi: parsed.onyomi,
        kunyomi: parsed.kunyomi,
        nanori: parsed.nanori,
        meaning_mnemonic: parsed.meaningMnemonic ?? null,
        meaning_hint: parsed.meaningHint ?? null,
        reading_mnemonic: parsed.readingMnemonic ?? null,
        reading_hint: parsed.readingHint ?? null,
        external_id: parsed.externalId,
      };
    });

  // Conflict target is `id` (the real, non-partial primary key), not
  // `owner_id,character` — `kanji_owner_character_uidx` is a partial index
  // (`where deleted_at is null`), and Postgres's ON CONFLICT arbiter
  // inference doesn't match partial indexes unless the same predicate is
  // repeated in the conflict clause, which PostgREST's upsert has no way to
  // express. Using `id` works because it's looked up and reused above for
  // every character that already exists, so this is still a character-keyed
  // upsert in effect — just routed through the column Postgres can actually
  // use as an arbiter.
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from('kanji').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`Upsert failed on batch starting at ${i}: ${error.message}`);
  }

  console.log(`Done. ${created} created, ${updated} updated, ${rows.length} total.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
