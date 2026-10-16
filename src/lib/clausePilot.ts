import { CLAUSE_PILOT } from '../data/clausePilot';
import reviewNotes from '../data/clauseReviewNotes.json';

export interface ClausePilotReference {
  id: string;
  source: string;
  targetText: string;
  question: string;
  options: readonly string[];
  answerText: string;
  explanation: string;
}

/** Native string offsets are UTF-16, matching slice() and the rest of the rendering code. */
export function uniqueTextSpan(source: string, text: string): { start: number; end: number } | null {
  const start = text ? source.indexOf(text) : -1;
  return start >= 0 && source.indexOf(text, start + 1) < 0 ? { start, end: start + text.length } : null;
}

export function clausePilotFor(source: string, references: readonly ClausePilotReference[] = CLAUSE_PILOT): ClausePilotReference | null {
  return references.find((reference) => reference.source === source &&
    uniqueTextSpan(source, reference.targetText) &&
    reference.options.length >= 2 && new Set(reference.options).size === reference.options.length &&
    reference.options.every((option) => uniqueTextSpan(source, option)) &&
    reference.options.includes(reference.answerText)) ?? null;
}

export type ClausePilotFeedback = 'helpful' | 'disputed';
// Separate from learner evidence, sync and scheduling. A draft revision gets a new key.
export const clausePilotFeedbackKey = (id: string) => `glossbook.clausePilot.feedback.${id}`;


/** Exact-source review notes expire when the sentence changes, just like questions. */
export function clauseQuestionAvailability(source: string):
  | { status: 'ready'; reference: ClausePilotReference }
  | { status: 'reviewed'; reason: string }
  | { status: 'missing' } {
  const reference = clausePilotFor(source);
  if (reference) return { status: 'ready', reference };
  const note = reviewNotes.find((item) => item.source === source);
  return note ? { status: 'reviewed', reason: note.reason } : { status: 'missing' };
}
