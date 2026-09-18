/**
 * One-off: forces a fresh (uncached) /align call for the sentences known
 * to have failed due to arabic-digit counters becoming <unk>
 * (docs/STATUS.md 2026-09-18), to confirm shadowing-analysis-api's new
 * numeral-to-kanji expansion (numerals.py) actually fixes them live.
 */
import { alignAudio } from './lib/audioClipHelpers';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const AUDIO_BUCKET = 'reference-audio';
const TARGET_SENTENCES = [
  '気象庁によると、16日まで、とても強く降る所がありそうです。',
  '11日は、関東地方などで、気温が低くなりました。',
  '8番テーブルってどこですか。',
  'いつもの年の10月ぐらいの気温になりました。',
];

async function main() {
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const sentences = await fetchAll<{ id: string; japanese: string }>(
    supabase,
    'sentences',
    'id, japanese',
    user.id,
    (row) => ({ id: String(row.id), japanese: String(row.japanese ?? '') }),
  );
  const audioRows = await fetchAll<{ sentenceId: string; storagePath: string | null }>(
    supabase,
    'reference_audio',
    'sentence_id, storage_path',
    user.id,
    (row) => ({ sentenceId: String(row.sentence_id), storagePath: row.storage_path ? String(row.storage_path) : null }),
    'sentence_id',
  );
  const audioBySentence = new Map(audioRows.map((r) => [r.sentenceId, r]));

  for (const japanese of TARGET_SENTENCES) {
    const sentence = sentences.find((s) => s.japanese === japanese);
    if (!sentence) {
      console.log(`[not found] ${japanese}`);
      continue;
    }
    const audio = audioBySentence.get(sentence.id);
    if (!audio?.storagePath) {
      console.log(`[no audio] ${japanese}`);
      continue;
    }
    const { data: blob, error } = await supabase.storage.from(AUDIO_BUCKET).download(audio.storagePath);
    if (error || !blob) {
      console.log(`[download failed] ${japanese}: ${error?.message}`);
      continue;
    }
    const result = await alignAudio(blob, japanese);
    console.log(`\n${japanese}`);
    console.log('  ' + result.words.map((w) => w.text).join(' | '));
    console.log(`  has <unk>: ${result.words.some((w) => w.text === '<unk>')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
