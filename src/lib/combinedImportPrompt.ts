/**
 * Quick import's single combined prompt: segment + translate (PART 1, required)
 * plus the per-book prompts that otherwise need a separate round trip after
 * import — focus targets and phrase constructions (episode pack), chunk
 * structure, comprehension checks and particle questions. The assistant
 * numbers its own sentences S1..Sn and every later part refers to them by
 * that number; `quickImportExtras.ts` maps the numbers onto the committed
 * sentences. The reply is one `=== PART ===`-delimited text file.
 */
import { TARGET_INSTRUCTIONS, TARGET_SHAPE } from './episodePack';
import { EPISODE_PREPARATION_VERSION } from './episodePreparation';
import { STRUCTURE_LINE_EXAMPLE, buildStructureInstructions } from './episodeStructure';
import { formatWizardTimestamp, type WizardTranscriptSeg } from './miningTranscript';
import { CONSTRUCTION_SHAPE, buildConstructionInstructions } from './phraseConstruction';

export interface CombinedPromptOptions {
  targets?: boolean;
  structure?: boolean;
  constructions?: boolean;
  comprehension?: boolean;
  particles?: boolean;
}

export const COMBINED_REPLY_FILENAME = 'quick-import-reply.txt';
export const COMBINED_PROMPT_FILENAME = 'quick-import-prompt.txt';

const SENTENCE_RULES = [
  'You are helping prepare a Japanese transcript for shadowing practice. The work has',
  'several parts; PART 1 (SENTENCES) is required and the others are optional extras',
  'listed under "PARTS REQUESTED" at the end of the instructions.',
  '',
  'Below the instructions are timed fragments from automatic transcription. They often break',
  'mid-sentence and may lack punctuation or contain small recognition errors.',
  '',
  'PART 1 — SENTENCES. Segment the transcript into clean sentences AND translate each one.',
  'For each sentence:',
  '- Add sentence-final punctuation (。！？) where it belongs.',
  '- Fix obvious mis-recognitions, but keep the Japanese wording faithful — do not paraphrase it.',
  '- Begin the line with the [m:ss] timestamp of the fragment where that sentence starts.',
  '- Keep lines short enough to shadow: merge at most 2-3 source fragments into one line.',
  '  Never combine a long run of fragments into one paragraph-length sentence, even if the',
  '  original speech runs on without a clear break — split it at a natural pause instead.',
  '- After the Japanese, add " || " followed by a natural, idiomatic English translation of',
  '  that sentence only. Translate faithfully — do not paraphrase away nuance, and do not add',
  '  explanation or notes.',
  '- One sentence per line, formatted exactly as: [m:ss] 日本語文。 || English translation',
  '',
  'Count your sentences S1, S2, S3… in the order they appear in PART 1 — but do NOT write the S-number on the PART 1 lines',
  '(each line starts with the [m:ss] timestamp). Every later part refers to sentences ONLY by these counts (S4, or',
  '"Sentence 4"), never by timestamp.',
];

function withDefaults(options: CombinedPromptOptions): Required<CombinedPromptOptions> {
  return {
    targets: options.targets ?? true,
    structure: options.structure ?? true,
    constructions: options.constructions ?? true,
    comprehension: options.comprehension ?? true,
    particles: options.particles ?? true,
  };
}

function extraBlocks(opts: Required<CombinedPromptOptions>): { heading: string; lines: string[] }[] {
  const blocks: { heading: string; lines: string[] }[] = [];
  if (opts.targets || opts.constructions) {
    const shape: Record<string, unknown> = { version: EPISODE_PREPARATION_VERSION };
    const lines: string[] = [];
    if (opts.targets) {
      const targetShape: Record<string, unknown> = { ...TARGET_SHAPE };
      delete targetShape.ref;
      shape.targets = [targetShape];
      lines.push(
        ...TARGET_INSTRUCTIONS,
        'Omit "ref" on every target. Each occurrence "sentence" is an S-number from PART 1 and its "text" is an exact substring of that sentence.',
        '',
      );
    }
    if (opts.constructions) {
      shape.constructions = CONSTRUCTION_SHAPE;
      lines.push(
        ...buildConstructionInstructions(),
        'Every construction "text" must be copied exactly from the sentence it names; omit a sentence that has nothing worth explaining.',
        '',
      );
    }
    lines.push(
      'Write ONLY this JSON (plain straight quotes), using S-numbers from PART 1 as the sentence keys:',
      JSON.stringify(shape, null, 2),
    );
    blocks.push({ heading: 'EPISODE PACK', lines });
  }
  if (opts.structure) {
    blocks.push({
      heading: 'STRUCTURE',
      lines: [
        ...buildStructureInstructions(),
        'Cover every sentence from PART 1. One chunk per line, in this exact form: S-number | chunk text | role | short English gloss',
        'Example:',
        STRUCTURE_LINE_EXAMPLE,
      ],
    });
  }
  if (opts.comprehension) {
    blocks.push({
      heading: 'COMPREHENSION',
      lines: [
        'For each sentence, write a reading-comprehension check. First translate the sentence *in isolation* (as if you had not',
        'seen the sentences before it) and note any ambiguity a cold reading would leave unresolved (dropped subject/pronoun',
        'referent, tense/aspect, register). Then translate it *using the preceding sentences* to resolve that ambiguity.',
        'Produce exactly 4 English options for "which sentence best represents the target sentence, in context": one correct',
        '(the in-context translation) and three plausible near-miss mistranslations a cold reading could produce.',
        'Write one block per sentence under its "=== Sentence N ===" header (N = the S-number), the 4 options only, numbered 1-4,',
        'the correct one marked by a leading asterisk:',
        '=== Sentence 1 ===',
        '1. Some incorrect option',
        '*2. The correct, in-context option',
        '3. Some incorrect option',
        '4. Some incorrect option',
      ],
    });
  }
  if (opts.particles) {
    blocks.push({
      heading: 'PARTICLES',
      lines: [
        'For each sentence pick the chunks that end in a CASE particle (に で と へ を が から まで より) whose role is worth a',
        'question. Do NOT ask about the topic/contrast markers は and も (e.g. 将来は, 私は, ときも) or time clauses such as',
        '〜ときは — their role is just "this is the topic/also" and makes a weak question. Also skip trivially obvious roles,',
        'quotative と, listed items (や/と between nouns) and particles inside fixed expressions. Ask only when the question has',
        'exactly ONE defensible answer given the sentence and its English meaning; if you would have to stretch to write three',
        'wrong options, skip that chunk. Prefer a sentence with 0 questions over a forced one.',
        'Ask about the',
        "role of that phrase IN THIS SENTENCE, in plain English using the sentence's own words (e.g. \"What role does the bin",
        "play in putting it in?\"), not \"what does に mean?\". Give exactly 4 concrete readings phrased with the sentence's own",
        'nouns and verb; one correct, three plausible-but-wrong for this sentence. No grammar-category labels.',
        'Under each "=== Sentence N ===" header write blocks exactly like this (correct option starts with "*"):',
        '=== Sentence 1 ===',
        'CHUNK: ゴミ箱に',
        'Q: What role does the bin play in putting it in?',
        '1. the bin is where it happens',
        '*2. the bin is where the thing ends up',
        '3. the bin is who receives it',
        '4. the bin is what it is compared to',
        opts.structure
          ? "CHUNK must be copied exactly from that sentence's chunks in your STRUCTURE part."
          : 'CHUNK must be copied exactly from the sentence and end with the particle.',
        'If a sentence has nothing worth asking, write only "NONE" under its header.',
      ],
    });
  }
  return blocks;
}

