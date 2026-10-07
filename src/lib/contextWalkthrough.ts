/**
 * Contextual sentence walkthrough: for one sentence, an ordered list of meaningful word groups (spans
 * that may cross chunk boundaries), what each means *here*, which other span it connects to and how,
 * what Japanese leaves implicit, and a natural whole-sentence meaning. Drafted by an external AI from a
 * pasted episode-pack reply that includes the surrounding sentences.
 *
 * Trust boundary matches phraseConstruction.ts: the AI supplies handles and quoted text only; offsets
 * are computed here, bad steps are dropped individually, and everything is re-validated against the
 * live sentence before display. Nothing here touches reviews or FSRS.
 */
import type { ContextWalkthrough, ContextWalkthroughStep, WalkthroughParticipant, WalkthroughRelation, WalkthroughSpan } from '../domain/types';

import type { PreparationContext } from './episodePreparation';

export const WALKTHROUGH_SENTENCES_PER_PART = 12;
export const WALKTHROUGH_CONTEXT_BEFORE = 3;
export const WALKTHROUGH_CONTEXT_AFTER = 2;
/** Entries below this version still display but are offered for enrichment (see `sentencesNeedingUpgrade`). */
export const CONTEXT_WALKTHROUGH_VERSION = 2;
export const RELATIONS: readonly WalkthroughRelation[] = ['subject', 'object', 'topic', 'modifier', 'quotation', 'listing', 'predicate', 'adverbial', 'link', 'other'];
const MAX_STEPS = 16;
const MAX_FIELD = 320;
const MAX_DETAIL = 700;

export function buildWalkthroughInstructions(): string[] {
  return [
    'SENTENCE WALKTHROUGHS: for each sentence under "EXPLAIN THESE", teach the learner how its parts produce its meaning in context.',
    'Read the surrounding sentences first. Use them to decide what is being referred to, who is speaking, and what is left unsaid.',
    'Rules:',
    '- Group words that work together into ONE step (e.g. a verb plus its helper, a whole clause that describes a noun). Do not explain every',
    '  token separately, and never produce a step for punctuation alone. A step may span what a chunker would split.',
    '- Steps are in teaching order (usually left to right, but a clause that modifies a noun may come just before the noun step). Steps may nest',
    '  (a clause step, then the noun it describes) but must not partly overlap each other.',
    '- "gloss": natural English for just that span in context, not word-for-word.',
    '- "explanation": what the span means in THIS sentence and how it does it, in plain English, one or two short sentences.',
    '- "connects": the other span it attaches to and HOW (e.g. "を marks 何か as the thing being written"; "the whole phrase describes やつ").',
    '  Omit when the step stands alone. "to" must be copied exactly from the sentence; if that text occurs more than once, add "occurrence"',
    '  (1 = first occurrence in the sentence) to say which one. Same for a repeated step "text": list the steps in sentence order.',
    '- "mechanics": what particles, conjugations or constructions contribute (e.g. "書いたり + する lists writing as one example of several").',
    '  Mention a surprising form (such as た-looking forms that are not past tense here). Use a grammar term only when it helps, and explain it.',
    '- "implicit": what Japanese leaves unsaid that natural English must supply (a subject, an object, a relationship such as "on" or "for").',
    '- "nuance": conversational tone, politeness, softening or invited agreement, only where it matters.',
    '- "inferred": use ONLY for something that rests on the surrounding sentences rather than this sentence itself. Say what it rests on.',
    '  Never invent context that is not in the text you were given; say what is unknown instead.',
    '- Omit any optional field that has nothing real to say. Keep each field short; put anything longer in "detail".',
    '- "natural": a natural English rendering of the whole sentence. "caveat": say when the reading depends on context or could be taken',
    '  another way (e.g. "the other one" only fits if two things are being discussed; otherwise "another one"). Omit it when nothing is ambiguous.',
    'Structure rules (these matter most):',
    '- Attach every dependent to the predicate or phrase it ACTUALLY belongs to, never by default to the last verb. In a sentence with several',
    '  clauses, decide clause by clause: an object marked を belongs to the verb of its own clause, even when that clause is only describing a noun.',
    '- "relation" says what the step is to the span in "connects.to": subject, object, topic, modifier (a word or clause describing a noun),',
    '  quotation (a thought or speech reported before と思う / と言う), listing (と/や/も joining nouns), predicate, adverbial, link, or other.',
    '- A clause that describes a noun gets its own step with relation "modifier" and connects.to = that noun; nest the clause\'s inner steps inside it.',
    '- Treat compounds, loanwords, fixed expressions and verb + auxiliary chains (e.g. 聞いている, 学んでいる) as ONE step with the meaning of the whole.',
    '  Put their components in "parts" ([{text, gloss}]) for optional inspection, only when a component is genuinely informative. Never split a',
    '  loanword or name (ポッドキャスト) or a well-known compound (日本語) into pieces as the main gloss.',
    '- When the same particle appears twice with different jobs (e.g. quotation と vs noun-linking と), give each its own explanation of the job it does HERE.',
    '- "participants": for each clause with a predicate, who does or experiences it. basis is "stated" if the sentence names them, "inferred" only if',
    '  surrounding sentences show it. If the context does not settle it, set who to "not specified" rather than inventing one.',
    '- "check": one short question about the sentence\'s real difficulty (attachment, who, scope), with its answer. Omit for trivial sentences.',
    '- Sentence-specific beats generic: write "を marks このポッドキャスト as what the listeners listen to", not "を marks the object".',
    'Do not use a grammar label as a substitute for an explanation, and do not add any quotation marks other than JSON string quotes.',
  ];
}

