/**
 * "Episode pack": one copy/paste round trip (or a short ordered series, for a
 * long episode) that asks an external AI for everything we would otherwise
 * ask piecemeal — the whole-episode focus targets and any missing sentence
 * translations. No API key or Edge Function is involved. The prompts are
 * rebuilt from the current state, so a pack is resumable: whatever a
 * previous reply already filled in is simply not asked for again.
 *
 * Trust boundary is the same as episodePreparation.ts: the AI only supplies
 * handles (S1..) and text; ids and offsets are resolved here, and existing
 * translations are never overwritten.
 */
import type { EpisodePreparation, StructureDraftChunk } from '../domain/types';
import { STRUCTURE_SENTENCES_PER_PART, STRUCTURE_SHAPE, buildStructureInstructions, parseStructure } from './episodeStructure';
import {
  EPISODE_PREPARATION_VERSION,
  MAX_PREPARED_TARGETS,
  extractJson,
  isPreparationStale,
  parsePreparationObject,
  type PreparationContext,
} from './episodePreparation';

export const PACK_TRANSLATIONS_PER_PART = 60;
const MAX_TRANSLATION_LENGTH = 600;

export interface EpisodePackPlan {
  wantsTargets: boolean;
  missingTranslationHandles: string[];
  /** Handles whose chunk structure is wanted (opt-in); asked in separate parts after translations/targets. */
  structureHandles: string[];
}

export function planEpisodePack(
  context: PreparationContext,
  preparation: EpisodePreparation | undefined,
  options: { forceTargets?: boolean; structureSentenceIds?: ReadonlySet<string> } = {},
): EpisodePackPlan {
  const hasFreshTargets =
    !!preparation && preparation.targets.length > 0 && !isPreparationStale(preparation, context.sentences);
  return {
    wantsTargets: !!options.forceTargets || !hasFreshTargets,
    missingTranslationHandles: context.sentences.flatMap((sentence, index) =>
      sentence.translation?.trim() ? [] : [`S${index + 1}`],
    ),
    structureHandles: context.sentences.flatMap((sentence, index) =>
      options.structureSentenceIds?.has(sentence.id) ? [`S${index + 1}`] : [],
    ),
  };
}

const TARGET_INSTRUCTIONS = [
  `FOCUS TARGETS: read the whole episode, then choose at most ${MAX_PREPARED_TARGETS} teaching targets — words, grammar patterns or`,
  'multi-word expressions that recur, contrast across uses, or are needed to follow the episode. Prefer few, well-justified',
  'targets. Do not pick a short interchangeable filler/connective as a recall target; use treatment "gloss_only" for it, or',
  '"phrase" if a longer stretch makes it fair.',
];

const TARGET_SHAPE = {
  kind: 'vocabulary | grammar | expression',
  ref: 'V3 or G2 only when it is in one of the lists above; otherwise omit ref (kind may still be vocabulary or grammar)',
  label: 'the target as written in the episode',
  treatment: 'recall | phrase | gloss_only',
  reason: 'one plain-English sentence on why it matters in this episode',
  occurrences: [{ sentence: 'S4', text: 'exact substring quoted from that sentence' }],
};

