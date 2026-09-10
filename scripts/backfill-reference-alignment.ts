/**
 * Compute + store forced alignment for every reference recording that
 * doesn't have one yet, so review-time word-audio isolation
 * (`SegmentLoopPlayer` / `isolatedWordRange` — pitch_accent / word_listening
 * cards, the karaoke shadow text) works without the client reaching the
 * tailnet-only MFA service. Populates the `reference_alignment` table that
 * `loadOrComputeAlignment` reads as its middle tier.
 *
 * Meant to run **on the box that hosts the aligner** (`shadowing-analysis-api`
 * on codex-dev): then `ALIGN_API_BASE` is `http://127.0.0.1:8002`, no
 * tailnet hop, and the run can take as long as it needs. Idempotent —
 * skips recordings that already have a current-version row.
 *
 * For each candidate: download the clip from the `reference-audio` Storage
 * bucket, POST it + the sentence's Japanese to `/align`, insert the result.
 *
 * Usage:
 *   ANALYSIS_ALIGN_API_BASE=http://127.0.0.1:8002 \
 *   npx tsx scripts/backfill-reference-alignment.ts [--apply] [--limit N]
 *
 * Dry-run by default (lists what it would do). Needs SCRIPT_SUPABASE_EMAIL
 * / SCRIPT_SUPABASE_PASSWORD / VITE_SUPABASE_* like the other scripts, and
 * the aligner service running (start it first: `systemctl --user start
 * shadowing-analysis-api`, or run uvicorn directly).
 */
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import type { AlignmentResult } from '../src/domain/types';

import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const ALIGN_API_BASE = (
  process.env.ANALYSIS_ALIGN_API_BASE ??
  process.env.ALIGN_API_BASE ??
  'http://127.0.0.1:8002'
).replace(/\/$/, '');

const STORAGE_BUCKET = 'reference-audio';

interface AudioRow {
  id: string;
  sentenceId: string;
  sourceTitle: string;
  storagePath: string | null;
}

async function align(blob: Blob, transcript: string): Promise<AlignmentResult> {
  const form = new FormData();
  form.append('audio', blob, 'clip');
  form.append('transcript', transcript);
  const resp = await fetch(`${ALIGN_API_BASE}/align`, { method: 'POST', body: form });
  if (!resp.ok) {
    throw new Error(`/align ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as AlignmentResult;
  if (!Array.isArray(data.words)) throw new Error('/align returned no words[]');
  return data;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const limitArg = argv[argv.indexOf('--limit') + 1];
  const limit = argv.includes('--limit') && limitArg ? Number(limitArg) : Infinity;

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  // Reference recordings (owner-scoped, live).
  const audio = await fetchAll<AudioRow>(
    supabase,
    'reference_audio',
    'id, sentence_id, source_title, storage_path',
    user.id,
    (row) => ({
      id: String(row.id),
      sentenceId: String(row.sentence_id ?? ''),
      sourceTitle: String(row.source_title ?? ''),
      storagePath: (row.storage_path as string | null) ?? null,
    }),
  );

  // Alignments already present at the current version — skip these.
  const { data: existingRows, error: existingErr } = await supabase
    .from('reference_alignment')
    .select('id, alignment_version')
    .eq('owner_id', user.id);
  if (existingErr) throw new Error(`fetch reference_alignment: ${existingErr.message}`);
  const current = new Set(
    (existingRows ?? [])
      .filter((r) => Number(r.alignment_version) === ALIGNMENT_VERSION)
      .map((r) => String(r.id)),
  );

  // Sentence text, keyed by id — only for the sentences we still need.
  const neededSentenceIds = new Set(
    audio.filter((a) => a.storagePath && !current.has(a.id)).map((a) => a.sentenceId),
  );
  const sentences = await fetchAll<{ id: string; japanese: string }>(
    supabase,
    'sentences',
    'id, japanese',
    user.id,
    (row) => ({ id: String(row.id), japanese: String(row.japanese ?? '') }),
  );
  const japaneseById = new Map(
    sentences.filter((s) => neededSentenceIds.has(s.id)).map((s) => [s.id, s.japanese]),
  );

  const candidates = audio
    .filter((a) => a.storagePath && !current.has(a.id))
    .filter((a) => {
      const jp = japaneseById.get(a.sentenceId);
      return jp && jp.trim().length > 0;
    })
    .slice(0, limit === Infinity ? undefined : limit);

  const skippedNoPath = audio.filter((a) => !a.storagePath && !current.has(a.id)).length;
  const skippedNoText = audio.filter(
    (a) => a.storagePath && !current.has(a.id) && !japaneseById.get(a.sentenceId)?.trim(),
  ).length;

  console.log(
    `${audio.length} recording(s); ${current.size} already aligned (v${ALIGNMENT_VERSION}), ` +
      `${candidates.length} to do` +
      (skippedNoPath ? `, ${skippedNoPath} skipped (no cloud blob)` : '') +
      (skippedNoText ? `, ${skippedNoText} skipped (no sentence text)` : ''),
  );
  console.log(`Aligner: ${ALIGN_API_BASE}\n`);

  if (!apply) {
    console.log('Dry run — re-run with --apply to compute and store.');
    return;
  }

  let ok = 0;
  const failures: string[] = [];
  for (const [i, row] of candidates.entries()) {
    const transcript = japaneseById.get(row.sentenceId)!;
    process.stdout.write(`[${i + 1}/${candidates.length}] ${row.id} … `);
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(row.storagePath!);
      if (dlErr || !blob) throw new Error(`download: ${dlErr?.message ?? 'no data'}`);

      const result = await align(blob, transcript);

      const { error: insErr } = await supabase.from('reference_alignment').upsert(
        {
          id: row.id,
          owner_id: user.id,
          alignment: result,
          alignment_version: ALIGNMENT_VERSION,
        },
        { onConflict: 'id' },
      );
      if (insErr) throw new Error(`insert: ${insErr.message}`);
      console.log(`ok (${result.words.length} words)`);
      ok += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`FAILED — ${reason}`);
      failures.push(
        `  ${row.id}  [${row.sourceTitle || '?'}]  sentence=${row.sentenceId}\n` +
          `    ${transcript}\n    → ${reason}`,
      );
    }
  }

  console.log(`\nDone. ${ok} stored, ${failures.length} failed.`);
  if (failures.length) console.log(`\nFailures:\n${failures.join('\n')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