export const WALKTHROUGH_SHAPE = {
  S4: {
    natural: 'The other one is paper: the stuff you write things on, you know.',
    participants: [{ clause: '書いたりする', who: 'you / people in general', role: 'the one writing', basis: 'inferred' }],
    check: { question: 'What noun does 何かを書いたりする describe?', answer: 'やつ (the thing, i.e. paper).' },
    caveat: '"The other one" fits when two things are being discussed; otherwise もう一つ can mean "another one".',
    steps: [
      {
        text: 'もう一つは紙',
        gloss: 'As for the other one, it is paper.',
        explanation: 'もう一つ introduces one more item, は makes it the topic, and 紙 says what it is.',
        mechanics: 'は marks what the sentence is about; 紙 completes it as the answer.',
        inferred: 'Which items "the other one" contrasts with comes from the preceding sentences.',
      },
      {
        text: '何かを',
        gloss: 'something (as the thing written)',
        explanation: 'を connects 何か to 書く: you write something.',
        relation: 'object',
        connects: { to: '書いたり', how: '何か is what gets written' },
      },
      {
        text: '書いたりする',
        gloss: 'do things like writing',
        explanation: '書く becomes 書いたり and combines with する to present writing as one example among others.',
        mechanics: 'Although it contains 書いた, this is not a past-tense statement; たり lists examples.',
      },
      {
        text: '何かを書いたりするやつ',
        gloss: 'the stuff you do things like writing on',
        explanation: 'The whole phrase before やつ describes やつ, which refers back to 紙.',
        relation: 'modifier',
        parts: [{ text: 'やつ', gloss: 'casual word for "thing/one"' }],
        connects: { to: '紙', how: 'やつ is an informal word for "thing", pointing back at paper' },
        implicit: 'Japanese does not say "on"; natural English has to make that relationship explicit.',
        nuance: 'やつ is casual, which fits relaxed speech.',
      },
      {
        text: 'ですね',
        gloss: 'you know / right?',
        explanation: 'です gives a polite ending; ね invites the listener to agree.',
        nuance: 'Roughly "you know" or "right?", depending on the speaker and the mood.',
      },
    ],
  },
};

