/**
 * Read-only: how are the four grammar_* review cards
 * (grammar_comprehension / grammar_completion / grammar_contrast /
 * grammar_production) actually performing, as evidence for the open
 * ROADMAP question ("Grammar SRS: noticing + in-context reading vs. the
 * isolated drill ladder").
 *
 * Two questions:
 *  1. Leech rate — of grammar_* study items with at least one review, what
 *     fraction have racked up repeat lapses, vs. the same rate for every
 *     other subject/activity type combined (baseline).
 *  2. Self-rating calibration — grammar_comprehension/grammar_contrast/
 *     grammar_production are bare self-ratings (no auto right/wrong check);
 *     grammar_completion is objectively graded. If the self-rated types
 *     skew markedly easier (more "easy"/"good", fewer "again"/"hard") than
 *     the graded sibling, that's a sign the self-rating isn't tracking
 *     real difficulty — the core worry behind treating this as a "metalabel
 *     quiz" rather than real evidence of learning.
 *
 * Usage: npx tsx scripts/report-grammar-card-performance.ts
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

async function fetchAll(supabase: any, table: string, columns: string): Promise<Row[]> {
  const rows: Row[] = [];
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

const GRAMMAR_ACTIVITY_TYPES = [
  'grammar_comprehension',
  'grammar_completion',
  'grammar_contrast',
  'grammar_production',
];
const SELF_RATED = new Set(['grammar_comprehension', 'grammar_contrast', 'grammar_production']);
const GRADED = new Set(['grammar_completion']);
const LEECH_LAPSES_THRESHOLD = 4; // half Anki's default leech threshold of 8 — this app reviews far less volume

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

async function main() {
  const supabase = await createScriptSupabaseClient();

  const [studyItems, reviews, patterns] = await Promise.all([
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type, fsrs_state'),
    fetchAll(supabase, 'reviews', 'study_item_id, rating, timestamp'),
    fetchAll(supabase, 'grammar_patterns', 'id, canonical_name'),
  ]);

  const patternName = new Map(patterns.map((p) => [p.id, p.canonical_name]));

  const reviewsByItem = new Map<string, Row[]>();
  for (const r of reviews) {
    const arr = reviewsByItem.get(r.study_item_id) ?? [];
    arr.push(r);
    reviewsByItem.set(r.study_item_id, arr);
  }

  const grammarItems = studyItems.filter(
    (it) => it.subject_type === 'grammarPattern' && GRAMMAR_ACTIVITY_TYPES.includes(it.activity_type),
  );
  const otherItems = studyItems.filter(
    (it) => !(it.subject_type === 'grammarPattern' && GRAMMAR_ACTIVITY_TYPES.includes(it.activity_type)),
  );

  console.log('=== Volume ===');
  console.log(`grammar_* study items:     ${grammarItems.length}`);
  console.log(`all other study items:     ${otherItems.length}`);
  const byType = new Map<string, number>();
  for (const it of grammarItems) byType.set(it.activity_type, (byType.get(it.activity_type) ?? 0) + 1);
  for (const t of GRAMMAR_ACTIVITY_TYPES) console.log(`  ${t}: ${byType.get(t) ?? 0}`);

  // --- 1. Leech rate ---------------------------------------------------
  function leechStats(items: Row[]) {
    const reviewed = items.filter((it) => (reviewsByItem.get(it.id)?.length ?? 0) > 0);
    const leeches = reviewed.filter((it) => (it.fsrs_state?.lapses ?? 0) >= LEECH_LAPSES_THRESHOLD);
    const totalLapses = reviewed.reduce((sum, it) => sum + (it.fsrs_state?.lapses ?? 0), 0);
    return {
      reviewed: reviewed.length,
      leeches: leeches.length,
      avgLapses: reviewed.length ? totalLapses / reviewed.length : 0,
      leechItems: leeches,
    };
  }

  console.log(`\n=== Leech rate (>= ${LEECH_LAPSES_THRESHOLD} lapses, among reviewed items) ===`);
  const grammarLeech = leechStats(grammarItems);
  const otherLeech = leechStats(otherItems);
  console.log(
    `grammar_* : ${grammarLeech.leeches}/${grammarLeech.reviewed} (${pct(grammarLeech.leeches, grammarLeech.reviewed)}), avg lapses ${grammarLeech.avgLapses.toFixed(2)}`,
  );
  console.log(
    `baseline  : ${otherLeech.leeches}/${otherLeech.reviewed} (${pct(otherLeech.leeches, otherLeech.reviewed)}), avg lapses ${otherLeech.avgLapses.toFixed(2)}`,
  );

  console.log('\nPer grammar activity type:');
  for (const t of GRAMMAR_ACTIVITY_TYPES) {
    const items = grammarItems.filter((it) => it.activity_type === t);
    const stats = leechStats(items);
    console.log(
      `  ${t}: ${stats.leeches}/${stats.reviewed} (${pct(stats.leeches, stats.reviewed)}), avg lapses ${stats.avgLapses.toFixed(2)}`,
    );
  }

  if (grammarLeech.leechItems.length) {
    console.log('\nLeeching patterns (>=' + LEECH_LAPSES_THRESHOLD + ' lapses):');
    for (const it of grammarLeech.leechItems.slice(0, 20)) {
      const name = patternName.get(it.subject_id) ?? it.subject_id;
      console.log(`  ${name} (${it.activity_type}) — lapses ${it.fsrs_state?.lapses}, state ${it.fsrs_state?.state}`);
    }
  }

  // --- 2. Self-rating calibration ---------------------------------------
  console.log('\n=== Rating distribution: self-rated vs. graded grammar cards ===');
  function ratingDist(activityTypes: Set<string>) {
    const items = grammarItems.filter((it) => activityTypes.has(it.activity_type));
    const dist: Record<string, number> = { again: 0, hard: 0, good: 0, easy: 0 };
    let total = 0;
    for (const it of items) {
      for (const r of reviewsByItem.get(it.id) ?? []) {
        if (dist[r.rating] !== undefined) {
          dist[r.rating]++;
          total++;
        }
      }
    }
    return { dist, total };
  }

  const selfRated = ratingDist(SELF_RATED);
  const graded = ratingDist(GRADED);
  function printDist(label: string, d: { dist: Record<string, number>; total: number }) {
    console.log(`${label} (n=${d.total}):`);
    for (const k of ['again', 'hard', 'good', 'easy']) {
      console.log(`  ${k}: ${d.dist[k]} (${pct(d.dist[k], d.total)})`);
    }
  }
  printDist('self-rated (comprehension + contrast + production)', selfRated);
  printDist('graded (completion)', graded);

  const selfPassRate = pct(selfRated.dist.good + selfRated.dist.easy, selfRated.total);
  const gradedPassRate = pct(graded.dist.good + graded.dist.easy, graded.total);
  console.log(`\nself-rated "good"+"easy" rate: ${selfPassRate}`);
  console.log(`graded     "good"+"easy" rate: ${gradedPassRate}`);
  console.log(
    '(if self-rated pass rate is much higher than graded, that is calibration drift — self-rating is not catching what the objective check catches)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
