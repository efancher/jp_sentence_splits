/**
 * "Translate with AI help" round-trip for the mining wizard's Translate
 * stage — the sibling of `miningTranscript.ts`'s "Segment with AI help".
 *
 * The Translate stage seeds each row's English from the video's aligned
 * subtitle track (`translateJob`), which leaves gaps where the track had
 * nothing and occasionally drifts a line onto the wrong sentence. The
 * in-app "Auto-fill translations (AI)" button covers this via the
 * `sentence-realign` Edge Function, but that needs the deployed key and
 * only redistributes *within* a provenance group. This is the manual
 * escape hatch: `formatRowsForTranslationAI` builds a copy-pasteable
 * prompt with every sentence + its current draft, `parseAiTranslations`
 * reads the numbered reply back onto the rows by line number. No key, no
 * deploy, works with whatever assistant the user already has open.
 */

const AI_PROMPT_HEADER = [
  'You are translating a Japanese transcript into English for shadowing practice.',
  'Below are the sentences in order, numbered. Some already have a draft English',
  'translation ("current:"); some are blank ("current: (none)").',
  '',
  'For every numbered line, give the best English translation:',
  '- Fill in the blank ones.',
  '- Where a "current:" translation is wrong, unnatural, or clearly belongs to a',
  '  different sentence, replace it. Where it is already good, repeat it unchanged.',
  '- Translate faithfully: natural, idiomatic English that says what the Japanese',
  '  says. Do not paraphrase away nuance, and do not add explanation.',
  '- One line per sentence, prefixed with its number, e.g. "12. <english>".',
  '- Keep the same numbering and the same count. Output only the numbered lines.',
  '',
  '--- sentences ---',
].join('\n');

export interface TranslationRow {
  japanese: string;
  translation: string;
}

export function formatRowsForTranslationAI(rows: TranslationRow[]): string {
  const body = rows
    .map((row, index) => {
      const current = row.translation.trim();
      return `${index + 1}. ${row.japanese.trim()}\n   current: ${current || '(none)'}`;
    })
    .join('\n');
  return `${AI_PROMPT_HEADER}\n${body}\n`;
}

/** `12. text` / `12) text` / `12: text` / `12 - text` / `12 text`. */
const AI_LINE_RE = /^\s*(\d+)\s*[.)\]:。-]?\s+(.*\S)\s*$/;

/**
 * Parse a numbered assistant reply back into a translation per row, keyed
 * by the line number (1-indexed). `rowCount` bounds the result: entries the
 * reply didn't cover stay `null` so the caller leaves those rows alone. A
 * line with no leading number — or a leading number outside `[1, rowCount]`
 * (a wrapped sentence that happens to start with a figure) — is folded into
 * the previous translation as a continuation. Returns all-`null` when
 * nothing parseable is found.
 */
export function parseAiTranslations(
  reply: string,
  rowCount: number,
): (string | null)[] {
  const out = new Array<string | null>(Math.max(0, rowCount)).fill(null);
  let lastIndex: number | null = null;
  const continueLast = (text: string): void => {
    if (lastIndex !== null && out[lastIndex]) {
      out[lastIndex] = `${out[lastIndex]} ${text}`.trim();
    }
  };
  for (const rawLine of reply.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^current:/i.test(line)) continue;
    const match = AI_LINE_RE.exec(line);
    if (!match) {
      continueLast(line);
      continue;
    }
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= out.length) {
      continueLast(line);
      continue;
    }
    out[index] = match[2].trim();
    lastIndex = index;
  }
  return out;
}
