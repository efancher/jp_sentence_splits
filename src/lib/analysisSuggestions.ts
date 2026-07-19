import type { AnalysisChunk, TargetVocabulary } from '../domain/types';
import {
  chunkJapaneseSentence,
  chunksMatchSource,
  roleForChunk,
} from './chunking';
import {
  stickyLiteralsDiffer,
  suggestStickyEnglish,
} from './stickyEnglish';

export type SuggestionSeverity = 'info' | 'warning';

export type SuggestionKind =
  | 'integrity'
  | 'missing_role'
  | 'missing_lit'
  | 'role_mismatch'
  | 'lit_alternative'
  | 'lit_has_jp'
  | 'lit_fluentish'
  | 'chunk_vs_heuristic';

export type SuggestionAction =
  | 'apply_role'
  | 'apply_lit'
  | 'reapply_heuristic'
  | 'none';

export interface AnalysisSuggestion {
  id: string;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  message: string;
  chunkId?: string;
  chunkIndex?: number;
  action: SuggestionAction;
  /** Role to apply when action is `apply_role`. */
  suggestedRole?: string;
  /** Sticky English to apply when action is `apply_lit`. */
  suggestedLiteral?: string;
}

export interface LintAnalysisOptions {
  translation?: string;
  vocabulary?: TargetVocabulary[];
}

const JP_IN_LITERAL = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9d]/;
const FLUENT_START =
  /^(i|i'm|i’ve|i've|you|he|she|it|we|they|the|a|an|this|that|there|here)\b/i;
const LONG_CLAUSE_MARKERS = /\b(who|which|that|because|although|when|while)\b/i;
const MIN_FLUENTISH_WORDS = 6;

function normalizeRole(role: string): string {
  return role.trim().replace(/\s+/g, ' ').toLowerCase();
}

function rolesCompatible(userRole: string, heuristicRole: string): boolean {
  const user = normalizeRole(userRole);
  const heuristic = normalizeRole(heuristicRole);
  if (!user || !heuristic) return !user && !heuristic;
  if (user === heuristic) return true;
  if (heuristic === 'engine' && user.startsWith('engine')) return true;
  if (user === 'engine' && heuristic.startsWith('engine')) return true;
  return false;
}

