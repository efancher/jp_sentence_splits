import { hashString } from './ids';
import { puzzleShapeFamily } from './puzzleShapes';

export const BUILD_HINT_MAX = 5;

export type BuildHintLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type BuildChunk = {
  id: string;
  japanese: string;
  role: string;
  literalEnglish: string;
};

export const BUILD_HINT_LABELS: Record<BuildHintLevel, string> = {
  0: 'English only',
  1: 'Show vocabulary',
  2: 'Show slot count',
  3: 'Sticky English on tiles',
  4: 'Roles + shapes',
  5: 'Show Japanese on tiles',
};

/** Deterministic shuffle for a chunk bank (stable until seed changes). */
export function shuffleChunkIds(
  ids: readonly string[],
  seed: string,
): string[] {
  return [...ids].sort((a, b) => {
    const ha = Number.parseInt(hashString(`${seed}:${a}`), 16);
    const hb = Number.parseInt(hashString(`${seed}:${b}`), 16);
    return ha - hb;
  });
}

export function checkBuildAssembly(
  assembledIds: readonly string[],
  correctIds: readonly string[],
): {
  perfect: boolean;
  matchedPrefix: number;
  lengthMatch: boolean;
} {
  const lengthMatch = assembledIds.length === correctIds.length;
  let matchedPrefix = 0;
  const limit = Math.min(assembledIds.length, correctIds.length);
  for (let index = 0; index < limit; index += 1) {
    if (assembledIds[index] !== correctIds[index]) break;
    matchedPrefix += 1;
  }
  return {
    perfect: lengthMatch && matchedPrefix === correctIds.length,
    matchedPrefix,
    lengthMatch,
  };
}

export function correctChunkIds(chunks: readonly BuildChunk[]): string[] {
  return chunks.map((chunk) => chunk.id);
}

/** What to show on a bank/assembly tile at the current hint level. */
export function buildTileFace(
  chunk: BuildChunk,
  hintLevel: BuildHintLevel,
): { primary: string; secondary?: string; showShape: boolean } {
  if (hintLevel >= 5) {
    return {
      primary: chunk.japanese,
      secondary: chunk.role.trim() || undefined,
      showShape: true,
    };
  }
  if (hintLevel >= 4) {
    return {
      primary: chunk.role.trim() || 'role?',
      secondary: chunk.literalEnglish.trim() || undefined,
      showShape: true,
    };
  }
  if (hintLevel >= 3) {
    return {
      primary: chunk.literalEnglish.trim() || '…',
      secondary: undefined,
      showShape: true,
    };
  }
  if (hintLevel >= 2) {
    return {
      primary: '■',
      secondary: puzzleShapeFamily(chunk.role),
      showShape: true,
    };
  }
  return {
    primary: '？',
    secondary: undefined,
    showShape: false,
  };
}

export function clampBuildHintLevel(level: number): BuildHintLevel {
  if (level <= 0) return 0;
  if (level >= BUILD_HINT_MAX) return BUILD_HINT_MAX as BuildHintLevel;
  return level as BuildHintLevel;
}

export function nextBuildHintLevel(
  level: BuildHintLevel,
): BuildHintLevel {
  return clampBuildHintLevel(level + 1);
}