function field(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function partlyOverlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const aInB = a.start >= b.start && a.end <= b.end;
  const bInA = b.start >= a.start && b.end <= a.end;
  return overlaps(a, b) && !aInB && !bInA;
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) out.push(at);
  return out;
}

const HAS_CONTENT = /[\p{L}\p{N}]/u;

export interface WalkthroughParse {
  drafts: Map<string, ContextWalkthrough>;
  rejected: { handle: string; reason: string }[];
}

/**
 * Validate a `walkthroughs` object keyed by sentence handle. A step's quote may occur more than once;
 * repeats are assigned to successive occurrences. A connection that cannot be anchored is dropped from
 * its step (the step stays); a step that cannot be anchored is dropped from the sentence.
 */
export function parseWalkthroughs(raw: unknown, context: Pick<PreparationContext, 'sentences'>): WalkthroughParse {
  const drafts = new Map<string, ContextWalkthrough>();
  const rejected: WalkthroughParse['rejected'] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { drafts, rejected: [{ handle: 'walkthroughs', reason: '"walkthroughs" must be an object keyed by sentence handle.' }] };
  }
  const sentenceByHandle = new Map(context.sentences.map((sentence, index) => [`S${index + 1}`, sentence]));
  for (const [rawHandle, value] of Object.entries(raw)) {
    const handle = rawHandle.trim();
    const sentence = sentenceByHandle.get(handle);
    if (!sentence) {
      rejected.push({ handle, reason: 'Unknown sentence handle.' });
      continue;
    }
    const entry = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
    const natural = field(entry.natural);
    if (!natural || !Array.isArray(entry.steps)) {
      rejected.push({ handle, reason: 'Needs a "natural" meaning and a list of "steps".' });
      continue;
    }
    const steps: ContextWalkthroughStep[] = [];
    const dropped: string[] = [];
    for (const item of entry.steps.slice(0, MAX_STEPS)) {
      const step = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const text = typeof step.text === 'string' ? step.text : '';
      const gloss = field(step.gloss);
      const explanation = field(step.explanation);
      if (!text || !HAS_CONTENT.test(text) || !gloss || !explanation) {
        dropped.push(text || '(no text)');
        continue;
      }
      const taken = new Set(steps.filter((existing) => existing.text === text).map((existing) => existing.start));
      const start = occurrences(sentence.japanese, text).find((at) => !taken.has(at));
      if (start === undefined) {
        dropped.push(text);
        continue;
      }
      const span = { start, end: start + text.length };
      if (steps.some((existing) => partlyOverlaps(existing, span))) {
        dropped.push(text);
        continue;
      }
      const built: ContextWalkthroughStep = { text, ...span, gloss, explanation };
      const connect = (step.connects && typeof step.connects === 'object' ? step.connects : undefined) as Record<string, unknown> | undefined;
      const to = typeof connect?.to === 'string' ? connect.to : '';
      const how = field(connect?.how);
      if (to && how) {
        const all = occurrences(sentence.japanese, to);
        const nth = typeof connect?.occurrence === 'number' ? all[Math.floor(connect.occurrence) - 1] : undefined;
        const target =
          nth !== undefined && !overlaps({ start: nth, end: nth + to.length }, span)
            ? nth
            : all
                .filter((at) => !overlaps({ start: at, end: at + to.length }, span))
                .sort((a, b) => Math.abs(a - span.start) - Math.abs(b - span.start))[0];
        if (target !== undefined) built.connects = { text: to, start: target, end: target + to.length, how };
      }
      const relation = field(step.relation, 20).toLowerCase() as WalkthroughRelation;
      if (RELATIONS.includes(relation)) built.relation = relation;
      if (Array.isArray(step.parts)) {
        const parts = step.parts
          .map((part) => (part && typeof part === 'object' ? (part as Record<string, unknown>) : {}))
          .map((part) => ({ text: field(part.text, 60), gloss: field(part.gloss, 120) }))
          .filter((part) => part.text && part.gloss)
          .slice(0, 6);
        if (parts.length > 0) built.parts = parts;
      }
      for (const key of ['mechanics', 'implicit', 'nuance', 'inferred'] as const) {
        const value = field(step[key]);
        if (value) built[key] = value;
      }
      const detail = field(step.detail, MAX_DETAIL);
      if (detail) built.detail = detail;
      steps.push(built);
    }
    if (steps.length === 0) {
      rejected.push({ handle, reason: 'No step could be matched to the sentence text.' });
      continue;
    }
    if (dropped.length > 0) {
      rejected.push({ handle, reason: `Kept ${steps.length} step${steps.length === 1 ? '' : 's'}; dropped ${dropped.map((text) => `“${text}”`).join(', ')} (not in the sentence, incomplete or overlapping).` });
    }
    const caveat = field(entry.caveat);
    const participants = parseParticipants(entry.participants, sentence.japanese);
    const check = entry.check && typeof entry.check === 'object' ? (entry.check as Record<string, unknown>) : undefined;
    const question = field(check?.question);
    const answer = field(check?.answer);
    const problems = attachmentProblems(steps);
    if (problems.length > 0) rejected.push({ handle, reason: `Saved, but check attachment: ${problems.join('; ')}` });
    drafts.set(sentence.id, {
      version: CONTEXT_WALKTHROUGH_VERSION,
      natural,
      ...(caveat ? { caveat } : {}),
      ...(participants.length > 0 ? { participants } : {}),
      ...(question && answer ? { check: { question, answer } } : {}),
      steps,
    });
  }
  return { drafts, rejected };
}

