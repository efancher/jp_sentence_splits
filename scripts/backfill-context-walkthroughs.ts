/**
 * Backfills contextual walkthroughs (Chapter.contextWalkthroughs) for a book by driving `codex exec`
 * batch by batch: build the same prompt the Book page downloads, run Codex on it, validate the reply
 * with the app's own parser, and merge only the accepted walkthroughs into the book's chapters.
 *
 * Resumable and idempotent: pending sentences (none, or older-format) are recomputed from the database
 * before every batch, so a failed/cut-off batch is simply requested again and finished sentences are
 * never revisited. Existing walkthroughs are replaced only by a valid v2 reply; nothing else on the
 * book (analyses, drafts, learning history) is touched. Fresh chapters are re-read just before each write.
 *
 * Dry-run by default (runs Codex and validates, writes nothing); --apply required to write.
 * Usage: npm run backfill:context-walkthroughs -- <bookId> [--apply] [--batch-size N] [--max-batches N] [--model M]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ContextWalkthrough } from '../src/domain/types';
import {
  BOOK_WALKTHROUGH_BATCH_SIZE,
  formatBookWalkthroughPrompt,
  parseBookWalkthroughReply,
  type BookWalkthroughPlan,
} from '../src/lib/bookWalkthroughs';
import { sentencesNeedingUpgrade, sentencesNeedingWalkthrough } from '../src/lib/contextWalkthrough';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Supabase = Awaited<ReturnType<typeof createScriptSupabaseClient>>;
interface ChapterRow {
  id: string;
  contextWalkthroughs?: Record<string, ContextWalkthrough>;
  [key: string]: unknown;
}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function loadPlan(supabase: Supabase, ownerId: string, bookId: string) {
  const { data: book, error } = await supabase
    .from('books')
    .select('id, title, chapters, version')
    .eq('owner_id', ownerId)
    .eq('id', bookId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch book: ${error.message}`);
  if (!book) throw new Error(`Book ${bookId} not found.`);
  const { data: members, error: memberError } = await supabase
    .from('book_sentences')
    .select('sentence_id, chapter_id, position')
    .eq('owner_id', ownerId)
    .eq('book_id', bookId)
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (memberError) throw new Error(`Failed to fetch book sentences: ${memberError.message}`);
  const seen = new Set<string>();
  const unique = (members ?? []).filter((m) => m.chapter_id && !seen.has(String(m.sentence_id)) && seen.add(String(m.sentence_id)));
  const sentenceRows = new Map<string, { japanese: string; translation: string }>();
  const ids = unique.map((m) => String(m.sentence_id));
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: sentenceError } = await supabase.from('sentences').select('id, japanese, translation').eq('owner_id', ownerId).in('id', ids.slice(i, i + 200));
    if (sentenceError) throw new Error(`Failed to fetch sentences: ${sentenceError.message}`);
    for (const row of data ?? []) sentenceRows.set(String(row.id), { japanese: String(row.japanese), translation: String(row.translation ?? '') });
  }
  const sentences: BookWalkthroughPlan['sentences'] = [];
  for (const m of unique) {
    const row = sentenceRows.get(String(m.sentence_id));
    if (row) sentences.push({ id: String(m.sentence_id), japanese: row.japanese, translation: row.translation.trim() || undefined, chapterId: String(m.chapter_id) });
  }
  const chapters = (book.chapters ?? []) as ChapterRow[];
  const drafts: Record<string, ContextWalkthrough> = {};
  for (const chapter of chapters) Object.assign(drafts, chapter.contextWalkthroughs);
  const handleOf = new Map(sentences.map((s, i) => [s.id, `S${i + 1}`]));
  const missing = sentencesNeedingWalkthrough(sentences, drafts).map((id) => handleOf.get(id)!);
  const outdated = sentencesNeedingUpgrade(sentences, drafts).map((id) => handleOf.get(id)!);
  const plan: BookWalkthroughPlan = {
    title: String(book.title),
    sentences,
    pending: [...missing, ...outdated],
    missing,
    outdated,
    current: sentences.length - missing.length - outdated.length,
  };
  return { plan, chapters, version: Number(book.version ?? 1) };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const bookId = argv.find((arg, i) => !arg.startsWith('--') && !['--batch-size', '--max-batches', '--model'].includes(argv[i - 1] ?? ''));
  if (!bookId) throw new Error('Usage: tsx scripts/backfill-context-walkthroughs.ts <bookId> [--apply] [--batch-size N] [--max-batches N] [--model M]');
  const batchSize = Number(flag(argv, '--batch-size') ?? BOOK_WALKTHROUGH_BATCH_SIZE);
  const maxBatches = Number(flag(argv, '--max-batches') ?? Infinity);
  const model = flag(argv, '--model');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const dir = mkdtempSync(join(tmpdir(), 'walkthrough-backfill-'));
  const failed = new Set<string>();
  let totalSaved = 0;

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const { plan } = await loadPlan(supabase, user.id, bookId);
    const todo = plan.pending.filter((handle) => !failed.has(handle));
    console.log(`\nBatch ${batch}: ${plan.missing.length} missing, ${plan.outdated.length} outdated, ${plan.current} current; ${todo.length} left to try.`);
    if (todo.length === 0) break;
    const handles = todo.slice(0, batchSize);
    const prompt = formatBookWalkthroughPrompt(plan, handles);
    const promptFile = join(dir, `batch-${batch}-prompt.txt`);
    const replyFile = join(dir, `batch-${batch}-reply.txt`);
    writeFileSync(promptFile, prompt);
    console.log(`  Asking Codex about ${handles[0]}–${handles[handles.length - 1]} (${handles.length} sentences)...`);
    const run = spawnSync(
      'codex',
      ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-o', replyFile, ...(model ? ['-m', model] : []), '-'],
      { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 },
    );
    let reply = '';
    try {
      reply = readFileSync(replyFile, 'utf8');
    } catch {
      /* no reply file */
    }
    if (run.status !== 0 || !reply.trim()) {
      console.log(`  Codex failed (status ${run.status}); will not retry these this run.`);
      for (const handle of handles) failed.add(handle);
      continue;
    }
    const parsed = parseBookWalkthroughReply(reply, plan);
    if (parsed.error) {
      console.log(`  Reply unusable: ${parsed.error}`);
      for (const handle of handles) failed.add(handle);
      continue;
    }
    for (const r of parsed.rejected) console.log(`  ${r.handle}: ${r.reason}`);
    const savedIds = new Set([...parsed.byChapter.values()].flatMap((drafts) => Object.keys(drafts)));
    const handleOf = new Map(plan.sentences.map((s, i) => [s.id, `S${i + 1}`]));
    for (const handle of handles) if (![...savedIds].some((id) => handleOf.get(id) === handle)) failed.add(handle);
    console.log(`  ${parsed.saved} of ${handles.length} validated.`);
    if (!apply || parsed.saved === 0) continue;

    // Re-read right before writing so concurrent chapter edits are not clobbered.
    const fresh = await loadPlan(supabase, user.id, bookId);
    const chapters = fresh.chapters.map((chapter) => {
      const drafts = parsed.byChapter.get(chapter.id);
      return drafts ? { ...chapter, contextWalkthroughs: { ...chapter.contextWalkthroughs, ...drafts } } : chapter;
    });
    const { error } = await supabase
      .from('books')
      .update({ chapters, updated_at: new Date().toISOString(), version: fresh.version + 1 })
      .eq('id', bookId)
      .eq('version', fresh.version);
    if (error) throw new Error(`Failed to write chapters: ${error.message}`);
    totalSaved += parsed.saved;
    console.log('  Written.');
  }

  const { plan: after } = await loadPlan(supabase, user.id, bookId);
  console.log(`\n${apply ? `Wrote ${totalSaved} walkthrough(s).` : 'Dry run — nothing written; re-run with --apply.'} Still pending: ${after.pending.length}${failed.size ? ` (${failed.size} failed this run, retry by re-running)` : ''}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
