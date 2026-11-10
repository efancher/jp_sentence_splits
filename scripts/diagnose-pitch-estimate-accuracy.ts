/**
 * Read-only diagnostic: could a word's accent be *estimated* from its native recording?
 *
 * Leave-one-out test for the idea "learn the speaker's pitch, then guess accents of unknown words". For every
 * citation-form, dictionary-accented word occurrence with a current alignment, the dictionary accent is hidden,
 * the best valid H/L shape is fitted to the measured per-mora pitch (`fitAccentShape`, all shapes allowed), and
 * the result is compared with the dictionary shape. Reports agreement by fit margin / contrast / mora count and
 * per book (`Book.id` is the speaker proxy — there is no per-clip speaker identity). Word-internal only:
 * heiban vs odaka share a shape here (separating them needs the following particle).
 *
 * Gate for building estimated marks: strong-cue agreement of about 70% or more. Nothing is written.
 * Audio/pitch cache: /tmp/pitch-audit-cache (shared with audit-pitch-accent-clips). Needs `ffmpeg`.
 *
 * Usage: npm run diagnose:pitch-estimate-accuracy [-- --limit N] [--exclude <title regex>] [--only <title regex>]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import type { AlignmentResult } from '../src/domain/types';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { isolatedWordMatchRange, isolatedWordSpans } from '../src/lib/isolatedWordRange';
import { segmentIntoMorae } from '../src/lib/mora';
import { isPlausibleClipSpan } from '../src/lib/oddEarOut';
import { extractPitch, type PitchAnalysisPayload } from '../src/lib/pitch';
import { classifyLearnerMorae } from '../src/lib/pitchAccentObservations';
import { expectedPitchShape } from '../src/lib/pitchAccentShape';
import { fitAccentShape } from '../src/lib/pitchShapeFit';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { downloadReferenceClip } from './lib/referenceAudioStorage';

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
interface Obs { bookId: string; moraCount: number; ok: boolean; margin: number; contrast: number }

const pct = (ok: number, n: number) => (n ? `${Math.round((ok / n) * 100)}%` : '—');
const MARGIN_BINS: Array<[string, number, number]> = [['<1', 0, 1], ['1–3', 1, 3], ['3–8', 3, 8], ['≥8', 8, Infinity]];
const CONTRAST_BINS: Array<[string, number, number]> = [['<1.5 st', -Infinity, 1.5], ['1.5–3 st', 1.5, 3], ['≥3 st', 3, Infinity]];
const isStrong = (o: Obs) => o.margin >= 3 && o.contrast >= 1.5;

function table(title: string, obs: Obs[], bins: Array<[string, number, number]>, key: (o: Obs) => number) {
  console.log(`\n${title}`);
  for (const [label, lo, hi] of bins) {
    const list = obs.filter((o) => key(o) >= lo && key(o) < hi);
    console.log(`  ${label.padEnd(10)} n=${String(list.length).padEnd(5)} agree ${pct(list.filter((o) => o.ok).length, list.length)}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
  mkdirSync(CACHE_DIR, { recursive: true });
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [vocab, links, sentences, audioRows, bookSentences, books] = await Promise.all([
    fetchAll(supabase, 'vocabulary_items', 'id, expression, reading, pitch_accent_positions', user.id, (r) => r),
    fetchAll(supabase, 'sentence_vocabulary', 'id, sentence_id, vocabulary_item_id, surface_form', user.id, (r) => r),
    fetchAll(supabase, 'sentences', 'id, japanese', user.id, (r) => r),
    fetchAll<AudioRow>(supabase, 'reference_audio', 'id, sentence_id, storage_path', user.id, (r) => ({
      id: String(r.id), sentenceId: String(r.sentence_id ?? ''), storagePath: (r.storage_path as string | null) ?? null,
    })),
    fetchAll(supabase, 'book_sentences', 'id, book_id, sentence_id, deleted_at', user.id, (r) => r),
    fetchAll(supabase, 'books', 'id, title', user.id, (r) => r),
  ]);
  const vocabById = new Map(vocab.map((v) => [String(v.id), v]));
  const japaneseBySentence = new Map(sentences.map((s) => [String(s.id), String(s.japanese ?? '')]));
  const bookBySentence = new Map<string, string>();
  for (const bs of bookSentences) {
    if (!bs.deleted_at && !bookBySentence.has(String(bs.sentence_id))) bookBySentence.set(String(bs.sentence_id), String(bs.book_id));
  }
  const bookTitle = new Map(books.map((b) => [String(b.id), String(b.title ?? b.id)]));
  const audioBySentence = new Map<string, AudioRow>();
  for (const a of audioRows) if (a.storagePath && !audioBySentence.has(a.sentenceId)) audioBySentence.set(a.sentenceId, a);

  const seen = new Set<string>();
  const candidates: Array<{ link: Record<string, unknown>; audio: AudioRow; item: Record<string, unknown>; japanese: string }> = [];
  for (const link of links) {
    const item = vocabById.get(String(link.vocabulary_item_id));
    const positions = item?.pitch_accent_positions as number[] | null | undefined;
    if (!item || !positions?.length || !link.surface_form || link.surface_form !== item.expression) continue;
    const key = `${item.id}:${link.sentence_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const audio = audioBySentence.get(String(link.sentence_id));
    const japanese = japaneseBySentence.get(String(link.sentence_id));
    if (audio && japanese) candidates.push({ link, audio, item, japanese });
  }
  // --exclude <regex> drops books whose title matches (e.g. multi-speaker podcasts); --only keeps just those.
  const excludeRe = argv.includes('--exclude') ? new RegExp(argv[argv.indexOf('--exclude') + 1]!, 'i') : null;
  const onlyRe = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]!, 'i') : null;
  const titleOf = (sentenceId: unknown) => bookTitle.get(bookBySentence.get(String(sentenceId)) ?? '') ?? '';
  const used = candidates
    .filter((c) => (!excludeRe || !excludeRe.test(titleOf(c.link.sentence_id))) && (!onlyRe || onlyRe.test(titleOf(c.link.sentence_id))))
    .slice(0, limit === Infinity ? undefined : limit);

  const alignmentById = new Map<string, AlignmentResult>();
  const audioIds = [...new Set(used.map((c) => c.audio.id))];
  for (let i = 0; i < audioIds.length; i += 40) {
    const { data, error } = await supabase.from('reference_alignment').select('id, alignment, alignment_version').in('id', audioIds.slice(i, i + 40));
    if (error) throw new Error(`reference_alignment: ${error.message}`);
    for (const row of data ?? []) {
      if (Number(row.alignment_version) === ALIGNMENT_VERSION) alignmentById.set(String(row.id), row.alignment as AlignmentResult);
    }
  }
  console.log(`Candidates with audio: ${candidates.length}`);

  async function pitchFor(audio: AudioRow): Promise<PitchAnalysisPayload | null> {
    const cachePath = `${CACHE_DIR}/${audio.id}.json`;
    if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8')) as PitchAnalysisPayload;
    const { data: blob, error } = await downloadReferenceClip(supabase, audio.storagePath!);
    if (error || !blob) return null;
    try {
      const samples = await decodeToSamples(Buffer.from(await blob.arrayBuffer()));
      const payload = extractPitch({ sampleRate: SAMPLE_RATE, samples, durationSeconds: samples.length / SAMPLE_RATE });
      writeFileSync(cachePath, JSON.stringify(payload));
      return payload;
    } catch {
      return null;
    }
  }

  const obs: Obs[] = [];
  let done = 0;
  for (const { link, audio, item, japanese } of used) {
    done += 1;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${used.length}\r`);
    const moraCount = segmentIntoMorae(String(item.reading)).length;
    if (moraCount < 2) continue;
    const alignment = alignmentById.get(audio.id);
    if (!alignment) continue;
    const span = isolatedWordSpans(alignment.words, japanese, String(link.surface_form))?.wordOnly ?? null;
    if (!span || !isPlausibleClipSpan(span)) continue;
    const matched = isolatedWordMatchRange(alignment.words, japanese, String(link.surface_form));
    if (!matched) continue;
    const pitch = await pitchFor(audio);
    if (!pitch) continue;
    const word = { text: String(link.surface_form), start: matched.startMs / 1000, end: matched.endMs / 1000, phones: [] };
    const classified = classifyLearnerMorae(word, moraCount, pitch, undefined, null);
    if (!classified) continue;
    const fit = fitAccentShape(classified.bucketMeans);
    if (!fit) continue;
    const expected = expectedPitchShape(moraCount, (item.pitch_accent_positions as number[])[0]!).join('');
    obs.push({
      bookId: bookBySentence.get(String(link.sentence_id)) ?? '?',
      moraCount,
      ok: fit.shape.join('') === expected,
      margin: fit.margin,
      contrast: fit.contrastSemitones,
    });
  }

  console.log(`\nEstimated ${obs.length} words (accent hidden). Overall agreement ${pct(obs.filter((o) => o.ok).length, obs.length)}`);
  table('By fit margin (runner-up cost − winner cost, st²):', obs, MARGIN_BINS, (o) => o.margin);
  table('By contrast (high − low):', obs, CONTRAST_BINS, (o) => o.contrast);
  console.log('\nBy mora count:');
  for (const n of [2, 3, 4, 5, 6]) {
    const list = obs.filter((o) => (n === 6 ? o.moraCount >= 6 : o.moraCount === n));
    console.log(`  ${(n === 6 ? '6+' : String(n)).padEnd(4)} n=${String(list.length).padEnd(5)} agree ${pct(list.filter((o) => o.ok).length, list.length)}`);
  }
  const strong = obs.filter(isStrong);
  console.log(`\nStrong cue (margin ≥3 and contrast ≥1.5 st): ${strong.length}/${obs.length} (${pct(strong.length, obs.length)}), agreement ${pct(strong.filter((o) => o.ok).length, strong.length)}   [gate: ≥70%]`);

  console.log('\nPer book (speaker proxy), n≥10:');
  const byBook = new Map<string, Obs[]>();
  for (const o of obs) byBook.set(o.bookId, [...(byBook.get(o.bookId) ?? []), o]);
  for (const [id, list] of [...byBook.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 10) continue;
    const s = list.filter(isStrong);
    console.log(
      `  ${(bookTitle.get(id) ?? id).slice(0, 34).padEnd(36)} n=${String(list.length).padEnd(4)} all ${pct(list.filter((o) => o.ok).length, list.length).padEnd(4)} strong ${pct(s.filter((o) => o.ok).length, s.length)} (n=${s.length})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
