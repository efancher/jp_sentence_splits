/**
 * Second-pass pitch-accent backfill: fill `vocabulary_items.pitch_accent_positions`
 * from UniDic's `aType` for items the Kanjium dictionary
 * (`scripts/backfill-pitch-accent.ts`) couldn't match — chiefly rarer
 * single-morpheme words. **Run `backfill:pitch-accent` first**; this only
 * touches items still blank, so Kanjium (NHK/Daijisen-derived) always wins.
 *
 * Deliberately conservative — only writes when the mining service's
 * tokenizer (`POST /resegment`, annotate-only) returns the expression as a
 * *single* content-word token (名詞/動詞/形容詞/形状詞/副詞, never 固有名詞)
 * with a plain-integer `aType`. UniDic gives proper nouns a bare "1"/"0"
 * default rather than real accent data, and a compound's per-token aType
 * isn't the compound's accent, so both are skipped.
 *
 * Same `aType` convention as `pitchAccentPositions` — mora index of the
 * accent nucleus, 0 = heiban.
 *
 * Dry-run by default; --apply to write. Idempotent (only blank items).
 * Needs the mining service reachable; override with MINING_API_BASE.
 *
 * Usage: npm run backfill:pitch-accent-unidic -- [--apply] [--limit N]
 */
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ??
  'https://codex-dev.tailfbd89c.ts.net/youtube-mining').replace(/\/$/, '');

const CONTENT_POS = ['名詞/普通名詞', '動詞', '形容詞', '形状詞', '副詞'];
const BATCH = 40;

export interface Item {
  id: string;
  expression: string;
  reading: string;
}

export interface ResegToken {
  surface: string;
  lemma?: string;
  reading?: string;
  lemmaReading?: string;
  pos?: string;
  accentType?: string;
}
export interface ResegCue {
  japanese: string;
  tokens: ResegToken[] | null;
}

/**
 * The UniDic accent for `item`, or null when the tokenizer's answer isn't
 * safe to use: expression isn't a single dictionary-form content token, it's
 * a proper noun, the reading disagrees, or aType isn't a plain integer.
 */
export function accentFor(cue: ResegCue, item: Item): number | null {
  const tokens = cue.tokens ?? [];
  if (tokens.length !== 1) return null;
  const [tok] = tokens;
  // Whole expression = one token, already in dictionary form (a conjugated
  // adverbial like 仲良く carries the wrong accent for its dictionary entry).
  if (tok.surface !== item.expression || (tok.lemma ?? tok.surface) !== item.expression) {
    return null;
  }
  // The tokenizer must have read the kanji the same way the vocab item does
  // (今日 きょう vs こんにち, 歳 とし vs さい) — otherwise its accent is for a
  // different word.
  const tokReading = (tok.lemmaReading || tok.reading || '').trim();
  if (tokReading && tokReading !== item.reading.trim()) return null;
  const pos = tok.pos ?? '';
  if (pos.startsWith('名詞/固有名詞')) return null;
  if (!CONTENT_POS.some((prefix) => pos.startsWith(prefix))) return null;
  if (!/^\d+$/.test(tok.accentType ?? '')) return null;
  return Number(tok.accentType);
}

async function resegment(expressions: string[]): Promise<ResegCue[]> {
  const response = await fetch(`${API_BASE}/resegment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sentences: expressions.map((japanese) => ({ japanese, startMs: 0, endMs: 0 })),
      merge: false,
      split: false,
      generateKana: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`/resegment -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as ResegCue[];
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const limitArg = argv[argv.indexOf('--limit') + 1];
  const limit = argv.includes('--limit') && limitArg ? Number(limitArg) : Infinity;

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const all = await fetchAll(
    supabase,
    'vocabulary_items',
    'id, expression, reading, pitch_accent_positions',
    user.id,
    (row) => ({
      id: String(row.id),
      expression: String(row.expression ?? ''),
      reading: String(row.reading ?? ''),
      scored: ((row.pitch_accent_positions as number[] | null) ?? []).length > 0,
    }),
  );
  const items: Item[] = all
    .filter((r) => r.reading.trim() && !r.scored && r.expression.trim())
    .map(({ id, expression, reading }) => ({ id, expression, reading }))
    .slice(0, limit === Infinity ? undefined : limit);

  console.log(`${items.length} unscored item(s) to check against UniDic aType.\n`);
  if (!items.length) return;

  let filled = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const cues = await resegment(batch.map((it) => it.expression));
    for (let j = 0; j < batch.length; j += 1) {
      const item = batch[j]!;
      const cue = cues[j];
      const accent = cue ? accentFor(cue, item) : null;
      if (accent === null) continue;
      filled += 1;
      console.log(`  ${item.expression} [${item.reading}] → [${accent}]`);
      if (apply) {
        const { error } = await supabase
          .from('vocabulary_items')
          .update({ pitch_accent_positions: [accent] })
          .eq('id', item.id);
        if (error) throw new Error(`update ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${filled}/${items.length} item(s) ${apply ? 'updated' : 'would be updated'} from UniDic.`,
  );
  if (!apply) console.log('Dry run — re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
