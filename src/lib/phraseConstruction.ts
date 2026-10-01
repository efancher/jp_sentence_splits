/**
 * "How this phrase works": layered, span-anchored explanations of how a phrase in a real sentence
 * is built (inflection, helper construction, change of grammatical role, or a set phrase).
 *
 * Two kinds of content are kept apart on purpose:
 *  - the reusable rule for a construction (formation, core function, restriction) — a small vetted
 *    catalog here, never taken from an AI reply when the key is known;
 *  - the occurrence-specific explanation (this form, this attachment, this contribution, this span)
 *    — AI-drafted via the pasted episode-pack reply and re-validated against the sentence text.
 *
 * Nothing here touches reviews or FSRS.
 */
import type { ConstructionLayer, ConstructionOperation } from '../domain/types';

import type { CompareExcerpt, CompareSentence } from './sentenceLearning';

export interface ConstructionRule {
  /** Short learner-facing name, e.g. "て-form + いる". */
  name: string;
  operation: ConstructionOperation;
  /** The reusable formation or attachment rule. */
  formation: string;
  /** Core function, without claiming one fixed English meaning. */
  function: string;
  /** A restriction that stops the rule being over-generalised. */
  caution?: string;
}

export const OPERATION_LABELS: Record<ConstructionOperation, string> = {
  inflection: 'Inflection',
  helper: 'Helper construction',
  role_change: 'Change of role in the sentence',
  unit: 'Set phrase',
};

