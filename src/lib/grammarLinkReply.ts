// Book-assistant "grammar links" extra: instructions, pattern-list formatting and reply parsing.
// Kept free of database imports so the box-side assist run (compiled outside the app project) can use it.

export interface GrammarPatternRef {
  id: string;
  name: string;
  template?: string;
  aliases?: string[];
  /** Patterns tagged this are kept in the learner's list but never offered to the assistant. */
  family?: string | null;
}

/** The reserved `family` value that tells the book assistant not to link sentences to a pattern. */
export const NO_AUTO_LINK_FAMILY = 'no-auto-link';

export interface ParsedGrammarLink {
  /** The pattern as the assistant named it: a name from the list, or a new one it proposes. */
  name: string;
  /** Only given for a pattern that was not in the list. */
  template: string;
  meaning: string;
  /** Exact text from the sentence, `〜`/`…` joining the parts of a discontinuous pattern. */
  span: string;
  note: string;
}

export const GRAMMAR_HEADING = 'GRAMMAR';

/** The patterns the assistant may be told about: everything except entries the learner tagged no-auto-link. */
export function linkablePatterns<T extends { family?: string | null }>(patterns: readonly T[]): T[] {
  return patterns.filter((pattern) => pattern.family !== NO_AUTO_LINK_FAMILY);
}

export function formatGrammarPatternList(patterns: readonly GrammarPatternRef[]): string[] {
  if (patterns.length === 0) return ['(No patterns are known yet: every pattern you report is new.)'];
  return patterns.map((pattern) => {
    const extras = [pattern.template, pattern.aliases?.length ? `also: ${pattern.aliases.join(', ')}` : '']
      .filter(Boolean)
      .join(' | ');
    return `${pattern.name}${extras ? ` | ${extras}` : ''}`;
  });
}

export const GRAMMAR_INSTRUCTION_LINES: string[] = [
  'For each sentence list the reusable grammar constructions it uses that a learner should notice: patterns like 〜ている,',
  '〜てしまう, 〜ことができる, 〜ようになる, 〜ば〜ほど, 〜わけがない, conditionals, 〜ながら, passive/causative, 〜そう. Do NOT list',
  'single case particles, plain verb conjugation, です/ます, or vocabulary: only constructions that could be taught as a pattern.',
  'A list of known patterns is given below, one per line (name | template | also: other spellings). If a construction matches',
  'one of them (same pattern, even in a different conjugation or spelling, e.g. 訳がない = わけがない), PATTERN is that name copied',
  'EXACTLY as listed. Only when nothing in the list fits, give a NEW pattern: a short canonical name in its dictionary shape',
  '(e.g. 〜ようにする) plus TEMPLATE and MEANING lines.',
  'Only cite a listed pattern when the sentence really contains its form: a similar-looking word is not a match (初めての is',
  'not 〜て初めて). Prefer 0-3 patterns per sentence over padding. SPAN must be copied EXACTLY from the sentence and cover only',
  'the words that make up the pattern itself, as short as possible (the construction with its attached words, e.g.',
  '食べてしまった; for a list pattern just the connector, e.g. そして, never the whole list). For a pattern with a gap join',
  'the two parts with 〜 (e.g. 読めば〜ほど).',
  'NOTE is one short plain-English line saying what the construction is doing in THIS sentence (not a dictionary definition).',
  'Under each "=== Sentence N ===" header write blocks exactly like these:',
  '=== Sentence 1 ===',
  'PATTERN: 〜てしまう',
  'SPAN: 食べてしまった',
  'NOTE: the 〜てしまった shows regret that it is already done',
  'PATTERN: 〜ようにする',
  'TEMPLATE: [verb dictionary form] + ようにする',
  'MEANING: make a point of doing / try to',
  'SPAN: 食べるようにして',
  'NOTE: she is making a habit of eating it',
  'If a sentence has no construction worth noting, write only "NONE" under its header.',
];

