/**
 * Optional "sentence structure" part of the episode pack: the AI proposes how
 * each sentence splits into chunks with a role and a literal English gloss, so
 * the Reader walkthrough is not stuck with generic automatic roles. These are
 * drafts kept beside (never in place of) the learner's saved analyses. The AI
 * supplies only handles and text; a draft is accepted only when its chunks
 * rebuild the sentence exactly, and nothing here touches reviews or FSRS.
 */
import type { StructureDraftChunk } from '../domain/types';

import { chunksMatchSource } from './chunking';
import type { PreparationContext } from './episodePreparation';
import { ROLE_GUIDE_GROUPS } from './roleGuide';

export const STRUCTURE_SENTENCES_PER_PART = 20;
const MAX_CHUNK_TEXT = 200;
const MAX_ROLE_LENGTH = 40;
const MAX_GLOSS_LENGTH = 120;

export const STRUCTURE_ROLES: string[] = ROLE_GUIDE_GROUPS.flatMap((group) => group.entries.map((entry) => entry.role));

export function buildStructureInstructions(): string[] {
  return [
    'SENTENCE STRUCTURE: split each sentence in "STRUCTURE THESE" into its natural chunks (a content word plus its particle,',
    'a verb phrase, a clause). For every chunk give its role and a short literal English gloss. Prefer these role names exactly:',
    STRUCTURE_ROLES.join(' | '),
    'Chunks must be in sentence order and, joined together, must rebuild the sentence exactly (punctuation may sit on the chunk before it).',
    'GLOSSES: write each gloss as a plain, almost word-for-word "dolly" translation of that chunk in context, not a polished rendering. Cover',
    'EVERY chunk, including ones that are not vocabulary words: connectives, fixed expressions, counters and particles ("もう一つは" =',
    '"another one, as for"; "何かを" = "something (object)"). Keep the Japanese word order of the idea (e.g. "writing-or-so thing, right"),',
    'show what a particle contributes, and prefer a short fragment over a full sentence.',
    'Do not use quotation marks inside a gloss.',
  ];
}

export const STRUCTURE_LINE_EXAMPLE =
  'S4 | 私は | topic は | as for me\nS4 | もう一つは | topic は | another one, as for\nS4 | 読みます。 | engine: verb | read';

export function parseStructure(
  raw: unknown,
  context: PreparationContext,
): { drafts: Map<string, StructureDraftChunk[]>; rejected: { handle: string; reason: string }[] } {
  const drafts = new Map<string, StructureDraftChunk[]>();
  const rejected: { handle: string; reason: string }[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { drafts, rejected: [{ handle: 'structure', reason: '"structure" must be an object keyed by sentence handle.' }] };
  }
  const sentenceByHandle = new Map(context.sentences.map((sentence, index) => [`S${index + 1}`, sentence]));
  for (const [rawHandle, value] of Object.entries(raw)) {
    const handle = rawHandle.trim();
    const sentence = sentenceByHandle.get(handle);
    if (!sentence) {
      rejected.push({ handle, reason: 'Unknown sentence handle.' });
      continue;
    }
    if (!Array.isArray(value) || value.length === 0) {
      rejected.push({ handle, reason: 'Expected a non-empty list of chunks.' });
      continue;
    }
    const chunks: StructureDraftChunk[] = [];
    let valid = true;
    for (const item of value) {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      const role = typeof entry.role === 'string' ? entry.role.trim() : '';
      const gloss = typeof entry.gloss === 'string' ? entry.gloss.trim() : '';
      if (!text || text.length > MAX_CHUNK_TEXT || !role || role.length > MAX_ROLE_LENGTH || gloss.length > MAX_GLOSS_LENGTH) {
        valid = false;
        break;
      }
      chunks.push({ japanese: text, role, ...(gloss ? { literalEnglish: gloss } : {}) });
    }
    if (!valid) rejected.push({ handle, reason: 'A chunk was missing its text or role, or was too long.' });
    else if (!chunksMatchSource(chunks.map((chunk) => chunk.japanese), sentence.japanese)) {
      rejected.push({ handle, reason: 'The chunks do not rebuild the sentence exactly.' });
    } else drafts.set(sentence.id, chunks);
  }
  return { drafts, rejected };
}

export interface StructureParse {
  drafts: Map<string, StructureDraftChunk[]>;
  rejected: { handle: string; reason: string }[];
}

const LINE_SEPARATOR = /\s*[|\u23d0\uff5c\t]\s*/;
const QUOTE_EDGES = /^[\s"'`\u201c\u201d\u2018\u2019\u300c\u300d]+|[\s"'`\u201c\u201d\u2018\u2019\u300c\u300d]+$/g;

/**
 * Line-based structure replies: "S3 | 僕は | topic は | as for me", one chunk per
 * line. Anything that is not such a line (chatter, code fences, markdown table
 * rules, a cut-off final line) is ignored, and each sentence is judged on its
 * own, so one bad line never costs the rest of the reply.
 */
export function parseStructureLines(reply: string, context: PreparationContext): StructureParse {
  const sentenceByHandle = new Map(context.sentences.map((sentence, index) => [`S${index + 1}`, sentence]));
  const byHandle = new Map<string, StructureDraftChunk[]>();
  const rejected: { handle: string; reason: string }[] = [];
  for (const rawLine of reply.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>*\-\u2022|]+/, '').replace(/\|\s*$/, '');
    const match = line.match(/^\**\s*[SsＳ]\s*(\d+)\s*[.):\uff1a]?\s*[|\u23d0\uff5c\t]\s*(.*)$/);
    if (!match) continue;
    const handle = `S${Number(match[1])}`;
    const fields = match[2]!.split(LINE_SEPARATOR).map((field) => field.replace(QUOTE_EDGES, ''));
    const [text = '', role = '', ...glossParts] = fields;
    if (!text || !role || text.length > MAX_CHUNK_TEXT || role.length > MAX_ROLE_LENGTH) {
      if (!rejected.some((item) => item.handle === handle)) rejected.push({ handle, reason: 'A line was missing its text or role.' });
      byHandle.set(handle, [...(byHandle.get(handle) ?? []), { japanese: '\u0000', role: '' }]);
      continue;
    }
    const gloss = glossParts.join(' | ').slice(0, MAX_GLOSS_LENGTH);
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), { japanese: text, role, ...(gloss ? { literalEnglish: gloss } : {}) }]);
  }
  const drafts = new Map<string, StructureDraftChunk[]>();
  for (const [handle, chunks] of byHandle) {
    const sentence = sentenceByHandle.get(handle);
    if (!sentence) rejected.push({ handle, reason: 'Unknown sentence handle.' });
    else if (!chunksMatchSource(chunks.map((chunk) => chunk.japanese), sentence.japanese)) {
      if (!rejected.some((item) => item.handle === handle)) rejected.push({ handle, reason: 'The chunks do not rebuild the sentence exactly (cut off?).' });
    } else drafts.set(sentence.id, chunks);
  }
  return { drafts, rejected };
}
