/**
 * Read-only audit of curated grammar entries the text detector ignores because their fixed text is under 3
 * characters (さえ, こそ, まま, ほど, 次第 …). For each, counts the sentences where the text sits on token
 * boundaries (it neither starts nor ends partway through a content word), with a few contexts, to judge whether
 * lowering the minimum for that entry would be precise enough. Nothing is written.
 *
 * Usage: npm run diagnose:grammar-short [-- --samples 4] [--min-length 2] [--level N3,N2,N1]
 */
import openJlptGrammar from '../src/data/openJlptGrammar.json';
import type { VocabularySuggestion } from '../src/domain/types';
import { detectableSegments, wordSpansForDetection } from '../src/lib/grammarReference';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const LITERAL = /^[぀-ヿ一-鿿]+$/;

async function main(): Promise<void> {
  const samples = Number(flag('samples') ?? 4);
  const minLength = Number(flag('min-length') ?? 2);
  const levels = (flag('level') ?? 'N3,N2,N1').split(',');
  const entries = openJlptGrammar.patterns.filter(
    (entry) => entry.id && levels.includes(entry.level ?? '') && detectableSegments(entry as never).length === 0,
  );
  const literals = entries
    .map((entry) => ({
      entry,
      forms: entry.pattern
        .split(/\s*[/・]\s*/)
        .map((variant) => variant.replace(/[（(][^）)]*[）)]/g, '').split(/[〜～]/).map((s) => s.trim()).filter(Boolean))
        .filter((segments) => segments.length === 1 && segments[0]!.length >= minLength && LITERAL.test(segments[0]!))
        .map((segments) => segments[0]!),
    }))
    .filter((row) => row.forms.length > 0);

  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const sentences = await fetchAll<Row>(client, 'sentences', 'id,japanese,vocabulary_suggestions', ownerId, (r) => r);
  const prepared = sentences.map((sentence) => ({
    japanese: (sentence.japanese ?? '') as string,
    words: wordSpansForDetection((sentence.vocabulary_suggestions ?? []) as VocabularySuggestion[]),
  }));

  const rows = literals
    .map(({ entry, forms }) => {
      const hits: Array<{ japanese: string; at: number; form: string }> = [];
      for (const { japanese, words } of prepared) {
        for (const form of forms) {
          for (let at = japanese.indexOf(form); at >= 0; at = japanese.indexOf(form, at + 1)) {
            const end = at + form.length;
            const inside = words.some((w) => (at > w.start && at < w.end) || (end > w.start && end < w.end));
            if (!inside) {
              hits.push({ japanese, at, form });
              break;
            }
          }
        }
      }
      return { entry, forms, hits };
    })
    .sort((a, b) => b.hits.length - a.hits.length);

  console.log(`${sentences.length} sentences; ${rows.length} short entries at levels ${levels.join('/')}`);
  for (const { entry, forms, hits } of rows) {
    console.log(`\n${entry.pattern} [${entry.level}] id=${entry.id} forms=${forms.join('|')} boundary-sentences=${hits.length}`);
    for (const hit of hits.slice(0, samples)) {
      console.log(`  ${hit.japanese.slice(0, hit.at)}[${hit.form}]${hit.japanese.slice(hit.at + hit.form.length)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