/** Standalone prompt for one batch: sentences are numbered 1..n and the reply cites them as "=== Sentence N ===". */
export function buildGrammarPrompt(
  sentences: readonly { japanese: string; translation: string }[],
  patterns: readonly GrammarPatternRef[],
): string {
  return [
    'You are helping a Japanese learner notice reusable grammar patterns in sentences from their study material.',
    '',
    `TASK — ${GRAMMAR_HEADING}.`,
    ...GRAMMAR_INSTRUCTION_LINES,
    'Reply as plain text in your message — no attachment, no code fence, no files written, and no commentary.',
    '',
    '--- known patterns ---',
    ...formatGrammarPatternList(patterns),
    '',
    '--- sentences ---',
    ...sentences.map((sentence, index) => `Sentence ${index + 1}: ${sentence.japanese} || ${sentence.translation}`),
    '',
  ].join('\n');
}

const SECTION_RE = /^===\s*Sentence\s+(\d+)\s*===$/;
const FIELD_RE = /^(PATTERN|TEMPLATE|MEANING|SPAN|NOTE)\s*[:：]\s*(.*)$/i;

function parseBlock(lines: string[]): ParsedGrammarLink | null {
  const fields = new Map<string, string>();
  for (const raw of lines) {
    const match = FIELD_RE.exec(raw.trim());
    if (match) fields.set(match[1]!.toUpperCase(), match[2]!.trim());
  }
  const name = fields.get('PATTERN') ?? '';
  const span = fields.get('SPAN') ?? '';
  if (!name || !span) return null;
  return {
    name,
    template: fields.get('TEMPLATE') ?? '',
    meaning: fields.get('MEANING') ?? '',
    span,
    note: fields.get('NOTE') ?? '',
  };
}

/**
 * One entry per sentence `1..expectedCount`: the usable links (`[]` for NONE), or `null` when the section is
 * missing or every block in it was unusable, so that sentence stays a candidate for the next run.
 */
export function parseBookGrammarReply(reply: string, expectedCount: number): Array<ParsedGrammarLink[] | null> {
  const sections = new Map<number, string[]>();
  let current: string[] | null = null;
  for (const raw of reply.split('\n')) {
    const match = SECTION_RE.exec(raw.trim());
    if (match) {
      current = [];
      sections.set(Number(match[1]), current);
    } else current?.push(raw);
  }
  const results: Array<ParsedGrammarLink[] | null> = [];
  for (let n = 1; n <= expectedCount; n += 1) {
    const lines = sections.get(n);
    if (!lines) {
      results.push(null);
      continue;
    }
    const blocks: string[][] = [];
    for (const line of lines) {
      if (/^\s*PATTERN\s*[:：]/i.test(line)) blocks.push([line]);
      else blocks.at(-1)?.push(line);
    }
    const links = blocks.flatMap((block) => {
      const parsed = parseBlock(block);
      return parsed ? [parsed] : [];
    });
    results.push(blocks.length > 0 && links.length === 0 ? null : links);
  }
  return results;
}

const GAP_RE = /[〜～~…]+/;

/**
 * Where `span` sits in `sentence`. A span written with a gap marker (読めば〜ほど) must have every part found in
 * order; the range runs from the first part's start to the last part's end. Returns null when the text is not in
 * the sentence, so a hallucinated span is dropped instead of highlighting the wrong words.
 */
export function locateGrammarSpan(
  sentence: string,
  span: string,
): { start: number; end: number; surfaceForm: string } | null {
  const parts = span.split(GAP_RE).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let from = 0;
  let start = -1;
  let end = -1;
  for (const part of parts) {
    const at = sentence.indexOf(part, from);
    if (at < 0) return null;
    if (start < 0) start = at;
    end = at + part.length;
    from = end;
  }
  return { start, end, surfaceForm: sentence.slice(start, end) };
}