function parseParticipants(raw: unknown, japanese: string): WalkthroughParticipant[] {
  if (!Array.isArray(raw)) return [];
  const out: WalkthroughParticipant[] = [];
  for (const item of raw.slice(0, 8)) {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const clause = field(entry.clause, 120);
    const who = field(entry.who, 120);
    const role = field(entry.role, 120);
    if (!clause || !who || !japanese.includes(clause)) continue;
    out.push({ clause, who, role, basis: entry.basis === 'inferred' ? 'inferred' : 'stated' });
  }
  return out;
}

/**
 * Mechanical sanity checks on attachment. These can't prove a parse right, but catch the signature
 * failure: a step claiming to attach to a span that sits inside itself, or every step piling onto one target.
 */
export function attachmentProblems(steps: ContextWalkthroughStep[]): string[] {
  const problems: string[] = [];
  const linked = steps.filter((step) => step.connects);
  for (const step of linked) {
    if (overlaps(step, step.connects!)) problems.push(`“${step.text}” connects to a span overlapping itself`);
  }
  const counts = new Map<string, number>();
  for (const step of linked) counts.set(step.connects!.text, (counts.get(step.connects!.text) ?? 0) + 1);
  for (const [target, n] of counts) {
    if (n >= 4 && n === linked.length) problems.push(`every connection points at “${target}”`);
  }
  return problems;
}

function spanHolds(japanese: string, span: WalkthroughSpan): boolean {
  return span.start >= 0 && span.end <= japanese.length && span.start < span.end && japanese.slice(span.start, span.end) === span.text;
}

/** The walkthrough with only the steps (and connections) that still match the live sentence; undefined when none do. */
export function validWalkthroughFor(japanese: string, walkthrough: ContextWalkthrough | undefined): ContextWalkthrough | undefined {
  if (!walkthrough?.natural?.trim()) return undefined;
  const steps = (walkthrough.steps ?? [])
    .filter((step) => spanHolds(japanese, step))
    .map((step) => {
      if (!step.connects || spanHolds(japanese, step.connects)) return step;
      const { connects: _dropped, ...rest } = step;
      return rest;
    });
  if (steps.length === 0) return undefined;
  const participants = walkthrough.participants?.filter((p) => japanese.includes(p.clause));
  const { participants: _old, ...rest } = walkthrough;
  return { ...rest, ...(participants && participants.length > 0 ? { participants } : {}), steps };
}

