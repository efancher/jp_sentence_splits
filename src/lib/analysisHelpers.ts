import type { AnalysisChunk } from '../domain/types';
import {
  chunkJapaneseSentence,
  chunksMatchSource,
  chunksToSpacedText,
  spacedTextToChunks,
  suggestRoles,
} from './chunking';
import { createId } from './ids';

export function makeChunksFromJapaneseList(
  parts: string[],
  previous: AnalysisChunk[] = [],
  seedRoles = false,
): AnalysisChunk[] {
  const roles = seedRoles ? suggestRoles(parts) : parts.map(() => '');
  return parts.map((japanese, index) => {
    const prior = previous.find((chunk) => chunk.japanese === japanese);
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
  return makeChunksFromJapaneseList(parts, previous, true);
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
  return { ok: true, chunks: makeChunksFromJapaneseList(parts, previous) };
}

export function countDiscardedAnnotations(
  previous: AnalysisChunk[],
  next: AnalysisChunk[],
): number {
  const nextKeys = new Set(next.map((chunk) => chunk.japanese));
  return previous.filter(
    (chunk) =>
      (chunk.role.trim() || chunk.literalEnglish.trim()) &&
      !nextKeys.has(chunk.japanese),
  ).length;
}

export function initialSpacedText(
  japanese: string,
  chunks?: AnalysisChunk[],
): string {
  if (chunks?.length) return chunksToSpacedText(chunks.map((c) => c.japanese));
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
  return next.map((item, order) => ({ ...item, order }));
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
  return next.map((item, order) => ({ ...item, order }));
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

  const next = chunks.map((chunk) => ({ ...chunk }));
  if (direction === 'left') {
    if (index === 0) return chunks;
    const current = next[index]!;
    const previous = next[index - 1]!;
    if (!previous.japanese) return chunks;
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
    if (!current.japanese) return chunks;
    const ch = current.japanese.slice(0, 1);
    current.japanese = current.japanese.slice(1);
    following.japanese = ch + following.japanese;
    if (!current.japanese) {
      next.splice(index, 1);
    }
  }

  const normalized = next
    .filter((chunk) => chunk.japanese)
    .map((chunk, order) => ({ ...chunk, order }));
  if (
    !chunksMatchSource(
      normalized.map((chunk) => chunk.japanese),
      sourceJapanese,
    )
  ) {
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
