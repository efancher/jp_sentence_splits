/**
 * Progressive glossing core: which structural decisions a sentence offers, how
 * a response is graded against the heuristic reference, the hint ladder, and
 * the per-skill support level inferred from stored observations.
 *
 * Observations (GlossDecision) are stored; the level is a pure function of them
 * recomputed on read, so changing a rule never needs a data migration.
 */

import type { GlossDecision, GlossOutcome, GlossSkill, ParticleCheck } from '../domain/types';

import { PARTICLE_ROLE, roleForChunk, splitTrailingParticle } from './chunking';
import { isEngineRole } from './clauseBands';

export type SupportLevel = 1 | 2 | 3 | 4;
export const DEFAULT_LEVEL: SupportLevel = 3;
export const LEVEL_NAMES: Record<SupportLevel, string> = {
  1: 'Worked example',
  2: 'Partial analysis',
  3: 'Guided analysis',
  4: 'Independent',
};

export const SUCCESSES_TO_ADVANCE = 3;
export const MISS_WINDOW = 3;
export const MIN_GRADABLE = 3;
export const RUST_DAYS = 45;

export interface GlossChunk {
  id: string;
  japanese: string;
  role: string;
  literalEnglish?: string;
}

export interface RelationOption {
  id: string;
  label: string;
}

const RELATIONS: Record<string, RelationOption> = {
  subject: { id: 'subject', label: 'who or what does it / is it' },
  object: { id: 'object', label: 'what the action is done to' },
  topic: { id: 'topic', label: 'what we are talking about' },
  where_how: { id: 'where_how', label: 'where it happens / how or by what' },
  to_at: { id: 'to_at', label: 'where to / when / to whom' },
  with_quote: { id: 'with_quote', label: 'together with / what was said' },
  from: { id: 'from', label: 'the starting point' },
  until: { id: 'until', label: 'the end point' },
  than: { id: 'than', label: 'what it is compared to' },
  also: { id: 'also', label: 'also / even' },
};

/** Particles with one dominant, checkable relation. */
const SETTLED: Record<string, string> = {
  を: 'object', が: 'subject', から: 'from', まで: 'until', より: 'than',
};
/** Particles the learner can still be asked about, but whose relation depends on the verb. */
const UNSETTLED: Record<string, string> = {
  に: 'to_at', で: 'where_how', と: 'with_quote', は: 'topic', も: 'also',
};

export interface GlossDecisionSpec {
  skill: GlossSkill;
  subskill: GlossDecision['subskill'];
  ruleKey: string;
  chunkId: string;
  targetText: string;
  particle?: string;
  options: RelationOption[];
  /** Sentence-specific question text (authored contextual particle check); absent = generic wording. */
  question?: string;
  referenceValue: string;
  /** settled = auto-gradable; alternative = recorded ungraded; compare = reference not trusted, show it after the attempt. */
  confidence: GlossDecision['referenceConfidence'];
}

const bare = (text: string) => text.replace(/[。．！？!?、，,」』）)「『（(\s]/g, '');
const SENTENCE_FINAL = new Set(['ね', 'よ', 'な', 'ぞ', 'わ', 'さ', 'か', 'ぜ']);

/** The authored check for a chunk, tolerating a chunk boundary that differs a little from the AI's. */
export function matchParticleCheck(checks: readonly ParticleCheck[] | undefined, chunkText: string, particle: string): ParticleCheck | undefined {
  const target = bare(chunkText);
  return checks?.find((check) => {
    if (check.particle !== particle) return false;
    const mine = bare(check.chunk);
    return mine === target || target.endsWith(mine) || mine.endsWith(target);
  });
}

function hash(text: string): number {
  let h = 0;
  for (const char of text) h = (h * 31 + char.codePointAt(0)!) >>> 0;
  return h;
}

/**
 * The reference is only trusted when the stored (or draft) role agrees with the
 * role the heuristic computes fresh from the chunk text — otherwise the learner
 * is shown "compare" mode and the answer never counts for or against them.
 */
