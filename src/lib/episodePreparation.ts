/**
 * Whole-episode preparation round trip (sentence-first plan, Phase 0). The
 * app builds an inspectable prompt from the episode's own sentences and known
 * vocabulary/grammar links; a learner pastes the AI's JSON reply back; the
 * reply is validated against the real ids and text before anything is stored.
 * The AI never supplies offsets or database ids — only short handles and
 * quoted text — so an invented sentence, id or span is rejected, not trusted.
 */
import type {
  EpisodePreparation,
  PreparedTarget,
  PreparedTargetKind,
  PreparedTargetTreatment,
  RejectedPreparedTarget,
} from '../domain/types';

export const EPISODE_PREPARATION_VERSION = 1;
export const MAX_PREPARED_TARGETS = 8;

export interface PreparationSentence {
  id: string;
  japanese: string;
  /** Present-but-empty means "still needs a translation"; never part of the fingerprint. */
  translation?: string;
}
export interface PreparationVocabulary {
  id: string;
  expression: string;
  reading?: string;
  meaning?: string;
}
export interface PreparationGrammar {
  id: string;
  canonicalName: string;
  shortMeaning?: string;
}
export interface PreparationContext {
  title: string;
  sentences: PreparationSentence[];
  vocabulary: PreparationVocabulary[];
  grammar: PreparationGrammar[];
}

/** FNV-1a over ids and text, in order: changes when the episode's sentences change. */
export function episodeFingerprint(sentences: PreparationSentence[]): string {
  let hash = 0x811c9dc5;
  for (const char of sentences.map((s) => `${s.id}|${s.japanese}`).join('\n')) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function isPreparationStale(preparation: EpisodePreparation, sentences: PreparationSentence[]): boolean {
  return (
    preparation.version !== EPISODE_PREPARATION_VERSION ||
    preparation.sentenceFingerprint !== episodeFingerprint(sentences)
  );
}

export function buildPreparationPrompt(context: PreparationContext): string {
  const sentenceLines = context.sentences.map((s, i) => `S${i + 1}: ${s.japanese}`);
  const vocabularyLines = context.vocabulary.map(
    (v, i) =>
      `V${i + 1}: ${v.expression}${v.reading && v.reading !== v.expression ? `（${v.reading}）` : ''}${v.meaning ? ` — ${v.meaning}` : ''}`,
  );
  const grammarLines = context.grammar.map(
    (g, i) => `G${i + 1}: ${g.canonicalName}${g.shortMeaning ? ` — ${g.shortMeaning}` : ''}`,
  );
  return [
    `You are helping a Japanese learner decide what to teach first from one episode: "${context.title}".`,
    `Read the whole episode, then choose at most ${MAX_PREPARED_TARGETS} teaching targets: words, grammar patterns or multi-word expressions that`,
    'recur, contrast across uses, or are needed to follow the episode. Prefer few, well-justified targets. Do not pick a short',
    'interchangeable filler/connective as a recall target; use treatment "gloss_only" for it, or "phrase" if a longer stretch makes it fair.',
    '',
    'SENTENCES (refer to them only by handle):',
    ...sentenceLines,
    '',
    'KNOWN VOCABULARY (optional refs):',
    ...(vocabularyLines.length ? vocabularyLines : ['(none)']),
    '',
    'KNOWN GRAMMAR PATTERNS (optional refs):',
    ...(grammarLines.length ? grammarLines : ['(none)']),
    '',
    'Reply with ONLY this JSON, nothing else:',
    JSON.stringify(
      {
        version: EPISODE_PREPARATION_VERSION,
        targets: [
          {
            kind: 'vocabulary | grammar | expression',
            ref: 'V3 or G2 when it is one of the lists above; omit for a new expression',
            label: 'the target as written in the episode',
            treatment: 'recall | phrase | gloss_only',
            reason: 'one plain-English sentence on why it matters in this episode',
            occurrences: [{ sentence: 'S4', text: 'exact substring quoted from that sentence' }],
          },
        ],
      },
      null,
      2,
    ),
    'Every "text" must be copied exactly from the sentence it names. Every occurrence must name a real sentence handle.',
  ].join('\n');
}

export function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? reply).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in the reply.');
  return JSON.parse(candidate.slice(start, end + 1));
}

const KINDS: PreparedTargetKind[] = ['vocabulary', 'grammar', 'expression'];
const TREATMENTS: PreparedTargetTreatment[] = ['recall', 'phrase', 'gloss_only'];

