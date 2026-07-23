import type { AnalysisChunk } from '../domain/types';
import {
  chunkJapaneseSentence,
  chunksMatchSource,
  chunksToSpacedText,
  spacedTextToChunks,
  suggestRoles,
} from './chunking';
import { createId } from './ids';

export const ZERO_GA_DEFAULT_JAPANESE = '∅が';
export const ZERO_GA_ROLE = 'zero-が (∅ subject)';

/** True when the chunk is the invisible ∅が subject (not source text). */
export function isZeroGaChunk(chunk: AnalysisChunk): boolean {
  return chunk.kind === 'zero_ga';
}

export function isSurfaceChunk(chunk: AnalysisChunk): boolean {
  return !isZeroGaChunk(chunk);
}

export function surfaceChunks(chunks: AnalysisChunk[]): AnalysisChunk[] {
  return chunks.filter(isSurfaceChunk);
}

export function surfaceJapaneseParts(chunks: AnalysisChunk[]): string[] {
  return surfaceChunks(chunks).map((chunk) => chunk.japanese);
}

/** Hiragana, katakana, or kanji — enough to bother with TTS (skip ∅ markers). */
export function chunkHasSpeakableJapanese(japanese: string): boolean {
  if (japanese.includes('∅') || japanese.includes('⌀')) return false;
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(japanese);
}

function renumber(chunks: AnalysisChunk[]): AnalysisChunk[] {
  return chunks.map((chunk, order) => ({ ...chunk, order }));
}

/**
 * After rebuilding surface chunks, keep prior zero_ga chunks in their relative
 * slots (then any leftover surface chunks at the end).
 */
export function preserveZeroGaChunks(
  previous: AnalysisChunk[],
  nextSurface: AnalysisChunk[],
): AnalysisChunk[] {
  const surfaceQueue = [...nextSurface];
  const result: AnalysisChunk[] = [];
  for (const prev of previous) {
    if (isZeroGaChunk(prev)) {
      result.push({ ...prev, kind: 'zero_ga' });
    } else {
      const next = surfaceQueue.shift();
      if (next) {
        const { kind: _ignored, ...rest } = next;
        result.push(rest);
      }
    }
  }
  for (const chunk of surfaceQueue) {
    const { kind: _ignored, ...rest } = chunk;
    result.push(rest);
  }
  return renumber(result);
}

export function hasZeroGaSubject(chunks: AnalysisChunk[]): boolean {
  return chunks.some(isZeroGaChunk);
}

export function addZeroGaSubject(chunks: AnalysisChunk[]): AnalysisChunk[] {
  if (hasZeroGaSubject(chunks)) return chunks;
  const zeroGa: AnalysisChunk = {
    id: createId('chunk'),
    order: 0,
    japanese: ZERO_GA_DEFAULT_JAPANESE,
    role: ZERO_GA_ROLE,
    literalEnglish: '',
    kind: 'zero_ga',
  };
  return renumber([zeroGa, ...chunks]);
}

export function removeZeroGaSubject(chunks: AnalysisChunk[]): AnalysisChunk[] {
  return renumber(chunks.filter((chunk) => !isZeroGaChunk(chunk)));
}

export function moveChunk(
  chunks: AnalysisChunk[],
  chunkId: string,
  direction: 'up' | 'down',
): AnalysisChunk[] {
  const index = chunks.findIndex((chunk) => chunk.id === chunkId);
  if (index < 0) return chunks;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= chunks.length) return chunks;
  const next = [...chunks];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return renumber(next);
}

export function makeChunksFromJapaneseList(
  parts: string[],
  previous: AnalysisChunk[] = [],
  seedRoles = false,
): AnalysisChunk[] {
  const priorSurface = surfaceChunks(previous);
  const roles = seedRoles ? suggestRoles(parts) : parts.map(() => '');
  return parts.map((japanese, index) => {
    const prior = priorSurface.find((chunk) => chunk.japanese === japanese);
    return {
      id: prior?.id ?? createId('chunk'),
      order: index,
      japanese,
      role: prior?.role || roles[index] || '',
      literalEnglish: prior?.literalEnglish || '',
      notes: prior?.notes,
    };
  });
}

export function applyHeuristicChunks(
  japanese: string,
  previous: AnalysisChunk[] = [],
): AnalysisChunk[] {
  const parts = chunkJapaneseSentence(japanese);
  const surface = makeChunksFromJapaneseList(parts, previous, true);
  return preserveZeroGaChunks(previous, surface);
}

/** Dry-run of the Cure Dolly chunker + role suggestions (no IDs / no apply). */
export function previewHeuristicChunks(japanese: string): {
  parts: string[];
  roles: string[];
  spaced: string;
} {
  const parts = chunkJapaneseSentence(japanese);
  return {
    parts,
    roles: suggestRoles(parts),
    spaced: chunksToSpacedText(parts),
  };
}