export function buildDecisions(chunks: GlossChunk[], particleChecks?: readonly ParticleCheck[]): GlossDecisionSpec[] {
  const specs: GlossDecisionSpec[] = [];
  if (chunks.length === 0) return specs;

  // Predicate: the last engine chunk (clause-final).
  let predicateIndex = -1;
  chunks.forEach((chunk, index) => {
    if (isEngineRole(chunk.role)) predicateIndex = index;
  });
  if (predicateIndex >= 0) {
    const chunk = chunks[predicateIndex]!;
    const text = bare(chunk.japanese);
    const isLast = predicateIndex === chunks.length - 1;
    const heuristicAgrees = isLast && roleForChunk(chunk.japanese, true) === 'engine';
    const odd = SENTENCE_FINAL.has(text) || /(?:と|って)$/.test(text) || text.length < 2;
    specs.push({
      skill: 'predicate',
      subskill: 'predicate',
      ruleKey: 'predicate:last-engine',
      chunkId: chunk.id,
      targetText: chunk.japanese,
      options: chunks.map((c) => ({ id: c.id, label: c.japanese })),
      referenceValue: chunk.id,
      confidence: heuristicAgrees && !odd && chunks.length > 1 ? 'settled' : 'compare',
    });
  }

  chunks.forEach((chunk, index) => {
    if (index === predicateIndex) return;
    const [stem, particle] = splitTrailingParticle(bare(chunk.japanese));
    // 〜ますが / 〜ですが is the clause-linking "but", not the subject marker.
    if (particle === 'が' && /(?:ます|ません|ました|です|でした)$/.test(stem)) return;
    const relation = SETTLED[particle] ?? UNSETTLED[particle];
    const authored = particle ? matchParticleCheck(particleChecks, chunk.japanese, particle) : undefined;
    if (!particle || (!relation && !authored)) return;
    // Compound roles (では, には…) are not a single relation, and a stored role that
    // disagrees with the fresh heuristic is not trusted.
    if (PARTICLE_ROLE[particle] !== chunk.role) return;
    if (authored && authored.correctIndex < authored.options.length) {
      // Authored in-sentence readings replace the generic relation list and are gradable.
      const options = authored.options
        .map((label, i) => ({ id: String(i), label }))
        .sort((a, b) => hash(chunk.id + a.label) - hash(chunk.id + b.label));
      specs.push({
        skill: 'particle',
        subskill: 'case',
        ruleKey: `particle:${particle}:ctx`,
        chunkId: chunk.id,
        targetText: chunk.japanese,
        particle,
        options,
        question: authored.question,
        referenceValue: String(authored.correctIndex),
        confidence: 'settled',
      });
      return;
    }
    if (!relation) return;
    const settled = particle in SETTLED;
    const distractors = Object.values(RELATIONS)
      .filter((option) => option.id !== relation)
      .sort((a, b) => hash(chunk.id + a.id) - hash(chunk.id + b.id))
      .slice(0, 3);
    const options = [...distractors, RELATIONS[relation]!].sort((a, b) => hash(chunk.id + b.id) - hash(chunk.id + a.id));
    specs.push({
      skill: 'particle',
      subskill: particle === 'は' || particle === 'も' ? 'topic' : 'case',
      ruleKey: `particle:${particle}`,
      chunkId: chunk.id,
      targetText: chunk.japanese,
      particle,
      options,
      referenceValue: relation,
      confidence: settled ? 'settled' : 'alternative',
    });
  });

  // Noun modifier: Aの + B — A describes the chunk right after it. High precision, so settled;
  // skipped when the next chunk is the predicate (explanatory のだ) or the role was edited.
  chunks.forEach((chunk, index) => {
    const next = chunks[index + 1];
    if (!next || isEngineRole(next.role) || index === predicateIndex) return;
    const [, particle] = splitTrailingParticle(bare(chunk.japanese));
    if (particle !== 'の' || chunk.role !== PARTICLE_ROLE['の']) return;
    specs.push({
      skill: 'attachment',
      subskill: 'noun_modifier',
      ruleKey: 'attachment:の',
      chunkId: chunk.id,
      targetText: chunk.japanese,
      particle,
      options: chunks.filter((c) => c.id !== chunk.id).map((c) => ({ id: c.id, label: c.japanese })),
      referenceValue: next.id,
      confidence: 'settled',
    });
  });
  return specs;
}

/** null when the reference isn't settled (never counts for or against the learner). */
export function gradeResponse(spec: GlossDecisionSpec, response: string): boolean | null {
  if (spec.confidence !== 'settled') return null;
  return response === spec.referenceValue;
}

export interface Hint {
  step: 1 | 2 | 3;
  text: string;
  /** Option ids still shown after this step (step 2 narrows to the answer plus one distractor). */
  keepOptions?: string[];
}

export type Blocker = NonNullable<GlossDecision['blocker']>;

