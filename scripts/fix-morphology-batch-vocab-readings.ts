/**
 * One-time cleanup for a batch of vocabulary_items created through the
 * VocabularyPicker (`ensureVocabularyItem`, id prefix `vocab_item_`) on
 * 2026-08-15/16, before `deriveDictionaryReading` existed
 * (src/lib/vocabularySuggestions.ts) and before
 * `combinedExpressionWarning` guarded the combine flow. Follow-up to the
 * 2026-08-20 "Vocabulary reading-mismatch bug + cleanup" entry in
 * docs/STATUS.md — the three general scripts from that pass
 * (fix:vocabulary-reading-mismatches, fix:vocabulary-godan-readings,
 * merge:duplicate-vocabulary-items) were re-run against production on
 * 2026-08-27 and cleared 26 more items/pairs automatically. This script
 * mops up what those three deliberately leave alone:
 *
 *   A. Garbled combined-expression items — combining a content word with a
 *      particle/auxiliary without editing the draft glued the raw lemmas
 *      together (e.g. 売られた + 喧嘩 -> expression "売るれるた喧嘩"). Same
 *      mechanism delete-garbled-combined-vocabulary.ts handles; these are
 *      six more, all with zero study_items. Soft-deleted (item + its
 *      sentence_vocabulary / vocabulary_kanji links).
 *
 *   B. Conjugated-surface readings on a word with no correct duplicate to
 *      merge into and no usable sentence_vocabulary.surface_form for the
 *      derivation scripts to work from (they skip an item entirely when it
 *      has no surface_form, or when its only surface *is* the dictionary
 *      form). Each target reading below is the single unambiguous JMDict
 *      reading for the expression, picked by hand. Reading updated in place.
 *
 *   C. Conjugated/variant readings that ARE duplicates of an existing
 *      canonical item but which merge:duplicate-vocabulary-items won't pair
 *      up — either the reading is genuinely ambiguous in JMDict (行く いく
 *      vs ゆく) so it refuses to guess, or the buggy item was only ever seen
 *      in dictionary-form surface (お父さん, whose bad reading おちちさん
 *      came from morphological decomposition お+父+さん, not conjugation) so
 *      its "never seen conjugated" guard skips it. Merged the same way that
 *      script does: study_items / reviews / card_issue_reports repointed
 *      (never dropped), sentence_vocabulary and vocabulary_kanji repointed
 *      or soft-deleted on collision, buggy row soft-deleted last.
 *
 * Explicit id lists, not a re-derived scan — "garbled combine" and
 * "which JMDict reading" aren't reliably decidable by pattern (see
 * delete-garbled-combined-vocabulary.ts's and fix-vocabulary-godan-
 * readings.ts's own notes), and the C pairs were each eyeballed.
 *
 * Dry-run by default; --apply required to write. Idempotent: an
 * already-deleted item, an already-corrected reading, and an
 * already-merged (soft-deleted) buggy row are each skipped on a rerun.
 *
 * Usage: npm run fix:morphology-batch-vocab-readings -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

// A — soft-delete outright (garbled combined-expression items, 0 study_items).
const GARBLED_ITEM_IDS = [
  'vocab_item_521afdb3-2c06-4cd9-96c8-116da609bb37', // 売るれるた喧嘩「うられたけんか」
  'vocab_item_7ad4ab27-0ad2-406b-96e0-a84c1ad34ccc', // 安いすぎる「やすすぎる」
  'vocab_item_1178d80e-8118-4268-a7aa-121184a5c4d8', // 最低だセリフ「さいていなせりふ」
  'vocab_item_06192301-baad-46fa-9308-887d43491a8a', // 笑うれる「わらわれる」
  'vocab_item_c94382b0-3fa2-458c-b580-89b6264b0640', // 鈍感だふりするて「どんかんなふりして」
  'vocab_item_0b5353f0-eecf-4fc4-b0d5-5111065310ec', // なし「なかれ」 (勿れ mis-attached)
];

// B — update reading in place to the single unambiguous JMDict reading.
const READING_FIXES: { id: string; expression: string; from: string; to: string }[] = [
  { id: 'vocab_item_fcbb65c4-2022-4ea5-8357-cd6d31e3106d', expression: '売る', from: 'うら', to: 'うる' },
  { id: 'vocab_item_3456b883-ec40-4e8d-9ef5-ee882b9ad621', expression: '安い', from: 'やす', to: 'やすい' },
  { id: 'vocab_item_a05a8c10-6525-42b8-b456-b00f3b1b87dd', expression: '笑う', from: 'わらっ', to: 'わらう' },
  { id: 'vocab_item_cd71228c-7019-4672-895f-47bbe9648b58', expression: '乗る', from: 'のれ', to: 'のる' },
  { id: 'vocab_item_b202d3cc-c6cd-4150-a469-2d07543e1387', expression: '父さん', from: 'ちちさん', to: 'とうさん' },
  { id: 'vocab_item_d1b2eafc-d58a-4f9d-85d2-9bd75d2ce4f6', expression: '飛び散らす', from: 'とびちらし', to: 'とびちらす' },
  { id: 'vocab_item_424b8e48-4dc2-4caf-9190-9ba81c1eaeaa', expression: '湿る', from: 'しめっ', to: 'しめる' },
];

// C — merge buggy -> correct (both rows real vocabulary_items).
const MERGE_PAIRS: { label: string; buggyId: string; correctId: string }[] = [
  { label: '行く「いこう」', buggyId: 'vocab_item_46b7326b-6470-4eb0-9d17-6c678956e3e3', correctId: 'vocab_820a1ae8-c4df-45e5-924c-c22651aa73ef' },
  { label: '行く「いき」', buggyId: 'vocab_item_7d42d625-0881-4b0e-83e3-205a799200c8', correctId: 'vocab_820a1ae8-c4df-45e5-924c-c22651aa73ef' },
  { label: '言う「いい」', buggyId: 'vocab_item_94ae7d35-3f01-4afb-b3ac-63f643e25edb', correctId: 'vocab_b89b59a0-fc93-44a5-a0aa-cdcc61dd19c6' },
  { label: '来る「き」', buggyId: 'vocab_item_b6bac9a5-495d-4ef1-86ce-764e07b2ffa9', correctId: 'vocab_d205c273-5968-4e38-8423-eb2da3731484' },
  { label: 'する「し」', buggyId: 'vocab_item_2003af41-c4b2-4344-bb7a-68a58346e1e5', correctId: 'vocab_84a2c205-9b8c-480b-90ac-615172034a23' },
  { label: '寄る「よっ」', buggyId: 'vocab_17748a21-08f0-4e56-8d8e-8fd5209c38b1', correctId: 'vocab_a3db9df1-68af-4195-aa69-b28165ddff34' },
  { label: 'お父さん「おちちさん」', buggyId: 'vocab_item_74761812-1e3d-4a59-9477-32e26ef115c0', correctId: 'vocab_18a79a98-f8ee-449f-a417-abbb70dab233' },
];

const nowIso = () => new Date().toISOString();

async function liveRows(supabase: SupabaseClient, table: string, column: string, value: string) {
  const { data, error } = await supabase.from(table).select('*').eq(column, value).is('deleted_at', null);
  if (error) throw new Error(`select ${table}.${column}=${value}: ${error.message}`);
  return data ?? [];
}

async function softDelete(supabase: SupabaseClient, table: string, id: string, apply: boolean) {
  if (!apply) return;
  const { error } = await supabase.from(table).update({ deleted_at: nowIso() }).eq('id', id);
  if (error) throw new Error(`soft-delete ${table} ${id}: ${error.message}`);
}

async function repoint(
  supabase: SupabaseClient,
  table: string,
  id: string,
  patch: Record<string, unknown>,
  apply: boolean,
) {
  if (!apply) return;
  const { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error) throw new Error(`repoint ${table} ${id}: ${error.message}`);
}

async function reviewCount(supabase: SupabaseClient, studyItemId: string): Promise<number> {
  const { count } = await supabase
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('study_item_id', studyItemId)
    .is('deleted_at', null);
  return count ?? 0;
}

async function runGarbled(supabase: SupabaseClient, apply: boolean) {
  console.log('=== A: garbled combined-expression items ===');
  for (const id of GARBLED_ITEM_IDS) {
    const { data: item } = await supabase.from('vocabulary_items').select('id, expression, reading, deleted_at').eq('id', id).maybeSingle();
    if (!item) { console.log(`  ${id}: not found — skipping`); continue; }
    if (item.deleted_at) { console.log(`  ${item.expression}「${item.reading}」: already deleted — skipping`); continue; }
    const studyItems = await liveRows(supabase, 'study_items', 'subject_id', id);
    if (studyItems.length > 0) {
      console.log(`  ${item.expression}「${item.reading}」: HAS ${studyItems.length} study_item(s) — NOT deleting (unexpected, needs a merge instead)`);
      continue;
    }
    const links = await liveRows(supabase, 'sentence_vocabulary', 'vocabulary_item_id', id);
    const kanji = await liveRows(supabase, 'vocabulary_kanji', 'vocabulary_item_id', id);
    console.log(`  ${item.expression}「${item.reading}」: delete item + ${links.length} sentence_vocabulary + ${kanji.length} vocabulary_kanji`);
    for (const l of links) await softDelete(supabase, 'sentence_vocabulary', l.id as string, apply);
    for (const k of kanji) await softDelete(supabase, 'vocabulary_kanji', k.id as string, apply);
    await softDelete(supabase, 'vocabulary_items', id, apply);
  }
}

async function runReadingFixes(supabase: SupabaseClient, apply: boolean) {
  console.log('\n=== B: conjugated-surface readings, fixed in place ===');
  for (const fix of READING_FIXES) {
    const { data: item } = await supabase.from('vocabulary_items').select('id, owner_id, expression, reading, deleted_at').eq('id', fix.id).maybeSingle();
    if (!item) { console.log(`  ${fix.expression}: not found — skipping`); continue; }
    if (item.deleted_at) { console.log(`  ${fix.expression}: deleted — skipping`); continue; }
    if (item.reading === fix.to) { console.log(`  ${fix.expression}「${fix.to}」: already correct — skipping`); continue; }
    if (item.reading !== fix.from) { console.log(`  ${fix.expression}: reading is "${item.reading}", expected "${fix.from}" — skipping (needs another look)`); continue; }
    const { data: collision } = await supabase
      .from('vocabulary_items')
      .select('id')
      .eq('owner_id', item.owner_id)
      .eq('expression', fix.expression)
      .eq('reading', fix.to)
      .is('deleted_at', null)
      .maybeSingle();
    if (collision) {
      console.log(`  ${fix.expression}: "${fix.to}" already exists (${collision.id}) — skipping (should be a merge, not an in-place fix)`);
      continue;
    }
    console.log(`  ${fix.expression}: "${fix.from}" -> "${fix.to}"`);
    await repoint(supabase, 'vocabulary_items', fix.id, { reading: fix.to }, apply);
  }
}

async function runMerges(supabase: SupabaseClient, apply: boolean) {
  console.log('\n=== C: merges (buggy -> correct) ===');
  for (const { label, buggyId, correctId } of MERGE_PAIRS) {
    const { data: buggy } = await supabase.from('vocabulary_items').select('id, expression, reading, deleted_at').eq('id', buggyId).maybeSingle();
    const { data: correct } = await supabase.from('vocabulary_items').select('id, expression, reading, deleted_at').eq('id', correctId).maybeSingle();
    if (!buggy || buggy.deleted_at) { console.log(`  ${label}: buggy row gone — already merged, skipping`); continue; }
    if (!correct || correct.deleted_at) { console.log(`  ${label}: TARGET ${correctId} missing/deleted — skipping`); continue; }
    console.log(`  ${label} (${buggyId}) -> ${correct.expression}「${correct.reading}」 (${correctId})`);

    const buggyStudy = await liveRows(supabase, 'study_items', 'subject_id', buggyId);
    const correctStudy = await liveRows(supabase, 'study_items', 'subject_id', correctId);
    for (const bsi of buggyStudy) {
      const clash = correctStudy.find((c) => c.activity_type === bsi.activity_type);
      if (!clash) {
        console.log(`    study_item ${bsi.id} (${bsi.activity_type}) -> subject ${correctId}`);
        await repoint(supabase, 'study_items', bsi.id as string, { subject_id: correctId }, apply);
        correctStudy.push({ ...bsi, subject_id: correctId });
        continue;
      }
      const [bCount, cCount] = await Promise.all([reviewCount(supabase, bsi.id as string), reviewCount(supabase, clash.id as string)]);
      const [loser, survivor] = bCount > cCount ? [clash, bsi] : [bsi, clash];
      console.log(`    study_item ${bsi.activity_type} collision — move reviews/issues ${loser.id} -> ${survivor.id}, delete ${loser.id}`);
      if (apply) {
        for (const t of ['reviews', 'card_issue_reports']) {
          const { error } = await supabase.from(t).update({ study_item_id: survivor.id }).eq('study_item_id', loser.id);
          if (error) throw new Error(`move ${t} ${loser.id}->${survivor.id}: ${error.message}`);
        }
      }
      await softDelete(supabase, 'study_items', loser.id as string, apply);
      if (survivor.id === bsi.id) await repoint(supabase, 'study_items', bsi.id as string, { subject_id: correctId }, apply);
    }

    const buggyLinks = await liveRows(supabase, 'sentence_vocabulary', 'vocabulary_item_id', buggyId);
    const correctLinks = await liveRows(supabase, 'sentence_vocabulary', 'vocabulary_item_id', correctId);
    for (const link of buggyLinks) {
      const clash = correctLinks.find((c) => c.sentence_id === link.sentence_id && (c.chunk_id ?? null) === (link.chunk_id ?? null));
      if (!clash) {
        console.log(`    sentence_vocabulary ${link.id} (${link.sentence_id}) -> item ${correctId}`);
        await repoint(supabase, 'sentence_vocabulary', link.id as string, { vocabulary_item_id: correctId }, apply);
        correctLinks.push({ ...link, vocabulary_item_id: correctId });
        continue;
      }
      if (link.surface_form && !clash.surface_form) {
        await repoint(supabase, 'sentence_vocabulary', clash.id as string, { surface_form: link.surface_form }, apply);
      }
      console.log(`    sentence_vocabulary ${link.id}: redundant (${link.sentence_id} already linked) — delete`);
      await softDelete(supabase, 'sentence_vocabulary', link.id as string, apply);
    }

    const buggyKanji = await liveRows(supabase, 'vocabulary_kanji', 'vocabulary_item_id', buggyId);
    const correctKanji = await liveRows(supabase, 'vocabulary_kanji', 'vocabulary_item_id', correctId);
    for (const k of buggyKanji) {
      const clash = correctKanji.find((c) => c.kanji_id === k.kanji_id && c.position_in_word === k.position_in_word);
      if (!clash) {
        console.log(`    vocabulary_kanji ${k.id} -> item ${correctId}`);
        await repoint(supabase, 'vocabulary_kanji', k.id as string, { vocabulary_item_id: correctId }, apply);
        correctKanji.push({ ...k, vocabulary_item_id: correctId });
      } else {
        console.log(`    vocabulary_kanji ${k.id}: redundant — delete`);
        await softDelete(supabase, 'vocabulary_kanji', k.id as string, apply);
      }
    }

    console.log(`    vocabulary_items ${buggyId}: delete`);
    await softDelete(supabase, 'vocabulary_items', buggyId, apply);
  }
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  await requireAuthedUser(supabase);

  await runGarbled(supabase, apply);
  await runReadingFixes(supabase, apply);
  await runMerges(supabase, apply);

  console.log(`\nDone. ${apply ? 'Applied.' : 'Dry run — nothing written. Re-run with --apply to write.'}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
