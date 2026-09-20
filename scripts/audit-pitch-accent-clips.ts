/**
 * Read-only audit: do the native clips behind the `pitch_accent` card actually
 * realize the dictionary accent, and does your accuracy track how strong the
 * cue is in the clip? (docs/ROADMAP.md "Pitch-accent analysis tools".)
 *
 * For every confirmed, citation-form occurrence of a pitch-carrying word that
 * has a reference recording and a current-version alignment, this cuts out the
 * word's own span, measures its per-mora pitch with the *same rule the drill
 * scores learners with* (`classifyLearnerMorae`), and reports:
 *   1. Agreement — how often the native clip's measured high/low shape equals
 *      the dictionary shape (word-internal only; heiban vs odaka needs the
 *      particle and isn't measured here).
 *   2. Cue strength — mean(expected-high) − mean(expected-low) in semitones;
 *      small or negative means the cue is weak/absent in that clip.
 *   3. Your accuracy vs cue strength — each shape-tagged `pitch_accent` review
 *      joined to its clip (exact via `context_sentence_id` on reviews since
 *      2026-09-19, else the mean over that word's clips), binned by separation.
 *   4. Whether the words you miss share a property (voiceless consonant?).
 *   5. Per-word table incl. the clips most worth gating/dropping.
 *
 * Audio is downloaded from Supabase storage once and the pitch track cached in
 * /tmp/pitch-audit-cache, so re-runs are quick. Needs `ffmpeg` on PATH.
 *
 * Usage: npx tsx scripts/audit-pitch-accent-clips.ts [--limit N] [--tsv out.tsv]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import type { AlignmentResult } from '../src/domain/types';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { isolatedWordMatchRange, isolatedWordSpans } from '../src/lib/isolatedWordRange';
import { phonesToMoraIntervals, type MoraInterval } from '../src/lib/moraTiming';
import { segmentIntoMorae } from '../src/lib/mora';
import {
  accuracyBySeparation,
  measureNativeWord,
  type NativeWordMeasurement,
} from '../src/lib/nativeClipPitchAudit';
import { isPlausibleClipSpan } from '../src/lib/oddEarOut';
import { extractPitch, type PitchAnalysisPayload } from '../src/lib/pitch';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const STORAGE_BUCKET = 'reference-audio';
const CACHE_DIR = '/tmp/pitch-audit-cache';
const SAMPLE_RATE = 16_000;
/** Below this separation a clip's cue is treated as weak. */
const WEAK_SEPARATION_ST = 1.5;

/** Kana whose consonant is voiceless (no pitch during it): か/さ/た/は/ぱ rows, っ, and the palatal/affricate ones. */
const VOICELESS_KANA = /[かきくけこさしすせそたちつてとはひふへほぱぴぷぺぽっ]/u;

/** m4a keeps its index at the end of the file, so ffmpeg can't demux it from a pipe — decode from a temp file. */
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
interface Clip {
  audioId: string;
  sentenceId: string;
  vocabularyItemId: string;
  expression: string;
  reading: string;
  position: number;
  measurement: NativeWordMeasurement;
}

/**
 * The target word's measured mora intervals from the aligner tokens inside its span — only when every
 * token's phones parse and they add up to exactly `moraCount` (else null → equal-width buckets).
 * Used when EXACT_MORAE=1, to compare the two bucketings against the dictionary.
 */
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

const pct = (ok: number, n: number) => (n ? `${Math.round((ok / n) * 100)}%` : '—');
const median = (values: number[]) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

