/**
 * Pure planning for merge-grammar-patterns.ts: given the owner's live patterns, links and pattern cards, work
 * out which pattern survives each approved group, what its canonical name/aliases become, and which dependent
 * rows move. No database access, so it is testable without credentials.
 */
import { normalizeGrammarPatternKey } from '../../src/lib/grammarPatterns';

/** The reserved `family` value that tells the book assistant not to link sentences to a pattern. */
export const NO_AUTO_LINK_FAMILY = 'no-auto-link';

export interface MergeGroup {
  /** Canonical name the surviving pattern ends up with. */
  canonical: string;
  /** Existing canonical names to fold together. */
  members: string[];
  /** Member that survives (its explanation is kept); default is the one with the most encounters. */
  keep?: string;
  /** Replaces the survivor's short meaning, for when the survivor's own wording is narrower than the merged pattern. */
  shortMeaning?: string;
}

export interface PatternRow {
  id: string;
  canonicalName: string;
  aliases: string[];
  family: string | null;
}

export interface LinkRow {
  id: string;
  sentenceId: string;
  patternId: string;
  surfaceForm: string | null;
  occurrenceExplanation: string | null;
  confirmedByLearner: boolean;
}

export interface PatternStudyItemRow {
  id: string;
  subjectId: string;
  activityType: string;
}

export interface RelationshipRow {
  id: string;
  patternAId: string;
  patternBId: string;
}

export interface GroupPlan {
  canonical: string;
  survivor: PatternRow;
  losers: PatternRow[];
  normalizedKey: string;
  aliases: string[];
  shortMeaning: string | null;
  repointLinks: { id: string; toPatternId: string; confirmed: boolean }[];
  /** A loser link whose sentence the survivor already has: carry over anything missing, then soft-delete. */
  mergeAndDeleteLinks: {
    id: string;
    survivorLinkId: string;
    surfaceForm: string | null;
    occurrenceExplanation: string | null;
    confirmed: boolean;
  }[];
  repointStudyItems: { id: string; toPatternId: string }[];
  /** Set when the group cannot be applied safely; nothing in it is written. */
  blocked: string | null;
}

export interface MergePlan {
  groups: GroupPlan[];
  /** Patterns to tag with the no-auto-link family. */
  flags: { id: string; canonicalName: string }[];
  problems: string[];
}

export function planGrammarMerge(input: {
  patterns: PatternRow[];
  links: LinkRow[];
  studyItems: PatternStudyItemRow[];
  relationships: RelationshipRow[];
  groups: MergeGroup[];
  flagNames: string[];
}): MergePlan {
  const byName = new Map(input.patterns.map((pattern) => [pattern.canonicalName, pattern]));
  const problems: string[] = [];
  const groups: GroupPlan[] = [];
  const claimed = new Set<string>();

  for (const group of input.groups) {
    const found: PatternRow[] = [];
    for (const name of group.members) {
      const pattern = byName.get(name);
      if (!pattern) problems.push(`"${group.canonical}": no live pattern named "${name}" (already merged or renamed?)`);
      else if (claimed.has(pattern.id)) problems.push(`"${name}" appears in more than one group`);
      else found.push(pattern);
    }
    if (found.length < 2) {
      if (found.length > 0 || group.members.length > 0) problems.push(`"${group.canonical}": fewer than two members found, skipped`);
      continue;
    }
    found.forEach((pattern) => claimed.add(pattern.id));

    const encounters = (pattern: PatternRow) => input.links.filter((link) => link.patternId === pattern.id).length;
    const kept = group.keep ? found.find((pattern) => pattern.canonicalName === group.keep) : undefined;
    if (group.keep && !kept) problems.push(`"${group.canonical}": keep "${group.keep}" is not among the members found, using the busiest`);
    const survivor = kept ?? [...found].sort((a, b) => encounters(b) - encounters(a))[0]!;
    const losers = found.filter((pattern) => pattern.id !== survivor.id);
    const normalizedKey = normalizeGrammarPatternKey(group.canonical);

    const taken = input.patterns.find(
      (pattern) =>
        pattern.id !== survivor.id &&
        !found.includes(pattern) &&
        normalizeGrammarPatternKey(pattern.canonicalName) === normalizedKey,
    );
    let blocked: string | null = taken
      ? `canonical key "${normalizedKey}" is already used by pattern "${taken.canonicalName}"`
      : null;

    const aliasSet = new Set<string>();
    for (const pattern of found) {
      for (const name of [pattern.canonicalName, ...pattern.aliases]) {
        if (normalizeGrammarPatternKey(name) !== normalizedKey) aliasSet.add(name);
      }
    }

    const loserIds = new Set(losers.map((pattern) => pattern.id));
    const survivorLinkBySentence = new Map(
      input.links.filter((link) => link.patternId === survivor.id).map((link) => [link.sentenceId, link]),
    );
    const repointLinks: GroupPlan['repointLinks'] = [];
    const mergeAndDeleteLinks: GroupPlan['mergeAndDeleteLinks'] = [];
    for (const link of input.links.filter((row) => loserIds.has(row.patternId))) {
      const existing = survivorLinkBySentence.get(link.sentenceId);
      if (existing) {
        mergeAndDeleteLinks.push({
          id: link.id,
          survivorLinkId: existing.id,
          surfaceForm: existing.surfaceForm ? null : link.surfaceForm,
          occurrenceExplanation: existing.occurrenceExplanation ? null : link.occurrenceExplanation,
          confirmed: link.confirmedByLearner && !existing.confirmedByLearner,
        });
      } else {
        repointLinks.push({ id: link.id, toPatternId: survivor.id, confirmed: link.confirmedByLearner });
        survivorLinkBySentence.set(link.sentenceId, link);
      }
    }

    const survivorActivities = new Set(
      input.studyItems.filter((item) => item.subjectId === survivor.id).map((item) => item.activityType),
    );
    const repointStudyItems: GroupPlan['repointStudyItems'] = [];
    for (const item of input.studyItems.filter((row) => loserIds.has(row.subjectId))) {
      if (survivorActivities.has(item.activityType)) {
        blocked ??= `both a merged pattern and the survivor have a "${item.activityType}" card; resolve by hand`;
      } else {
        survivorActivities.add(item.activityType);
        repointStudyItems.push({ id: item.id, toPatternId: survivor.id });
      }
    }

    const involved = new Set(found.map((pattern) => pattern.id));
    if (input.relationships.some((rel) => involved.has(rel.patternAId) || involved.has(rel.patternBId))) {
      blocked ??= 'a pattern relationship references this group; the script does not move relationships';
    }

    groups.push({
      canonical: group.canonical,
      survivor,
      losers,
      normalizedKey,
      aliases: [...aliasSet],
      shortMeaning: group.shortMeaning ?? null,
      repointLinks,
      mergeAndDeleteLinks,
      repointStudyItems,
      blocked,
    });
  }

  const flags: MergePlan['flags'] = [];
  for (const name of input.flagNames) {
    const pattern = byName.get(name);
    if (!pattern) problems.push(`flag: no live pattern named "${name}"`);
    else if (claimed.has(pattern.id)) problems.push(`flag: "${name}" is also being merged, skipped`);
    else if (pattern.family === NO_AUTO_LINK_FAMILY) continue;
    else if (pattern.family) problems.push(`flag: "${name}" already has family "${pattern.family}", left alone`);
    else flags.push({ id: pattern.id, canonicalName: pattern.canonicalName });
  }
  return { groups, flags, problems };
}