export function hintLadder(spec: GlossDecisionSpec, blocker: Blocker = 'unsure'): Hint[] {
  const wrong = spec.options.find((o) => o.id !== spec.referenceValue)?.id;
  const narrowed = [spec.referenceValue, ...(wrong ? [wrong] : [])];
  if (spec.skill === 'predicate') {
    return [
      { step: 1, text: 'Japanese sentences end on their verb, adjective or です/だ. Which chunk is doing the closing?' },
      {
        step: 2,
        text: blocker === 'form'
          ? 'Look for a verb or adjective ending (ます・た・ない・です). That chunk is the predicate.'
          : 'Narrowed to two chunks — the predicate is the one that could finish the sentence.',
        keepOptions: narrowed,
      },
      { step: 3, text: `The predicate is ${spec.targetText}.` },
    ];
  }
  const particle = spec.particle ?? '';
  if (spec.skill === 'attachment') {
    const keep = [spec.referenceValue, ...(wrong ? [wrong] : [])];
    return [
      { step: 1, text: `${particle} links two nouns: the thing before ${particle} describes or owns the thing that comes right after it.` },
      { step: 2, text: 'Narrowed to two chunks.', keepOptions: keep },
      { step: 3, text: `${spec.targetText} describes ${spec.options.find((o) => o.id === spec.referenceValue)?.label ?? 'the next chunk'}.` },
    ];
  }
  return [
    { step: 1, text: `Look at what ${particle} attaches to and what the predicate does with it: is it the thing acted on, the one acting, or something else?` },
    { step: 2, text: `Narrowed to two readings of ${particle}.`, keepOptions: narrowed },
    { step: 3, text: `${spec.targetText}: ${RELATIONS[spec.referenceValue]?.label ?? spec.options.find((o) => o.id === spec.referenceValue)?.label ?? spec.referenceValue}.` },
  ];
}

export function outcomeFor(args: { graded: boolean | null; hintMaxStep: number; resolved: boolean }): GlossOutcome {
  if (args.graded === null) return 'ungraded';
  if (args.graded && args.hintMaxStep === 0) return 'independent_correct';
  return args.resolved ? 'assisted_correct' : 'unresolved';
}

/** 0 hidden, 1 word glosses, 2 partial (target masked), 3 full. Level 2 falls back to full when a partial can't be built. */
export function translationLevelFor(level: SupportLevel): 0 | 1 | 2 | 3 {
  if (level >= 4) return 0;
  if (level === 3) return 1;
  return level === 2 ? 2 : 3;
}

/**
 * Literal English of every chunk except the target (masked as ___), only from the learner's
 * own saved glosses — never machine-written. Undefined when any other chunk has none.
 */
export function partialTranslation(chunks: GlossChunk[], targetChunkId: string): string | undefined {
  const parts: string[] = [];
  for (const chunk of chunks) {
    if (chunk.id === targetChunkId) {
      parts.push('___');
    } else if (chunk.literalEnglish?.trim()) {
      parts.push(chunk.literalEnglish.trim());
    } else {
      return undefined;
    }
  }
  return parts.join(' ');
}

export interface SkillState {
  skill: GlossSkill;
  level: SupportLevel;
  reason: string;
  gradable: number;
  /** No evidence yet: show a one-off level-1 worked example before the first question. */
  needsIntro: boolean;
}

function isGradable(record: GlossDecision): boolean {
  return (
    record.referenceConfidence === 'settled' &&
    record.firstCorrect !== null &&
    (record.outcome === 'independent_correct' || record.outcome === 'assisted_correct' || record.outcome === 'unresolved') &&
    // word/form gaps are counted separately, not as structural weakness
    record.blocker !== 'word' && record.blocker !== 'form'
  );
}

const DAY_MS = 86_400_000;

export function inferSkillState(records: GlossDecision[], skill: GlossSkill, now: Date = new Date()): SkillState {
  const own = records
    .filter((record) => record.skill === skill)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const gradableAll = own.filter(isGradable);
  if (own.length === 0) {
    return { skill, level: DEFAULT_LEVEL, reason: 'First time — starting with a worked example.', gradable: 0, needsIntro: true };
  }
  if (gradableAll.length < MIN_GRADABLE) {
    return { skill, level: DEFAULT_LEVEL, reason: `Too little evidence yet (${gradableAll.length}/${MIN_GRADABLE}) — default support.`, gradable: gradableAll.length, needsIntro: false };
  }

  let level: SupportLevel = DEFAULT_LEVEL;
  let reason = 'Default support.';
  let window: GlossDecision[] = [];
  for (const record of gradableAll) {
    window.push(record);
    const successes = window.filter((r) => r.outcome === 'independent_correct' && r.levelShown >= level);
    if (successes.length >= SUCCESSES_TO_ADVANCE && new Set(successes.map((r) => r.sentenceId)).size >= SUCCESSES_TO_ADVANCE && level < 4) {
      level = (level + 1) as SupportLevel;
      reason = `${SUCCESSES_TO_ADVANCE} independent successes on different sentences — less support.`;
      window = [];
      continue;
    }
    const recent = window.slice(-MISS_WINDOW);
    const misses = recent.filter((r) => r.firstCorrect === false && r.outcome === 'unresolved');
    if (misses.length >= 2 && new Set(misses.map((r) => r.sentenceId)).size >= 2 && level > 1) {
      level = (level - 1) as SupportLevel;
      reason = 'Repeated misses that stayed unresolved — more support.';
      window = [];
    }
  }

  const last = own[own.length - 1]!;
  const idleDays = (now.getTime() - new Date(last.timestamp).getTime()) / DAY_MS;
  if (idleDays > RUST_DAYS && level > 1) {
    return { skill, level: (level - 1) as SupportLevel, reason: `${Math.floor(idleDays)} days since last practice — one step more support until one success.`, gradable: gradableAll.length, needsIntro: false };
  }
  return { skill, level, reason, gradable: gradableAll.length, needsIntro: false };
}

