/**
 * Read-only: pool-size feasibility for the candidate "game" activities in
 * docs/ROADMAP.md ("Short games"). Each game needs an `eligible()` pool
 * before it's worth building, and at least one (the minimal-pair warm-up)
 * has already turned out to have a near-zero corpus.
 *
 *  - Word Detective: confirmed vocab words met in 2+ distinct sentences
 *    (a clue ladder needs a second context), ideally with audio, and how
 *    many of those are weakness targets (a real FSRS lapse).
 *  - Odd Ear Out: same-mora-count pitch-carrying words with isolatable
 *    audio, grouped by in-word accent shape — a round needs 3 of one shape
 *    plus 1 of another. Heiban/odaka collapse to one in-word shape
 *    (`expectedPitchShape`), matching the existing minimal-pair rule.
 *    Proficiency is deliberately NOT filtered here, so this is an upper
 *    bound on the pool.
 *  - Particle Puzzle: sentences whose stored UniDic tokens include
 *    particles (助詞), split by token source, to check imports aren't
 *    token-poor.
 *
 * Usage: npx tsx scripts/report-game-feasibility.ts
 */
import { expectedPitchShape } from '../src/lib/pitchAccentShape';
import { segmentIntoMorae } from '../src/lib/mora';
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

// reference_alignment has no deleted_at column.
async function fetchAllNoDelete(supabase: any, table: string, columns: string) {
  const rows: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

function histogram(values: number[], caps: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < caps.length; i += 1) {
    const lo = caps[i]!;
    const hi = caps[i + 1];
    const n = values.filter((v) => v >= lo && (hi === undefined || v < hi)).length;
    out.push(`${hi === undefined ? `${lo}+` : hi - lo === 1 ? `${lo}` : `${lo}-${hi - 1}`}: ${n}`);
  }
  return out.join('   ');
}