export const CONSTRUCTION_CATALOG: Record<string, ConstructionRule> = {
  te_form: {
    name: 'て-form',
    operation: 'inflection',
    formation:
      'Verb ending changes: る-verbs drop る and add て (食べる → 食べて); う/つ/る → って; ぬ/ぶ/む → んで; く → いて (but 行く → 行って); ぐ → いで; す → して. する → して, 来る → 来て.',
    function: 'Turns the verb into a linking form that other parts attach to: a helper verb, a following clause, a request.',
    caution: 'The て-form has no tense of its own and no single meaning; what follows it (and the context) decides whether it reads as sequence, reason, manner or a request.',
  },
  ta_form: {
    name: 'plain past (た-form)',
    operation: 'inflection',
    formation: 'Same sound changes as the て-form, ending in た/だ instead of て/で (読む → 読んだ, 食べる → 食べた). い-adjectives: い → かった. Nouns/な-adjectives: だ → だった.',
    function: 'Marks the plain-style past or a completed/perfective event.',
    caution: 'た also appears for a state that holds now or a discovered fact, so it is not simply "English past tense".',
  },
  nai_form: {
    name: 'negative (ない-form)',
    operation: 'inflection',
    formation: 'Verbs: change the final syllable to its あ-row sound and add ない (読む → 読まない); る-verbs drop る (食べない). Exceptions: ある → ない; する → しない; 来る → こない. い-adjectives: い → くない.',
    function: 'Negates the verb or adjective in plain style.',
    caution: 'Godan verbs ending in う use わ (買う → 買わない), not あ.',
  },
  masu_form: {
    name: 'polite (ます-form)',
    operation: 'inflection',
    formation: 'Verb stem (the い-row sound for godan verbs, the る-less stem for る-verbs) + ます (読む → 読みます, 食べる → 食べます).',
    function: 'Polite style; the same content as the plain form with a different register.',
  },
  i_adj_inflection: {
    name: 'い-adjective inflection',
    operation: 'inflection',
    formation: 'Replace the final い: く + ない (negative), かった (past), くて (linking), く (adverbial: 早く). The adjective itself is the predicate, so no だ is needed in plain style.',
    function: 'Lets an adjective carry negation, tense, or link to what follows, or modify a verb.',
    caution: 'いい has the irregular stem よ- (よくない, よかった).',
  },
  na_adj_inflection: {
    name: 'な-adjective / copula forms',
    operation: 'inflection',
    formation: 'Before a noun the な-adjective takes な (静かな部屋); as a predicate it takes だ/です; it links with で and becomes adverbial with に (静かに).',
    function: 'The copula carries the tense, politeness and linking that the adjective stem cannot.',
    caution: 'Some words ending in い (きれい, 嫌い) are な-adjectives, so they take な/に rather than い-adjective endings; check which kind the word is.',
  },
  potential_form: {
    name: 'potential form',
    operation: 'inflection',
    formation: 'Godan: final syllable to its え-row sound + る (読む → 読める). る-verbs: drop る, add られる (食べられる). する → できる, 来る → こられる.',
    function: 'Says the subject can/is able to do the action.',
    caution: 'The object of a potential verb is often marked with が instead of を. Ichidan potential looks identical to the passive.',
  },
  passive_form: {
    name: 'passive form',
    operation: 'inflection',
    formation: 'Godan: あ-row sound + れる (読む → 読まれる). る-verbs: drop る, add られる. する → される, 来る → こられる.',
    function: 'Makes the affected party the subject; can also be adversative or honorific.',
    caution: 'Several unrelated meanings share this form; the context decides.',
  },
  causative_form: {
    name: 'causative form',
    operation: 'inflection',
    formation: 'Godan: あ-row sound + せる (読む → 読ませる). る-verbs: drop る, add させる. する → させる, 来る → こさせる.',
    function: 'Says someone makes or lets someone else do the action.',
    caution: 'Whether it means "make" or "let" comes from context and the particle on the person doing it.',
  },
  conditional_form: {
    name: 'conditional (ば / たら)',
    operation: 'inflection',
    formation: 'ば: verb → え-row sound + ば (読めば), い-adjective い → ければ. たら: た-form + ら (読んだら).',
    function: 'Sets up a condition for what follows.',
    caution: 'ば, たら, と and なら are not interchangeable; each fits different kinds of conditions.',
  },
  te_iru: {
    name: 'て-form + いる',
    operation: 'helper',
    formation: 'て-form of the verb + いる (conjugates like a る-verb). Casual speech often drops い: 読んでいる → 読んでる.',
    function: 'Presents an action as in progress, a state that resulted from a change and still holds, or a repeated activity.',
    caution: 'Which reading applies depends on the verb and context: 食べている is usually ongoing, but 結婚している and 知っている describe a state. Do not assume it always means "-ing".',
  },
  te_kuru: {
    name: 'て-form + くる',
    operation: 'helper',
    formation: 'て-form + くる (来る conjugation).',
    function: 'Movement or change toward the speaker or the present moment, or something starting to happen.',
    caution: 'Not every verb takes it, and the sense (coming and doing vs. gradually becoming) depends on the verb.',
  },
  te_iku: {
    name: 'て-form + いく',
    operation: 'helper',
    formation: 'て-form + いく.',
    function: 'Movement or change away from the speaker, or continuing into the future.',
    caution: 'The pair くる / いく is about direction relative to the speaker or the time frame, not about literal coming and going only.',
  },
  te_shimau: {
    name: 'て-form + しまう',
    operation: 'helper',
    formation: 'て-form + しまう; casual contractions ちゃう (て → ちゃ), じゃう (で → じゃ).',
    function: 'Completion, or an unintended/regretted outcome.',
    caution: 'Whether it means "finish it off" or "accidentally" comes from the context.',
  },
  te_oku: {
    name: 'て-form + おく',
    operation: 'helper',
    formation: 'て-form + おく; casual: とく.',
    function: 'Does the action in advance or leaves something in the resulting state.',
  },
  te_miru: {
    name: 'て-form + みる',
    operation: 'helper',
    formation: 'て-form + みる.',
    function: 'Tries doing something to see what happens.',
    caution: 'It describes trying an action, not trying hard; and the helper is usually written in kana.',
  },
  te_kureru: {
    name: 'て-form + くれる',
    operation: 'helper',
    formation: 'て-form + くれる (past: てくれた; polite: てくださる).',
    function: 'Someone does the action as a favour toward the speaker or the speaker’s side.',
    caution: 'The direction of the favour matters: あげる and もらう give other directions or perspectives, so they are not interchangeable with くれる.',
  },
  te_ageru: {
    name: 'て-form + あげる',
    operation: 'helper',
    formation: 'て-form + あげる.',
    function: 'The speaker (or someone on their side) does the action for someone else.',
    caution: 'Can sound condescending toward a superior; the direction is the opposite of くれる.',
  },
  te_morau: {
    name: 'て-form + もらう',
    operation: 'helper',
    formation: 'て-form + もらう (polite: いただく).',
    function: 'Receives a favour: the receiver is the subject, the doer is marked with に or から.',
    caution: 'Same event as くれる seen from the receiver’s side, with a different subject.',
  },
  tari_suru: {
    name: 'たり…たり + する',
    operation: 'helper',
    formation: 'た-form of each verb/adjective + り, listed in a series, then する (書く → 書いたり, 読む → 読んだり, + する: 書いたり読んだりする). The final する carries tense and politeness.',
    function: 'Gives representative examples of actions or states, implying there are others, or that they alternate.',
    caution: 'Unlike て-form listing, it is not a strict sequence and is not exhaustive. A single たり (…たりする) is also fine and hints at other unnamed examples.',
  },
  hou_ga_comparison: {
    name: 'AのほうがB (comparison)',
    operation: 'unit',
    formation: 'Noun or plain-form clause + の + 方(ほう) + が + predicate (本を読む方が好き). Often paired with より for the other side: AのほうがBより….',
    function: 'Picks A out as the preferred or greater side of a two-way comparison.',
    caution: 'The comparison can be implicit, with no より part. 方 here is “side/direction”, not a free-standing noun, and a verb before it needs plain form (書く方が), not a の-linked noun.',
  },
  no_nominaliser: {
    name: 'clause + の',
    operation: 'role_change',
    formation: 'Clause in plain form + の → a noun phrase. A noun or な-adjective predicate takes な before の (静かなの).',
    function: 'The clause keeps its internal structure; の lets the whole clause take a role in the larger sentence (subject, object, topic).',
    caution: 'Often fits things perceived or concrete; こと, and a few others, fit more abstract or factual content, so the two are not always interchangeable.',
  },
  koto_nominaliser: {
    name: 'clause + こと',
    operation: 'role_change',
    formation: 'Clause in plain form + こと → a noun phrase. A noun or な-adjective predicate takes な before こと.',
    function: 'The clause keeps its internal structure; こと lets the whole clause act as an abstract fact or action in the larger sentence.',
    caution: 'こと is also an ordinary noun ("matter"), so check that it is closing a clause here. It is not always replaceable by の.',
  },
  relative_clause: {
    name: 'clause modifying a noun',
    operation: 'role_change',
    formation: 'Plain-form clause placed directly before the noun it describes; no relative pronoun. Within the clause が can mark the subject.',
    function: 'The clause describes the noun that follows, which is a participant in that clause.',
    caution: 'The noun may be the clause’s subject, object or something else; only the context tells which.',
  },
  quotation_to: {
    name: 'clause + と',
    operation: 'role_change',
    formation: 'Plain-form clause (or quoted words) + と, followed by a verb of saying, thinking or hearing.',
    function: 'Presents the clause as what was said, thought or perceived.',
    caution: 'と has other jobs (and, with, conditional); only the quoted-clause use follows this pattern.',
  },
};

