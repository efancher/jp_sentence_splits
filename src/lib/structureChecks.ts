/**
 * Pre-walkthrough structure checks that follow the Ear Tiles check, built from the
 * sentence's own chunks so the target changes every sentence:
 *
 *   - Roles: "tap who does it / what it is done to / where it happens" — answered by reading
 *     the particle, not by position.
 *   - Describes: "tap everything that describes this noun" — only asked when the description
 *     is more than a lone adjacent Aの (an の chain, or a verb describing a noun).
 *
 * Grading is deliberately lenient: only chunks the heuristics are sure about count.
 * Pure — chunks come from the walkthrough.
 */

import { splitTrailingParticle } from './chunking';
import { assignClauseIndices, isEngineRole } from './clauseBands';
import { bare, buildDecisions, type GlossChunk } from './glossSkill';
import { hashString } from './ids';

const hash = (text: string) => Number.parseInt(hashString(text), 16);

export type RoleKind = 'doer' | 'receiver' | 'place' | 'start' | 'end';

const ROLE_BY_PARTICLE: Record<string, RoleKind> = {
  が: 'doer',
  を: 'receiver',
  で: 'place',
  から: 'start',
  まで: 'end',
};

export const ROLE_QUESTION: Record<RoleKind, string> = {
  doer: 'Tap who or what does it (or is it).',
  receiver: 'Tap what the action is done to.',
  place: 'Tap where it happens, or what it is done by.',
  start: 'Tap the starting point.',
  end: 'Tap the end point.',
};

export interface RolesCheck {
  chunks: GlossChunk[];
  predicateId: string;
  role: RoleKind;
  answerId: string;
}

export function buildRolesCheck(chunks: GlossChunk[], seed: string): RolesCheck | null {
  if (chunks.length < 4) return null;
  if (new Set(assignClauseIndices(chunks)).size > 1) return null;
  const predicate = buildDecisions(chunks).find((spec) => spec.skill === 'predicate');
  if (predicate?.confidence !== 'settled') return null;
  // Enough non-predicate chunks that tapping is a real choice, not a coin flip.
  if (chunks.length - 1 < 3) return null;

  const byRole = new Map<RoleKind, string[]>();
  for (const chunk of chunks) {
    if (chunk.id === predicate.chunkId) continue;
    const [stem, particle] = splitTrailingParticle(bare(chunk.japanese));
    const role = ROLE_BY_PARTICLE[particle];
    // 〜ますが is the clause-linking "but", not a subject marker.
    if (!role || (particle === 'が' && /(?:ます|ません|ました|です|でした)$/.test(stem))) continue;
    byRole.set(role, [...(byRole.get(role) ?? []), chunk.id]);
  }
  // Only roles marked by exactly one chunk have a single right answer.
  const candidates = [...byRole.entries()].filter(([, ids]) => ids.length === 1);
  if (candidates.length === 0) return null;
  const [role, ids] = candidates[hash(`${seed}:role`) % candidates.length]!;
  return { chunks, predicateId: predicate.chunkId, role, answerId: ids[0]! };
}

export interface DescribesCheck {
  chunks: GlossChunk[];
  kind: 'chain' | 'clause';
  /** The noun chunk being described (highlighted, not tappable). */
  headId: string;
  /** Chunks that must be tapped. */
  requiredIds: string[];
  /** Chunks that may be tapped or left (optional detail inside a verb description). */
  freeIds: string[];
}

const PLAIN_ENDING = /(?:た|だった|ない|なかった|る|う|く|ぐ|す|つ|ぬ|ぶ|む)$/;

export function buildDescribesCheck(chunks: GlossChunk[], seed: string): DescribesCheck | null {
  const options: DescribesCheck[] = [];
  const isNo = (chunk: GlossChunk) => splitTrailingParticle(bare(chunk.japanese))[1] === 'の' && chunk.role === 'の-car';

  // の chain: two or more consecutive Aの chunks, then the noun they all build up.
  for (let i = 0; i < chunks.length; i += 1) {
    if (!isNo(chunks[i]!) || (i > 0 && isNo(chunks[i - 1]!))) continue;
    let end = i;
    while (end < chunks.length && isNo(chunks[end]!)) end += 1;
    const head = chunks[end];
    if (end - i < 2 || !head || isEngineRole(head.role) || head.role === 'chunk') continue;
    options.push({ chunks, kind: 'chain', headId: head.id, requiredIds: chunks.slice(i, end).map((c) => c.id), freeIds: [] });
  }

  // Verb + noun: a plain-form verb chunk directly before a noun chunk describes it.
  chunks.forEach((verb, index) => {
    const head = chunks[index + 1];
    if (!head || index === chunks.length - 1) return;
    const text = bare(verb.japanese);
    if (!isEngineRole(verb.role) || splitTrailingParticle(text)[1] || !PLAIN_ENDING.test(text)) return;
    if (/(?:ます|ません|ました|です|でした)$/.test(text)) return;
    if (isEngineRole(head.role) || head.role === 'chunk' || head.role === 'modifier/content') return;
    // Optional detail: chunks before the verb back to the previous engine chunk (the verb's own
    // where/when/who). Nothing after the head belongs to the description.
    const free: string[] = [];
    for (let j = index - 1; j >= 0 && !isEngineRole(chunks[j]!.role); j -= 1) free.push(chunks[j]!.id);
    options.push({ chunks, kind: 'clause', headId: head.id, requiredIds: [verb.id], freeIds: free });
  });

  if (options.length === 0) return null;
  return options[hash(`${seed}:describes`) % options.length]!;
}

export interface DescribesResult {
  missed: string[];
  wrong: string[];
  correct: boolean;
}

export function gradeDescribes(check: DescribesCheck, tapped: ReadonlySet<string>): DescribesResult {
  const free = new Set(check.freeIds);
  const required = new Set(check.requiredIds);
  const missed = check.requiredIds.filter((id) => !tapped.has(id));
  const wrong = [...tapped].filter((id) => !required.has(id) && !free.has(id));
  return { missed, wrong, correct: missed.length === 0 && wrong.length === 0 };
}

export interface StructureChecks {
  roles: RolesCheck | null;
  describes: DescribesCheck | null;
}

export function buildStructureChecks(chunks: GlossChunk[], seed: string): StructureChecks {
  return { roles: buildRolesCheck(chunks, seed), describes: buildDescribesCheck(chunks, seed) };
}