async function main() {
  const supabase = await createScriptSupabaseClient();
  const [links, vocab, sentences, audio, alignment, studyItems] = await Promise.all([
    fetchAll(supabase, 'sentence_vocabulary', 'sentence_id, vocabulary_item_id, surface_form'),
    fetchAll(supabase, 'vocabulary_items', 'id, expression, reading, pitch_accent_positions'),
    fetchAll(supabase, 'sentences', 'id, translation, vocabulary_suggestions'),
    fetchAll(supabase, 'reference_audio', 'id, sentence_id'),
    fetchAllNoDelete(supabase, 'reference_alignment', 'id'),
    fetchAll(supabase, 'study_items', 'subject_type, subject_id, activity_type, fsrs_state'),
  ]);

  const confirmedLinks = links.filter((l) => l.surface_form);
  const sentenceById = new Map(sentences.map((s) => [s.id, s]));
  const audioSentenceIds = new Set(audio.filter((a) => a.sentence_id).map((a) => a.sentence_id));
  const alignedIds = new Set(alignment.map((a) => a.id));
  const alignedAudioSentenceIds = new Set(
    audio.filter((a) => a.sentence_id && alignedIds.has(a.id)).map((a) => a.sentence_id),
  );

  // ---- Word Detective -------------------------------------------------
  const sentencesByWord = new Map<string, Set<string>>();
  for (const l of confirmedLinks) {
    const set = sentencesByWord.get(l.vocabulary_item_id) ?? new Set<string>();
    set.add(l.sentence_id);
    sentencesByWord.set(l.vocabulary_item_id, set);
  }
  const wordIds = [...sentencesByWord.keys()];
  const counts = wordIds.map((id) => sentencesByWord.get(id)!.size);
  const withAudioCounts = wordIds.map(
    (id) => [...sentencesByWord.get(id)!].filter((s) => audioSentenceIds.has(s)).length,
  );
  const withTranslation = wordIds.map(
    (id) =>
      [...sentencesByWord.get(id)!].filter((s) => (sentenceById.get(s)?.translation ?? '').trim())
        .length,
  );

  const lapsedWordIds = new Set(
    studyItems
      .filter((s) => s.subject_type === 'vocabularyItem' && (s.fsrs_state?.lapses ?? 0) > 0)
      .map((s) => s.subject_id),
  );
  const hasCard = new Set(
    studyItems.filter((s) => s.subject_type === 'vocabularyItem').map((s) => s.subject_id),
  );

  console.log('== Word Detective ==');
  console.log(`confirmed vocab words:                      ${wordIds.length}`);
  console.log(`distinct sentences per word:                ${histogram(counts, [1, 2, 3, 5])}`);
  console.log(
    `words with 2+ sentences:                    ${counts.filter((c) => c >= 2).length}`,
  );
  console.log(
    `  ...2+ sentences that have audio:          ${withAudioCounts.filter((c) => c >= 2).length}`,
  );
  console.log(
    `  ...2+ sentences that have a translation:  ${withTranslation.filter((c) => c >= 2).length}`,
  );
  const leechesEligible = wordIds.filter(
    (id, i) => lapsedWordIds.has(id) && counts[i]! >= 2,
  ).length;
  console.log(`weakness targets (lapsed) total:            ${lapsedWordIds.size}`);
  console.log(`  ...of those with 2+ sentences:            ${leechesEligible}`);
  console.log(
    `no-card backlog words with 2+ sentences:    ${
      wordIds.filter((id, i) => !hasCard.has(id) && counts[i]! >= 2).length
    }`,
  );

  // ---- Odd Ear Out ----------------------------------------------------
  const vocabById = new Map(vocab.map((v) => [v.id, v]));
  const byMoraShape = new Map<number, Map<string, Set<string>>>();
  let pitchCarrying = 0;
  const seenItem = new Set<string>();
  for (const l of confirmedLinks) {
    const item = vocabById.get(l.vocabulary_item_id);
    const positions: number[] | null = item?.pitch_accent_positions ?? null;
    if (!item || !positions || positions.length === 0) continue;
    if (l.surface_form !== item.expression) continue; // citation form only
    if (!seenItem.has(item.id)) {
      seenItem.add(item.id);
      pitchCarrying += 1;
    }
    if (!alignedAudioSentenceIds.has(l.sentence_id)) continue; // needs aligned audio to isolate the word
    const moraCount = segmentIntoMorae(item.reading).length;
    if (moraCount < 2) continue;
    const shape = expectedPitchShape(moraCount, positions[0]!).join('');
    const byShape = byMoraShape.get(moraCount) ?? new Map<string, Set<string>>();
    const set = byShape.get(shape) ?? new Set<string>();
    set.add(item.id);
    byShape.set(shape, set);
    byMoraShape.set(moraCount, byShape);
  }
  const isolatableItems = new Set<string>();
  for (const byShape of byMoraShape.values())
    for (const set of byShape.values()) for (const id of set) isolatableItems.add(id);
  const isolatable = isolatableItems.size;

  console.log('\n== Odd Ear Out (upper bound: proficiency NOT filtered) ==');
  console.log(`confirmed pitch-carrying words (citation form): ${pitchCarrying}`);
  console.log(`  ...with aligned audio, 2+ morae:              ${isolatable}`);
  let feasibleMoraGroups = 0;
  for (const [moraCount, byShape] of [...byMoraShape].sort((a, b) => a[0] - b[0])) {
    const shapes = [...byShape].map(([shape, set]) => `${shape}:${set.size}`).join('  ');
    const majority = [...byShape.values()].some((s) => s.size >= 3);
    const minority = [...byShape.values()].reduce((n, s) => n + s.size, 0) >= 4 && byShape.size >= 2;
    const ok = majority && minority;
    if (ok) feasibleMoraGroups += 1;
    console.log(`  ${moraCount} morae ${ok ? '[round OK]' : '[too thin]'}  ${shapes}`);
  }
  console.log(`mora lengths that can form a 3+1 round: ${feasibleMoraGroups}`);

  // ---- Particle Puzzle ------------------------------------------------
  let sentencesWithSuggestions = 0;
  let sentencesWith2Particles = 0;
  let sentencesWith3Particles = 0;
  const bySource = new Map<string, { total: number; particles: number }>();
  const posSamples = new Map<string, number>();
  for (const s of sentences) {
    const tokens: any[] = Array.isArray(s.vocabulary_suggestions) ? s.vocabulary_suggestions : [];
    if (tokens.length === 0) continue;
    sentencesWithSuggestions += 1;
    let particles = 0;
    for (const t of tokens) {
      const src = t.source ?? 'unknown';
      const entry = bySource.get(src) ?? { total: 0, particles: 0 };
      entry.total += 1;
      if (typeof t.pos === 'string' && t.pos.startsWith('助詞')) {
        entry.particles += 1;
        particles += 1;
        posSamples.set(t.pos, (posSamples.get(t.pos) ?? 0) + 1);
      }
      bySource.set(src, entry);
    }
    if (particles >= 2) sentencesWith2Particles += 1;
    if (particles >= 3) sentencesWith3Particles += 1;
  }
  console.log('\n== Particle Puzzle ==');
  console.log(`sentences total:                          ${sentences.length}`);
  console.log(`sentences with stored suggestion tokens:  ${sentencesWithSuggestions}`);
  console.log(`  ...with 2+ particle tokens:             ${sentencesWith2Particles}`);
  console.log(`  ...with 3+ particle tokens:             ${sentencesWith3Particles}`);
  for (const [src, { total, particles }] of bySource)
    console.log(`  token source "${src}": ${total} tokens, ${particles} particles`);
  console.log(
    `  particle POS breakdown: ${[...posSamples].map(([p, n]) => `${p}=${n}`).join('  ') || '(none)'}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
