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
 * this corpus (人 つ ヶ月 分 番 歳 才 年 週間 羽 月 日 本 匹 回 個 枚 冊 台 円
 * 時 時間 軒) with their irregular / euphonic readings. An unrecognised
 * counter falls back to
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
  // Calendar month (10月 → じゅうがつ) — distinct from ヶ月 (counting a
  // *duration* in months, いっかげつ). Fully irregular 1–12; the tokenizer
  // only ever pairs this with a digit in that range.
  月: {
    kana: 'がつ',
    irregular: {
      1: 'いちがつ',
      2: 'にがつ',
      3: 'さんがつ',
      4: 'しがつ',
      5: 'ごがつ',
      6: 'ろくがつ',
      7: 'しちがつ',
      8: 'はちがつ',
      9: 'くがつ',
      10: 'じゅうがつ',
      11: 'じゅういちがつ',
      12: 'じゅうにがつ',
    },
  },
  // Day of the month (3日 → みっか). Fully irregular 1–31 — day names don't
  // reduce to a number reading + euphony rule the way most counters do.
  日: {
    kana: 'にち',
    irregular: {
      1: 'ついたち',
      2: 'ふつか',
      3: 'みっか',
      4: 'よっか',
      5: 'いつか',
      6: 'むいか',
      7: 'なのか',
      8: 'ようか',
      9: 'ここのか',
      10: 'とおか',
      11: 'じゅういちにち',
      12: 'じゅうににち',
      13: 'じゅうさんにち',
      14: 'じゅうよっか',
      15: 'じゅうごにち',
      16: 'じゅうろくにち',
      17: 'じゅうしちにち',
      18: 'じゅうはちにち',
      19: 'じゅうくにち',
      20: 'はつか',
      21: 'にじゅういちにち',
      22: 'にじゅうににち',
      23: 'にじゅうさんにち',
      24: 'にじゅうよっか',
      25: 'にじゅうごにち',
      26: 'にじゅうろくにち',
      27: 'にじゅうしちにち',
      28: 'にじゅうはちにち',
      29: 'にじゅうくにち',
      30: 'さんじゅうにち',
      31: 'さんじゅういちにち',
    },
  },
  本: {
    kana: 'ほん',
    irregular: {
      1: 'いっぽん',
      3: 'さんぼん',
      6: 'ろっぽん',
      8: 'はっぽん',
      10: 'じゅっぽん',
    },
  },
  匹: {
    kana: 'ひき',
    irregular: {
      1: 'いっぴき',
      3: 'さんびき',
      6: 'ろっぴき',
      8: 'はっぴき',
      10: 'じゅっぴき',
    },
  },
  回: {
    kana: 'かい',
    euphonic: true,
    irregular: { 1: 'いっかい', 6: 'ろっかい', 8: 'はっかい', 10: 'じゅっかい' },
  },
  個: {
    kana: 'こ',
    euphonic: true,
    irregular: { 1: 'いっこ', 6: 'ろっこ', 8: 'はっこ', 10: 'じゅっこ' },
  },
  枚: { kana: 'まい' },
  冊: {
    kana: 'さつ',
    irregular: { 1: 'いっさつ', 8: 'はっさつ', 10: 'じゅっさつ' },
  },
  台: { kana: 'だい' },
  円: { kana: 'えん' },
  時: {
    kana: 'じ',
    irregular: { 4: 'よじ', 7: 'しちじ', 9: 'くじ' },
  },
  時間: {
    kana: 'じかん',
    irregular: { 4: 'よじかん', 7: 'しちじかん', 9: 'くじかん' },
  },
  軒: {
    kana: 'けん',
    irregular: { 1: 'いっけん', 3: 'さんげん', 6: 'ろっけん', 8: 'はっけん', 10: 'じゅっけん' },
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
