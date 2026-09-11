/**
 * Read-only: is the free pitch-accent drill (`PitchAccentDrillPage`,
 * `/pitch-accent`) actually moving the needle on the `pitch_accent` SRS
 * card, and what H/L shape confusions show up. Pulls `pitch_drill_attempts`
 * (usage log, docs/STATUS.md) and `reviews`/`study_items` (the `pitch_accent`
 * card's review history, including the `pitch_expected_shape`/
 * `pitch_chosen_shape` columns) straight from Supabase — no export/import,
 * just run this and read the numbers.
 *
 * Usage: npx tsx scripts/report-pitch-drill-effectiveness.ts
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function fetchAll(supabase: any, table: string, columns: string, filter?: (q: any) => any) {
  const rows: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    let query = supabase.from(table).select(columns).is('deleted_at', null);
    if (filter) query = filter(query);
    const { data, error } = await query.range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

/** Monday-anchored ISO week key, e.g. "2026-W37". */
function weekKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const day = (date.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day);
  const jan1 = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((monday.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
  return `${monday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function topShapeConfusions(
  pairs: { expected: string; chosen: string }[],
  limit = 10,
): { expected: string; chosen: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { expected, chosen } of pairs) {
    if (!expected || !chosen || expected === chosen) continue;
    const key = `${expected}\t${chosen}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => {
      const [expected, chosen] = key.split('\t');
      return { expected: expected!, chosen: chosen!, count };
    });
}

async function main() {
  const supabase = await createScriptSupabaseClient();

  const [attempts, studyItems] = await Promise.all([
    fetchAll(
      supabase,
      'pitch_drill_attempts',
      'timestamp, mode, mismatch, expected_shape, measured_shape, focus_triggered',
    ),
    fetchAll(supabase, 'study_items', 'id, activity_type', (q) =>
      q.eq('activity_type', 'pitch_accent'),
    ),
  ]);

  const studyItemIds = studyItems.map((s) => s.id);
  const reviews = studyItemIds.length
    ? await fetchAll(supabase, 'reviews', 'timestamp, rating, pitch_expected_shape, pitch_chosen_shape', (q) =>
        q.in('study_item_id', studyItemIds),
      )
    : [];

  console.log('=== Pitch-accent drill usage ===');
  console.log(`total logged attempts: ${attempts.length}`);
  console.log(`  sentence mode: ${attempts.filter((a) => a.mode === 'sentence').length}`);
  console.log(`  word mode:     ${attempts.filter((a) => a.mode === 'word').length}`);
  console.log(`  via "extra practice" focus queue: ${attempts.filter((a) => a.focus_triggered).length}`);

  console.log('\n=== pitch_accent SRS card review history ===');
  console.log(`total reviews: ${reviews.length}`);

  const weeks = new Map<string, { attempts: number; reviewsGood: number; reviewsTotal: number }>();
  for (const attempt of attempts) {
    const key = weekKey(attempt.timestamp);
    const week = weeks.get(key) ?? { attempts: 0, reviewsGood: 0, reviewsTotal: 0 };
    week.attempts += 1;
    weeks.set(key, week);
  }
  for (const review of reviews) {
    const key = weekKey(review.timestamp);
    const week = weeks.get(key) ?? { attempts: 0, reviewsGood: 0, reviewsTotal: 0 };
    week.reviewsTotal += 1;
    if (review.rating === 'good' || review.rating === 'easy') week.reviewsGood += 1;
    weeks.set(key, week);
  }

  console.log('\n=== Weekly: drill attempts vs. pitch_accent pass-rate ===');
  console.log('week       attempts   reviews   pass-rate');
  for (const [week, data] of [...weeks.entries()].sort()) {
    const passRate = data.reviewsTotal ? `${Math.round((data.reviewsGood / data.reviewsTotal) * 100)}%` : '—';
    console.log(
      `${week}  ${String(data.attempts).padStart(8)}   ${String(data.reviewsTotal).padStart(7)}   ${passRate}`,
    );
  }

  const drillWeeks = [...weeks.values()].filter((w) => w.attempts > 0 && w.reviewsTotal > 0);
  const noDrillWeeks = [...weeks.values()].filter((w) => w.attempts === 0 && w.reviewsTotal > 0);
  const avgPassRate = (list: typeof drillWeeks) =>
    list.length
      ? Math.round(
          (list.reduce((sum, w) => sum + w.reviewsGood / w.reviewsTotal, 0) / list.length) * 100,
        )
      : undefined;
  console.log('\n=== Drill volume vs. pass-rate (weeks with reviews only) ===');
  console.log(`weeks with drill activity:    ${drillWeeks.length}, avg pass-rate: ${avgPassRate(drillWeeks) ?? '—'}%`);
  console.log(`weeks with no drill activity: ${noDrillWeeks.length}, avg pass-rate: ${avgPassRate(noDrillWeeks) ?? '—'}%`);
  console.log('(correlational, not causal — drill usage is self-selected, not randomized.)');

  const confusionPairs = [
    ...reviews
      .filter((r) => r.pitch_expected_shape && r.pitch_chosen_shape)
      .map((r) => ({ expected: r.pitch_expected_shape as string, chosen: r.pitch_chosen_shape as string })),
    ...attempts
      .filter((a) => a.mismatch && a.expected_shape && a.measured_shape)
      .map((a) => ({ expected: a.expected_shape as string, chosen: a.measured_shape as string })),
  ];
  console.log('\n=== Most common H/L shape confusions (expected -> chosen/measured) ===');
  const top = topShapeConfusions(confusionPairs);
  if (top.length === 0) {
    console.log('(none yet)');
  } else {
    for (const { expected, chosen, count } of top) {
      console.log(`${expected} -> ${chosen}  (${count}x)`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
