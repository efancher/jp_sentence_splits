/**
 * Dry run of the book assistant's "grammar links" extra. Read-only: reads one book's walked-through sentences and
 * the owner's grammar patterns from Supabase, asks the box assistant to link each sentence to patterns, and prints
 * what it WOULD link (existing pattern, proposed new pattern, dropped spans). Nothing is written anywhere.
 *
 * Usage: npm run diagnose:grammar-links -- --book <bookId> [--limit 15] [--all]
 *   --limit N  sentences to send (default 15)
 *   --all      include sentences that have not been walked through (default: walked-through only)
 * Needs the mining box API reachable at MINING_API_SELF_BASE (default http://127.0.0.1:8003).
 */
import {
  buildGrammarPrompt,
  locateGrammarSpan,
  parseBookGrammarReply,
  type GrammarPatternRef,
} from '../src/lib/grammarLinkReply';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_SELF_BASE ?? 'http://127.0.0.1:8003').replace(/\/$/, '');

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function askAssistant(prompt: string): Promise<string> {
  const created = await fetch(`${API_BASE}/assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, backend: 'auto' }),
  });
  if (!created.ok) throw new Error(`Failed to start assistant: ${created.status} ${await created.text()}`);
  const { assistId } = (await created.json()) as { assistId: string };
  for (let waited = 0; waited < 15 * 60_000; waited += 3000) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const response = await fetch(`${API_BASE}/assist/${assistId}`);
    if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
    const status = (await response.json()) as { status: string; reply?: string | null; error?: string | null };
    if (status.status === 'error') throw new Error(status.error ?? 'Assistant failed');
    if (status.status === 'done') return status.reply ?? '';
  }
  throw new Error('Assistant timed out');
}

async function main(): Promise<void> {
  const bookId = flag('book');
  if (!bookId) {
    console.error('Usage: npm run diagnose:grammar-links -- --book <bookId> [--limit 15] [--all]');
    process.exit(1);
  }
  const limit = Number(flag('limit') ?? 15);
  const client = await createScriptSupabaseClient();

  const { data: memberships, error: memberError } = await client
    .from('book_sentences')
    .select('sentence_id,position')
    .eq('book_id', bookId)
    .is('deleted_at', null)
    .order('position');
  if (memberError) throw memberError;
  let sentenceIds = (memberships ?? []).map((row) => row.sentence_id as string);

  if (!process.argv.includes('--all')) {
    const { data: events, error: eventError } = await client
      .from('sentence_learning_events')
      .select('sentence_id')
      .eq('action', 'walkthrough_completed')
      .in('sentence_id', sentenceIds);
    if (eventError) throw eventError;
    const walked = new Set((events ?? []).map((row) => row.sentence_id as string));
    sentenceIds = sentenceIds.filter((id) => walked.has(id));
  }
  sentenceIds = sentenceIds.slice(0, limit);
  if (sentenceIds.length === 0) {
    console.log('No sentences matched (none walked through? try --all).');
    return;
  }

  const [{ data: sentenceRows, error: sentenceError }, { data: patternRows, error: patternError }] = await Promise.all([
    client.from('sentences').select('id,japanese,translation').in('id', sentenceIds),
    client
      .from('grammar_patterns')
      .select('id,canonical_name,structural_template,aliases')
      .is('deleted_at', null)
      .order('canonical_name'),
  ]);
  if (sentenceError) throw sentenceError;
  if (patternError) throw patternError;
  const byId = new Map((sentenceRows ?? []).map((row) => [row.id as string, row]));
  const sentences = sentenceIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id, japanese: row.japanese as string, translation: ((row.translation as string) ?? '').trim() }] : [];
  });
  const patterns: GrammarPatternRef[] = (patternRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.canonical_name as string,
    template: (row.structural_template as string | null) ?? undefined,
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
  }));

  console.log(`Sending ${sentences.length} sentences with ${patterns.length} known patterns to ${API_BASE} ...`);
  const reply = await askAssistant(buildGrammarPrompt(sentences, patterns));
  const parsed = parseBookGrammarReply(reply, sentences.length, patterns.length);

  let linked = 0;
  let proposed = 0;
  let dropped = 0;
  let unparsed = 0;
  parsed.forEach((links, index) => {
    const sentence = sentences[index]!;
    console.log(`\n${index + 1}. ${sentence.japanese}\n   ${sentence.translation}`);
    if (links === null) {
      unparsed += 1;
      console.log('   (no usable reply for this sentence)');
      return;
    }
    if (links.length === 0) console.log('   NONE');
    for (const link of links) {
      const where = locateGrammarSpan(sentence.japanese, link.span);
      if (!where) {
        dropped += 1;
        console.log(`   DROPPED (span not in sentence): ${link.span}`);
        continue;
      }
      if (link.newPattern) {
        proposed += 1;
        console.log(`   NEW  ${link.newPattern.name}  [${where.surfaceForm}]  ${link.newPattern.meaning}`);
      } else {
        linked += 1;
        const pattern = patterns[link.patternNumber! - 1]!;
        console.log(`   LINK ${pattern.name}  [${where.surfaceForm}]  ${link.note}`);
      }
    }
  });
  console.log(
    `\nSummary: ${linked} links to existing patterns, ${proposed} proposed new, ${dropped} dropped spans, ${unparsed} sentences unparsed. Nothing was written.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
