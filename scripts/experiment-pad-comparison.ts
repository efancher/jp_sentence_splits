/**
 * Read-only experiment: which word-clip padding is best by round-trip ASR?
 * (docs/STATUS.md 2026-09-20.) Varies the ceilings/slack of the gap-aware pad
 * (`padSpan` in src/lib/isolatedWordRange.ts) against the shipped default.
 *
 * For a seeded random sample of confirmed word occurrences (current-version
 * alignment, word span found) it cuts the same underlying word-only match once
 * per variant in VARIANTS, transcribes each clip with large-v3-turbo
 * (`score-pad-variants.py`, `mfa` conda env) and scores it against the surface
 * form. `differs` marks words where any variant's range differs from the
 * default's — only those can separate the variants, so results are reported on
 * that subset as well as overall. Writes nothing to Supabase.
 *
 * Usage: npx tsx scripts/experiment-pad-comparison.ts [--n 100] [--seed 1] [--keep DIR]
 */
import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AlignmentResult } from '../src/domain/types';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { isolatedWordMatchRange, padSpan, type PadConfig } from '../src/lib/isolatedWordRange';

import { ffmpegTrimToM4a, ffprobeDurationMs } from './lib/audioClipHelpers';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const MFA_PYTHON = process.env.MFA_PYTHON ?? '/home/ed/miniforge3/envs/mfa/bin/python3.14';
const SCORER = join(dirname(fileURLToPath(import.meta.url)), 'score-pad-variants.py');
/** `current` is the shipped default; the rest are candidates. `none` is the raw match. */
const VARIANTS: Record<string, PadConfig> = {
  current: { onsetMs: 60, tailMs: 120, slackMs: 30 },
  'c30-60-s30': { onsetMs: 30, tailMs: 60, slackMs: 30 },
  'c30-60-s0': { onsetMs: 30, tailMs: 60, slackMs: 0 },
  none: { onsetMs: 0, tailMs: 0, slackMs: 0 },
};
const LABELS = Object.keys(VARIANTS);
const BASELINE = 'current';

interface Scored {
  id: string;
  surfaceForm: string;
  differs: boolean;
  sims: Record<string, number>;
  texts: Record<string, string>;
}

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};