/** Ordered prompts; paste the reply to each into the same box, one at a time. */
export function buildEpisodePackPrompts(context: PreparationContext, plan: EpisodePackPlan): string[] {
  const batches: string[][] = [];
  for (let i = 0; i < plan.missingTranslationHandles.length; i += PACK_TRANSLATIONS_PER_PART) {
    batches.push(plan.missingTranslationHandles.slice(i, i + PACK_TRANSLATIONS_PER_PART));
  }
  const structureBatches: string[][] = [];
  for (let i = 0; i < plan.structureHandles.length; i += STRUCTURE_SENTENCES_PER_PART) {
    structureBatches.push(plan.structureHandles.slice(i, i + STRUCTURE_SENTENCES_PER_PART));
  }
  if (batches.length === 0 && !plan.wantsTargets && structureBatches.length === 0) return [];
  if (plan.wantsTargets && batches.length === 0) batches.push([]);

  const sentenceByHandle = new Map(context.sentences.map((s, i) => [`S${i + 1}`, s]));
  const total = batches.length + structureBatches.length;

  const structurePrompts = structureBatches.map((batch, index) =>
    [
      `You are helping a Japanese learner prepare one episode: "${context.title}".` +
        (total > 1 ? ` This is part ${batches.length + index + 1} of ${total}; each part is answered separately.` : ''),
      '',
      ...buildStructureInstructions(),
      '',
      'STRUCTURE THESE:',
      ...batch.map((handle) => `${handle}: ${sentenceByHandle.get(handle)!.japanese}`),
      '',
      'Reply with ONLY this JSON, nothing else, using plain straight quotes:',
      JSON.stringify({ version: EPISODE_PREPARATION_VERSION, structure: STRUCTURE_SHAPE }, null, 2),
      '"structure" must have one entry per handle listed under STRUCTURE THESE, keyed by that handle.',
    ].join('\n'),
  );

  const mainPrompts = batches.map((batch, partIndex) => {
    const includeTargets = plan.wantsTargets && partIndex === 0;
    const lines: string[] = [
      `You are helping a Japanese learner prepare one episode: "${context.title}".` +
        (total > 1 ? ` This is part ${partIndex + 1} of ${total}; each part is answered separately.` : ''),
    ];

    if (includeTargets) {
      lines.push('', ...TARGET_INSTRUCTIONS);
    }
    if (batch.length > 0) {
      lines.push(
        '',
        `TRANSLATIONS: give a natural, idiomatic English translation for each sentence handle in the list "TRANSLATE THESE"` +
          ' (translate faithfully; no notes or explanation).',
      );
    }

    if (includeTargets) {
      lines.push(
        '',
        'THE WHOLE EPISODE (refer to sentences only by handle):',
        ...context.sentences.map((s, i) => `S${i + 1}: ${s.japanese}`),
        '',
        'KNOWN VOCABULARY (optional refs):',
        ...(context.vocabulary.length
          ? context.vocabulary.map(
              (v, i) =>
                `V${i + 1}: ${v.expression}${v.reading && v.reading !== v.expression ? `（${v.reading}）` : ''}${v.meaning ? ` — ${v.meaning}` : ''}`,
            )
          : ['(none)']),
        '',
        'KNOWN GRAMMAR PATTERNS (optional refs):',
        ...(context.grammar.length
          ? context.grammar.map((g, i) => `G${i + 1}: ${g.canonicalName}${g.shortMeaning ? ` — ${g.shortMeaning}` : ''}`)
          : ['(none)']),
      );
    }
    if (batch.length > 0) {
      lines.push(
        '',
        'TRANSLATE THESE:',
        ...batch.map((handle) => `${handle}: ${sentenceByHandle.get(handle)!.japanese}`),
      );
    }

    const shape: Record<string, unknown> = { version: EPISODE_PREPARATION_VERSION };
    if (includeTargets) shape.targets = [TARGET_SHAPE];
    if (batch.length > 0) shape.translations = { [batch[0]!]: 'English translation' };
    lines.push(
      '',
      'Reply with ONLY this JSON, nothing else, using plain straight quotes:',
      JSON.stringify(shape, null, 2),
    );
    if (includeTargets) {
      lines.push('Every occurrence "text" must be copied exactly from the sentence it names, and name a real sentence handle.');
    }
    if (batch.length > 0) {
      lines.push('"translations" must have one entry per handle listed under TRANSLATE THESE, keyed by that handle.');
    }
    return lines.join('\n');
  });
  return [...mainPrompts, ...structurePrompts];
}

export interface PackTranslation {
  sentenceId: string;
  translation: string;
}
export interface PackReplyResult {
  error?: string;
  /** Present only when the reply had a "targets" list. */
  preparation?: EpisodePreparation;
  translations: PackTranslation[];
  rejectedTranslations: { handle: string; reason: string }[];
  /** Present only when the reply had a "structure" object. */
  structure?: { drafts: Map<string, StructureDraftChunk[]>; rejected: { handle: string; reason: string }[] };
}

export function parseEpisodePackReply(reply: string, context: PreparationContext, now: string): PackReplyResult {
  let raw: unknown;
  try {
    raw = extractJson(reply);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not read the reply as JSON.',
      translations: [],
      rejectedTranslations: [],
    };
  }
  const object = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hasTargets = 'targets' in object;
  const hasTranslations = 'translations' in object;
  const hasStructure = 'structure' in object;
  if (!hasTargets && !hasTranslations && !hasStructure) {
    return { error: 'The reply has none of "targets", "translations" or "structure".', translations: [], rejectedTranslations: [] };
  }

  const translations: PackTranslation[] = [];
  const rejectedTranslations: PackReplyResult['rejectedTranslations'] = [];
  if (hasTranslations) {
    const rawTranslations = object.translations;
    if (!rawTranslations || typeof rawTranslations !== 'object' || Array.isArray(rawTranslations)) {
      return { error: '"translations" must be an object keyed by sentence handle.', translations: [], rejectedTranslations: [] };
    }
    const sentenceByHandle = new Map(context.sentences.map((s, i) => [`S${i + 1}`, s]));
    for (const [rawHandle, value] of Object.entries(rawTranslations)) {
      const handle = rawHandle.trim();
      const sentence = sentenceByHandle.get(handle);
      const text = typeof value === 'string' ? value.trim() : '';
      if (!sentence) rejectedTranslations.push({ handle, reason: 'Unknown sentence handle.' });
      else if (!text) rejectedTranslations.push({ handle, reason: 'Empty translation.' });
      else if (text.length > MAX_TRANSLATION_LENGTH) rejectedTranslations.push({ handle, reason: 'Translation is implausibly long.' });
      else if (sentence.translation?.trim()) rejectedTranslations.push({ handle, reason: 'Already has a translation; kept yours.' });
      else translations.push({ sentenceId: sentence.id, translation: text });
    }
  }

  return {
    preparation: hasTargets ? parsePreparationObject(raw, context, now) : undefined,
    translations,
    rejectedTranslations,
    structure: hasStructure ? parseStructure(object.structure, context) : undefined,
  };
}