export function constructionRule(layer: Pick<ConstructionLayer, 'key' | 'rule' | 'operation'>): (ConstructionRule & { source: 'catalog' | 'draft' }) | undefined {
  const known = CONSTRUCTION_CATALOG[layer.key];
  if (known) return { ...known, source: 'catalog' };
  if (!layer.rule) return undefined;
  return {
    name: layer.key.replace(/_/g, ' '),
    operation: layer.operation,
    formation: layer.rule.formation,
    function: layer.rule.function,
    ...(layer.rule.caution ? { caution: layer.rule.caution } : {}),
    source: 'draft',
  };
}

export const CONSTRUCTION_KEYS = Object.keys(CONSTRUCTION_CATALOG);
export const MAX_LAYERS_PER_SENTENCE = 6;
export const CONSTRUCTION_SENTENCES_PER_PART = 60;
const MAX_FIELD = 300;

export function constructionLayerId(sentenceId: string, layer: Pick<ConstructionLayer, 'start' | 'end' | 'key'>): string {
  return `construction:${sentenceId}:${layer.start}-${layer.end}:${layer.key}`;
}

export function buildConstructionInstructions(): string[] {
  return [
    'HOW PHRASES WORK: for each sentence in "EXPLAIN THESE", pick the phrases where a learner would benefit from seeing how the form is built,',
    `and list their layers (at most ${MAX_LAYERS_PER_SENTENCE} per sentence; none if the sentence has nothing worth explaining). Each layer is one`,
    'operation applied to an exact span of the sentence. Distinguish:',
    '- inflection: changing a word’s form (verb, adjective, copula);',
    '- helper: adding meaning with a construction such as ～ている or ～てくれる;',
    '- role_change: changing the grammatical role of a span, e.g. clause + の or こと making a noun phrase, or a clause modifying a noun;',
    '- unit: an idiomatic combination that would mislead if split mechanically; explain it as one unit.',
    'Layers may nest (the inner て-form, then ている, then の around the whole clause). For each layer give:',
    '"text" (exact substring of that sentence, long enough to occur only once in it), "operation", "key", "from" (the base or preceding form, if useful),',
    '"attach" (how the pieces attach here), "contribution" (what the operation adds in THIS sentence, without claiming a single fixed English meaning),',
    '"scope" (what span it applies to, especially when it covers a whole clause), and "use" (a few words naming this particular use, to tell similar-looking forms apart).',
    `"key" is a short snake_case construction name; reuse one of these when it fits: ${CONSTRUCTION_KEYS.join(', ')}.`,
    'For a key NOT in that list, also give "rule": {"formation": the reusable attachment rule, "function": its core function, "caution": a restriction against over-generalising}.',
    'If the analysis is genuinely ambiguous, leave that layer out rather than guessing. Keep every explanation short and learner-friendly.',
  ];
}

