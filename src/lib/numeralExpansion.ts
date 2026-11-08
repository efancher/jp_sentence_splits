/**
 * Arabic-digit expansion the forced aligner applies before aligning (bare
 * numbers and counters, incl. irregular counter readings). Mirror of
 * `app/number_expansion.py` in `shadowing-analysis-api`; both are checked
 * against `tests/fixtures/numeral_expansion_cases.json` (shared verbatim), and
 * `tests/alignerText.test.ts` compares the fixtures when the sibling repo is
 * checked out. 日/月 dates keep their own tables in `alignerText.ts`.
 */

const DIGITS = ['ぜろ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
const MAX_NUMBER = 99_999_999;

function below10000(n: number): string {
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  let out = '';
  if (thousands) {
    out += ({ 1: 'せん', 3: 'さんぜん', 8: 'はっせん' } as Record<number, string>)[thousands] ?? `${DIGITS[thousands]}せん`;
  }
  if (hundreds) {
    out +=
      ({ 1: 'ひゃく', 3: 'さんびゃく', 6: 'ろっぴゃく', 8: 'はっぴゃく' } as Record<number, string>)[hundreds] ??
      `${DIGITS[hundreds]}ひゃく`;
  }
  if (tens) out += tens === 1 ? 'じゅう' : `${DIGITS[tens]}じゅう`;
  if (ones) out += DIGITS[ones];
  return out;
}

/** Plain Sino-Japanese reading of 0..99,999,999. */
export function numberReading(n: number): string {
  if (n === 0) return DIGITS[0]!;
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  let out = '';
  if (man) out += `${man === 1 ? 'いち' : below10000(man)}まん`;
  if (rest) out += below10000(rest);
  return out;
}

type Override = readonly [string, string | null];
interface CounterSpec {
  reading: string;
  digits: Readonly<Record<number, Override>>;
  exact?: Readonly<Record<number, string>>;
  exactOnly?: boolean;
}

const SOKUON: Record<number, Override> = {
  1: ['いっ', null],
  6: ['ろっ', null],
  8: ['はっ', null],
  0: ['じゅっ', null],
};

function sokuon(extra: Record<number, Override> = {}, drop: number[] = []): Record<number, Override> {
  const table: Record<number, Override> = {};
  for (const [k, v] of Object.entries(SOKUON)) if (!drop.includes(Number(k))) table[Number(k)] = v;
  return { ...table, ...extra };
}

function pRow(three: string, plosive: string): Record<number, Override> {
  return {
    1: ['いっ', plosive],
    3: ['さん', three],
    6: ['ろっ', plosive],
    8: ['はっ', plosive],
    0: ['じゅっ', plosive],
  };
}

const COUNTERS: Record<string, CounterSpec> = {
  回: { reading: 'かい', digits: sokuon() },
  歳: { reading: 'さい', digits: sokuon({}, [6]), exact: { 20: 'はたち' } },
  点: { reading: 'てん', digits: sokuon() },
  週: { reading: 'しゅう', digits: sokuon() },
  個: { reading: 'こ', digits: sokuon() },
  階: { reading: 'かい', digits: sokuon({ 3: ['さん', 'がい'] }) },
  分: { reading: 'ふん', digits: { ...pRow('ぷん', 'ぷん'), 4: ['よん', 'ぷん'] } },
  本: { reading: 'ほん', digits: pRow('ぼん', 'ぽん') },
  杯: { reading: 'はい', digits: pRow('ばい', 'ぱい') },
  匹: { reading: 'ひき', digits: pRow('びき', 'ぴき') },
  年: { reading: 'ねん', digits: { 4: ['よ', null] } },
  時: { reading: 'じ', digits: { 4: ['よ', null], 7: ['しち', null], 9: ['く', null] } },
  人: { reading: 'にん', digits: { 4: ['よ', null], 7: ['しち', null] }, exact: { 1: 'ひとり', 2: 'ふたり' } },
  つ: {
    reading: 'つ',
    digits: {},
    exact: {
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
    exactOnly: true,
  },
};
for (const alias of ['ヶ月', 'ヵ月', 'ケ月', 'か月', 'カ月']) {
  COUNTERS[alias] = { reading: 'かげつ', digits: sokuon({}, [8]) };
}

/** Counters the digit pattern recognises: the table plus 日/月 (whose readings live in `alignerText.ts`). */
export const COUNTER_ALTERNATION = [...Object.keys(COUNTERS), '日', '月']
  .sort((a, b) => b.length - a.length)
  .join('|');

function counterReading(n: number, counter: string): string | null {
  const spec = COUNTERS[counter]!;
  const exact = spec.exact?.[n];
  if (exact !== undefined) return exact;
  if (spec.exactOnly) return null;
  const last = n % 10;
  const key = last === 0 ? (n % 100 !== 0 ? 0 : null) : last;
  const override = key === null ? undefined : spec.digits[key];
  if (override === undefined) return numberReading(n) + spec.reading;
  const [numPart, counterPart] = override;
  const counterText = counterPart ?? spec.reading;
  if (key === 0) {
    const tensDigit = Math.floor(n / 10) % 10;
    const head = (n >= 100 ? numberReading(n - (n % 100)) : '') + (tensDigit > 1 ? DIGITS[tensDigit] : '');
    return head + numPart + counterText;
  }
  const head = n > last ? numberReading(n - last) : '';
  return head + numPart + counterText;
}

/**
 * Reading for a digit string and its optional counter (everything but 日/月
 * dates), or undefined when the aligner leaves it untouched (leading zeros,
 * past 99,999,999). The counter's own characters are included in the result
 * (kept as kanji when it isn't in the table).
 */
export function numeralReading(digits: string, counter: string | undefined): string | undefined {
  const normalized = digits.normalize('NFKC');
  if (!/^\d+$/.test(normalized) || (normalized.length > 1 && normalized.startsWith('0'))) return undefined;
  const n = Number.parseInt(normalized, 10);
  if (n > MAX_NUMBER) return undefined;
  if (counter && counter in COUNTERS) {
    const reading = counterReading(n, counter);
    if (reading !== null) return reading;
  }
  return numberReading(n) + (counter ?? '');
}
