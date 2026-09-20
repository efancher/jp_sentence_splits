/**
 * Audit (dry-run by default) of `sentence_vocabulary.audio_start_ms/end_ms`
 * overrides written by `backfill-word-audio-range.ts` before `matchWord`
 * (src/lib/isolatedWordRange.ts) stopped counting punctuation — those
 * "tight" ranges were chosen by round-trip ASR among candidates built on a
 * span that could sit on the wrong token (docs/STATUS.md 2026-09-20).
 *
 * A stored range is classed by comparing it to what the *legacy* matcher
 * (raw-length proportion, reproduced below) would have produced as the
 * unpadded, particle-inclusive range:
 *   - matches legacy AND differs from the fixed matcher -> "stale backfill":
 *     safe to clear (the runtime default is now right; re-run
 *     backfill:word-audio-range afterwards to redo it on correct spans).
 *   - matches legacy AND the fixed matcher -> "still correct": left alone.
 *   - matches neither -> "manual/other": a human's Adjust edit or something
 *     this script can't attribute — NEVER touched.
 *
 * Usage: npx tsx scripts/audit-backfilled-word-ranges.ts [--apply]
 */
import type { AlignmentResult, WordAlignment } from '../src/domain/types';
import { isolatedWordRangeUnpadded } from '../src/lib/isolatedWordRange';

import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const TOLERANCE_MS = 2;

/** The pre-fix matcher, verbatim in behavior: proportion against the raw (punctuated) sentence. */
function legacyUnpadded(words: WordAlignment[], japanese: string, surface: string) {
  const charIndex = japanese.indexOf(surface);
  if (charIndex === -1 || surface.length === 0) return null;
  const usable = words.filter((w) => w.text && w.text !== '<eps>' && w.text !== '<unk>');
  const total = usable.reduce((sum, w) => sum + w.text.length, 0);
  if (total === 0) return null;
  const startFrac = charIndex / japanese.length;
  const endFrac = (charIndex + surface.length) / japanese.length;
  let acc = 0;
  let startMs: number | null = null;
  let endMs: number | null = null;
  let last = -1;
  usable.forEach((w, i) => {
    const s = acc / total;
    acc += w.text.length;
    const e = acc / total;
    if (e > startFrac && s < endFrac) {
      if (startMs === null) startMs = w.start * 1000;
      endMs = w.end * 1000;
      last = i;
    }
  });
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  const matchEnd = endMs;
  if (words.some((w) => w.text === '<unk>' && w.end > w.start && w.start * 1000 < matchEnd)) return null;
  const next = usable[last + 1];
  if (next && next.text.length <= 2) endMs = next.end * 1000;
  return { startMs, endMs };
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_MS;

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [sentences, audio, links, alignments] = await Promise.all([
    fetchAll(supabase, 'sentences', 'id, japanese', user.id, (r) => ({
      id: String(r.id),
      japanese: String(r.japanese ?? ''),
    })),
    fetchAll(supabase, 'reference_audio', 'id, sentence_id', user.id, (r) => ({
      id: String(r.id),
      sentenceId: String(r.sentence_id),
    }), 'sentence_id'),
    fetchAll(supabase, 'sentence_vocabulary', 'id, sentence_id, surface_form, audio_start_ms, audio_end_ms', user.id, (r) => ({
      id: String(r.id),
      sentenceId: String(r.sentence_id),
      surfaceForm: String(r.surface_form ?? ''),
      start: r.audio_start_ms == null ? null : Number(r.audio_start_ms),
      end: r.audio_end_ms == null ? null : Number(r.audio_end_ms),
    })),
    supabase.from('reference_alignment').select('id, alignment').eq('owner_id', user.id),
  ]);
  if (alignments.error) throw new Error(alignments.error.message);

  const japaneseBySentence = new Map(sentences.map((s) => [s.id, s.japanese]));
  const sentenceByAudio = new Map(audio.map((a) => [a.id, a.sentenceId]));
  const alignmentBySentence = new Map<string, AlignmentResult>();
  for (const row of alignments.data ?? []) {
    const sid = sentenceByAudio.get(String(row.id));
    if (sid) alignmentBySentence.set(sid, row.alignment as AlignmentResult);
  }

  const stale: typeof links = [];
  let stillCorrect = 0;
  let manualOrOther = 0;
  let noAlignment = 0;
  for (const link of links) {
    if (link.start === null || link.end === null) continue;
    const japanese = japaneseBySentence.get(link.sentenceId);
    const alignment = alignmentBySentence.get(link.sentenceId);
    if (!japanese || !alignment) {
      noAlignment++;
      continue;
    }
    const legacy = legacyUnpadded(alignment.words, japanese, link.surfaceForm);
    const fixed = isolatedWordRangeUnpadded(alignment.words, japanese, link.surfaceForm);
    const matchesLegacy = legacy && near(link.start, legacy.startMs) && near(link.end, legacy.endMs);
    if (!matchesLegacy) {
      manualOrOther++;
      continue;
    }
    if (fixed && near(link.start, fixed.startMs) && near(link.end, fixed.endMs)) stillCorrect++;
    else {
      stale.push(link);
      const sentence = japaneseBySentence.get(link.sentenceId) ?? '';
      console.log(
        `  ${link.surfaceForm}  [${link.start},${link.end}] -> ` +
          (fixed ? `would be [${Math.round(fixed.startMs)},${Math.round(fixed.endMs)}]` : 'no match') +
          `   ${sentence.slice(0, 40)}`,
      );
    }
  }

  console.log(
    `\nOverrides: ${stale.length} stale backfill, ${stillCorrect} still correct, ` +
      `${manualOrOther} manual/other (untouched), ${noAlignment} without a cached alignment (untouched).`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to clear the stale backfill ranges.');
    return;
  }
  for (const link of stale) {
    const { error } = await supabase
      .from('sentence_vocabulary')
      .update({ audio_start_ms: null, audio_end_ms: null })
      .eq('id', link.id);
    if (error) throw new Error(`Failed to clear ${link.id}: ${error.message}`);
  }
  console.log(`Cleared ${stale.length} range(s).`);
}

main();