export const CONSTRUCTION_SHAPE = {
  S4: [
    {
      text: '読んでいる',
      operation: 'inflection | helper | role_change | unit',
      key: 'te_iru',
      from: '読む → 読んで + いる',
      attach: 'the て-form 読んで connects to いる',
      contribution: 'presents the reading as ongoing here',
      scope: 'the verb phrase 読んでいる',
      use: 'ongoing action',
    },
  ],
};

const OPERATIONS: ConstructionOperation[] = ['inflection', 'helper', 'role_change', 'unit'];
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function field(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function crosses(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const overlap = a.start < b.end && b.start < a.end;
  const aInB = a.start >= b.start && a.end <= b.end;
  const bInA = b.start >= a.start && b.end <= a.end;
  return overlap && !aInB && !bInA;
}

export interface ConstructionParse {
  drafts: Map<string, ConstructionLayer[]>;
  rejected: { handle: string; reason: string }[];
}

/**
 * Validate a `constructions` object keyed by sentence handle. The AI supplies only handles and quoted
 * text; offsets are computed here, a quote must occur exactly once in its sentence, and layers that
 * partially overlap each other are rejected (nesting and disjointness are fine). Each bad layer is
 * dropped on its own so one slip never costs the rest of the reply.
 */
export function parseConstructions(raw: unknown, context: { sentences: { id: string; japanese: string }[] }): ConstructionParse {
  const drafts = new Map<string, ConstructionLayer[]>();
  const rejected: ConstructionParse['rejected'] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { drafts, rejected: [{ handle: 'constructions', reason: '"constructions" must be an object keyed by sentence handle.' }] };
  }
  const sentenceByHandle = new Map(context.sentences.map((sentence, index) => [`S${index + 1}`, sentence]));
  for (const [rawHandle, value] of Object.entries(raw)) {
    const handle = rawHandle.trim();
    const sentence = sentenceByHandle.get(handle);
    if (!sentence) {
      rejected.push({ handle, reason: 'Unknown sentence handle.' });
      continue;
    }
    if (!Array.isArray(value)) {
      rejected.push({ handle, reason: 'Expected a list of layers.' });
      continue;
    }
    const layers: ConstructionLayer[] = [];
    for (const item of value) {
      if (layers.length >= MAX_LAYERS_PER_SENTENCE) {
        rejected.push({ handle, reason: `Over the limit of ${MAX_LAYERS_PER_SENTENCE} layers.` });
        break;
      }
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const text = typeof entry.text === 'string' ? entry.text : '';
      const key = field(entry.key, 40).toLowerCase();
      const operation = OPERATIONS.find((candidate) => candidate === entry.operation);
      const attach = field(entry.attach);
      const contribution = field(entry.contribution);
      const known = CONSTRUCTION_CATALOG[key];
      if (!text || !operation || !KEY_PATTERN.test(key) || !attach || !contribution) {
        rejected.push({ handle, reason: `A layer${text ? ` on ${text}` : ''} was missing text, operation, key, attach or contribution.` });
        continue;
      }
      const start = sentence.japanese.indexOf(text);
      if (start < 0) {
        rejected.push({ handle, reason: `“${text}” is not in the sentence.` });
        continue;
      }
      if (sentence.japanese.indexOf(text, start + 1) >= 0) {
        rejected.push({ handle, reason: `“${text}” occurs more than once in the sentence; quote a longer stretch.` });
        continue;
      }
      const span = { start, end: start + text.length };
      if (layers.some((existing) => crosses(existing, span))) {
        rejected.push({ handle, reason: `“${text}” partly overlaps another layer; layers must nest or stay apart.` });
        continue;
      }
      if (layers.some((existing) => existing.start === span.start && existing.end === span.end && existing.key === key)) continue;
      const ruleEntry = (entry.rule && typeof entry.rule === 'object' ? entry.rule : {}) as Record<string, unknown>;
      const formation = field(ruleEntry.formation);
      const ruleFunction = field(ruleEntry.function);
      const caution = field(ruleEntry.caution);
      if (!known && (!formation || !ruleFunction)) {
        rejected.push({ handle, reason: `“${text}” uses an unfamiliar key (${key}) without a reusable rule.` });
        continue;
      }
      const from = field(entry.from, 120);
      const scope = field(entry.scope, 160);
      const use = field(entry.use, 60);
      layers.push({
        text,
        ...span,
        operation: known ? known.operation : operation,
        key,
        ...(from ? { from } : {}),
        attach,
        contribution,
        ...(scope ? { scope } : {}),
        ...(use ? { use } : {}),
        ...(!known ? { rule: { formation, function: ruleFunction, ...(caution ? { caution } : {}) } } : {}),
      });
    }
    if (layers.length > 0) drafts.set(sentence.id, layers);
  }
  return { drafts, rejected };
}