/** Disputes per rule, so a rule the learner keeps contesting can be audited. */
export function disputeCounts(records: GlossDecision[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    if (record.outcome === 'disputed') counts[record.ruleKey] = (counts[record.ruleKey] ?? 0) + 1;
  }
  return counts;
}

/** How often each kind of gap blocked a decision. */
export function blockerCounts(records: GlossDecision[]): Record<Blocker, number> {
  const counts: Record<Blocker, number> = { word: 0, form: 0, structure: 0, unsure: 0 };
  for (const record of records) if (record.blocker) counts[record.blocker] += 1;
  return counts;
}

export type GlossReadinessTier = 'ready' | 'workable' | 'thin';

/** Advisory only: never blocks, only decides whether the word strip opens up front. */
export function glossReadinessTier(knownRatio: number | undefined): GlossReadinessTier {
  if (knownRatio === undefined || knownRatio >= 0.8) return 'ready';
  return knownRatio >= 0.5 ? 'workable' : 'thin';
}

const isDecisionRow = (record: GlossDecision) => record.outcome !== 'self_report';

/** Sentences with a decision whose latest attempt stayed unresolved, excluding ones touched today. */
export function parkedDecisionKeys(records: GlossDecision[]): Map<string, Set<string>> {
  const latest = new Map<string, GlossDecision>();
  for (const record of [...records].filter(isDecisionRow).sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (record.outcome === 'skipped' || record.outcome === 'disputed') continue;
    latest.set(`${record.sentenceId}|${record.ruleKey}|${record.targetText}`, record);
  }
  const parked = new Map<string, Set<string>>();
  for (const record of latest.values()) {
    if (record.outcome !== 'unresolved') continue;
    const keys = parked.get(record.sentenceId) ?? new Set<string>();
    keys.add(`${record.ruleKey}|${record.targetText}`);
    parked.set(record.sentenceId, keys);
  }
  return parked;
}

export function parkedSentenceIds(records: GlossDecision[], now: Date = new Date()): string[] {
  const today = now.toDateString();
  const touchedToday = new Set(records.filter((r) => new Date(r.timestamp).toDateString() === today).map((r) => r.sentenceId));
  return [...parkedDecisionKeys(records).keys()].filter((id) => !touchedToday.has(id));
}

export interface GlossSummary {
  skills: SkillState[];
  decisions: number;
  blockers: Record<Blocker, number>;
  disputes: Record<string, number>;
  felt: Record<'too_easy' | 'right' | 'too_hard', number>;
  skipRate: number | null;
  /** Hint use in the latest 15 decisions vs the 15 before; null until there are enough. */
  hintRate: { recent: number; earlier: number } | null;
  parkedSentences: number;
}

export function summariseGloss(records: GlossDecision[], now: Date = new Date()): GlossSummary {
  const rows = records.filter(isDecisionRow).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const felt = { too_easy: 0, right: 0, too_hard: 0 };
  for (const record of records) if (record.felt) felt[record.felt] += 1;
  const asked = rows.filter((r) => r.levelShown > 1);
  const rate = (list: GlossDecision[]) => list.filter((r) => r.hintMaxStep > 0).length / list.length;
  const hintRate = asked.length >= 30 ? { recent: rate(asked.slice(-15)), earlier: rate(asked.slice(-30, -15)) } : null;
  return {
    skills: (['predicate', 'particle', 'attachment'] as const).map((skill) => inferSkillState(rows, skill, now)),
    decisions: rows.length,
    blockers: blockerCounts(rows),
    disputes: disputeCounts(rows),
    felt,
    skipRate: rows.length ? rows.filter((r) => r.outcome === 'skipped').length / rows.length : null,
    hintRate,
    parkedSentences: parkedDecisionKeys(rows).size,
  };
}
