/**
 * Friendly labels for the UniDic part-of-speech tags morphology tokens carry
 * (`VocabularySuggestion.pos` / `VocabularySelection.pos`, e.g.
 * "名詞/普通名詞", "助詞/格助詞"). UniDic's own tags are finer-grained than
 * what a dictionary entry prints, so each one maps to the term you'd
 * actually see in a Japanese dictionary (品詞, with the UniDic subcategory
 * noted parenthetically) and a short English gloss — this is the picker's
 * only proactive teaching surface for "how to read a dictionary entry", so
 * it favors real terminology over a paraphrase.
 *
 * Table built from every distinct `pos` value seen in prod
 * `sentences.vocabulary_suggestions` as of 2026-09-11 (32 values), plus a
 * handful of defensive extras (bare top-level tags, 記号/空白) that don't
 * currently occur but are valid UniDic output. `describePos` falls back to
 * a top-level-prefix match for anything not in this exact table, so a new
 * UniDic subcategory shows *something* rather than nothing.
 */

export interface PosLabel {
  /** The term as printed in a Japanese dictionary, with the UniDic subcategory noted parenthetically when it adds information. */
  ja: string;
  /** Short English gloss, same parenthetical-nuance convention. */
  en: string;
}

const EXACT_LABELS: Record<string, PosLabel> = {
  '名詞/普通名詞': { ja: '名詞（普通名詞）', en: 'noun (common)' },
  '名詞/固有名詞': { ja: '名詞（固有名詞）', en: 'noun (proper)' },
  '名詞/数詞': { ja: '名詞（数詞）', en: 'noun (numeral)' },
  '動詞/一般': { ja: '動詞（一般）', en: 'verb' },
  '動詞/非自立可能': { ja: '動詞（非自立可能）', en: 'verb (auxiliary use, e.g. ～ている)' },
  '形容詞/一般': { ja: '形容詞（一般）', en: 'i-adjective' },
  '形容詞/非自立可能': { ja: '形容詞（非自立可能）', en: 'i-adjective (auxiliary use, e.g. ～てほしい)' },
  '形状詞/一般': { ja: '形状詞（一般）', en: 'na-adjective' },
  '形状詞/タリ': { ja: '形状詞（タリ）', en: 'na-adjective (classical タリ type)' },
  '形状詞/助動詞語幹': { ja: '形状詞（助動詞語幹）', en: 'na-adjective (auxiliary stem, e.g. そう・よう・みたい)' },
  副詞: { ja: '副詞', en: 'adverb' },
  連体詞: { ja: '連体詞', en: 'adnominal (pre-noun modifier, e.g. この・大きな)' },
  接続詞: { ja: '接続詞', en: 'conjunction' },
  代名詞: { ja: '代名詞', en: 'pronoun' },
  '感動詞/一般': { ja: '感動詞（一般）', en: 'interjection' },
  '感動詞/フィラー': { ja: '感動詞（フィラー）', en: 'interjection (filler, e.g. えっと)' },
  助動詞: { ja: '助動詞', en: 'auxiliary verb' },
  '助詞/格助詞': { ja: '助詞（格助詞）', en: 'particle (case-marking, e.g. を・に・で)' },
  '助詞/係助詞': { ja: '助詞（係助詞）', en: 'particle (binding, e.g. は・も)' },
  '助詞/副助詞': { ja: '助詞（副助詞）', en: 'particle (adverbial, e.g. だけ・まで)' },
  '助詞/接続助詞': { ja: '助詞（接続助詞）', en: 'particle (conjunctive, e.g. て・から・けど)' },
  '助詞/終助詞': { ja: '助詞（終助詞）', en: 'particle (sentence-final, e.g. ね・よ)' },
  '助詞/準体助詞': { ja: '助詞（準体助詞）', en: 'particle (nominalizing の)' },
  接頭辞: { ja: '接頭辞', en: 'prefix (e.g. お・ご honorific)' },
  '接尾辞/名詞的': { ja: '接尾辞（名詞的）', en: 'suffix (noun-forming, e.g. さん・たち)' },
  '接尾辞/形状詞的': { ja: '接尾辞（形状詞的）', en: 'suffix (na-adjective-forming)' },
  '接尾辞/形容詞的': { ja: '接尾辞（形容詞的）', en: 'suffix (i-adjective-forming, e.g. ～っぽい)' },
  '接尾辞/動詞的': { ja: '接尾辞（動詞的）', en: 'suffix (verb-forming, e.g. ～がる)' },
  '補助記号/句点': { ja: '補助記号（句点）', en: 'punctuation (period 。)' },
  '補助記号/読点': { ja: '補助記号（読点）', en: 'punctuation (comma 、)' },
  '補助記号/括弧開': { ja: '補助記号（括弧開）', en: 'punctuation (opening bracket)' },
  '補助記号/括弧閉': { ja: '補助記号（括弧閉）', en: 'punctuation (closing bracket)' },
  '補助記号/一般': { ja: '補助記号（一般）', en: 'punctuation (other)' },
};

/** Fallback when the exact tag isn't in EXACT_LABELS — matched by top-level prefix (before the first "/"). */
const TOP_LEVEL_LABELS: Record<string, PosLabel> = {
  名詞: { ja: '名詞', en: 'noun' },
  動詞: { ja: '動詞', en: 'verb' },
  形容詞: { ja: '形容詞', en: 'i-adjective' },
  形状詞: { ja: '形状詞', en: 'na-adjective' },
  形容動詞: { ja: '形容動詞', en: 'na-adjective' },
  副詞: { ja: '副詞', en: 'adverb' },
  連体詞: { ja: '連体詞', en: 'adnominal' },
  接続詞: { ja: '接続詞', en: 'conjunction' },
  代名詞: { ja: '代名詞', en: 'pronoun' },
  感動詞: { ja: '感動詞', en: 'interjection' },
  助動詞: { ja: '助動詞', en: 'auxiliary verb' },
  助詞: { ja: '助詞', en: 'particle' },
  接頭辞: { ja: '接頭辞', en: 'prefix' },
  接尾辞: { ja: '接尾辞', en: 'suffix' },
  記号: { ja: '記号', en: 'symbol' },
  補助記号: { ja: '補助記号', en: 'punctuation' },
  空白: { ja: '空白', en: 'whitespace' },
};

/** Full ja+en description, or null when `pos` is blank or unrecognized. */
export function describePos(pos: string | undefined): PosLabel | null {
  const trimmed = pos?.trim();
  if (!trimmed) return null;
  const exact = EXACT_LABELS[trimmed];
  if (exact) return exact;
  const topLevel = trimmed.split('/')[0];
  return TOP_LEVEL_LABELS[topLevel] ?? null;
}

/** Just the top-level Japanese dictionary term (e.g. "名詞") for compact badges — same fallback as describePos. */
export function posTopLevelJa(pos: string | undefined): string | null {
  const trimmed = pos?.trim();
  if (!trimmed) return null;
  const topLevel = trimmed.split('/')[0];
  return TOP_LEVEL_LABELS[topLevel]?.ja ?? EXACT_LABELS[trimmed]?.ja.split('（')[0] ?? null;
}
