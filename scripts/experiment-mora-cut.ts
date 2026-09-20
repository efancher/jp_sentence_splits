/**
 * Read-only experiment: is cutting a target at its last mora (when it ends
 * inside an aligner token — 生まれ within 生まれた) better than playing the whole
 * token, by round-trip ASR? (docs/STATUS.md 2026-09-20.)
 *
 * Candidates are the links where passing the sentence's reading changes the
 * word-only span (`isolatedWordSpans(..., { inlineReading })` vs without). Both
 * spans get the shipped pad, are cut from the sentence audio, transcribed with
 * large-v3-turbo (`score-pad-variants.py`) and scored against the surface form.
 * Note the token clip contains extra morae by construction, so ASR is expected
 * to hear those (it transcribes 生まれた for 生まれ); similarity to the *surface
 * form* therefore rewards the mora cut when it is right and punishes it when it
 * chops the word — exactly what we want to know. Writes nothing to Supabase.
 *
 * Usage: npx tsx scripts/experiment-mora-cut.ts [--n 100] [--seed 1]
 */
import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AlignmentResult } from '../src/domain/types';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { isolatedWordSpans } from '../src/lib/isolatedWordRange';

import { ffmpegTrimToM4a, ffprobeDurationMs } from './lib/audioClipHelpers';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const MFA_PYTHON = process.env.MFA_PYTHON ?? '/home/ed/miniforge3/envs/mfa/bin/python3.14';
const SCORER = join(dirname(fileURLToPath(import.meta.url)), 'score-pad-variants.py');

interface Scored {
  id: string;
  surfaceForm: string;
  sims: { token: number; mora: number };
  texts: { token: string; mora: string };
}

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};

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

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

async function main() {
  const n = Number(arg('n', '100'));
  const rand = rng(Number(arg('seed', '1')));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const workDir = await mkdtemp(join(tmpdir(), 'mora-cut-'));

  const [sentences, audioRows, links, alignments] = await Promise.all([
    fetchAll(supabase, 'sentences', 'id, japanese, inline_reading', user.id, (r) => ({
      id: String(r.id),
      japanese: String(r.japanese ?? ''),
      inlineReading: String(r.inline_reading ?? ''),
    })),
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

  const sentenceById = new Map(sentences.map((s) => [s.id, s]));
  const audioBySentence = new Map<string, (typeof audioRows)[number]>();
  for (const a of audioRows) if (a.storagePath && !audioBySentence.has(a.sentenceId)) audioBySentence.set(a.sentenceId, a);
  const alignmentByAudio = new Map(
    (alignments.data ?? []).filter((r) => Number(r.alignment_version) === ALIGNMENT_VERSION).map((r) => [String(r.id), r.alignment as AlignmentResult]),
  );

  const candidates = links
    .map((link) => {
      const sentence = sentenceById.get(link.sentenceId);
      const audio = audioBySentence.get(link.sentenceId);
      const alignment = audio && alignmentByAudio.get(audio.id);
      if (!sentence || !audio || !alignment || !link.surfaceForm) return null;
      const token = isolatedWordSpans(alignment.words, sentence.japanese, link.surfaceForm)?.wordOnly;
      const mora = isolatedWordSpans(alignment.words, sentence.japanese, link.surfaceForm, { inlineReading: sentence.inlineReading })?.wordOnly;
      if (!token || !mora) return null;
      const changed = Math.abs(token.startMs - mora.startMs) > 1 || Math.abs(token.endMs - mora.endMs) > 1;
      return changed ? { link, audio, token, mora } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({ c, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c)
    .slice(0, n);

  console.log(`${candidates.length} links where the mora cut differs from the token span. Preparing clips in ${workDir}...`);
  const audioCache = new Map<string, { path: string; durationMs: number }>();
  let prepared = 0;
  const moraDurationMs = new Map<string, number>();
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
    const clamp = (r: { startMs: number; endMs: number }) => ({ startMs: Math.max(0, r.startMs), endMs: Math.min(cached!.durationMs, r.endMs) });
    const ranges = { token: clamp(c.token), mora: clamp(c.mora) };
    if (ranges.mora.endMs - ranges.mora.startMs < 60) continue;
    moraDurationMs.set(c.link.id, ranges.mora.endMs - ranges.mora.startMs);
    for (const label of ['token', 'mora'] as const) {
      const clipFile = `clip-${i}-${label}.m4a`;
      await ffmpegTrimToM4a(cached.path, join(workDir, clipFile), ranges[label].startMs, ranges[label].endMs);
      await appendFile(join(workDir, 'manifest.jsonl'), `${JSON.stringify({ id: c.link.id, surfaceForm: c.link.surfaceForm, label, clipFile, differs: true })}\n`);
    }
    prepared += 1;
  }
  console.log(`${prepared} words prepared. Scoring with large-v3-turbo...`);
  const scored = await runScorer(workDir);

  await writeFile('/tmp/mora-cut-scored.json', JSON.stringify(scored.map((r) => ({ ...r, moraMs: moraDurationMs.get(r.id) })), null, 1));

  // Whisper's stock hallucinations on near-silent or very short audio — a judge failure, not a clip failure.
  const HALLUCINATION = /ご視聴|お会いしましょう|ありがとうございました|次回|チャンネル登録|字幕/;
  const isHallucination = (r: Scored) => HALLUCINATION.test(r.texts.token) || HALLUCINATION.test(r.texts.mora);
  const summarize = (title: string, rows: Scored[]) => {
    const better = rows.filter((r) => r.sims.mora - r.sims.token > 0.05).length;
    const worse = rows.filter((r) => r.sims.token - r.sims.mora > 0.05).length;
    console.log(`${title.padEnd(34)} n=${String(rows.length).padStart(3)}  token=${mean(rows.map((r) => r.sims.token)).toFixed(3)}  mora=${mean(rows.map((r) => r.sims.mora)).toFixed(3)}  mora better ${better} / worse ${worse}`);
  };
  console.log('');
  summarize('All', scored);
  summarize('Excluding hallucinated clips', scored.filter((r) => !isHallucination(r)));
  console.log(`  (${scored.filter((r) => HALLUCINATION.test(r.texts.mora)).length} mora clips vs ${scored.filter((r) => HALLUCINATION.test(r.texts.token)).length} token clips hallucinated)`);
  for (const [label, lo, hi] of [['mora clip < 250 ms', 0, 250], ['mora clip 250–400 ms', 250, 400], ['mora clip >= 400 ms', 400, Infinity]] as const) {
    summarize(label, scored.filter((r) => (moraDurationMs.get(r.id) ?? 0) >= lo && (moraDurationMs.get(r.id) ?? 0) < hi));
  }
  const show = (r: Scored) => `  ${r.surfaceForm}: token=${r.sims.token.toFixed(2)} "${r.texts.token}" | mora=${r.sims.mora.toFixed(2)} "${r.texts.mora}"`;
  const real = scored.filter((r) => !isHallucination(r));
  console.log('\nMora cut clearly better (no hallucination):\n' + real.filter((r) => r.sims.mora - r.sims.token > 0.25).slice(0, 8).map(show).join('\n'));
  console.log('\nMora cut clearly worse (no hallucination):\n' + real.filter((r) => r.sims.token - r.sims.mora > 0.25).slice(0, 10).map(show).join('\n'));
  await rm(workDir, { recursive: true, force: true });
}

main();
