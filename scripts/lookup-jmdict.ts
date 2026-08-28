/**
 * Local-only JMDict lookup, for verifying scripts/lib/jmdict.ts works end to
 * end. Downloads/caches the JMDict release on first run (scripts/.cache/,
 * gitignored); nothing here writes to Supabase.
 *
 * Usage: npm run jmdict:lookup -- 先生 [reading] [pos]
 *   pos is a fugashi POS ("動詞") or JMDict tags ("v5r,vt"), used to break
 *   homophone ties — e.g. `npm run jmdict:lookup -- する 動詞`.
 */
import { buildJmdictIndex, ensureJmdictFile, lookupJmdict } from './lib/jmdict';
import { buildJmnedictIndex, ensureJmnedictFile, lookupJmnedict } from './lib/jmnedict';

async function main() {
  const [expression, reading, pos] = process.argv.slice(2);
  if (!expression) {
    console.error('Usage: npm run jmdict:lookup -- <expression> [reading] [pos]');
    process.exitCode = 1;
    return;
  }

  console.log('Loading JMDict (downloads + caches on first run)...');
  const file = await ensureJmdictFile();
  const index = buildJmdictIndex(file);

  const result = lookupJmdict(index, expression, reading, pos);
  if (result) {
    console.log(`${result.expression} [${result.reading}] — ${result.gloss}`);
    console.log(`  pos: ${result.pos || '(none)'}  common: ${result.common}`);
    return;
  }

  const name = lookupJmnedict(buildJmnedictIndex(await ensureJmnedictFile()), expression, reading);
  if (name) {
    console.log(`${name.expression} [${name.reading}] — ${name.gloss}  (JMnedict)`);
    return;
  }

  console.log(`No match for "${expression}"${reading ? ` (${reading})` : ''}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
