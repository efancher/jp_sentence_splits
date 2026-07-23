/**
 * Display-only clause banding from chunk roles (not a full parse).
 *
 * New clause when:
 * - the chunk is a `clause connector`, or
 * - the previous chunk is an engine and this chunk is not a `sentence ending`.
 * `て-car` stays in the current clause (link toward the engine).
 */

export function isEngineRole(role: string): boolean {
  const trimmed = role.trim();
  return trimmed === 'engine' || trimmed.startsWith('engine');
}

export function isClauseConnectorRole(role: string): boolean {
  return role.trim() === 'clause connector';
}

export function isSentenceEndingRole(role: string): boolean {
  return role.trim() === 'sentence ending';
}

/** Returns a clause index per chunk (0-based, contiguous from the start). */
export function assignClauseIndices(
  chunks: readonly { role: string }[],
): number[] {
  if (!chunks.length) return [];

  const indices: number[] = [];
  let clause = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const role = chunk.role;
    if (index > 0) {
      const previous = chunks[index - 1]!;
      if (isClauseConnectorRole(role)) {
        clause += 1;
      } else if (
        isEngineRole(previous.role) &&
        !isSentenceEndingRole(role)
      ) {
        clause += 1;
      }
    }
    indices.push(clause);
  }

  return indices;
}
