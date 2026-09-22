/**
 * Backfill `sentence_vocabulary.pitch_cue_separation_semitones` — how far
 * apart a citation-form occurrence's native clip actually holds its
 * dictionary-expected high vs. low morae, in semitones (`measureNativeWord`'s
 * `separationSemitones`, the same measure `scripts/audit-pitch-accent-clips.ts`
 * reports and the drill's own scorer buckets by). ReviewPage's `pitch_accent`
 * card builder reads this to skip an occurrence whose clip doesn't actually
 * carry the cue it's meant to teach, and to prefer the strongest-cue
 * occurrence when a word has several (docs/ROADMAP.md "Gate/rank
 * pitch_accent cards by measured cue strength") — the same "don't show a
 * card that can't populate its scaffolding" stance already applied to
 * missing audio and phrase-final heiban/odaka.
 *
 * Scope matches ReviewPage's own citation-form preference: only links where
 * `surface_form` equals the vocabulary item's dictionary `expression`.
 * Inflected occurrences are left unmeasured (column stays null) rather than
 * guessed — null reads as "unknown," which the review-side gate treats as
 * "don't block," the same conservative default used everywhere else a
 * measurement can be missing.
 *
 * Idempotent: skips links that already have a stored value unless --force
 * (e.g. after a scorer or alignment change makes re-measuring worthwhile).
 * Audio + pitch tracks are cached under /tmp/pitch-audit-cache, shared with
 * the audit script, so a --force re-run after already auditing is fast.
 *
 * Usage: npx tsx scripts/backfill-pitch-cue-strength.ts [--apply] [--limit N] [--force]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import type { AlignmentResult } from '../src/domain/types';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { isolatedWordMatchRange, isolatedWordSpans } from '../src/lib/isolatedWordRange';
import { phonesToMoraIntervals, type MoraInterval } from '../src/lib/moraTiming';
import { segmentIntoMorae } from '../src/lib/mora';
import { measureNativeWord } from '../src/lib/nativeClipPitchAudit';
import { isPlausibleClipSpan } from '../src/lib/oddEarOut';
import { extractPitch, type PitchAnalysisPayload } from '../src/lib/pitch';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const STORAGE_BUCKET = 'reference-audio';
const CACHE_DIR = '/tmp/pitch-audit-cache';
const SAMPLE_RATE = 16_000;

async function decodeToSamples(bytes: Buffer): Promise<Float32Array> {
  const tmpPath = `${CACHE_DIR}/_decode-${process.pid}.bin`;
  writeFileSync(tmpPath, bytes);
  const samples = await new Promise<Float32Array>((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-v', 'error', '-y', '-i', tmpPath, '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1']);
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 200)}`));
      const all = Buffer.concat(chunks);
      const copy = new Uint8Array(all.byteLength);
      copy.set(all);
      resolve(new Float32Array(copy.buffer));
    });
  });
  if (samples.length < SAMPLE_RATE / 10) throw new Error('decoded no audio');
  return samples;
}

interface AudioRow { id: string; sentenceId: string; storagePath: string | null }

/** Mirrors `scripts/audit-pitch-accent-clips.ts`'s EXACT_MORAE path — always on here. */
function targetMoraIntervals(words: AlignmentResult['words'], span: { startMs: number; endMs: number }, moraCount: number): MoraInterval[] | null {
  const from = span.startMs / 1000 - 0.005;
  const to = span.endMs / 1000 + 0.005;
  const inside = words.filter((w) => w.text && !w.text.startsWith('<') && w.start >= from && w.end <= to);
  const all: MoraInterval[] = [];
  for (const w of inside) {
    const intervals = phonesToMoraIntervals(w.phones);
    if (!intervals) return null;
    all.push(...intervals);
  }
  return all.length === moraCount ? all : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const force = argv.includes('--force');
  const limitArg = argv[argv.indexOf('--limit') + 1];
  const limit = argv.includes('--limit') && limitArg ? Number(limitArg) : Infinity;
  mkdirSync(CACHE_DIR, { recursive: true });

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [vocab, links, sentences, audioRows] = await Promise.all([
    fetchAll(supabase, 'vocabulary_items', 'id, expression, reading, pitch_accent_positions', user.id, (r) => r),
    fetchAll(supabase, 'sentence_vocabulary', 'id, sentence_id, vocabulary_item_id, surface_form, pitch_cue_separation_semitones', user.id, (r) => r),
    fetchAll(supabase, 'sentences', 'id, japanese', user.id, (r) => r),
    fetchAll<AudioRow>(supabase, 'reference_audio', 'id, sentence_id, storage_path', user.id, (r) => ({
      id: String(r.id),
      sentenceId: String(r.sentence_id ?? ''),
      storagePath: (r.storage_path as string | null) ?? null,
    })),
  ]);

  const vocabById = new Map(vocab.map((v) => [String(v.id), v]));
  const japaneseBySentence = new Map(sentences.map((s) => [String(s.id), String(s.japanese ?? '')]));
  const audioBySentence = new Map<string, AudioRow>();
  for (const audio of audioRows) if (audio.storagePath && !audioBySentence.has(audio.sentenceId)) audioBySentence.set(audio.sentenceId, audio);

  const alignmentById = new Map<string, AlignmentResult>();
  async function loadAlignments(audioIds: string[]) {
    for (let i = 0; i < audioIds.length; i += 40) {
      const { data, error } = await supabase
        .from('reference_alignment')
        .select('id, alignment, alignment_version')
        .in('id', audioIds.slice(i, i + 40));
      if (error) throw new Error(`reference_alignment: ${error.message}`);
      for (const row of data ?? []) {
        if (Number(row.alignment_version) === ALIGNMENT_VERSION) alignmentById.set(String(row.id), row.alignment as AlignmentResult);
      }
    }
  }

  interface Candidate { linkId: string; audio: AudioRow; item: Record<string, unknown>; japanese: string; surfaceForm: string }
  const candidates: Candidate[] = [];
  let skippedInflected = 0;
  let skippedAlreadyMeasured = 0;
  let skippedNoAudio = 0;
  for (const link of links) {
    const item = vocabById.get(String(link.vocabulary_item_id));
    const positions = item?.pitch_accent_positions as number[] | null | undefined;
    if (!item || !positions?.length || !link.surface_form) continue;
    if (link.surface_form !== item.expression) { skippedInflected += 1; continue; }
    if (!force && link.pitch_cue_separation_semitones !== null && link.pitch_cue_separation_semitones !== undefined) {
      skippedAlreadyMeasured += 1;
      continue;
    }
    const audio = audioBySentence.get(String(link.sentence_id));
    const japanese = japaneseBySentence.get(String(link.sentence_id));
    if (!audio || !japanese) { skippedNoAudio += 1; continue; }
    candidates.push({ linkId: String(link.id), audio, item, japanese, surfaceForm: String(link.surface_form) });
  }
  const scoped = candidates.slice(0, limit === Infinity ? undefined : limit);
  await loadAlignments([...new Set(scoped.map((c) => c.audio.id))]);
  console.log(
    `${links.length} link(s); ${scoped.length} to measure ` +
      `(skipped ${skippedInflected} inflected, ${skippedAlreadyMeasured} already measured, ${skippedNoAudio} no audio/text).`,
  );

  const pitchByAudio = new Map<string, PitchAnalysisPayload>();
  async function pitchFor(audio: AudioRow): Promise<PitchAnalysisPayload | null> {
    const hit = pitchByAudio.get(audio.id);
    if (hit) return hit;
    const cachePath = `${CACHE_DIR}/${audio.id}.json`;
    if (existsSync(cachePath)) {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as PitchAnalysisPayload;
      pitchByAudio.set(audio.id, cached);
      return cached;
    }
    const { data: blob, error } = await supabase.storage.from(STORAGE_BUCKET).download(audio.storagePath!);
    if (error || !blob) return null;
    try {
      const samples = await decodeToSamples(Buffer.from(await blob.arrayBuffer()));
      const payload = extractPitch({ sampleRate: SAMPLE_RATE, samples, durationSeconds: samples.length / SAMPLE_RATE });
      writeFileSync(cachePath, JSON.stringify(payload));
      pitchByAudio.set(audio.id, payload);
      return payload;
    } catch {
      return null;
    }
  }

  let measured = 0;
  let noSignal = 0;
  let unusableSpan = 0;
  let updated = 0;
  const failures: string[] = [];
  for (const [index, candidate] of scoped.entries()) {
    if ((index + 1) % 50 === 0) process.stdout.write(`  …${index + 1}/${scoped.length}\r`);
    const reading = String(candidate.item.reading);
    const moraCount = segmentIntoMorae(reading).length;
    if (moraCount < 2) continue;
    const alignment = alignmentById.get(candidate.audio.id);
    if (!alignment) { unusableSpan += 1; continue; }
    const span = isolatedWordSpans(alignment.words, candidate.japanese, candidate.surfaceForm)?.wordOnly ?? null;
    if (!span || !isPlausibleClipSpan(span)) { unusableSpan += 1; continue; }
    const matched = isolatedWordMatchRange(alignment.words, candidate.japanese, candidate.surfaceForm);
    if (!matched) { unusableSpan += 1; continue; }
    const pitch = await pitchFor(candidate.audio);
    if (!pitch) { unusableSpan += 1; continue; }
    const position = (candidate.item.pitch_accent_positions as number[])[0]!;
    const moraIntervals = targetMoraIntervals(alignment.words, matched, moraCount);
    const measurement = measureNativeWord({ pitch, span: matched, surfaceForm: candidate.surfaceForm, moraCount, position, moraIntervals });
    if (!measurement || measurement.separationSemitones === null) { noSignal += 1; continue; }
    measured += 1;
    const value = Math.round(measurement.separationSemitones * 100) / 100;
    if (apply) {
      const { error } = await supabase
        .from('sentence_vocabulary')
        .update({ pitch_cue_separation_semitones: value })
        .eq('id', candidate.linkId);
      if (error) {
        failures.push(`${candidate.linkId} (${candidate.item.expression}): ${error.message}`);
        continue;
      }
      updated += 1;
    }
  }

  console.log(
    `\nMeasured ${measured} clip(s) (no usable span/pitch: ${unusableSpan}, measured but no voiced signal: ${noSignal}).`,
  );
  if (apply) {
    console.log(`Updated ${updated} row(s).`);
    if (failures.length) console.log(`Failures:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  } else {
    console.log('Dry run — re-run with --apply to write pitch_cue_separation_semitones.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
