/**
 * Read-only Supabase query helper. Only ever issues `select` (supabase-js
 * `.select()`); there is no insert/update/delete/rpc path in this file.
 * Runs as the signed-in script user, so RLS scopes rows to that owner.
 *
 * Usage: npm run db:query -- <table> [options]
 *   --select <cols>        columns (default *)
 *   --eq col=val           equality filter (repeatable)
 *   --neq col=val          inequality filter (repeatable)
 *   --lt/--lte/--gt/--gte col=val  comparisons; JSON fields work, e.g.
 *                          --lt "fsrs_state->>due=2026-10-02T00:00:00Z"
 *   --in col=a,b,c         membership filter (repeatable)
 *   --like col=pattern     ilike filter, use % wildcards (repeatable)
 *   --is-null col          column is null (repeatable)
 *   --not-null col         column is not null (repeatable)
 *   --order col[:desc]     sort (repeatable)
 *   --limit N              row cap (default 50, max 1000)
 *   --count                print only the matching row count
 *   --include-deleted      don't hide rows with deleted_at set
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const TABLES = new Set([
  'analyses', 'book_invites', 'book_members', 'books', 'book_sentences',
  'card_issue_reports', 'gloss_decisions', 'grammar_patterns',
  'grammar_relationships', 'import_batches', 'inbox', 'kanji',
  'named_podcast_feeds', 'pitch_drill_attempts', 'pitch_drill_takes',
  'planner_sessions', 'profiles', 'reference_alignment', 'reference_audio',
  'reviews', 'sentence_grammar', 'sentence_learning_events', 'sentences',
  'sentence_vocabulary', 'sources', 'study_items', 'sync_events',
  'sync_issue_reports', 'vocabulary_confusions', 'vocabulary_items',
  'vocabulary_kanji', 'wanikani_subjects',
]);
const MAX_LIMIT = 1000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function pair(arg: string, flag: string): [string, string] {
  const at = arg.indexOf('=');
  if (at < 1) fail(`${flag} expects col=value, got "${arg}"`);
  return [arg.slice(0, at), arg.slice(at + 1)];
}

async function main() {
  const [table, ...rest] = process.argv.slice(2);
  if (!table || table.startsWith('--')) fail(`Usage: npm run db:query -- <table> [options]\nTables: ${[...TABLES].join(', ')}`);
  if (!TABLES.has(table)) fail(`Unknown table "${table}". Known: ${[...TABLES].join(', ')}`);

  let select = '*';
  let limit = 50;
  let countOnly = false;
  let includeDeleted = false;
  const filters: Array<(q: any) => any> = [];
  const orders: Array<[string, boolean]> = [];

  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]!;
    const value = (): string => rest[++i] ?? fail(`${flag} needs a value`);
    switch (flag) {
      case '--select': select = value(); break;
      case '--limit': limit = Math.min(MAX_LIMIT, Math.max(1, Number(value()) || 50)); break;
      case '--count': countOnly = true; break;
      case '--include-deleted': includeDeleted = true; break;
      case '--eq': { const [c, v] = pair(value(), flag); filters.push((q) => q.eq(c, v)); break; }
      case '--neq': { const [c, v] = pair(value(), flag); filters.push((q) => q.neq(c, v)); break; }
      case '--lt': { const [c, v] = pair(value(), flag); filters.push((q) => q.lt(c, v)); break; }
      case '--lte': { const [c, v] = pair(value(), flag); filters.push((q) => q.lte(c, v)); break; }
      case '--gt': { const [c, v] = pair(value(), flag); filters.push((q) => q.gt(c, v)); break; }
      case '--gte': { const [c, v] = pair(value(), flag); filters.push((q) => q.gte(c, v)); break; }
      case '--in': { const [c, v] = pair(value(), flag); filters.push((q) => q.in(c, v.split(','))); break; }
      case '--like': { const [c, v] = pair(value(), flag); filters.push((q) => q.ilike(c, v)); break; }
      case '--is-null': { const c = value(); filters.push((q) => q.is(c, null)); break; }
      case '--not-null': { const c = value(); filters.push((q) => q.not(c, 'is', null)); break; }
      case '--order': {
        const [c, dir] = value().split(':');
        orders.push([c!, dir === 'desc']);
        break;
      }
      default: fail(`Unknown option ${flag}`);
    }
  }

  const supabase = await createScriptSupabaseClient();
  let query: any = supabase
    .from(table)
    .select(select, countOnly ? { count: 'exact', head: true } : undefined);
  if (!includeDeleted) query = query.is('deleted_at', null);
  for (const apply of filters) query = apply(query);
  for (const [col, desc] of orders) query = query.order(col, { ascending: !desc });
  if (!countOnly) query = query.limit(limit);

  const { data, error, count } = await query;
  if (error) {
    const hint = /deleted_at/.test(error.message) ? ' (table may lack deleted_at: retry with --include-deleted)' : '';
    fail(`Query failed: ${error.message}${hint}`);
  }
  if (countOnly) {
    console.log(count);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
  console.error(`(${data?.length ?? 0} rows, limit ${limit})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
