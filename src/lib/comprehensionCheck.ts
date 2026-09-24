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
