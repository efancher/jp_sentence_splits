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
import { signalDetection } from '../src/lib/nativeClipPitchAudit';
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
      'timestamp, mode, mismatch, expected_shape, measured_shape, focus_triggered, fall_timing_error_morae, fall_magnitude_ratio',
    ),
    fetchAll(supabase, 'study_items', 'id, activity_type', (q) =>
      q.eq('activity_type', 'pitch_accent'),
    ),
  ]);

  const studyItemIds = studyItems.map((s) => s.id);
  const reviews = studyItemIds.length
    ? await fetchAll(supabase, 'reviews', 'study_item_id, timestamp, rating, assistance, pitch_expected_shape, pitch_chosen_shape', (q) =>
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

  // Baseline: exact-shape accuracy per expected shape (chance for 2-mora
  // words is 50%; watch 'hl'/'lh' first — the basic fall-vs-rise contrast).
  const shaped = reviews.filter((r) => r.pitch_expected_shape && r.pitch_chosen_shape);
  const byShape = new Map<string, { n: number; ok: number }>();
  for (const r of shaped) {
    const row = byShape.get(r.pitch_expected_shape) ?? { n: 0, ok: 0 };
    row.n += 1;
    if (r.pitch_expected_shape === r.pitch_chosen_shape) row.ok += 1;
    byShape.set(r.pitch_expected_shape, row);
  }
  console.log('\n=== Card accuracy by expected H/L shape (exact match) ===');
  for (const [shape, { n, ok }] of [...byShape.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${shape.padEnd(8)} n=${String(n).padEnd(4)} ${Math.round((ok / n) * 100)}%`);
  }

  // Signal detection for the basic 2-mora contrast: d' near 0 = can't tell
  // them apart (not merely biased to one answer). See docs/ROADMAP.md.
  console.log('\n=== Fall vs rise discrimination (2-mora hl vs lh, signal detection) ===');
  const twoMora = shaped.map((r) => ({ expected: r.pitch_expected_shape as string, chosen: r.pitch_chosen_shape as string }));
  const sd = signalDetection(twoMora, 'hl', 'lh');
  if (sd.dPrime === null) {
    console.log('(not enough trials on both sides yet)');
  } else {
    console.log(`hl trials ${sd.signalTrials} (answered hl ${sd.hits}), lh trials ${sd.noiseTrials} (answered hl ${sd.falseAlarms})`);
    console.log(
      `d' = ${sd.dPrime.toFixed(2)}  (0 = chance, ~1 = fair, 2+ = clear)   criterion c = ${sd.criterion!.toFixed(2)}  (<0 leans "hl", >0 leans "lh")`,
    );
  }

  // Reveal-scaffolding usage (2026-09-19): the card logs these as review
  // `assistance` values — no schema of their own. Reviews before that date
  // simply lack them, so "looped" below is only meaningful going forward.
  const has = (r: any, kind: string) => Array.isArray(r.assistance) && r.assistance.includes(kind);
  const pct = (ok: number, n: number) => (n ? `${Math.round((ok / n) * 100)}%` : '—');
  const passed = (r: any) => r.rating === 'good' || r.rating === 'easy';
  const since = reviews.filter((r) => r.timestamp >= '2026-09-19');
  console.log('\n=== Native-word loop before answering (reviews since 2026-09-19) ===');
  for (const [label, group] of [
    ['looped', since.filter((r) => has(r, 'pitch_native_looped'))],
    ['did not loop', since.filter((r) => !has(r, 'pitch_native_looped'))],
  ] as const) {
    console.log(`${label.padEnd(13)} n=${String(group.length).padEnd(4)} pass ${pct(group.filter(passed).length, group.length)}`);
  }

  const misses = since.filter((r) => r.pitch_chosen_shape && r.pitch_chosen_shape !== r.pitch_expected_shape);
  const shown = misses.filter((r) => has(r, 'pitch_contrast_shown'));
  const played = shown.filter((r) => has(r, 'pitch_contrast_played'));
  console.log('\n=== Miss contrast ("what your pick sounds like") ===');
  console.log(`misses since 2026-09-19: ${misses.length}; contrast offered: ${shown.length}; played: ${played.length}`);
  // Next review of the same card after a miss — did seeing/playing the contrast help?
  const nextPass = (group: any[]) => {
    let n = 0;
    let ok = 0;
    for (const miss of group) {
      const next = reviews
        .filter((r) => r.study_item_id === miss.study_item_id && r.timestamp > miss.timestamp)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0];
      if (!next) continue;
      n += 1;
      if (passed(next)) ok += 1;
    }
    return `${pct(ok, n)} (n=${n})`;
  };
  console.log(`next review pass — contrast played:        ${nextPass(played)}`);
  console.log(`next review pass — offered, not played:    ${nextPass(shown.filter((r) => !has(r, 'pitch_contrast_played')))}`);
  console.log(`next review pass — no contrast offered:    ${nextPass(misses.filter((r) => !has(r, 'pitch_contrast_shown')))}`);
  console.log('(correlational — playing the contrast is self-selected.)');

  // Continuous scoring (docs/ROADMAP.md "Continuous scoring in the drill",
  // shipped 2026-09-22): compareFallToNative's fall-timing/magnitude
  // comparison against a real native clip, logged per attempt only when a
  // clip was available — so weekly n here is a subset of the attempt count
  // above, not the same denominator. Shows whether the drill is trending
  // closer to native even on takes whose categorical shape still mismatches.
  const continuous = attempts.filter(
    (a) => a.fall_timing_error_morae !== null && a.fall_timing_error_morae !== undefined,
  );
  console.log('\n=== Continuous fall-timing/magnitude vs. native clip ===');
  console.log(`attempts with a native clip to compare against: ${continuous.length} of ${attempts.length}`);
  if (continuous.length === 0) {
    console.log('(none yet)');
  } else {
    const continuousWeeks = new Map<string, { n: number; timingSum: number; ratios: number[] }>();
    for (const a of continuous) {
      const key = weekKey(a.timestamp);
      const week = continuousWeeks.get(key) ?? { n: 0, timingSum: 0, ratios: [] };
      week.n += 1;
      week.timingSum += a.fall_timing_error_morae as number;
      if (a.fall_magnitude_ratio !== null && a.fall_magnitude_ratio !== undefined) {
        week.ratios.push(a.fall_magnitude_ratio as number);
      }
      continuousWeeks.set(key, week);
    }
    console.log('week       n     avg mora off   avg magnitude ratio');
    for (const [week, data] of [...continuousWeeks.entries()].sort()) {
      const avgRatio = data.ratios.length
        ? `${Math.round((data.ratios.reduce((sum, r) => sum + r, 0) / data.ratios.length) * 100)}%`
        : '—';
      console.log(
        `${week}  ${String(data.n).padStart(3)}   ${(data.timingSum / data.n).toFixed(2).padStart(11)}   ${avgRatio}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
