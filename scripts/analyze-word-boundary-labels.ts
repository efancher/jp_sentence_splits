/**
 * Scores the automatic word-boundary estimators against the hand labels made in
 * `/label-word-audio` (docs/ROADMAP.md "Word-audio ground truth"). Read-only.
 *
 * Reads the file(s) saved by the labelling page's "Save labels" button (several
 * files — e.g. from a phone and a laptop — are merged; a label present in more
 * than one keeps its newest copy), then prints, for the unbiased RANDOM sample
 * only unless --all is given:
 *   - each estimator's signed error (+ = late) and typical miss per edge, and the
 *     share of edges within 25 / 50 ms;
 *   - the same per book (the speaker proxy) — is the bias consistent across
 *     books, or does it depend on who is talking?
 *   - a pad calibration: how much onset/tail pad would have covered 75% / 90% of
 *     the mora cut's misses, next to the current defaults;
 *   - token vs mora, split by whether the mora cut was short (<250 ms).
 *
 * Usage: npx tsx scripts/analyze-word-boundary-labels.ts <labels.json> [more.json ...] [--all]
 */
import { readFileSync } from 'node:fs';

import type { WordBoundaryLabel } from '../src/domain/types';
import { parseLabelExports } from '../src/lib/wordBoundaryLabelExport';
import {
  edgeErrors,
  percentile,
  summarizeErrors,
  type EstimatorName,
} from '../src/lib/wordBoundaryLabels';

const CURRENT_PAD = { onsetMs: 30, tailMs: 60 };

const f = (n: number) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${Math.round(n)}` : '—');
const p = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—');

function row(name: string, labels: WordBoundaryLabel[], estimator: EstimatorName) {
  const e = edgeErrors(labels, estimator);
  const s = summarizeErrors(e.start);
  const t = summarizeErrors(e.end);
  if (s.n === 0) return `  ${name.padEnd(18)} (no data)`;
  return (
    `  ${name.padEnd(18)} n=${String(s.n).padStart(3)}  bias ${f(s.medianMs)} / ${f(t.medianMs)} ms   ` +
    `typical miss ${Math.round(s.medianAbsMs)} / ${Math.round(t.medianAbsMs)} ms   ` +
    `within 25: ${p(s.within25)} / ${p(t.within25)}   within 50: ${p(s.within50)} / ${p(t.within50)}   (start / end)`
  );
}

async function main() {
  const all = process.argv.includes('--all');
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/analyze-word-boundary-labels.ts <labels.json> [more.json ...] [--all]');
    console.error('(Save the file from the labelling page: Settings → Label word audio → Save labels.)');
    process.exit(1);
  }
  const labels = parseLabelExports(files.map((file) => readFileSync(file, 'utf8')));
  const scored = labels.filter((l) => l.verdict !== 'skipped');
  const sample = all ? scored : scored.filter((l) => l.sampleKind === 'random');

  const skipped = labels.filter((l) => l.verdict === 'skipped');
  const skipCounts = new Map<string, number>();
  for (const l of skipped) skipCounts.set(l.skipReason ?? '?', (skipCounts.get(l.skipReason ?? '?') ?? 0) + 1);
  console.log(`${labels.length} labels: ${scored.length} scored (${scored.filter((l) => l.sampleKind === 'random').length} random), ${skipped.length} skipped ${[...skipCounts].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`Analysing ${all ? 'all scored labels' : 'the random sample only'} (n=${sample.length}); errors are estimator − label, ms, + = late.\n`);
  if (sample.length === 0) return;

  console.log('Estimators (unpadded word span):');
  console.log(row('whole token', sample, 'token'));
  console.log(row('mora cut', sample, 'mora'));
  console.log(row('shipped (padded)', sample, 'shipped'));

  const short = (l: WordBoundaryLabel) => !!l.estimates.mora && l.estimates.mora.endMs - l.estimates.mora.startMs < 250;
  console.log('\nMora cut vs whole token, by mora-cut length:');
  for (const [name, keep] of [['mora cut < 250 ms', short], ['mora cut >= 250 ms', (l: WordBoundaryLabel) => !short(l)]] as const) {
    const part = sample.filter(keep);
    console.log(row(`${name} (mora)`, part, 'mora'));
    console.log(row(`${name} (token)`, part, 'token'));
  }

  // The squashed-alignment guard (docs/STATUS.md 2026-09-20): does the flag actually mark the bad ones?
  const flagged = sample.filter((l) => l.estimates.unreliable === true);
  const unflagged = sample.filter((l) => l.estimates.unreliable === false);
  const unknown = sample.length - flagged.length - unflagged.length;
  if (flagged.length + unflagged.length > 0) {
    console.log(`\nSquashed-alignment guard (labels made since it shipped; ${unknown} older labels have no flag):`);
    console.log(row('flagged (app falls back)', flagged, 'mora'));
    console.log(row('not flagged', unflagged, 'mora'));
    const bigMiss = (l: WordBoundaryLabel) => !!l.label && !!l.estimates.mora && Math.max(Math.abs(l.estimates.mora.startMs - l.label.startMs), Math.abs(l.estimates.mora.endMs - l.label.endMs)) >= 250;
    console.log(`  misses of 250 ms or more: ${flagged.filter(bigMiss).length} of ${flagged.length} flagged, ${unflagged.filter(bigMiss).length} of ${unflagged.length} not flagged`);
  }

  console.log('\nPer book (mora cut) — does the bias depend on the source?');
  const byBook = new Map<string, WordBoundaryLabel[]>();
  for (const l of sample) byBook.set(l.bookId ?? '(none)', [...(byBook.get(l.bookId ?? '(none)') ?? []), l]);
  for (const [book, ls] of [...byBook].sort((a, b) => b[1].length - a[1].length)) console.log(row(book.slice(0, 18), ls, 'mora'));

  const e = edgeErrors(sample, 'mora');
  // Onset pad is needed where the estimated start is LATE (positive error); tail pad where the estimated end is EARLY (negative).
  const needOnset = e.start.map((x) => Math.max(0, x));
  const needTail = e.end.map((x) => Math.max(0, -x));
  console.log('\nPad calibration for the mora cut (pad that would have covered the miss):');
  console.log(`  onset: p75 ${Math.round(percentile(needOnset, 0.75))} ms, p90 ${Math.round(percentile(needOnset, 0.9))} ms   (current ceiling ${CURRENT_PAD.onsetMs})`);
  console.log(`  tail : p75 ${Math.round(percentile(needTail, 0.75))} ms, p90 ${Math.round(percentile(needTail, 0.9))} ms   (current ceiling ${CURRENT_PAD.tailMs})`);
  console.log('  (a pad can never exceed the gap to the neighbouring word, so read these as ceilings)');

  const secs = scored.map((l) => l.elapsedMs / 1000);
  console.log(`\nLabelling speed: median ${Math.round(percentile(secs, 0.5))} s per item, ${scored.filter((l) => l.verdict === 'clean').length} accepted as-is.`);
}

main();
