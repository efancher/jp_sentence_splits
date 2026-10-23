/**
 * Merge neighbouring mined sentences that were split at a comma pause and lost
 * their clause-final connective ("…始めました。" + "今は…" -> "…始めましたが、今は…",
 * docs/ROADMAP.md "Dropped clause-final connectives"). The Re-segment page is
 * not usable for this: it rebuilds a whole book as one source.
 *
 * For each pair in the pairs file it creates the merged sentence (readings from
 * the mining service's annotate-only /resegment, audio re-cut from the pristine
 * source via /source-audio/clip), moves the better-reviewed study card per
 * activity type onto it, repoints vocabulary links whose surface survives, and
 * soft-deletes the two old sentences with everything offset-bound to them
 * (analysis, grammar links, sentence_extras, inbox, reference audio). Learning
 * events stay on the old ids as history; the merged sentence counts as
 * introduced because it inherits the most advanced book status and the card.
 * New first, retire after: a failure part-way leaves duplicates, not losses.
 *
 * Soft deletes only (a raw DELETE emits no sync event). Dry-run by default.
 * Run on the mining box: it needs the mining API (MINING_API_BASE, default
 * http://127.0.0.1:8003) and the usual script credentials in .env.
 *
 * Usage:
 *   npx tsx scripts/merge-adjacent-sentences.ts --pairs scripts/data/merge-pairs-2026-10-23.json \
 *     [--only <firstSentenceId>] [--apply]
 */
import { readFileSync } from 'node:fs';

import type { ImportBatch, Sentence } from '../src/domain/types';
import { fixNumeralsInReadingOnly } from '../src/lib/fixNumeralReadings';
import { createId, hashString, sentenceIdFromNormalizedKey } from '../src/lib/ids';
import { inlineReadingFromTokens } from '../src/lib/inlineReadingFromTokens';
import { normalizeSentenceKey } from '../src/lib/normalize';
import { suggestionsFromTokens, type MorphologyToken } from '../src/lib/vocabularySuggestions';
import { bookSentenceToRemote, importBatchToRemote, sentenceToRemote } from '../src/sync/mappers';
import {
  mergedStatus,
  planStudyItemMoves,
  validateMergedText,
  withVideoPosition,
  type MergePair,
} from './lib/mergeSentences';
import { uploadReferenceClip } from './lib/referenceAudioStorage';
import { parseApplyFlag, requireAuthedUser, withoutVersionAndTimestamps } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ?? 'http://127.0.0.1:8003').replace(/\/+$/, '');

