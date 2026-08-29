/**
 * Audit corpus readings against JMDict. The morphology service
 * (fugashi + unidic-lite) sometimes emits a dictionary-lemma reading that's
 * wrong in context — 私 as わたくし was the one the user happened to notice;
 * this finds the rest.
 *
 * Checks `vocabulary_suggestions` entries where the surface is unconjugated
 * (surface === expression) — the same shape as the 私 case, and the one
 * where a bad reading is unambiguously the tokenizer's fault rather than a
 * conjugation-stem or sub-word-furigana artifact.
 *
 * A pair is flagged when the expression is a headword in JMDict but the
 * reading isn't any of JMDict's readings for it. Expressions not in JMDict
 * (names, ad-hoc compounds) are skipped — can't judge. Pass --loose to also
 * scan conjugated suggestions + `inline_reading` furigana (much noisier —
 * single-kanji furigana in a longer word, un-deconjugated stems).
 *
 * Read-only. Output is grouped by (expression → bad reading), most frequent
 * first, with JMDict's actual readings and example sentences, so you can
 * decide which belong in server/youtube-mining READING_OVERRIDES / a data
 * fix.
 *
 * Usage: npx tsx scripts/audit-vocab-readings.ts [--limit N] [--min-count N]
 */
import { ensureJmdictFile, glossEntriesFromJmdictEntry } from './lib/jmdict';
import { requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const KANJI_RE = /[㐀-鿿々豈-﫿]/;
const FURIGANA_RE = /([㐀-鿿々豈-﫿]+)\[([ぁ-ゖァ-ヶー]+)\]/g;

function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
const norm = (s: string) => kataToHira(s).normalize('NFC').trim();

interface Flag {
  expression: string;
  reading: string;
  jmReadings: string[];
  where: 'suggestion' | 'furigana';
  sentenceId: string;
  japanese: string;
}

function argNum(name: string, dflt: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
}

async function main() {
  const limit = argNum('--limit', 0);
  const minCount = argNum('--min-count', 1);
  const loose = process.argv.includes('--loose');

  console.log('Loading JMDict…');
  const file = await ensureJmdictFile();
  const readings = new Map<string, Set<string>>();
  for (const entry of file.words) {
    for (const g of glossEntriesFromJmdictEntry(entry)) {
      const key = norm(g.expression);
      const set = readings.get(key) ?? new Set<string>();
      set.add(norm(g.reading));
      readings.set(key, set);
    }
  }
  console.log(`JMDict headwords: ${readings.size}`);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const flags: Flag[] = [];
  const seenPair = new Set<string>(); // expression|reading|where|sentence — dedupe

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('sentences')
      .select('id, japanese, inline_reading, vocabulary_suggestions')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const sid = String(row.id);
      const jp = String(row.japanese ?? '');

      const check = (expression: string, reading: string, where: Flag['where']) => {
        const expr = norm(expression);
        const read = norm(reading);
        if (!expr || !read || !KANJI_RE.test(expr)) return;
        const jm = readings.get(expr);
        if (!jm || jm.size === 0) return; // not a headword — can't judge
        if (jm.has(read)) return;
        const dedupe = `${expr}|${read}|${where}|${sid}`;
        if (seenPair.has(dedupe)) return;
        seenPair.add(dedupe);
        flags.push({
          expression: expr,
          reading: read,
          jmReadings: [...jm],
          where,
          sentenceId: sid,
          japanese: jp,
        });
      };

      for (const s of (row.vocabulary_suggestions as
        | { expression?: string; reading?: string; surface?: string }[]
        | null) ?? []) {
        if (!s.expression || !s.reading) continue;
        if (!loose && s.surface !== s.expression) continue; // skip conjugated
        check(s.expression, s.reading, 'suggestion');
      }
      if (loose) {
        const inline = String(row.inline_reading ?? '');
        for (const m of inline.matchAll(FURIGANA_RE)) check(m[1]!, m[2]!, 'furigana');
      }
    }
    if (data.length < pageSize) break;
  }

  // Group by (expression, reading).
  const groups = new Map<string, Flag[]>();
  for (const f of flags) {
    const key = `${f.expression}\t${f.reading}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }

  const ordered = [...groups.entries()]
    .map(([key, fs]) => ({ key, fs, count: fs.length }))
    .filter((g) => g.count >= minCount)
    .sort((a, b) => b.count - a.count);

  console.log(`\n${ordered.length} distinct (expression, reading) mismatches ` +
    `(${flags.length} occurrences across sentences):\n`);

  for (const g of limit ? ordered.slice(0, limit) : ordered) {
    const [expression, reading] = g.key.split('\t');
    const jm = g.fs[0]!.jmReadings.slice(0, 6).join(', ');
    const wheres = [...new Set(g.fs.map((f) => f.where))].join('+');
    console.log(`${String(g.count).padStart(3)}×  ${expression} — got 「${reading}」  JMDict: ${jm}  [${wheres}]`);
    for (const f of g.fs.slice(0, 2)) {
      console.log(`        ${f.sentenceId}  ${f.japanese}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