export function formatCombinedPromptForAI(
  segs: WizardTranscriptSeg[],
  options: CombinedPromptOptions = {},
): string {
  const blocks = extraBlocks(withDefaults(options));
  const headings = ['SENTENCES', ...blocks.map((block) => block.heading)];
  const body = segs.map((seg) => `[${formatWizardTimestamp(seg.startMs)}] ${seg.text.trim()}`).join('\n');
  const out: string[] = [...SENTENCE_RULES];
  blocks.forEach((block, index) => {
    out.push('', `PART ${index + 2} — ${block.heading}.`, ...block.lines);
  });
  out.push(
    '',
    `PARTS REQUESTED: ${headings.join(', ')}.`,
    '',
    'OUTPUT FORMAT. Put everything in ONE plain-text file and nothing else. Separate the parts with these exact header lines,',
    'each on its own line, in this order:',
    ...headings.map((heading) => `=== ${heading} ===`),
    `If you can create files, generate that file as a downloadable attachment named ${COMBINED_REPLY_FILENAME} and give me the`,
    'download link — do not paste its contents into the chat. If you cannot create files, reply with the whole thing in one',
    'plain code block instead. No commentary before, between or after the parts.',
    '',
    '--- transcript ---',
    body,
    '',
  );
  return out.join('\n');
}

export interface CombinedReplySections {
  sentences: string;
  pack: string;
  structure: string;
  comprehension: string;
  particles: string;
}

const SECTION_HEADER_RE = /^={2,}\s*(SENTENCES|EPISODE PACK|STRUCTURE|COMPREHENSION|PARTICLES)\s*={2,}$/i;
const SECTION_KEYS: Record<string, keyof CombinedReplySections> = {
  SENTENCES: 'sentences',
  'EPISODE PACK': 'pack',
  STRUCTURE: 'structure',
  COMPREHENSION: 'comprehension',
  PARTICLES: 'particles',
};

/**
 * Split a reply on its `=== PART ===` headers. A reply with no recognised
 * header is treated as bare `[m:ss] japanese || english` lines, so replies in
 * the older single-part format still import.
 */
export function splitCombinedReply(reply: string): CombinedReplySections {
  const buffers: Record<keyof CombinedReplySections, string[]> = {
    sentences: [],
    pack: [],
    structure: [],
    comprehension: [],
    particles: [],
  };
  let current: keyof CombinedReplySections | null = null;
  let sawHeader = false;
  for (const rawLine of reply.replace(/^﻿/, '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const match = SECTION_HEADER_RE.exec(trimmed);
    if (match) {
      current = SECTION_KEYS[match[1]!.toUpperCase()]!;
      sawHeader = true;
      continue;
    }
    if (/^```/.test(trimmed)) continue;
    if (current) buffers[current].push(rawLine);
  }
  if (!sawHeader) {
    return { sentences: reply, pack: '', structure: '', comprehension: '', particles: '' };
  }
  return {
    sentences: buffers.sentences.join('\n').trim(),
    pack: buffers.pack.join('\n').trim(),
    structure: buffers.structure.join('\n').trim(),
    comprehension: buffers.comprehension.join('\n').trim(),
    particles: buffers.particles.join('\n').trim(),
  };
}

/** Rewrite every `S<n>` handle through `map`; unmapped numbers become `S0`, which the downstream parsers reject. */
export function remapSentenceHandles(text: string, map: ReadonlyMap<number, number>): string {
  return text.replace(/\bS(\d+)\b/g, (_whole, digits: string) => `S${map.get(Number(digits)) ?? 0}`);
}