function looksFluentish(literal: string): boolean {
  const trimmed = literal.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (FLUENT_START.test(trimmed) && words.length >= 3) return true;
  if (words.length >= MIN_FLUENTISH_WORDS && LONG_CLAUSE_MARKERS.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Local, non-generative gloss review. Heuristics are suggestions only —
 * never overwrite the user's analysis unless they choose Apply.
 */
export function lintAnalysis(
  sourceJapanese: string,
  chunks: AnalysisChunk[],
  options: LintAnalysisOptions = {},
): AnalysisSuggestion[] {
  const suggestions: AnalysisSuggestion[] = [];
  if (!chunks.length) return suggestions;

  const japaneseParts = chunks.map((chunk) => chunk.japanese);
  if (!chunksMatchSource(japaneseParts, sourceJapanese)) {
    suggestions.push({
      id: 'integrity',
      kind: 'integrity',
      severity: 'warning',
      message:
        'Chunk Japanese no longer matches the source sentence. Reset or fix the spaced text before saving.',
      action: 'none',
    });
  }

  const heuristicParts = chunkJapaneseSentence(sourceJapanese);
  const currentJoined = japaneseParts.join('');
  const heuristicJoined = heuristicParts.join('');
  if (
    currentJoined === heuristicJoined.replace(/\s+/g, '') &&
    japaneseParts.join('\0') !== heuristicParts.join('\0')
  ) {
    suggestions.push({
      id: 'chunk_vs_heuristic',
      kind: 'chunk_vs_heuristic',
      severity: 'info',
      message: `Your chunk boundaries differ from the Cure Dolly heuristic (${heuristicParts.length} chunk(s) suggested).`,
      action: 'reapply_heuristic',
    });
  }

  chunks.forEach((chunk, index) => {
    const role = chunk.role.trim();
    const literal = chunk.literalEnglish.trim();
    const heuristicRole = roleForChunk(
      chunk.japanese,
      index === chunks.length - 1,
    );
    const suggestedLiteral = suggestStickyEnglish(chunk.japanese, {
      role: role || heuristicRole,
      englishHint: options.translation,
      vocabulary: options.vocabulary,
    });

    if (!role) {
      suggestions.push({
        id: `missing_role:${chunk.id}`,
        kind: 'missing_role',
        severity: 'warning',
        message: `Chunk #${index + 1} is missing a role.`,
        chunkId: chunk.id,
        chunkIndex: index,
        action: heuristicRole ? 'apply_role' : 'none',
        suggestedRole: heuristicRole || undefined,
      });
    } else if (heuristicRole && !rolesCompatible(role, heuristicRole)) {
      suggestions.push({
        id: `role_mismatch:${chunk.id}`,
        kind: 'role_mismatch',
        severity: 'info',
        message: `Chunk #${index + 1} role “${role}” differs from the heuristic suggestion “${heuristicRole}”.`,
        chunkId: chunk.id,
        chunkIndex: index,
        action: 'apply_role',
        suggestedRole: heuristicRole,
      });
    }

    if (!literal) {
      suggestions.push({
        id: `missing_lit:${chunk.id}`,
        kind: 'missing_lit',
        severity: 'warning',
        message: suggestedLiteral
          ? `Chunk #${index + 1} is missing sticky English. Suggested: “${suggestedLiteral}”.`
          : `Chunk #${index + 1} is missing sticky English.`,
        chunkId: chunk.id,
        chunkIndex: index,
        action: suggestedLiteral ? 'apply_lit' : 'none',
        suggestedLiteral: suggestedLiteral || undefined,
      });
    } else {
      if (JP_IN_LITERAL.test(literal)) {
        suggestions.push({
          id: `lit_has_jp:${chunk.id}`,
          kind: 'lit_has_jp',
          severity: 'info',
          message: suggestedLiteral
            ? `Chunk #${index + 1} sticky English still contains Japanese characters. Suggested: “${suggestedLiteral}”.`
            : `Chunk #${index + 1} sticky English still contains Japanese characters.`,
          chunkId: chunk.id,
          chunkIndex: index,
          action: suggestedLiteral ? 'apply_lit' : 'none',
          suggestedLiteral: suggestedLiteral || undefined,
        });
      }
      if (looksFluentish(literal)) {
        suggestions.push({
          id: `lit_fluentish:${chunk.id}`,
          kind: 'lit_fluentish',
          severity: 'info',
          message: suggestedLiteral
            ? `Chunk #${index + 1} sticky English looks fluent. Suggested sticky form: “${suggestedLiteral}”.`
            : `Chunk #${index + 1} sticky English looks like fluent English. Prefer Japanese-order “sticky” wording.`,
          chunkId: chunk.id,
          chunkIndex: index,
          action: suggestedLiteral ? 'apply_lit' : 'none',
          suggestedLiteral: suggestedLiteral || undefined,
        });
      } else if (
        suggestedLiteral &&
        stickyLiteralsDiffer(literal, suggestedLiteral) &&
        !JP_IN_LITERAL.test(suggestedLiteral)
      ) {
        suggestions.push({
          id: `lit_alternative:${chunk.id}`,
          kind: 'lit_alternative',
          severity: 'info',
          message: `Chunk #${index + 1} sticky English alternative: “${suggestedLiteral}”.`,
          chunkId: chunk.id,
          chunkIndex: index,
          action: 'apply_lit',
          suggestedLiteral,
        });
      }
    }
  });

  return suggestions;
}

export function applySuggestion(
  suggestion: AnalysisSuggestion,
  sourceJapanese: string,
  chunks: AnalysisChunk[],
  applyHeuristic: (
    japanese: string,
    previous: AnalysisChunk[],
  ) => AnalysisChunk[],
): AnalysisChunk[] {
  if (suggestion.action === 'apply_role' && suggestion.chunkId) {
    const role = suggestion.suggestedRole?.trim();
    if (!role) return chunks;
    return chunks.map((chunk) =>
      chunk.id === suggestion.chunkId ? { ...chunk, role } : chunk,
    );
  }
  if (suggestion.action === 'apply_lit' && suggestion.chunkId) {
    const literal = suggestion.suggestedLiteral?.trim();
    if (!literal) return chunks;
    return chunks.map((chunk) =>
      chunk.id === suggestion.chunkId
        ? { ...chunk, literalEnglish: literal }
        : chunk,
    );
  }
  if (suggestion.action === 'reapply_heuristic') {
    return applyHeuristic(sourceJapanese, chunks);
  }
  return chunks;
}
