/**
 * One-off cleanup for the silent-shadowing-audio repair (2026-08-30).
 *
 * An early version of `remine-silent-shadowing-audio.ts --redo` raw-DELETEd
 * its prior `audio_remine_*` rows instead of soft-deleting them. A raw
 * DELETE emits no `sync_events` row, so any device that had already pulled
 * those (silent) rows still has them locally — and ShadowPage can pick the
 * stale silent clip over the good replacement.
 *
 * This finds every `audio_remine_*` id that has an `insert` sync_event but
 * no longer exists in `reference_audio`, re-inserts it as a tombstone
 * (row + `deleted_at`), which fires an `op=delete` sync_event so clients
 * purge it on the next pull. Storage objects were already removed by the
 * bad --redo run.
 *
 * Dry-run by default; --apply to write. Idempotent (a re-created tombstone
 * that already exists is skipped).
 *
 * Usage: npx tsx scripts/tombstone-hard-deleted-remine-audio.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const REMINE_ID_PREFIX = 'audio_remine_';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  // Every remine id that was ever inserted.
  const insertedIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('sync_events')
      .select('record_id')
      .eq('owner_id', user.id)
      .eq('entity', 'reference_audio')
      .eq('op', 'insert')
      .like('record_id', `${REMINE_ID_PREFIX}%`)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) insertedIds.add(String(r.record_id));
    if (!data || data.length < 1000) break;
  }

  // Which of those still exist (live or already-tombstoned).
  const present = new Set<string>();
  const ids = [...insertedIds];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('reference_audio')
      .select('id')
      .in('id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) present.add(String(r.id));
  }

  const orphans = ids.filter((id) => !present.has(id));
  console.log(
    `${insertedIds.size} remine ids ever inserted, ${present.size} still present, ` +
      `${orphans.length} hard-deleted orphan(s) to tombstone`,
  );
  if (orphans.length === 0) return;

  if (!apply) {
    console.log('\nDry run — re-run with --apply to write tombstones.');
    console.log(orphans.slice(0, 10).join('\n') + (orphans.length > 10 ? '\n…' : ''));
    return;
  }

  let done = 0;
  for (const id of orphans) {
    // Insert bare row (fires op=insert v1), then set deleted_at (fires
    // op=delete v2) — the version bump is what makes clients that hold v1
    // actually apply it.
    const { error: insErr } = await supabase.from('reference_audio').insert({
      id,
      owner_id: user.id,
      mime_type: 'audio/mp4',
    });
    if (insErr) throw new Error(`insert ${id}: ${insErr.message}`);
    const { error: delErr } = await supabase
      .from('reference_audio')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (delErr) throw new Error(`tombstone ${id}: ${delErr.message}`);
    done += 1;
    if (done % 20 === 0) console.log(`  ${done}/${orphans.length}`);
  }
  console.log(`\nDone: ${done} tombstone(s) written.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