type Row = Record<string, any>;
type Client = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function must<T>(label: string, p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return (data ?? []) as T;
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

interface Plan {
  pair: MergePair;
  a: Row;
  b: Row;
  newId: string;
  connective: string;
  bookId: string;
  memberA: Row;
  memberB: Row;
  audioA: Row;
  audioB: Row;
  items: { id: string; subjectId: string; activityType: string; reviewCount: number; fsrsReps: number }[];
  links: Row[];
  counts: Record<string, number>;
  openSessions: number;
  /** In-progress planner sessions whose steps point at the old sentences. */
  sessionsToFix: Row[];
  alreadyDone: boolean;
}

async function buildPlan(supabase: Client, ownerId: string, pair: MergePair): Promise<Plan> {
  const ids = [pair.first, pair.second];
  const sentences = await must<Row[]>('sentences', supabase.from('sentences').select('*').in('id', ids).is('deleted_at', null));
  const a = sentences.find((s) => s.id === pair.first);
  const b = sentences.find((s) => s.id === pair.second);
  const newId = sentenceIdFromNormalizedKey(normalizeSentenceKey(pair.japanese));
  const existing = await must<Row[]>('merged sentence', supabase.from('sentences').select('id,deleted_at').eq('id', newId));
  if (!a || !b) {
    if (existing.some((s) => s.deleted_at === null)) {
      return { alreadyDone: true, pair, newId } as Plan;
    }
    throw new Error(`${pair.first}/${pair.second}: a source sentence is missing or already deleted`);
  }
  const valid = validateMergedText(a.japanese, b.japanese, pair.japanese);
  if (!valid.ok) throw new Error(`${pair.first}: ${valid.reason}`);
  if (existing.some((s) => s.deleted_at === null)) throw new Error(`${pair.first}: merged sentence ${newId} already exists alongside both originals`);

  const members = await must<Row[]>('book_sentences', supabase.from('book_sentences').select('*').in('sentence_id', ids).is('deleted_at', null));
  const memberA = members.find((m) => m.sentence_id === a.id);
  const memberB = members.find((m) => m.sentence_id === b.id);
  if (members.length !== 2 || !memberA || !memberB) throw new Error(`${pair.first}: expected exactly one live book membership per sentence`);
  if (memberA.book_id !== memberB.book_id) throw new Error(`${pair.first}: sentences are in different books`);
  const bookId = String(memberA.book_id);
  if (!(memberB.position > memberA.position)) throw new Error(`${pair.first}: second sentence does not follow the first in the book`);
  const between = await must<Row[]>(
    'between',
    supabase.from('book_sentences').select('sentence_id').eq('book_id', bookId).is('deleted_at', null).gt('position', memberA.position).lt('position', memberB.position),
  );
  if (between.length > 0) throw new Error(`${pair.first}: ${between.length} other sentence(s) sit between the pair in the book`);

  const audio = await must<Row[]>('reference_audio', supabase.from('reference_audio').select('*').in('sentence_id', ids).is('deleted_at', null));
  const audioA = audio.find((r) => r.sentence_id === a.id);
  const audioB = audio.find((r) => r.sentence_id === b.id);
  if (audio.length !== 2 || !audioA || !audioB) throw new Error(`${pair.first}: expected exactly one live reference clip per sentence`);
  if (audioA.source_id !== audioB.source_id || !audioA.source_url) throw new Error(`${pair.first}: clips come from different sources or have no source_url`);
  if (!(audioA.source_start_ms < audioB.source_end_ms)) throw new Error(`${pair.first}: clip times are not in order`);

  const itemRows = await must<Row[]>(
    'study_items',
    supabase.from('study_items').select('id,subject_id,activity_type,fsrs_state').in('subject_id', ids).eq('subject_type', 'sentence').is('deleted_at', null),
  );
  const items: Plan['items'] = [];
  for (const it of itemRows) {
    const { count, error } = await supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('study_item_id', it.id);
    if (error) throw new Error(`reviews count: ${error.message}`);
    items.push({ id: it.id, subjectId: it.subject_id, activityType: it.activity_type, reviewCount: count ?? 0, fsrsReps: Number(it.fsrs_state?.reps ?? 0) });
  }
  const links = await must<Row[]>('sentence_vocabulary', supabase.from('sentence_vocabulary').select('*').in('sentence_id', ids).is('deleted_at', null));

  const counts: Record<string, number> = {};
  for (const [table, col] of [['analyses', 'sentence_id'], ['sentence_grammar', 'sentence_id'], ['inbox', 'sentence_id'], ['sentence_extras', 'id'], ['sentence_learning_events', 'sentence_id'], ['gloss_decisions', 'sentence_id'], ['clause_question_feedback', 'sentence_id']] as const) {
    const { count, error } = await supabase.from(table).select(col, { count: 'exact', head: true }).in(col, ids).is('deleted_at', null);
    if (error) throw new Error(`${table}: ${error.message}`);
    counts[table] = count ?? 0;
  }
  const sessions = await must<Row[]>('planner_sessions', supabase.from('planner_sessions').select('id,steps').eq('owner_id', ownerId).eq('status', 'in_progress').is('deleted_at', null));
  const sessionsToFix = sessions.filter((s) => ids.some((id) => JSON.stringify(s.steps).includes(id)));
  const openSessions = sessionsToFix.length;

  return { pair, a, b, newId, connective: valid.connective, bookId, memberA, memberB, audioA, audioB, items, links, counts, openSessions, sessionsToFix, alreadyDone: false };
}

function describe(plan: Plan): void {
  if (plan.alreadyDone) {
    console.log(`= ${plan.pair.first}: merged sentence ${plan.newId} already live — skipping`);
    return;
  }
  const { move, retire } = planStudyItemMoves(plan.items);
  console.log(`\n* ${plan.a.id} + ${plan.b.id} -> ${plan.newId}  (connective ${plan.connective})`);
  console.log(`    ${plan.pair.japanese}`);
  console.log(`    ${plan.pair.translation}`);
  console.log(`    book ${plan.bookId}, position ${plan.memberA.position}, status ${mergedStatus(plan.memberA.status, plan.memberB.status)}`);
  console.log(`    audio ${plan.audioA.source_start_ms}-${plan.audioB.source_end_ms} ms from ${plan.audioA.source_title}`);
  console.log(`    study cards: move ${move.map((m) => `${m.activityType}(${m.reviewCount} reviews)`).join(', ') || 'none'}; retire ${retire.length}`);
  console.log(`    vocab links ${plan.links.length}; to soft-delete: ${Object.entries(plan.counts).filter(([k]) => k !== 'sentence_learning_events' && k !== 'gloss_decisions' && k !== 'clause_question_feedback').map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`    kept as history: learning_events=${plan.counts.sentence_learning_events} gloss_decisions=${plan.counts.gloss_decisions} clause_feedback=${plan.counts.clause_question_feedback}; open planner sessions mentioning them: ${plan.openSessions}`);
}

async function softDelete(supabase: Client, table: string, col: string, ids: string[], now: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from(table).update({ deleted_at: now }).in(col, ids).is('deleted_at', null);
  if (error) throw new Error(`soft-delete ${table}: ${error.message}`);
}

async function apply(supabase: Client, ownerId: string, plan: Plan, batchId: string): Promise<void> {
  const { pair, a, b, newId, bookId } = plan;
  const ids = [a.id, b.id];
  const now = new Date().toISOString();
  const sourceId = String(plan.audioA.source_id);

  // 1. Readings/tokens for the merged text (annotate only — no merge/split).
  const cues = await postJson('/resegment', { sentences: [{ japanese: pair.japanese, startMs: 0, endMs: 0 }], merge: false, split: false, generateKana: true });
  const cue = cues[0];
  if (!cue || cue.japanese.replace(/\s/g, '') !== pair.japanese.replace(/\s/g, '')) throw new Error(`${a.id}: annotate returned different text`);
  const tokens: MorphologyToken[] = cue.tokens ?? [];
  const refA = (a.source_references as Row[]).find((r) => r.cardType === 'SHADOWING') ?? (a.source_references as Row[])[0];

  // 2. Audio re-cut from the pristine source over the whole merged span.
  const startMs = Number(plan.audioA.source_start_ms);
  const endMs = Number(plan.audioB.source_end_ms);
  const clipRes = await postJson('/source-audio/clip', { url: plan.audioA.source_url, cuts: [{ startMs, endMs }] });
  const clip = clipRes.clips?.[0];
  if (!clip?.audioBase64 || !(clip.durationMs >= (endMs - startMs) * 0.8)) throw new Error(`${a.id}: re-cut clip missing or too short (${clip?.durationMs}ms for ${endMs - startMs}ms)`);
  const bytes = Buffer.from(clip.audioBase64, 'base64');
  const audioId = `audio_merge_${hashString(`${sourceId}:${newId}`)}`;
  const storagePath = `${ownerId}/${bookId}/${audioId}.m4a`;

  // 3. New rows first.
  const sentence: Sentence = {
    id: newId,
    normalizedKey: normalizeSentenceKey(pair.japanese),
    japanese: pair.japanese,
    readingOnly: fixNumeralsInReadingOnly(String(cue.reading ?? '').trim()),
    inlineReading: inlineReadingFromTokens(pair.japanese, tokens),
    translation: pair.translation,
    targetVocabulary: [],
    vocabularySuggestions: suggestionsFromTokens(pair.japanese, tokens),
    sourceReferences: [{
      cardId: `${String(refA?.cardId ?? sourceId).split(':')[0]}:merge-${newId}`,
      cardType: 'SHADOWING',
      contextNumber: 1,
      userNotes: withVideoPosition(refA?.userNotes, startMs, endMs),
      importBatchId: batchId,
    }],
    conflicts: [],
    firstOccurrenceIndex: Number(a.first_occurrence_index ?? 0),
    importBatchIds: [batchId],
    createdAt: now,
    updatedAt: now,
  };
  const { error: upErr } = await uploadReferenceClip(supabase, storagePath, bytes, { contentType: clip.mimeType ?? 'audio/mp4', upsert: true });
  if (upErr) throw new Error(`upload ${storagePath}: ${upErr.message}`);
  // reference_audio.sentence_id is a foreign key, so the sentence row goes in first.
  await must('upsert sentence', supabase.from('sentences').upsert(withoutVersionAndTimestamps(sentenceToRemote(sentence, ownerId, 1)), { onConflict: 'id' }));
  await must('upsert reference_audio', supabase.from('reference_audio').upsert({
    id: audioId, owner_id: ownerId, book_id: bookId, sentence_id: newId, source_id: sourceId,
    source_sentence_id: `${sourceId}:merge-${newId}`, source_title: plan.audioA.source_title, source_url: plan.audioA.source_url,
    storage_path: storagePath, mime_type: clip.mimeType ?? 'audio/mp4', duration_ms: clip.durationMs, size_bytes: bytes.length,
    source_start_ms: startMs, source_end_ms: endMs,
  }, { onConflict: 'id' }));
  const membership = {
    id: createId('bs'), bookId, sentenceId: newId, position: Number(plan.memberA.position),
    status: mergedStatus(plan.memberA.status, plan.memberB.status), addedAt: String(plan.memberA.added_at),
    lastStudiedAt: plan.memberA.last_studied_at ?? plan.memberB.last_studied_at ?? undefined,
    note: plan.memberA.note ?? undefined, chapterId: plan.memberA.chapter_id ?? undefined,
  };
  await must('insert book_sentences', supabase.from('book_sentences').insert(withoutVersionAndTimestamps(bookSentenceToRemote(membership, ownerId, 1))));

  // 4. Study cards: the better-reviewed one per activity type moves; the rest retire.
  const { move, retire } = planStudyItemMoves(plan.items);
  await softDelete(supabase, 'study_items', 'id', retire.map((i) => i.id), now);
  for (const item of move) {
    await must('move study_item', supabase.from('study_items').update({ subject_id: newId }).eq('id', item.id));
  }

  // 5. Vocabulary links whose surface survives move across (deduped); the rest retire with their per-occurrence cards.
  const seen = new Set<string>();
  const dropLinks: string[] = [];
  for (const link of plan.links) {
    const survives = !link.surface_form || pair.japanese.includes(link.surface_form);
    if (survives && !seen.has(link.vocabulary_item_id)) {
      seen.add(link.vocabulary_item_id);
      await must('move sentence_vocabulary', supabase.from('sentence_vocabulary').update({ sentence_id: newId }).eq('id', link.id));
    } else dropLinks.push(link.id);
  }
  await softDelete(supabase, 'study_items', 'subject_id', dropLinks, now);
  await softDelete(supabase, 'sentence_vocabulary', 'id', dropLinks, now);

  // 5b. Open planner steps that pointed at either old sentence now point at the merged one
  //     (same learning target) instead of becoming dead links.
  const remap = (id: string) => (ids.includes(id) ? newId : id);
  for (const session of plan.sessionsToFix) {
    const steps = (session.steps as Row[]).map((step) => {
      const next: Row = { ...step };
      if (typeof step.sentenceId === 'string') next.sentenceId = remap(step.sentenceId);
      if (Array.isArray(step.sentenceIds)) next.sentenceIds = [...new Set((step.sentenceIds as string[]).map(remap))];
      return next;
    });
    await must('update planner_sessions', supabase.from('planner_sessions').update({ steps }).eq('id', session.id));
  }

  // 6. Retire the originals and everything offset-bound to them. Learning events stay as history.
  await softDelete(supabase, 'book_sentences', 'sentence_id', ids, now);
  await softDelete(supabase, 'analyses', 'sentence_id', ids, now);
  await softDelete(supabase, 'sentence_grammar', 'sentence_id', ids, now);
  await softDelete(supabase, 'inbox', 'sentence_id', ids, now);
  await softDelete(supabase, 'sentence_extras', 'id', ids, now);
  await softDelete(supabase, 'reference_audio', 'id', [plan.audioA.id, plan.audioB.id], now);
  await softDelete(supabase, 'sentences', 'id', ids, now);
}

async function verify(supabase: Client, plan: Plan): Promise<string[]> {
  const problems: string[] = [];
  const ids = [plan.a.id, plan.b.id];
  const live = async (table: string, col: string, vals: string[]) =>
    (await must<Row[]>(table, supabase.from(table).select(col).in(col, vals).is('deleted_at', null))).length;
  if ((await live('sentences', 'id', [plan.newId])) !== 1) problems.push('merged sentence not live');
  if ((await live('sentences', 'id', ids)) !== 0) problems.push('old sentences still live');
  if ((await live('book_sentences', 'sentence_id', [plan.newId])) !== 1) problems.push('merged membership missing');
  if ((await live('book_sentences', 'sentence_id', ids)) !== 0) problems.push('old memberships still live');
  if ((await live('reference_audio', 'sentence_id', [plan.newId])) !== 1) problems.push('merged audio missing');
  if ((await live('reference_audio', 'sentence_id', ids)) !== 0) problems.push('old audio still live');
  const { move } = planStudyItemMoves(plan.items);
  if ((await live('study_items', 'subject_id', [plan.newId])) !== move.length) problems.push('study cards on merged sentence != expected');
  if ((await live('study_items', 'subject_id', ids)) !== 0) problems.push('study cards still on old sentences');
  return problems;
}

async function main() {
  const argv = process.argv.slice(2);
  const doApply = parseApplyFlag(argv);
  const pairsPath = arg(argv, '--pairs');
  if (!pairsPath) throw new Error('--pairs <file> is required');
  const only = arg(argv, '--only');
  const pairs = (JSON.parse(readFileSync(pairsPath, 'utf8')) as MergePair[]).filter((p) => !only || p.first === only);
  if (pairs.length === 0) throw new Error('no pairs selected');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const plans: Plan[] = [];
  for (const pair of pairs) plans.push(await buildPlan(supabase, user.id, pair));
  for (const plan of plans) describe(plan);

  const todo = plans.filter((p) => !p.alreadyDone);
  console.log(`\n${todo.length} merge(s) planned, ${plans.length - todo.length} already done.`);
  if (!doApply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }

  const batchId = createId('batch');
  const batch: ImportBatch = {
    id: batchId, filename: 'merge-adjacent-sentences', batchName: `Merged split sentences ${new Date().toLocaleDateString()}`,
    importedAt: new Date().toISOString(),
    counts: { totalRows: todo.length, contextOccurrences: 0, uniqueSentences: todo.length, newSentences: todo.length, updatedSentences: 0, exactDuplicatesIgnored: 0, newVocabularyAssociations: 0, rowsSkipped: 0, warningCount: 0, conflictCount: 0 },
    warnings: [],
  };
  await must('insert import_batches', supabase.from('import_batches').insert(withoutVersionAndTimestamps(importBatchToRemote(batch, user.id, 1))));

  let failed = 0;
  for (const plan of todo) {
    try {
      await apply(supabase, user.id, plan, batchId);
      const problems = await verify(supabase, plan);
      if (problems.length) throw new Error(`verification failed: ${problems.join('; ')}`);
      console.log(`+ merged ${plan.a.id} + ${plan.b.id} -> ${plan.newId} (verified)`);
    } catch (error) {
      failed += 1;
      console.error(`! ${plan.pair.first}: ${error instanceof Error ? error.message : error}`);
      console.error('  Stopping so this pair can be inspected; earlier pairs are done and verified.');
      break;
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
