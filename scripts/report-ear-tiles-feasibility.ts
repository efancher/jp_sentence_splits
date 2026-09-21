/**
 * Read-only: how many sentences can be an Ear Tiles round, why the rest can't,
 * and a sample of the actual tile splits so the chunker can be eyeballed
 * against real data (the Verb Lego lesson: check the generator on prod, not
 * just fixtures). Applies the same rules as the game: vocabulary confirmed,
 * native audio, translation, 4–7 tiles, length caps.
 *
 * Usage: npx tsx scripts/report-ear-tiles-feasibility.ts [sampleCount]
 */
import { earTilesRejection, chunkSentenceIntoTiles } from '../src/lib/earTiles';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function fetchAll(supabase: any, table: string, columns: string) {
  const rows: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is('deleted_at', null)
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  const sampleCount = Number(process.argv[2] ?? 25);
  const supabase = await createScriptSupabaseClient();
  const [sentences, audio, analyses] = await Promise.all([
    fetchAll(supabase, 'sentences', 'id, japanese, translation, vocabulary_suggestions'),
    fetchAll(supabase, 'reference_audio', 'id, sentence_id, duration_ms'),
    fetchAll(supabase, 'analyses', 'sentence_id, vocabulary_review_status'),
  ]);
  const confirmed = new Set(
    analyses.filter((a) => a.vocabulary_review_status === 'confirmed').map((a) => a.sentence_id),
  );
  const audioBySentence = new Map<string, number>();
  for (const a of audio) {
    if (a.sentence_id && !audioBySentence.has(a.sentence_id)) audioBySentence.set(a.sentence_id, a.duration_ms);
  }

  const rejects = new Map<string, number>();
  const eligible: { japanese: string; tiles: string[]; translation: string }[] = [];
  let confirmedWithAudio = 0;
  for (const row of sentences) {
    if (!confirmed.has(row.id) || !audioBySentence.has(row.id)) continue;
    confirmedWithAudio += 1;
    const sentence = {
      japanese: row.japanese,
      translation: row.translation,
      vocabularySuggestions: row.vocabulary_suggestions ?? [],
    };
    const why = earTilesRejection(sentence, audioBySentence.get(row.id)!);
    if (why) {
      rejects.set(why, (rejects.get(why) ?? 0) + 1);
      continue;
    }
    eligible.push({
      japanese: row.japanese,
      tiles: chunkSentenceIntoTiles(sentence)!,
      translation: row.translation,
    });
  }

  console.log(`sentences:                         ${sentences.length}`);
  console.log(`confirmed vocab + native audio:    ${confirmedWithAudio}`);
  console.log(`playable Ear Tiles sentences:      ${eligible.length}`);
  for (const [why, n] of [...rejects].sort((a, b) => b[1] - a[1])) console.log(`  rejected ${why.padEnd(16)} ${n}`);
  const tileCounts = new Map<number, number>();
  for (const e of eligible) tileCounts.set(e.tiles.length, (tileCounts.get(e.tiles.length) ?? 0) + 1);
  console.log(`tile counts: ${[...tileCounts].sort().map(([k, v]) => `${k}:${v}`).join('  ')}`);

  console.log(`\nSample splits (${sampleCount}):`);
  const step = Math.max(1, Math.floor(eligible.length / sampleCount));
  for (let i = 0; i < eligible.length && i < sampleCount * step; i += step) {
    const e = eligible[i]!;
    console.log(`${e.tiles.join(' | ')}    ← ${e.japanese}\n    ${e.translation}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
