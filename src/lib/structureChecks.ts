/**
 * Pre-walkthrough structure checks that replace the fixed multiple-choice predicate /
 * attachment questions on sentences that open on the Ear Tiles check. Both are done on the
 * sentence's own chunks, so the target changes every sentence instead of repeating a menu.
 *
 *   - Cut it down: drop every chunk that isn't needed for "who/what did what".
 *   - Tap what it describes: tap the chunk an Aの chunk belongs to (or, reversed, the chunk
 *     that describes a given noun).
 *
 * Grading is deliberately lenient: only chunks the heuristics are sure about count.
 * Pure — chunks come from the walkthrough.
 */

import { splitTrailingParticle } from './chunking';
import { assignClauseIndices } from './clauseBands';
import { bare, buildDecisions, type GlossChunk } from './glossSkill';
import { hashString } from './ids';

const hash = (text: string) => Number.parseInt(hashString(text), 16);

/** Particles whose chunk is part of "who/what did what". */
const CORE_PARTICLES = new Set(['が', 'は', 'を']);
/** Particles whose chunk is always an extra (where/how/from/until/than), safe to cut. */
const EXTRA_PARTICLES = new Set(['で', 'から', 'まで', 'より']);

export interface CutDownCheck {
  chunks: GlossChunk[];
  predicateId: string;
  /** Predicate plus the が / は / を chunks: cutting one is wrong. */
  keepIds: string[];
  /** Chunks that are clearly extras (で / から / まで / より): keeping one is wrong. */
  extraIds: string[];
  /** False = no clear extra or the predicate isn't trusted: the learner compares against the reference instead of being graded. */
  graded: boolean;
}

export function buildCutDownCheck(chunks: GlossChunk[]): CutDownCheck | null {
  if (chunks.length < 3) return null;
  // One clause only: a cut-down of a multi-clause sentence is a parsing exercise, not this one.
  if (new Set(assignClauseIndices(chunks)).size > 1) return null;
  const predicate = buildDecisions(chunks).find((spec) => spec.skill === 'predicate');
  if (!predicate) return null;

  const keep = new Set([predicate.chunkId]);
  const extras: string[] = [];
  for (const chunk of chunks) {
    if (chunk.id === predicate.chunkId) continue;
    const [, particle] = splitTrailingParticle(bare(chunk.japanese));
    if (CORE_PARTICLES.has(particle)) keep.add(chunk.id);
    else if (EXTRA_PARTICLES.has(particle)) extras.push(chunk.id);
  }
  if (chunks.length - keep.size < 1) return null;
  return {
    chunks,
    predicateId: predicate.chunkId,
    keepIds: chunks.filter((c) => keep.has(c.id)).map((c) => c.id),
    extraIds: extras,
    graded: predicate.confidence === 'settled' && extras.length > 0,
  };
}

export interface CutDownResult {
  /** Core chunks the learner cut. */
  droppedCore: string[];
  /** Clear extras the learner kept. */
  keptExtras: string[];
  /** null when the check isn't gradable. */
  correct: boolean | null;
}

export function gradeCutDown(check: CutDownCheck, keptIds: ReadonlySet<string>): CutDownResult {
  const droppedCore = check.keepIds.filter((id) => !keptIds.has(id));
  const keptExtras = check.extraIds.filter((id) => keptIds.has(id));
  return {
    droppedCore,
    keptExtras,
    correct: check.graded ? droppedCore.length === 0 && keptExtras.length === 0 : null,
  };
}

export interface AttachmentCheck {
  chunks: GlossChunk[];
  /** 'forward': which chunk does the Aの chunk describe? 'reverse': which chunk describes this one? */
  direction: 'forward' | 'reverse';
  /** The Aの chunk. */
  modifierId: string;
  /** The chunk Aの describes. */
  headId: string;
  /** The chunk the question is about (highlighted, not tappable). */
  askedId: string;
  /** The chunk the learner should tap. */
  answerId: string;
}

export function buildAttachmentCheck(chunks: GlossChunk[], seed: string): AttachmentCheck | null {
  const specs = buildDecisions(chunks).filter((spec) => spec.skill === 'attachment');
  if (specs.length === 0) return null;
  const spec = specs[hash(`${seed}:pick`) % specs.length]!;
  const direction = hash(`${seed}:direction`) % 2 === 0 ? 'forward' : 'reverse';
  const modifierId = spec.chunkId;
  const headId = spec.referenceValue;
  return {
    chunks,
    direction,
    modifierId,
    headId,
    askedId: direction === 'forward' ? modifierId : headId,
    answerId: direction === 'forward' ? headId : modifierId,
  };
}

export interface StructureChecks {
  cutDown: CutDownCheck | null;
  attachment: AttachmentCheck | null;
}

export function buildStructureChecks(chunks: GlossChunk[], seed: string): StructureChecks {
  return { cutDown: buildCutDownCheck(chunks), attachment: buildAttachmentCheck(chunks, seed) };
}
