/**
 * How the forced aligner sees a sentence, so token offsets can be mapped back
 * to the text we hold.
 *
 * The aligner (`shadowing-analysis-api`) (1) rewrites `<n>日`/`<n>月` dates to
 * their hiragana reading before aligning (`app/numerals.py`: 16日 →
 * じゅうろくにち — its dictionary has no entry for a bare digit string) and
 * (2) its tokenizer drops punctuation and whitespace. Its word texts therefore
 * concatenate to *that* text, not to `japanese`. `alignerView` reproduces it
 * and remembers, per aligner character, the raw range it came from.
 *
 * KEEP THE TABLES IN SYNC with `app/numerals.py` — `tests/alignerText.test.ts`
 * compares them against the sibling repo's file when it is checked out.
 */

/** Day-of-month readings (1–31), verbatim from the aligner's `_DAY_READINGS`. */
export const DAY_READINGS: Readonly<Record<number, string>> = {
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
};

/** Month readings (1–12), verbatim from the aligner's `_MONTH_READINGS`. */
export const MONTH_READINGS: Readonly<Record<number, string>> = {
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
};

/** Punctuation/symbols/whitespace/control characters the aligner's tokenizer drops. */
const ALIGNER_DROPPED = /[\p{P}\p{S}\p{Z}\p{Cc}]/u;

/** Python's `\d` matches any Unicode decimal digit (fullwidth included), so `\p{Nd}`. */
const DATE_PATTERN = /(\p{Nd}+)(日|月)/gu;

export interface AlignerView {
  /** The characters the aligner keeps, in order (dates expanded, punctuation dropped). */
  chars: string[];
  /** For each kept character, the [start, end) range of the raw text it came from (an expanded date's characters all share the whole `16日` range). */
  rawStart: number[];
  rawEnd: number[];
}

function dateReading(digits: string, counter: string): string | undefined {
  const n = Number.parseInt(digits.normalize('NFKC'), 10);
  return (counter === '日' ? DAY_READINGS : MONTH_READINGS)[n];
}

export function alignerView(japanese: string): AlignerView {
  const view: AlignerView = { chars: [], rawStart: [], rawEnd: [] };
  const push = (ch: string, start: number, end: number) => {
    view.chars.push(ch);
    view.rawStart.push(start);
    view.rawEnd.push(end);
  };
  const pushPlain = (from: number, to: number) => {
    let index = from;
    for (const ch of japanese.slice(from, to)) {
      if (!ALIGNER_DROPPED.test(ch)) push(ch, index, index + ch.length);
      index += ch.length;
    }
  };

  let cursor = 0;
  for (const match of japanese.matchAll(DATE_PATTERN)) {
    const reading = dateReading(match[1]!, match[2]!);
    if (reading === undefined) continue; // out-of-range number: left as-is, like the aligner
    const start = match.index!;
    const end = start + match[0].length;
    pushPlain(cursor, start);
    for (const ch of reading) push(ch, start, end);
    cursor = end;
  }
  pushPlain(cursor, japanese.length);
  return view;
}