/** Layers whose quoted text still sits exactly at their stored offsets in the live sentence. */
export function validLayersFor(japanese: string, layers: ConstructionLayer[] | undefined): ConstructionLayer[] {
  return (layers ?? []).filter(
    (layer) => layer.start >= 0 && layer.end <= japanese.length && layer.start < layer.end && japanese.slice(layer.start, layer.end) === layer.text,
  );
}

/** Inner layers first (shorter span, then earlier), which is the order a construction is built in. */
export function orderLayers(layers: ConstructionLayer[]): ConstructionLayer[] {
  return [...layers].sort((a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start);
}

/** How many other layers strictly contain this one (same span counts when it comes earlier in the list). */
export function layerDepth(layers: ConstructionLayer[], layer: ConstructionLayer): number {
  const index = layers.indexOf(layer);
  return layers.filter((other, otherIndex) => {
    if (other === layer) return false;
    const contains = other.start <= layer.start && other.end >= layer.end;
    if (!contains) return false;
    const same = other.start === layer.start && other.end === layer.end;
    return same ? otherIndex < index : true;
  }).length;
}

function overlapLength(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Layers that overlap a span, best match first (largest overlap, then the tighter layer). */
export function layersOverlapping(layers: ConstructionLayer[], span: { start: number; end: number }): ConstructionLayer[] {
  return layers
    .filter((layer) => overlapLength(layer, span) > 0)
    .sort((a, b) => overlapLength(b, span) - overlapLength(a, span) || a.end - a.start - (b.end - b.start));
}

export interface LayerWithSentence extends ConstructionLayer {
  sentenceId: string;
}

export interface ConstructionCompare {
  current: CompareExcerpt;
  other: CompareExcerpt;
  otherLayer: ConstructionLayer;
  /** Both uses carry a label and the labels differ: same-looking form, different use. */
  differentUse: boolean;
  /** The other occurrence is on different words (not the same text). */
  differentWords: boolean;
  remainingUnseen: number;
}

/**
 * Another real occurrence of the same construction. Matches by construction key (not by identical text),
 * checks the stored span against the live sentence, and prefers an unseen example, then one on different
 * words, then the nearest in the episode. `undefined` when there is no reliable second occurrence.
 */
export function pickConstructionCompare(
  current: { sentenceId: string; layer: ConstructionLayer },
  all: LayerWithSentence[],
  sentences: CompareSentence[],
  exposedSentenceIds: ReadonlySet<string>,
): ConstructionCompare | undefined {
  const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const here = byId.get(current.sentenceId);
  if (!here || current.layer.operation === 'unit') return undefined;
  const candidates = all
    .filter((item) => item.sentenceId !== current.sentenceId && item.key === current.layer.key)
    .flatMap((item) => {
      const sentence = byId.get(item.sentenceId);
      return sentence && validLayersFor(sentence.japanese, [item]).length > 0 ? [{ item, sentence }] : [];
    });
  if (candidates.length === 0) return undefined;
  const rank = ({ item, sentence }: (typeof candidates)[number]) => [
    exposedSentenceIds.has(sentence.id) ? 1 : 0,
    item.text === current.layer.text ? 1 : 0,
    Math.abs(sentence.position - here.position),
  ];
  const sorted = [...candidates].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0]! - rb[0]! || ra[1]! - rb[1]! || ra[2]! - rb[2]! || a.sentence.position - b.sentence.position;
  });
  const chosen = sorted[0]!;
  const toExcerpt = (sentence: CompareSentence, layer: ConstructionLayer): CompareExcerpt => ({
    sentenceId: sentence.id,
    position: sentence.position,
    japanese: sentence.japanese,
    span: { start: layer.start, end: layer.end },
  });
  const unseen = sorted.filter((candidate) => !exposedSentenceIds.has(candidate.sentence.id));
  return {
    current: toExcerpt(here, current.layer),
    other: toExcerpt(chosen.sentence, chosen.item),
    otherLayer: chosen.item,
    differentUse: !!current.layer.use && !!chosen.item.use && current.layer.use !== chosen.item.use,
    differentWords: chosen.item.text !== current.layer.text,
    remainingUnseen: Math.max(0, unseen.length - (exposedSentenceIds.has(chosen.sentence.id) ? 0 : 1)),
  };
}

/** The event target key under which Compare-uses exposures for a construction are logged. */
export function constructionTargetKey(key: string): string {
  return `construction:${key}`;
}