export function applySpacedChunks(
  spaced: string,
  sourceJapanese: string,
  previous: AnalysisChunk[] = [],
): { ok: true; chunks: AnalysisChunk[] } | { ok: false; reason: string } {
  const parts = spacedTextToChunks(spaced);
  if (!parts.length) {
    return { ok: false, reason: 'At least one chunk is required.' };
  }
  if (!chunksMatchSource(parts, sourceJapanese)) {
    return {
      ok: false,
      reason:
        'Chunk text no longer matches the source Japanese sentence. Reset or restore characters before saving.',
    };
  }
  const surface = makeChunksFromJapaneseList(parts, previous);
  return { ok: true, chunks: preserveZeroGaChunks(previous, surface) };
}

export function countDiscardedAnnotations(
  previous: AnalysisChunk[],
  next: AnalysisChunk[],
): number {
  const nextKeys = new Set(next.map((chunk) => chunk.japanese));
  const nextHasZeroGa = hasZeroGaSubject(next);
  return previous.filter((chunk) => {
    if (!(chunk.role.trim() || chunk.literalEnglish.trim())) return false;
    if (isZeroGaChunk(chunk)) return !nextHasZeroGa;
    return !nextKeys.has(chunk.japanese);
  }).length;
}

export function initialSpacedText(
  japanese: string,
  chunks?: AnalysisChunk[],
): string {
  if (chunks?.length) {
    return chunksToSpacedText(surfaceJapaneseParts(chunks));
  }
  return japanese;
}

export function splitChunkAt(
  chunks: AnalysisChunk[],
  chunkId: string,
  offset: number,
): AnalysisChunk[] {
  const index = chunks.findIndex((chunk) => chunk.id === chunkId);
  if (index < 0) return chunks;
  const chunk = chunks[index]!;
  if (isZeroGaChunk(chunk)) return chunks;
  if (offset <= 0 || offset >= chunk.japanese.length) return chunks;
  const left = chunk.japanese.slice(0, offset);
  const right = chunk.japanese.slice(offset);
  const next = [...chunks];
  next.splice(
    index,
    1,
    { ...chunk, japanese: left, literalEnglish: '', role: chunk.role },
    {
      id: createId('chunk'),
      order: index + 1,
      japanese: right,
      role: '',
      literalEnglish: '',
    },
  );
  return renumber(next);
}

export function mergeChunkWithNeighbor(
  chunks: AnalysisChunk[],
  chunkId: string,
  direction: 'previous' | 'next',
): AnalysisChunk[] {
  const index = chunks.findIndex((chunk) => chunk.id === chunkId);
  if (index < 0) return chunks;
  const neighborIndex = direction === 'previous' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= chunks.length) return chunks;
  const a = direction === 'previous' ? chunks[neighborIndex]! : chunks[index]!;
  const b = direction === 'previous' ? chunks[index]! : chunks[neighborIndex]!;
  if (isZeroGaChunk(a) || isZeroGaChunk(b)) return chunks;
  const merged: AnalysisChunk = {
    id: a.id,
    order: Math.min(a.order, b.order),
    japanese: a.japanese + b.japanese,
    role: a.role || b.role,
    literalEnglish: [a.literalEnglish, b.literalEnglish].filter(Boolean).join(' '),
    notes: a.notes || b.notes,
  };
  const next = chunks.filter((_, i) => i !== index && i !== neighborIndex);
  next.splice(Math.min(index, neighborIndex), 0, merged);
  return renumber(next);
}

/** Shift one character across a chunk boundary without changing source order. */
export function moveChunkBoundary(
  chunks: AnalysisChunk[],
  chunkId: string,
  direction: 'left' | 'right',
  sourceJapanese: string,
): AnalysisChunk[] {
  const index = chunks.findIndex((chunk) => chunk.id === chunkId);
  if (index < 0) return chunks;
  if (isZeroGaChunk(chunks[index]!)) return chunks;

  const next = chunks.map((chunk) => ({ ...chunk }));
  if (direction === 'left') {
    if (index === 0) return chunks;
    const current = next[index]!;
    const previous = next[index - 1]!;
    if (isZeroGaChunk(previous) || !previous.japanese) return chunks;
    const ch = previous.japanese.slice(-1);
    previous.japanese = previous.japanese.slice(0, -1);
    current.japanese = ch + current.japanese;
    if (!previous.japanese) {
      next.splice(index - 1, 1);
    }
  } else {
    if (index >= next.length - 1) return chunks;
    const current = next[index]!;
    const following = next[index + 1]!;
    if (isZeroGaChunk(following) || !current.japanese) return chunks;
    const ch = current.japanese.slice(0, 1);
    current.japanese = current.japanese.slice(1);
    following.japanese = ch + following.japanese;
    if (!current.japanese) {
      next.splice(index, 1);
    }
  }

  const normalized = renumber(next.filter((chunk) => chunk.japanese));
  if (!chunksMatchSource(surfaceJapaneseParts(normalized), sourceJapanese)) {
    return chunks;
  }
  return normalized;
}

export function analysisStatusLabel(status: string): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'in_progress':
      return 'In progress';
    default:
      return 'Unstarted';
  }
}
