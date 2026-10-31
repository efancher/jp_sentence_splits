// Book-assistant "grammar links" extra: instructions, pattern-list formatting and reply parsing.
// Kept free of database imports so the box-side assist run (compiled outside the app project) can use it.

export interface GrammarPatternRef {
  id: string;
  name: string;
  template?: string;
  aliases?: string[];
}

export interface ParsedGrammarLink {
  /** 1-based index into the pattern list the assistant was shown; absent for a proposed new pattern. */
  patternNumber?: number;
  newPattern?: { name: string; template: string; meaning: string };
  /** Exact text from the sentence, `〜`/`…` joining the parts of a discontinuous pattern. */
  span: string;
  note: string;
}

export const GRAMMAR_HEADING = 'GRAMMAR';

/** Patterns are listed to the assistant as P1..Pn, in this order, so replies can cite them by number. */
export function formatGrammarPatternList(patterns: readonly GrammarPatternRef[]): string[] {
  if (patterns.length === 0) return ['(No patterns are known yet: every pattern you report is NEW.)'];
  return patterns.map((pattern, index) => {
    const extras = [pattern.template, pattern.aliases?.length ? `also: ${pattern.aliases.join(', ')}` : '']
      .filter(Boolean)
      .join(' | ');
    return `P${index + 1} ${pattern.name}${extras ? ` | ${extras}` : ''}`;
  });
}

export const GRAMMAR_INSTRUCTION_LINES: string[] = [
  'For each sentence list the reusable grammar constructions it uses that a learner should notice: patterns like 〜ている,',
  '〜てしまう, 〜ことができる, 〜ようになる, 〜ば〜ほど, 〜わけがない, conditionals, 〜ながら, passive/causative, 〜そう. Do NOT list',
  'single case particles, plain verb conjugation, です/ます, or vocabulary: only constructions that could be taught as a pattern.',
  'A pattern list is given below as P1..Pn. If a construction matches one of them (same pattern, even in a different',
  'conjugation or spelling, e.g. 訳がない = わけがない), cite it by number. Only when nothing in the list fits, propose a NEW',
  'pattern with a short canonical name in its dictionary shape (e.g. 〜ようにする), a structural template and a one-line meaning.',
  'Prefer 0-3 patterns per sentence over padding. SPAN must be copied EXACTLY from the sentence (the construction with its',
  'attached words, e.g. 食べてしまった); for a pattern with a gap join the two parts with 〜 (e.g. 読めば〜ほど).',
  'NOTE is one short plain-English line saying what the construction is doing in THIS sentence (not a dictionary definition).',
  'Under each "=== Sentence N ===" header write blocks exactly like these:',
  '=== Sentence 1 ===',
  'PATTERN: P12',
  'SPAN: 食べてしまった',
  'NOTE: the 〜てしまった shows regret that it is already done',
  'PATTERN: NEW',
  'NAME: 〜ようにする',
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
const FIELD_RE = /^(PATTERN|NAME|TEMPLATE|MEANING|SPAN|NOTE)\s*[:：]\s*(.*)$/i;

function parseBlock(lines: string[], patternCount: number): ParsedGrammarLink | null {
  const fields = new Map<string, string>();
  for (const raw of lines) {
    const match = FIELD_RE.exec(raw.trim());
    if (match) fields.set(match[1]!.toUpperCase(), match[2]!.trim());
  }
  const pattern = fields.get('PATTERN') ?? '';
  const span = fields.get('SPAN') ?? '';
  const note = fields.get('NOTE') ?? '';
  if (!span) return null;
  if (/^NEW$/i.test(pattern)) {
    const name = fields.get('NAME') ?? '';
    if (!name) return null;
    return { newPattern: { name, template: fields.get('TEMPLATE') ?? '', meaning: fields.get('MEANING') ?? '' }, span, note };
  }
  const number = /^P(\d+)$/i.exec(pattern);
  if (!number) return null;
  const patternNumber = Number(number[1]);
  if (patternNumber < 1 || patternNumber > patternCount) return null;
  return { patternNumber, span, note };
}

/**
 * One entry per sentence `1..expectedCount`: the usable links (`[]` for NONE), or `null` when the section is
 * missing or every block in it was unusable, so that sentence stays a candidate for the next run.
 */
export function parseBookGrammarReply(
  reply: string,
  expectedCount: number,
  patternCount: number,
): Array<ParsedGrammarLink[] | null> {
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
      const parsed = parseBlock(block, patternCount);
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
