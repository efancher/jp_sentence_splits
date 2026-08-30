/**
 * Arabic-number → hiragana, plus number+counter fusion readings.
 *
 * The morphology service (fugashi/unidic-lite) tags a bare Arabic numeral as
 * 名詞/数詞 with *no* kana reading and reads the following counter with its
 * isolated default (人→にん, ヶ月→かげつ, 歳→さい). So "2人" came through as
 * "2にん", "1ヶ月" as "1かげつ", "20歳" as "20さい" — the digit dropped
 * entirely from ShadowPage's mora/hiragana row, the counter unfused. This
 * module is the single source of truth for turning those back into speech:
 * `inlineReadingFromTokens` calls it while building `inlineReading`, and the
 * `reading_only` string fixer (`fixNumeralReadings.ts`) calls it too.
 *
 * Scope: 0–9999 for the plain number, and the counters that actually occur in
 * this corpus (人 つ ヶ月 分 番 歳 才 年 週間 羽) with their irregular /
 * euphonic readings. An unrecognised counter falls back to
 * `readNumber(n) + <counter's own kana>` with no euphony — good enough for a
 * mora row, and `readCounter` returns null when it can't do even that so the
 * caller can leave the token alone.
 */

const ONES: Record<number, string> = {
  0: '',
  1: 'いち',
  2: 'に',
  3: 'さん',
  4: 'よん',
  5: 'ご',
  6: 'ろく',
  7: 'なな',
  8: 'はち',
  9: 'きゅう',
};

const HUNDREDS: Record<number, string> = {
  1: 'ひゃく',
  2: 'にひゃく',
  3: 'さんびゃく',
  4: 'よんひゃく',
  5: 'ごひゃく',
  6: 'ろっぴゃく',
  7: 'ななひゃく',
  8: 'はっぴゃく',
  9: 'きゅうひゃく',
};

const THOUSANDS: Record<number, string> = {
  1: 'せん',
  2: 'にせん',
  3: 'さんぜん',
  4: 'よんせん',
  5: 'ごせん',
  6: 'ろくせん',
  7: 'ななせん',
  8: 'はっせん',
  9: 'きゅうせん',
};

/** Normalise full-width digits to ASCII. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/** A hiragana reading for a whole number 0–9999, or null if out of range. */
export function readNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
  if (n === 0) return 'ゼロ';
  let out = '';
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  if (thousands) out += THOUSANDS[thousands];
  if (hundreds) out += HUNDREDS[hundreds];
  if (tens) out += tens === 1 ? 'じゅう' : `${ONES[tens]}じゅう`;
  if (ones) out += ONES[ones];
  return out;
}

// A trailing じゅう / ひゃく / せん geminates before a か/さ/た/は-row counter
// (にじゅっさい, さんびゃっかい). Applied to `readNumber`'s output when a
// euphonic counter follows.
function geminateTail(numberReading: string): string {
  return numberReading
    .replace(/じゅう$/, 'じゅっ')
    .replace(/ひゃく$/, 'ひゃっ')
    .replace(/せん$/, 'せん'); // せん doesn't geminate; kept explicit for clarity
}

interface CounterSpec {
  /** Fully irregular readings, keyed by the number. */
  irregular?: Record<number, string>;
  /** The counter's own kana, used for the regular `number + kana` case. */
  kana: string;
  /**
   * Regular-form builder. Defaults to `readNumber(n) + kana`. `euphonic`
   * geminates the number's tail (じゅう→じゅっ) and is used by か/さ/は-row
   * counters for numbers ending in 10/100.
   */
  euphonic?: boolean;
}

const COUNTERS: Record<string, CounterSpec> = {
  人: {
    kana: 'にん',
    irregular: { 1: 'ひとり', 2: 'ふたり', 4: 'よにん' },
  },
  つ: {
    kana: 'つ',
    irregular: {
      1: 'ひとつ',
      2: 'ふたつ',
      3: 'みっつ',
      4: 'よっつ',
      5: 'いつつ',
      6: 'むっつ',
      7: 'ななつ',
      8: 'やっつ',
      9: 'ここのつ',
      10: 'とお',
    },
  },
  ヶ月: {
    kana: 'かげつ',
    euphonic: true,
    irregular: { 1: 'いっかげつ', 6: 'ろっかげつ', 8: 'はっかげつ', 10: 'じゅっかげつ' },
  },
  分: {
    kana: 'ふん',
    irregular: {
      1: 'いっぷん',
      2: 'にふん',
      3: 'さんぷん',
      4: 'よんぷん',
      5: 'ごふん',
      6: 'ろっぷん',
      7: 'ななふん',
      8: 'はっぷん',
      9: 'きゅうふん',
      10: 'じゅっぷん',
    },
  },
  番: { kana: 'ばん' },
  歳: {
    kana: 'さい',
    euphonic: true,
    irregular: { 1: 'いっさい', 8: 'はっさい', 10: 'じゅっさい', 20: 'はたち' },
  },
  年: {
    kana: 'ねん',
    irregular: { 4: 'よねん' },
  },
  週間: {
    kana: 'しゅうかん',
    euphonic: true,
    irregular: { 1: 'いっしゅうかん', 8: 'はっしゅうかん', 10: 'じゅっしゅうかん' },
  },
  羽: {
    kana: 'わ',
    irregular: { 1: 'いちわ', 6: 'ろっぱ', 8: 'はっぱ', 10: 'じゅっぱ' },
  },
};

// Counter spellings that map onto a canonical entry above.
const COUNTER_ALIASES: Record<string, string> = {
  才: '歳',
  ケ月: 'ヶ月',
  か月: 'ヶ月',
  カ月: 'ヶ月',
  ヵ月: 'ヶ月',
};

/** Canonical counter surfaces this module knows how to fuse. */
export const KNOWN_COUNTERS: readonly string[] = [
  ...Object.keys(COUNTERS),
  ...Object.keys(COUNTER_ALIASES),
];

/** Every counter's plain kana, for matching an already-kana `reading_only`. */
export const COUNTER_KANA: Readonly<Record<string, string>> = Object.fromEntries([
  ...Object.entries(COUNTERS).map(([surface, spec]) => [surface, spec.kana]),
  ...Object.entries(COUNTER_ALIASES).map(([alias, canonical]) => [
    alias,
    COUNTERS[canonical]!.kana,
  ]),
]);

/**
 * Fused reading for `number + counter` (e.g. 2, "人" → "ふたり"). Returns null
 * when the number is out of range or the counter is unknown *and* no fallback
 * kana can be derived.
 */
export function readCounter(
  n: number,
  counter: string,
  fallbackKana?: string,
): string | null {
  if (!Number.isInteger(n) || n < 0) return null;
  const canonical = COUNTER_ALIASES[counter] ?? counter;
  const spec = COUNTERS[canonical];
  const numberReading = readNumber(n);

  if (!spec) {
    const kana = fallbackKana?.trim();
    if (!kana || !numberReading) return null;
    return numberReading + kana;
  }

  if (spec.irregular && spec.irregular[n] !== undefined) return spec.irregular[n]!;
  if (!numberReading) return null;
  const head = spec.euphonic ? geminateTail(numberReading) : numberReading;
  return head + spec.kana;
}
