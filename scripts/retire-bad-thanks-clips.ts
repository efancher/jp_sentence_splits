/**
 * One-off: soft-delete the mis-attached "ご視聴ありがとうございました" clips
 * (Slow Japanese Ep 4 / 5 / 17 / 22). Their audio is the English
 * outro (Ep 4 also has "ではまた来週"); none contains the spoken Japanese phrase.
 *
 * Soft-delete only (`deleted_at`) so clients learn of it on next pull.
 * Dry-run by default.
 *
 * Usage: npx tsx scripts/retire-bad-thanks-clips.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const SENTENCE_ID = 'sent_d51e885f';
const BAD_AUDIO_IDS = ['audio_69f4009e', 'audio_57691bf6', 'audio_48db9355', 'audio_baa54e8f'];

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data, error } = await supabase
    .from('reference_audio')
    .select('id, source_title, duration_ms')
    .eq('owner_id', user.id)
    .eq('sentence_id', SENTENCE_ID)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  const live = (data ?? []) as Array<{ id: string; source_title: string; duration_ms: number }>;
  console.log('Live clips for sentence:');
  for (const r of live) {
    console.log(`  ${BAD_AUDIO_IDS.includes(r.id) ? 'RETIRE' : 'keep  '} ${r.id} ${r.source_title} (${r.duration_ms}ms)`);
  }
  const targets = live.filter((r) => BAD_AUDIO_IDS.includes(r.id));
  if (!apply) {
    console.log(`\nDry run — ${targets.length} row(s) would be soft-deleted. Re-run with --apply.`);
    return;
  }
  const nowIso = new Date().toISOString();
  for (const r of targets) {
    const { error: e } = await supabase
      .from('reference_audio')
      .update({ deleted_at: nowIso })
      .eq('id', r.id)
      .eq('owner_id', user.id);
    if (e) throw new Error(`soft-delete ${r.id}: ${e.message}`);
  }
  console.log(`\nSoft-deleted ${targets.length} row(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