/** Small seeded PRNG (mulberry32) so a run is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runScorer(dir: string): Promise<Scored[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(MFA_PYTHON, [SCORER, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`scorer exited ${code}`));
      resolve(JSON.parse(out.trim().split('\n').pop() ?? '[]'));
    });
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function report(title: string, rows: Scored[]) {
  console.log(`\n${title} (n=${rows.length})`);
  if (rows.length === 0) return;
  for (const label of LABELS) console.log(`  mean similarity  ${label.padEnd(11)} ${mean(rows.map((r) => r.sims[label]!)).toFixed(3)}`);
  for (const label of LABELS.filter((l) => l !== BASELINE)) {
    const better = rows.filter((r) => r.sims[label]! - r.sims[BASELINE]! > 0.05).length;
    const worse = rows.filter((r) => r.sims[BASELINE]! - r.sims[label]! > 0.05).length;
    console.log(`  ${label.padEnd(11)} vs ${BASELINE}: ${better} better, ${worse} worse, ${rows.length - better - worse} within 0.05`);
  }
}

async function main() {
  const n = Number(arg('n', '100'));
  const rand = rng(Number(arg('seed', '1')));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const workDir = arg('keep', '') || (await mkdtemp(join(tmpdir(), 'pad-comparison-')));

  const [sentences, audioRows, links, alignments] = await Promise.all([
    fetchAll(supabase, 'sentences', 'id, japanese', user.id, (r) => ({ id: String(r.id), japanese: String(r.japanese ?? '') })),
    fetchAll(supabase, 'reference_audio', 'id, sentence_id, storage_path', user.id, (r) => ({
      id: String(r.id),
      sentenceId: String(r.sentence_id),
      storagePath: r.storage_path ? String(r.storage_path) : null,
    }), 'sentence_id'),
    fetchAll(supabase, 'sentence_vocabulary', 'id, sentence_id, surface_form', user.id, (r) => ({
      id: String(r.id),
      sentenceId: String(r.sentence_id),
      surfaceForm: String(r.surface_form ?? ''),
    })),
    supabase.from('reference_alignment').select('id, alignment, alignment_version').eq('owner_id', user.id),
  ]);
  if (alignments.error) throw new Error(alignments.error.message);

  const japanese = new Map(sentences.map((s) => [s.id, s.japanese]));
  const audioBySentence = new Map<string, (typeof audioRows)[number]>();
  for (const a of audioRows) if (a.storagePath && !audioBySentence.has(a.sentenceId)) audioBySentence.set(a.sentenceId, a);
  const alignmentByAudio = new Map(
    (alignments.data ?? []).filter((r) => Number(r.alignment_version) === ALIGNMENT_VERSION).map((r) => [String(r.id), r.alignment as AlignmentResult]),
  );

  // Candidates whose span resolves; shuffled, then the first n taken.
  const candidates = links
    .map((link) => {
      const audio = audioBySentence.get(link.sentenceId);
      const alignment = audio && alignmentByAudio.get(audio.id);
      const text = japanese.get(link.sentenceId);
      if (!audio || !alignment || !text || !link.surfaceForm) return null;
      const match = isolatedWordMatchRange(alignment.words, text, link.surfaceForm);
      return match ? { link, audio, match, text, words: alignment.words } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({ c, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c)
    .slice(0, n);

  console.log(`${candidates.length} occurrences sampled. Preparing clips in ${workDir}...`);
  const audioCache = new Map<string, { path: string; durationMs: number }>();
  let prepared = 0;
  for (const [i, c] of candidates.entries()) {
    let cached = audioCache.get(c.audio.id);
    if (!cached) {
      const { data: blob, error } = await supabase.storage.from('reference-audio').download(c.audio.storagePath!);
      if (error || !blob) continue;
      const path = join(workDir, `${c.audio.id}.m4a`);
      await writeFile(path, Buffer.from(await blob.arrayBuffer()));
      cached = { path, durationMs: await ffprobeDurationMs(path) };
      audioCache.set(c.audio.id, cached);
    }
    const clamp = (s: number, e: number) => ({ startMs: Math.max(0, s), endMs: Math.min(cached!.durationMs, e) });
    const ranges = Object.fromEntries(
      Object.entries(VARIANTS).map(([label, config]) => {
        const padded = padSpan(c.words, c.match.startMs, c.match.endMs, config);
        return [label, clamp(padded.startMs, padded.endMs)];
      }),
    ) as Record<string, { startMs: number; endMs: number }>;
    const base = ranges[BASELINE]!;
    const differs = LABELS.some(
      (l) => Math.abs(ranges[l]!.startMs - base.startMs) > 1 || Math.abs(ranges[l]!.endMs - base.endMs) > 1,
    );
    if (LABELS.some((l) => ranges[l]!.endMs - ranges[l]!.startMs < 60)) continue;
    for (const label of LABELS) {
      const clipFile = `clip-${i}-${label}.m4a`;
      await ffmpegTrimToM4a(cached.path, join(workDir, clipFile), ranges[label]!.startMs, ranges[label]!.endMs);
      await appendFile(join(workDir, 'manifest.jsonl'), `${JSON.stringify({ id: c.link.id, surfaceForm: c.link.surfaceForm, label, clipFile, differs })}\n`);
    }
    prepared += 1;
  }
  console.log(`${prepared} words prepared. Scoring with large-v3-turbo...`);
  const scored = await runScorer(workDir);

  report('All sampled words', scored);
  report('Only words where some variant differs from the default', scored.filter((r) => r.differs));
  const show = (r: Scored, label: string) =>
    `  ${r.surfaceForm}: current=${r.sims[BASELINE]!.toFixed(2)} "${r.texts[BASELINE]}" | ${label}=${r.sims[label]!.toFixed(2)} "${r.texts[label]}"`;
  for (const label of LABELS.filter((l) => l !== BASELINE && l !== 'none')) {
    const rows = scored.filter((r) => r.differs);
    console.log(`\n${label} clearly better than current:\n` + rows.filter((r) => r.sims[label]! - r.sims[BASELINE]! > 0.25).slice(0, 5).map((r) => show(r, label)).join('\n'));
    console.log(`\n${label} clearly worse than current:\n` + rows.filter((r) => r.sims[BASELINE]! - r.sims[label]! > 0.25).slice(0, 5).map((r) => show(r, label)).join('\n'));
  }
  if (!arg('keep', '')) await rm(workDir, { recursive: true, force: true });
}

main();
