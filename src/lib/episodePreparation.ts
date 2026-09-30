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
    'Reply with ONLY this JSON, nothing else, using plain straight quotes:',
    JSON.stringify(
      {
        version: EPISODE_PREPARATION_VERSION,
        targets: [
          {
            kind: 'vocabulary | grammar | expression',
            ref: 'V3 or G2 only when it is in one of the lists above; otherwise omit ref (kind may still be vocabulary or grammar)',
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
  const json = candidate.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (strictError) {
    // Chat apps and phone keyboards often turn the JSON's straight quotes into
    // curly ones, add non-breaking spaces, or leave trailing commas. Repair only
    // after a strict parse fails, so a valid reply is never altered.
    const repaired = json
      .replace(/[\u201c\u201d\u201e\u201f\u00ab\u00bb]/g, '"')
      .replace(/\u00a0/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(repaired);
    } catch {
      try {
        return JSON.parse(repairCurlyQuotes(json));
      } catch {
        // fall through to the error below
      }
      const detail = strictError instanceof Error ? strictError.message : 'parse error';
      throw new Error(`The reply is not valid JSON (${detail}). Ask the AI to answer again with only the JSON, using plain straight quotes.`);
    }
  }
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
      // No ref is fine: the word or pattern just is not in the learner's saved
      // lists yet, so the target stays unlinked. A ref that is given must be real.
      if (ref) {
        const found = kind === 'vocabulary' ? vocabularyByRef.get(ref) : grammarByRef.get(ref);
        if (!found) return reject(`Unknown ${kind} ref "${ref}".`);
        if (seenRefs.has(ref)) return reject(`Duplicate ref "${ref}".`);
        seenRefs.add(ref);
        if (kind === 'vocabulary') vocabularyItemId = found.id;
        else grammarPatternId = found.id;
      }
    } else if (ref) {
      return reject('An expression target must not carry a ref.');
    }

    const rawOccurrences = Array.isArray(entry.occurrences) ? entry.occurrences : [];
    const occurrences: PreparedTarget['occurrences'] = [];
    let dropped = 0;
    for (const occurrence of rawOccurrences) {
      const o = (occurrence && typeof occurrence === 'object' ? occurrence : {}) as Record<string, unknown>;
      const sentence = typeof o.sentence === 'string' ? sentenceByHandle.get(o.sentence.trim()) : undefined;
      const text = typeof o.text === 'string' ? o.text : '';
      const start = sentence && text ? sentence.japanese.indexOf(text) : -1;
      if (!sentence || start < 0) {
        dropped += 1;
        continue;
      }
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
      ...(dropped > 0 ? { droppedOccurrences: dropped } : {}),
    });
  });

  if (targets.length === 0) {
    return { ...failed('No valid targets in the reply.'), rejected };
  }
  return {
    version: EPISODE_PREPARATION_VERSION,
    status: rejected.length > 0 || targets.some((t) => t.droppedOccurrences) ? 'partial' : 'ready',
    preparedAt: now,
    provenance: 'pasted_ai_reply',
    sentenceFingerprint: fingerprint,
    targets,
    rejected,
  };
}

/**
 * Curly quotes may be the JSON's own delimiters or quotation marks inside a
 * string value (a gloss like “the book”). A curly quote outside a string opens
 * one; inside a string it closes it only when followed by , : } or ]; otherwise
 * it is content and becomes a single quote so the JSON stays valid.
 */
export function repairCurlyQuotes(json: string): string {
  const curly = /[\u201c\u201d\u201e\u201f\u00ab\u00bb]/;
  let out = '';
  let inString = false;
  let openedCurly = false;
  for (let i = 0; i < json.length; i += 1) {
    const ch = json[i]!;
    if (ch === '\\' && inString) {
      out += ch + (json[i + 1] ?? '');
      i += 1;
    } else if (ch === '"') {
      if (inString && openedCurly) out += "'";
      else {
        inString = !inString;
        out += ch;
      }
    } else if (curly.test(ch)) {
      if (!inString) {
        inString = true;
        openedCurly = true;
        out += '"';
      } else if (/^\s*[,:}\]]/.test(json.slice(i + 1))) {
        inString = false;
        openedCurly = false;
        out += '"';
      } else out += "'";
    } else out += ch;
  }
  return out.replace(/\u00a0/g, ' ').replace(/,(\s*[}\]])/g, '$1');
}
