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
  ];
}

export const STRUCTURE_SHAPE = { S4: [{ text: 'chunk copied from the sentence', role: 'role name', gloss: 'literal English' }] };

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
