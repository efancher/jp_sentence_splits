import 'dotenv/config';

import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

/**
 * One-off diagnostic: list every book whose sourceKey/sourceUrl mentions
 * a given podcast feed host, to check whether pre-migration episodes
 * (imported before commitSeriesEpisodeImport, 01fa81a 2026-09-13) still
 * live as standalone single-chapter books instead of the shared series
 * book — which would explain the podcast picker's "Imported" badge
 * missing them (getSeriesImportedSourceIds only looks at the series
 * book's chapters).
 */
async function main() {
  const needle = process.argv[2];
  if (!needle) {
    throw new Error('Usage: tsx scripts/diagnose-podcast-imported-books.ts <substring>');
  }
  const client = await createScriptSupabaseClient();
  const { data, error } = await client
    .from('books')
    .select('id, title, source_key, source_url, chapters, deleted_at')
    .or(`source_key.ilike.%${needle}%,source_url.ilike.%${needle}%,title.ilike.%${needle}%`);
  if (error) throw error;

  for (const row of data ?? []) {
    console.log(`--- ${row.title} (${row.id}) ---`);
    console.log(`  sourceKey: ${row.source_key}`);
    console.log(`  sourceUrl: ${row.source_url}`);
    console.log(`  deletedAt: ${row.deleted_at}`);
    const chapters = Array.isArray(row.chapters) ? row.chapters : [];
    for (const chapter of chapters) {
      console.log(`  chapter: ${chapter.title} | sourceId: ${chapter.sourceId} | sourceDate: ${chapter.sourceDate}`);
    }
  }
  console.log(`\n${data?.length ?? 0} matching book(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