export function parsePreparationReply(reply: string, context: PreparationContext, now: string): EpisodePreparation {
  const fingerprint = episodeFingerprint(context.sentences);
  const failed = (error: string): EpisodePreparation => ({
    version: EPISODE_PREPARATION_VERSION,
    status: 'failed',
    preparedAt: now,
    provenance: 'pasted_ai_reply',
    sentenceFingerprint: fingerprint,
    targets: [],
    rejected: [],
    error,
  });

  let raw: unknown;
  try {
    raw = extractJson(reply);
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'Could not read the reply as JSON.');
  }
  return parsePreparationObject(raw, context, now);
}

export function parsePreparationObject(raw: unknown, context: PreparationContext, now: string): EpisodePreparation {
  const fingerprint = episodeFingerprint(context.sentences);
  const failed = (error: string): EpisodePreparation => ({
    version: EPISODE_PREPARATION_VERSION,
    status: 'failed',
    preparedAt: now,
    provenance: 'pasted_ai_reply',
    sentenceFingerprint: fingerprint,
    targets: [],
    rejected: [],
    error,
  });
  const rawTargets = (raw as { targets?: unknown }).targets;
  if (!Array.isArray(rawTargets)) return failed('The reply has no "targets" list.');

  const sentenceByHandle = new Map(context.sentences.map((s, i) => [`S${i + 1}`, s]));
  const vocabularyByRef = new Map(context.vocabulary.map((v, i) => [`V${i + 1}`, v]));
  const grammarByRef = new Map(context.grammar.map((g, i) => [`G${i + 1}`, g]));

  const targets: PreparedTarget[] = [];
  const rejected: RejectedPreparedTarget[] = [];
  const seenRefs = new Set<string>();

  rawTargets.forEach((item, index) => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const reject = (reason: string) => {
      rejected.push({ label: label || `(target ${index + 1})`, reason });
    };

    if (targets.length >= MAX_PREPARED_TARGETS) return reject(`Over the limit of ${MAX_PREPARED_TARGETS} targets.`);
    if (!label) return reject('Missing label.');
    const kind = KINDS.find((k) => k === entry.kind);
    if (!kind) return reject('Unknown kind.');
    const treatment = entry.treatment === undefined ? 'recall' : TREATMENTS.find((t) => t === entry.treatment);
    if (!treatment) return reject('Unknown treatment.');

    const ref = typeof entry.ref === 'string' ? entry.ref.trim() : '';
    let vocabularyItemId: string | undefined;
    let grammarPatternId: string | undefined;
    if (kind === 'vocabulary' || kind === 'grammar') {
      if (!ref) return reject(`A ${kind} target needs a ref from the supplied list.`);
      const found = kind === 'vocabulary' ? vocabularyByRef.get(ref) : grammarByRef.get(ref);
      if (!found) return reject(`Unknown ${kind} ref "${ref}".`);
      if (seenRefs.has(ref)) return reject(`Duplicate ref "${ref}".`);
      seenRefs.add(ref);
      if (kind === 'vocabulary') vocabularyItemId = found.id;
      else grammarPatternId = found.id;
    } else if (ref) {
      return reject('An expression target must not carry a ref.');
    }

    const rawOccurrences = Array.isArray(entry.occurrences) ? entry.occurrences : [];
    const occurrences: PreparedTarget['occurrences'] = [];
    for (const occurrence of rawOccurrences) {
      const o = (occurrence && typeof occurrence === 'object' ? occurrence : {}) as Record<string, unknown>;
      const sentence = typeof o.sentence === 'string' ? sentenceByHandle.get(o.sentence.trim()) : undefined;
      const text = typeof o.text === 'string' ? o.text : '';
      if (!sentence || !text) continue;
      const start = sentence.japanese.indexOf(text);
      if (start < 0) continue;
      if (!occurrences.some((existing) => existing.sentenceId === sentence.id && existing.start === start)) {
        occurrences.push({ sentenceId: sentence.id, start, end: start + text.length, text });
      }
    }
    if (occurrences.length === 0) return reject('No quoted occurrence matched a real sentence.');

    targets.push({
      id: `prep-${index}-${kind}`,
      kind,
      label,
      vocabularyItemId,
      grammarPatternId,
      occurrences,
      reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
      treatment,
      decision: 'suggested',
    });
  });

  if (targets.length === 0) {
    return { ...failed('No valid targets in the reply.'), rejected };
  }
  return {
    version: EPISODE_PREPARATION_VERSION,
    status: rejected.length > 0 ? 'partial' : 'ready',
    preparedAt: now,
    provenance: 'pasted_ai_reply',
    sentenceFingerprint: fingerprint,
    targets,
    rejected,
  };
}