async function main() {
  const argv = process.argv.slice(2);
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
  const tsvPath = argv.includes('--tsv') ? argv[argv.indexOf('--tsv') + 1]! : '/tmp/pitch-audit-clips.tsv';
  mkdirSync(CACHE_DIR, { recursive: true });

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [vocab, links, sentences, audioRows] = await Promise.all([
    fetchAll(supabase, 'vocabulary_items', 'id, expression, reading, pitch_accent_positions', user.id, (r) => r),
    fetchAll(supabase, 'sentence_vocabulary', 'id, sentence_id, vocabulary_item_id, surface_form', user.id, (r) => r),
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
  // reference_alignment has no deleted_at, and its JSON is big: fetch by id in small chunks, only for recordings we need.
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

  // One candidate per (word, sentence): citation form, with audio + alignment.
  const seen = new Set<string>();
  const candidates: Array<{ link: Record<string, unknown>; audio: AudioRow; item: Record<string, unknown>; japanese: string }> = [];
  let skippedNoAudioOrAlign = 0;
  for (const link of links) {
    const item = vocabById.get(String(link.vocabulary_item_id));
    const positions = item?.pitch_accent_positions as number[] | null | undefined;
    if (!item || !positions?.length || !link.surface_form || link.surface_form !== item.expression) continue;
    const key = `${item.id}:${link.sentence_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const audio = audioBySentence.get(String(link.sentence_id));
    const japanese = japaneseBySentence.get(String(link.sentence_id));
    if (!audio || !japanese) {
      skippedNoAudioOrAlign += 1;
      continue;
    }
    candidates.push({ link, audio, item, japanese });
  }
  await loadAlignments([...new Set(candidates.slice(0, limit === Infinity ? undefined : limit).map((c) => c.audio.id))]);
  console.log(`Eligible citation-form occurrences: ${candidates.length} (skipped ${skippedNoAudioOrAlign}: no audio/date numerals; clips without a current alignment are dropped below)`);

  // Pitch tracks (cached), then per-clip measurement.
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

  const clips: Clip[] = [];
  let unmeasurableSpan = 0;
  let exactUsed = 0;
  let noPitch = 0;
  let done = 0;
  for (const { link, audio, item, japanese } of candidates.slice(0, limit === Infinity ? undefined : limit)) {
    done += 1;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${candidates.length}\r`);
    const reading = String(item.reading);
    const moraCount = segmentIntoMorae(reading).length;
    if (moraCount < 2) continue;
    const alignment = alignmentById.get(audio.id);
    if (!alignment) { unmeasurableSpan += 1; continue; }
    const span = isolatedWordSpans(alignment.words, japanese, String(link.surface_form))?.wordOnly ?? null;
    if (!span || !isPlausibleClipSpan(span)) { unmeasurableSpan += 1; continue; }
    const matched = isolatedWordMatchRange(alignment.words, japanese, String(link.surface_form));
    if (!matched) { unmeasurableSpan += 1; continue; }
    const pitch = await pitchFor(audio);
    if (!pitch) { noPitch += 1; continue; }
    const position = (item.pitch_accent_positions as number[])[0]!;
    const moraIntervals = process.env.EXACT_MORAE ? targetMoraIntervals(alignment.words, matched, moraCount) : null;
    if (moraIntervals) exactUsed += 1;
    const measurement = measureNativeWord({ pitch, span: matched, surfaceForm: String(link.surface_form), moraCount, position, moraIntervals });
    if (!measurement) continue;
    clips.push({
      audioId: audio.id,
      sentenceId: String(link.sentence_id),
      vocabularyItemId: String(item.id),
      expression: String(item.expression),
      reading,
      position,
      measurement,
    });
  }
  console.log(`\nMeasured ${clips.length} clips (span unusable: ${unmeasurableSpan}, no audio/pitch: ${noPitch}).${process.env.EXACT_MORAE ? `  Exact mora intervals used for ${exactUsed}.` : ''}`);

  // ---- 1 & 2: agreement + cue strength ----
  const measured = clips.filter((c) => c.measurement.agrees !== null);
  const agreeing = measured.filter((c) => c.measurement.agrees);
  console.log('\n=== 1. Do native clips realize the dictionary shape? (word-internal, learner-scoring rule) ===');
  console.log(`measurable: ${measured.length}/${clips.length}   agree with dictionary: ${agreeing.length} (${pct(agreeing.length, measured.length)})`);
  const groups = new Map<string, Clip[]>();
  for (const c of measured) {
    const key = `${c.measurement.moraCount}-mora ${c.measurement.expectedShape}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  console.log('shape group           n    agree   median cue (st)   weak cue (<1.5 st)');
  for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 14)) {
    const seps = list.map((c) => c.measurement.separationSemitones).filter((v): v is number => v !== null);
    const weak = seps.filter((v) => v < WEAK_SEPARATION_ST).length;
    console.log(
      `${key.padEnd(20)} ${String(list.length).padStart(4)}   ${pct(list.filter((c) => c.measurement.agrees).length, list.length).padStart(4)}    ${median(seps).toFixed(1).padStart(6)}            ${pct(weak, seps.length)}`,
    );
  }
  const allSeps = measured.map((c) => c.measurement.separationSemitones).filter((v): v is number => v !== null);
  console.log(`overall median cue ${median(allSeps).toFixed(1)} st; weak (<${WEAK_SEPARATION_ST} st or inverted): ${pct(allSeps.filter((v) => v < WEAK_SEPARATION_ST).length, allSeps.length)} of ${allSeps.length}`);

  // ---- 3: your accuracy vs cue strength ----
  const studyItems = await fetchAll(supabase, 'study_items', 'id, subject_id, subject_type, activity_type', user.id, (r) => r);
  const pitchItems = studyItems.filter((s) => s.activity_type === 'pitch_accent');
  const itemToVocab = new Map(pitchItems.map((s) => [String(s.id), String(s.subject_id)]));
  const reviews: Array<Record<string, unknown>> = [];
  const ids = [...itemToVocab.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('reviews')
        .select('study_item_id, timestamp, rating, context_sentence_id, pitch_expected_shape, pitch_chosen_shape')
        .in('study_item_id', ids.slice(i, i + 100))
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      reviews.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  const clipsByVocab = new Map<string, Clip[]>();
  for (const c of clips) clipsByVocab.set(c.vocabularyItemId, [...(clipsByVocab.get(c.vocabularyItemId) ?? []), c]);

  const joined: Array<{ vocabId: string; correct: boolean; sep: number | null; exact: boolean; voiceless: boolean; shape: string }> = [];
  for (const review of reviews) {
    if (!review.pitch_expected_shape || !review.pitch_chosen_shape) continue;
    const vocabId = itemToVocab.get(String(review.study_item_id));
    if (!vocabId) continue;
    const wordClips = clipsByVocab.get(vocabId) ?? [];
    const exactClip = review.context_sentence_id ? wordClips.find((c) => c.sentenceId === review.context_sentence_id) : undefined;
    const used = exactClip ? [exactClip] : wordClips;
    const seps = used.map((c) => c.measurement.separationSemitones).filter((v): v is number => v !== null);
    const reading = String(vocabById.get(vocabId)?.reading ?? '');
    joined.push({
      vocabId,
      correct: review.pitch_expected_shape === review.pitch_chosen_shape,
      sep: seps.length ? seps.reduce((a, b) => a + b, 0) / seps.length : null,
      exact: !!exactClip,
      voiceless: VOICELESS_KANA.test(reading),
      shape: String(review.pitch_expected_shape),
    });
  }
  const withClip = joined.filter((j) => j.sep !== null);
  console.log('\n=== 3. Your card accuracy vs the clip\'s measured cue strength ===');
  console.log(`${joined.length} shape-tagged reviews; ${withClip.length} joined to a measured clip (${withClip.filter((j) => j.exact).length} exact via context sentence, rest = mean over the word's clips).`);
  // Chance = 1 / (moraCount + 1) answer choices; longer words have lower chance, so compare each bin to its own.
  const bins = accuracyBySeparation(
    withClip.map((j) => ({ separationSemitones: j.sep, correct: j.correct, chance: 1 / (j.shape.length + 1) })),
  );
  console.log('cue strength                   n     accuracy   chance');
  for (const bin of bins) {
    console.log(`${bin.label.padEnd(30)} ${String(bin.n).padEnd(5)} ${pct(bin.correct, bin.n).padEnd(10)} ${pct(bin.chanceSum, bin.n)}`);
  }
  console.log('(If accuracy stays ~chance even for clear cues, the limit is perception, not the clips. If it climbs with cue strength, weak clips are hurting you.)');

  // ---- 4: property of misses ----
  console.log('\n=== 4. Voiceless consonant in the word? ===');
  for (const [label, list] of [['has voiceless consonant', joined.filter((j) => j.voiceless)], ['voiced/sonorant only', joined.filter((j) => !j.voiceless)]] as const) {
    console.log(`${label.padEnd(26)} n=${String(list.length).padEnd(4)} ${pct(list.filter((j) => j.correct).length, list.length)}`);
  }

  // ---- 5: per-word table ----
  const perWord = new Map<string, { n: number; ok: number }>();
  for (const j of joined) {
    const row = perWord.get(j.vocabId) ?? { n: 0, ok: 0 };
    row.n += 1;
    if (j.correct) row.ok += 1;
    perWord.set(j.vocabId, row);
  }
  console.log('\n=== 5. Clips whose native cue is weak or contradicts the dictionary (words you review) ===');
  console.log('word / reading         shape   your acc   clip cue (st)   native agrees?');
  const rows = [...perWord.entries()]
    .map(([vocabId, stat]) => {
      const wordClips = clipsByVocab.get(vocabId) ?? [];
      const seps = wordClips.map((c) => c.measurement.separationSemitones).filter((v): v is number => v !== null);
      const item = vocabById.get(vocabId);
      return {
        label: `${item?.expression ?? '?'} / ${item?.reading ?? '?'}`,
        shape: wordClips[0]?.measurement.expectedShape ?? '?',
        stat,
        cue: seps.length ? seps.reduce((a, b) => a + b, 0) / seps.length : null,
        agrees: wordClips.length ? `${wordClips.filter((c) => c.measurement.agrees).length}/${wordClips.length}` : '—',
      };
    })
    .filter((r) => r.cue !== null && (r.cue < WEAK_SEPARATION_ST || r.agrees.startsWith('0')))
    .sort((a, b) => a.cue! - b.cue!);
  for (const r of rows.slice(0, 25)) {
    console.log(`${r.label.padEnd(22)} ${r.shape.padEnd(7)} ${pct(r.stat.ok, r.stat.n).padStart(4)} (${r.stat.ok}/${r.stat.n})   ${r.cue!.toFixed(1).padStart(6)}          ${r.agrees}`);
  }
  if (rows.length === 0) console.log('(none — every reviewed word has a clear, agreeing clip)');

  const header = 'expression\treading\tposition\tmoraCount\texpectedShape\tmeasuredShape\tagrees\tvoicedBuckets\tseparationSt\tsentenceId\taudioId';
  const body = clips.map((c) => [c.expression, c.reading, c.position, c.measurement.moraCount, c.measurement.expectedShape, c.measurement.measuredShape ?? '', c.measurement.agrees ?? '', c.measurement.voicedBuckets, c.measurement.separationSemitones?.toFixed(2) ?? '', c.sentenceId, c.audioId].join('\t'));
  writeFileSync(tsvPath, [header, ...body].join('\n'));
  console.log(`\nPer-clip data written to ${tsvPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
