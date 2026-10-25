/**
 * "Grammar structure" overview for the sentence walkthrough: the sentence cut into clauses, the connector
 * that joins each clause to the one before it, and (when a contextual walkthrough exists) the English for
 * each clause's teaching steps. Display-only: clause boundaries come from chunk-role banding
 * (`clauseBands.ts`), not a parse, and nothing here is graded or scheduled.
 */
import type { ContextWalkthrough } from '../domain/types';

import { assignClauseIndices, isClauseConnectorRole } from './clauseBands';

export interface ClauseMapChunk {
  japanese: string;
  role: string;
  literalEnglish?: string;
  start: number;
  end: number;
}

export interface ClauseMapEntry {
  /** Clause text without its leading connector. */
  text: string;
  /** The connector linking this clause to the previous one (absent for the first clause or an unmarked join). */
  connector?: { text: string; gloss?: string };
  /** Glosses of the top-level walkthrough steps inside this clause, in order. */
  stepGlosses: { text: string; gloss: string }[];
}

/** Undefined for a one-clause sentence, where an overview would only repeat the sentence. */
export function buildClauseMap(chunks: readonly ClauseMapChunk[], japanese: string, walkthrough?: ContextWalkthrough): ClauseMapEntry[] | undefined {
  if (chunks.length === 0) return undefined;
  const clauseOf = assignClauseIndices(chunks);
  const count = Math.max(...clauseOf) + 1;
  if (count < 2) return undefined;

  const entries: ClauseMapEntry[] = [];
  for (let clause = 0; clause < count; clause += 1) {
    let members = chunks.filter((_, index) => clauseOf[index] === clause);
    const lead = members[0]!;
    const connector = clause > 0 && isClauseConnectorRole(lead.role) ? lead : undefined;
    if (connector) members = members.slice(1);
    if (members.length === 0) continue;
    const start = members[0]!.start;
    const end = members[members.length - 1]!.end;
    const steps = (walkthrough?.steps ?? []).filter((step) => step.start >= start && step.end <= end);
    const topLevel = steps.filter((step) => !steps.some((other) => other !== step && other.start <= step.start && other.end >= step.end && other.end - other.start > step.end - step.start));
    entries.push({
      text: japanese.slice(start, end),
      ...(connector ? { connector: { text: connector.japanese, gloss: connector.literalEnglish || undefined } } : {}),
      stepGlosses: topLevel.map((step) => ({ text: step.text, gloss: step.gloss })),
    });
  }
  return entries.length >= 2 ? entries : undefined;
}