export type HighlightKind = 'plain' | 'main' | 'connect' | 'both';

/** The full sentence cut into runs, tagged by whether each run is the explained span, the span it connects to, or both. */
export function highlightSegments(
  japanese: string,
  main?: { start: number; end: number },
  connect?: { start: number; end: number },
): { text: string; kind: HighlightKind }[] {
  const clamp = (value: number) => Math.max(0, Math.min(japanese.length, value));
  const cuts = new Set([0, japanese.length]);
  for (const span of [main, connect]) {
    if (!span) continue;
    cuts.add(clamp(span.start));
    cuts.add(clamp(span.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const inside = (span: { start: number; end: number } | undefined, from: number, to: number) => !!span && from >= span.start && to <= span.end;
  const segments: { text: string; kind: HighlightKind }[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const isMain = inside(main, from, to);
    const isConnect = inside(connect, from, to);
    segments.push({ text: japanese.slice(from, to), kind: isMain && isConnect ? 'both' : isMain ? 'main' : isConnect ? 'connect' : 'plain' });
  }
  return segments;
}

/** Sentence ids whose usable walkthrough predates the structured format; displayed as-is until a richer one replaces it. */
export function sentencesNeedingUpgrade(
  sentences: { id: string; japanese: string }[],
  drafts: Record<string, ContextWalkthrough> | undefined,
): string[] {
  return sentences
    .filter((sentence) => {
      const valid = validWalkthroughFor(sentence.japanese, drafts?.[sentence.id]);
      return !!valid && (valid.version ?? 1) < CONTEXT_WALKTHROUGH_VERSION;
    })
    .map((sentence) => sentence.id);
}

/** Sentence ids that have no usable contextual walkthrough yet. */
export function sentencesNeedingWalkthrough(
  sentences: { id: string; japanese: string }[],
  drafts: Record<string, ContextWalkthrough> | undefined,
): string[] {
  return sentences.filter((sentence) => !validWalkthroughFor(sentence.japanese, drafts?.[sentence.id])).map((sentence) => sentence.id);
}

/**
 * Read-only context lines for the prompt: every requested sentence plus a few either side, in order,
 * with any saved English. Handles are the episode's own S-numbers so a reply maps straight back.
 */
export function walkthroughContextLines(context: Pick<PreparationContext, 'sentences'>, handles: string[]): string[] {
  const wanted = new Set(handles);
  const keep = new Set<number>();
  context.sentences.forEach((_, index) => {
    if (!wanted.has(`S${index + 1}`)) return;
    for (let at = index - WALKTHROUGH_CONTEXT_BEFORE; at <= index + WALKTHROUGH_CONTEXT_AFTER; at += 1) {
      if (at >= 0 && at < context.sentences.length) keep.add(at);
    }
  });
  const lines: string[] = [];
  let previous = -2;
  [...keep].sort((a, b) => a - b).forEach((index) => {
    if (index > previous + 1 && lines.length > 0) lines.push('...');
    const sentence = context.sentences[index]!;
    const english = sentence.translation?.trim();
    lines.push(`S${index + 1}: ${sentence.japanese}${english ? `   (English: ${english})` : ''}`);
    previous = index;
  });
  return lines;
}

/** Merges per-chapter drafts; a sentence in several chapters keeps its newest-format entry. */
export function mergeChapterWalkthroughs(
  chapters: { contextWalkthroughs?: Record<string, ContextWalkthrough> }[],
): Record<string, ContextWalkthrough> {
  const merged: Record<string, ContextWalkthrough> = {};
  for (const chapter of chapters) {
    for (const [id, draft] of Object.entries(chapter.contextWalkthroughs ?? {})) {
      const existing = merged[id];
      if (!existing || (draft.version ?? 1) >= (existing.version ?? 1)) merged[id] = draft;
    }
  }
  return merged;
}
