import type { Sentence } from '../domain/types';
import type { ReadingContext } from './readingContext';
import type { ComprehensionCheck } from '../domain/types';

// ---------------------------------------------------------------------------
// Comprehension-check authoring round-trip for `reading_in_context`
// (docs/ROADMAP.md "Context-aware comprehension check…"). Same shape as
// `miningTranscript.ts`'s "Segment with AI help": build a copy-pasteable
// prompt, the author pastes an external assistant's reply back in, parse it
// into structured data. Deliberately a manual copy/paste flow, not another
// Edge Function — no key, no deploy, works with whatever assistant the
// author already has open.
//
// The recipe (from the ROADMAP discussion): translate the sentence cold
// (no context) vs. with its preceding context — the cold reading's
// plausible errors (dropped subject/pronoun referent, tense/aspect,
// register) are the distractors. Authored once per sentence and stored on
// `SentenceAnalysis.comprehensionCheck`, not recomputed per review.
// ---------------------------------------------------------------------------

const AI_PROMPT_HEADER = [
  'You are writing a reading-comprehension check for a Japanese learner.',
  '',
  'Below is a target Japanese sentence, plus the sentences immediately',
  'before it for context. First translate the target sentence *in isolation*',
  '(as if you had not seen the context) — note any ambiguity a cold reading',
  'would leave unresolved (dropped subject/pronoun referent, tense/aspect,',
  'register, etc). Then translate it again *using the context* to resolve',
  'that ambiguity.',
  '',
  'Now produce exactly 4 English options for "which sentence best represents',
  'the target sentence, in context":',
  '- One correct option: the in-context translation.',
  "- Three incorrect options: plausible mistranslations a cold (no-context)",
  '  reading could produce — near-misses, not random sentences.',
  '',
  'Output only the 4 options, one per line, numbered 1-4, with the correct',
  'one marked by a leading asterisk. Example:',
  '1. Some incorrect option',
  '*2. The correct, in-context option',
  '3. Some incorrect option',
  '4. Some incorrect option',
  '',
  '--- context (preceding sentences) ---',
].join('\n');

export function formatComprehensionPromptForAI(
  sentence: Sentence,
  context: Pick<ReadingContext, 'before'>,
): string {
  const contextLines = context.before.length
    ? context.before.map((s) => s.japanese).join('\n')
    : '(none — this is the first sentence)';
  return [
    AI_PROMPT_HEADER,
    contextLines,
    '',
    '--- target sentence ---',
    sentence.japanese,
    '',
  ].join('\n');
}

const OPTION_LINE_RE = /^(\*)?\s*([1-4])[.)]\s*(.+)$/;

/**
 * Parse a pasted-back reply into `{ options, correctIndex }`. Requires
 * exactly one line per number 1-4 and exactly one marked correct (`*`) —
 * returns `null` on anything else (missing numbers, duplicates, zero or
 * multiple `*` marks) so the caller can warn instead of saving bad data.
 */
export function parseComprehensionCheckReply(
  reply: string,
): { options: string[]; correctIndex: number } | null {
  const byNumber = new Map<number, { text: string; correct: boolean }>();
  for (const rawLine of reply.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = OPTION_LINE_RE.exec(line);
    if (!match) continue;
    const num = Number(match[2]);
    const text = match[3]!.trim();
    if (!text) continue;
    byNumber.set(num, { text, correct: Boolean(match[1]) });
  }
  if (byNumber.size !== 4) return null;
  const options: string[] = [];
  let correctIndex = -1;
  for (let num = 1; num <= 4; num += 1) {
    const entry = byNumber.get(num);
    if (!entry) return null;
    if (entry.correct) {
      if (correctIndex !== -1) return null;
      correctIndex = num - 1;
    }
    options.push(entry.text);
  }
  if (correctIndex === -1) return null;
  return { options, correctIndex };
}

// ---------------------------------------------------------------------------
// Batch variant — same recipe, but one prompt covers many sentences (a
// book's confirmed-vocab, full-review-ready sentences with no check yet)
// instead of one round-trip per sentence. The reply is split on
// "=== Sentence N ===" headers and each section re-uses
// parseComprehensionCheckReply, so a single malformed section doesn't
// invalidate the rest of the batch.
// ---------------------------------------------------------------------------

const BATCH_AI_PROMPT_HEADER = [
  'You are writing reading-comprehension checks for a Japanese learner, one',
  'per sentence below. For each sentence: first translate it *in isolation*',
  '(as if you had not seen the context) — note any ambiguity a cold reading',
  'would leave unresolved (dropped subject/pronoun referent, tense/aspect,',
  'register, etc). Then translate it again *using the context* to resolve',
  'that ambiguity.',
  '',
  'Then produce exactly 4 English options for "which sentence best represents',
  'the target sentence, in context":',
  '- One correct option: the in-context translation.',
  "- Three incorrect options: plausible mistranslations a cold (no-context)",
  '  reading could produce — near-misses, not random sentences.',
  '',
  'Reply with one section per sentence, repeating the exact',
  '"=== Sentence N ===" header shown below, each followed by that',
  "sentence's 4 options only, one per line, numbered 1-4, with the correct",
  'one marked by a leading asterisk. Example section:',
  '=== Sentence 1 ===',
  '1. Some incorrect option',
  '*2. The correct, in-context option',
  '3. Some incorrect option',
  '4. Some incorrect option',
].join('\n');

export function formatBatchComprehensionPromptForAI(
  items: { sentence: Sentence; before: Sentence[] }[],
): string {
  const sections = items.map((item, i) => {
    const contextLines = item.before.length
      ? item.before.map((s) => s.japanese).join('\n')
      : '(none — this is the first sentence)';
    return [
      `=== Sentence ${i + 1} ===`,
      '--- context (preceding sentences) ---',
      contextLines,
      '--- target sentence ---',
      item.sentence.japanese,
    ].join('\n');
  });
  return [BATCH_AI_PROMPT_HEADER, '', ...sections].join('\n\n');
}

const BATCH_SECTION_HEADER_RE = /^===\s*Sentence\s+(\d+)\s*===$/;

/**
 * Returns one entry per `1..expectedCount`, in order — `null` where that
 * section is missing or fails parseComprehensionCheckReply's validation,
 * so the caller can save the good entries and report the rest.
 */
export function parseBatchComprehensionCheckReply(
  reply: string,
  expectedCount: number,
): Array<{ options: string[]; correctIndex: number } | null> {
  const sections = new Map<number, string>();
  let currentNum: number | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    if (currentNum !== null) sections.set(currentNum, currentLines.join('\n'));
  };
  for (const rawLine of reply.split('\n')) {
    const match = BATCH_SECTION_HEADER_RE.exec(rawLine.trim());
    if (match) {
      flush();
      currentNum = Number(match[1]);
      currentLines = [];
    } else if (currentNum !== null) {
      currentLines.push(rawLine);
    }
  }
  flush();

  const results: Array<{ options: string[]; correctIndex: number } | null> = [];
  for (let i = 1; i <= expectedCount; i += 1) {
    const section = sections.get(i);
    results.push(section ? parseComprehensionCheckReply(section) : null);
  }
  return results;
}

export function buildComprehensionCheck(
  parsed: { options: string[]; correctIndex: number },
  provenance: ComprehensionCheck['provenance'],
): ComprehensionCheck {
  return {
    options: parsed.options,
    correctIndex: parsed.correctIndex,
    provenance,
    createdAt: new Date().toISOString(),
  };
}
