/**
 * One-off diagnostic: characterizes why specific sentence_vocabulary links
 * fail to get an aligner match in isolatedWordRange (used by
 * backfill-word-audio-range.ts, and at runtime by SegmentLoopPlayer/
 * PitchWordPhraseWarmup) — distinguishes "surface form isn't a substring of
 * the sentence text anymore" (a data issue) from "an OOV <unk> token sits
 * at/before the match" (isolatedWordRange's documented bail-out).
 *
 * Takes surface forms directly rather than the skip log's 1-based indices —
 * those shift as soon as an earlier `--apply` run gives some links a
 * manual range, which drops them out of the eligible-candidate list and
 * re-numbers everything after them. Checks every still-eligible occurrence
 * of each given surface form (a word can appear, and fail differently, in
 * more than one sentence).
 *
 * Usage: npx tsx scripts/diagnose-word-boundary-skips.ts <surfaceForm> [surfaceForm...]
 */
import type { AlignmentResult } from '../src/domain/types';

import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface SentenceRow {
  id: string;
  japanese: string;
}
interface AudioRow {
  id: string;
  sentenceId: string;
  storagePath: string | null;
}
interface VocabRow {
  id: string;
  sentenceId: string;
  surfaceForm: string;
  hasManualRange: boolean;
}

async function main() {
  const targetSurfaceForms = new Set(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [sentences, audioRows, alignmentResult, vocabRows] = await Promise.all([
    fetchAll<SentenceRow>(supabase, 'sentences', 'id, japanese', user.id, (row) => ({
      id: String(row.id),
      japanese: String(row.japanese ?? ''),
    })),
    fetchAll<AudioRow>(
      supabase,
      'reference_audio',
      'id, sentence_id, storage_path',
      user.id,
      (row) => ({
        id: String(row.id),
        sentenceId: String(row.sentence_id),
        storagePath: row.storage_path ? String(row.storage_path) : null,
      }),
      'sentence_id',
    ),
    supabase.from('reference_alignment').select('id, alignment').eq('owner_id', user.id),
    fetchAll<VocabRow>(
      supabase,
      'sentence_vocabulary',
      'id, sentence_id, surface_form, audio_start_ms, audio_end_ms',
      user.id,
      (row) => ({
        id: String(row.id),
        sentenceId: String(row.sentence_id),
        surfaceForm: String(row.surface_form ?? ''),
        hasManualRange: row.audio_start_ms != null && row.audio_end_ms != null,
      }),
    ),
  ]);
  if (alignmentResult.error) throw new Error(alignmentResult.error.message);
  const alignmentByAudioId = new Map(
    (alignmentResult.data ?? []).map((row) => [String(row.id), row.alignment as AlignmentResult]),
  );
  const japaneseBySentence = new Map(sentences.map((s) => [s.id, s.japanese]));
  const audioBySentence = new Map<string, AudioRow>();
  for (const row of audioRows) if (!audioBySentence.has(row.sentenceId)) audioBySentence.set(row.sentenceId, row);

  const candidates = vocabRows.filter(
    (v) => targetSurfaceForms.has(v.surfaceForm) && audioBySentence.get(v.sentenceId)?.storagePath,
  );

  for (const v of candidates) {
    const japanese = japaneseBySentence.get(v.sentenceId) ?? '';
    const audio = audioBySentence.get(v.sentenceId);
    const alignment = audio ? alignmentByAudioId.get(audio.id) : undefined;
    const charIndex = japanese.indexOf(v.surfaceForm);
    console.log(`\n[id=${v.id}] surfaceForm="${v.surfaceForm}" sentence="${japanese}" hasManualRange=${v.hasManualRange}`);
    console.log(`  substring found: ${charIndex !== -1} (charIndex=${charIndex})`);
    if (!alignment) {
      console.log('  no cached alignment for this sentence');
      continue;
    }
    const words = alignment.words;
    console.log(`  aligner word tier: ${words.map((w) => w.text).join(' | ')}`);
    if (charIndex !== -1) {
      const startFrac = charIndex / japanese.length;
      const endFrac = (charIndex + v.surfaceForm.length) / japanese.length;
      const usable = words.filter((w) => w.text && w.text !== '<eps>' && w.text !== '<unk>');
      const total = usable.reduce((sum, w) => sum + w.text.length, 0);
      let acc = 0;
      let startMs: number | null = null;
      let matchEndMs: number | null = null;
      for (const w of usable) {
        const wordStartFrac = acc / total;
        acc += w.text.length;
        const wordEndFrac = acc / total;
        if (wordEndFrac > startFrac && wordStartFrac < endFrac) {
          if (startMs === null) startMs = w.start * 1000;
          matchEndMs = w.end * 1000;
        }
      }
      console.log(`  matched span: [${startMs}, ${matchEndMs}]ms`);
      if (startMs === null || matchEndMs === null || matchEndMs <= startMs) {
        console.log('  -> degenerate (startMs/endMs null or endMs<=startMs)');
      } else {
        const unkBefore = words.some(
          (w) => w.text === '<unk>' && w.end > w.start && w.start * 1000 < matchEndMs!,
        );
        console.log(`  <unk> with start before matchEndMs: ${unkBefore}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
