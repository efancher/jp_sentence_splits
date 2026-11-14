/**
 * Word glosses via the box assistant (`/assist`): one narrow call per sentence
 * asking ONLY for a short in-context English meaning per word, as a JSON array
 * validated mechanically (expression must be one that was asked for, meaning
 * non-empty). Fail-open: an unreachable box or a malformed reply yields no
 * glosses and never throws.
 */
import { runAssist } from './miningApi';

export interface GlossWordInput {
  expression: string;
  reading?: string;
  surface?: string;
}

export interface WordGloss {
  expression: string;
  meaning: string;
}

const MAX_WORDS = 40;
const MAX_MEANING_CHARS = 120;

export function buildGlossPrompt(sentence: string, words: readonly GlossWordInput[]): string {
  const lines = words.slice(0, MAX_WORDS).map((word) => {
    const extras = [word.reading ? `reading ${word.reading}` : '', word.surface && word.surface !== word.expression ? `appears as ${word.surface}` : '']
      .filter(Boolean)
      .join(', ');
    return `- ${word.expression}${extras ? ` (${extras})` : ''}`;
  });
  return [
    'You are a Japanese dictionary. Give a short English gloss for each word below, for the sense it has IN THIS SENTENCE (not its first dictionary sense).',
    '',
    `SENTENCE: ${sentence}`,
    '',
    'WORDS (dictionary form):',
    ...lines,
    '',
    'Rules: 1-5 words per gloss, dictionary style (verbs as "to ...", no trailing period), no commentary. Use each word exactly as written in `expression`.',
    'Output ONLY a JSON array, no markdown fences, no other text:',
    '[{"expression": "...", "meaning": "..."}]',
  ].join('\n');
}

/** Extract the JSON array and keep only entries for requested expressions with a usable meaning. */
export function parseGlosses(reply: string, words: readonly GlossWordInput[]): WordGloss[] {
  const match = reply.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let data: unknown;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const asked = new Set(words.map((word) => word.expression));
  const seen = new Set<string>();
  const out: WordGloss[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const expression = typeof entry.expression === 'string' ? entry.expression : '';
    const meaning = typeof entry.meaning === 'string' ? entry.meaning.trim().slice(0, MAX_MEANING_CHARS) : '';
    if (!meaning || !asked.has(expression) || seen.has(expression)) continue;
    seen.add(expression);
    out.push({ expression, meaning });
  }
  return out;
}

/** Ask the assistant to gloss `words` in `sentence`. Returns [] on any failure. */
export async function glossWordsViaAssist(sentence: string, words: readonly GlossWordInput[]): Promise<WordGloss[]> {
  if (!sentence.trim() || words.length === 0) return [];
  try {
    const { reply } = await runAssist(buildGlossPrompt(sentence, words));
    return parseGlosses(reply, words);
  } catch {
    return [];
  }
}
