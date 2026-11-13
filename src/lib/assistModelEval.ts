/**
 * Pure helpers for `scripts/assist-model-eval.ts`: compare assistant models on the
 * same extras prompts (docs/ASSIST_MODEL_EVAL_PLAN.md). Windows are runs of
 * consecutive sentences, the shape of a real 10-sentence extras call, picked for
 * the constructions that tend to trip a model. Scoring here is only the
 * structural check the app already applies (`validateExtraReply`); whether an
 * explanation is actually good is left to the blind side-by-side review.
 */
import { buildExtraPrompt, planExtraTasks, validateExtraReply, EXTRA_RANGE_SENTENCES, type ExtraTask, type ExtrasSentence } from './assistExtras';
import type { CombinedPromptOptions, ExtraKind } from './combinedImportPrompt';

export interface EvalArm {
  id: string;
  backend: 'claude' | 'codex' | 'opencode';
  /** Omitted = the backend's configured default (the current production model). */
  model?: string;
  effort?: string;
}

/** Arm A is what production runs today; B are the cheaper OpenCode Go candidates; E is a stronger ceiling. */
export const DEFAULT_ARMS: EvalArm[] = [
  { id: 'A-haiku', backend: 'claude' },
  { id: 'B-glm-5.3', backend: 'opencode', model: 'opencode-go/glm-5.3' },
  { id: 'B-qwen3.8-max', backend: 'opencode', model: 'opencode-go/qwen3.8-max' },
  { id: 'B-kimi-k3', backend: 'opencode', model: 'opencode-go/kimi-k3' },
  { id: 'E-kimi-k3.1-pro', backend: 'opencode', model: 'opencode-go/kimi-k3.1-pro' },
  // Free OpenCode (Zen) models for a limited time; the first three do not retain or train on prompts.
  { id: 'F-glm-5.3-flash', backend: 'opencode', model: 'opencode/glm-5.3-flash-free' },
  { id: 'F-deepseek-v4.1-flash', backend: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' },
  { id: 'F-minimax-m3.1-flash', backend: 'opencode', model: 'opencode/minimax-m3.1-flash-free' },
  { id: 'F-big-pickle', backend: 'opencode', model: 'opencode/big-pickle' },
];

/** Constructions worth stress-testing; a window's score is how many distinct ones it contains. */
const CATEGORIES: { name: string; test: RegExp }[] = [
  { name: 'passive/potential', test: /られ|(?:れる|れた|れて|れない)(?:$|[、。！？])/ },
  { name: 'causative', test: /させ|せる(?:$|[、。！？])/ },
  { name: 'topic/subject particles', test: /[はが]/ },
  { name: 'te-form chain', test: /て(?:い|お|しま|み|あ|く)/ },
  { name: 'sentence-final particle', test: /[よねか]。?$/ },
  { name: 'conditional', test: /(?:たら|ば|なら|と)、/ },
  { name: 'nominaliser/explanatory', test: /(?:の|ん)(?:だ|です|で)/ },
  { name: 'fragment', test: /^.{1,6}[。！？]?$/ },
];

export function categoriesOf(japanese: string): string[] {
  return CATEGORIES.filter((category) => category.test.test(japanese.trim())).map((category) => category.name);
}

export interface EvalWindow {
  id: string;
  source: string;
  categories: string[];
  sentences: ExtrasSentence[];
}

/**
 * Picks up to `count` non-overlapping windows from ordered per-source sentence lists, richest in distinct
 * constructions first, at most `perSource` from one source so one book does not dominate. Deterministic.
 */
export function pickWindows(
  sources: { source: string; sentences: { japanese: string; translation: string }[] }[],
  count: number,
  perSource = 2,
  size = EXTRA_RANGE_SENTENCES,
): EvalWindow[] {
  const candidates: (EvalWindow & { score: number })[] = [];
  for (const { source, sentences } of sources) {
    for (let start = 0; start + size <= sentences.length; start += size) {
      const slice = sentences.slice(start, start + size);
      if (slice.some((sentence) => !sentence.translation.trim())) continue;
      const found = new Set(slice.flatMap((sentence) => categoriesOf(sentence.japanese)));
      candidates.push({
        id: `${source}#${start}`,
        source,
        categories: [...found].sort(),
        score: found.size,
        sentences: slice.map((sentence, index) => ({ handle: index + 1, ...sentence })),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const used = new Map<string, number>();
  const picked: EvalWindow[] = [];
  for (const { score: _score, ...window } of candidates) {
    if (picked.length >= count) break;
    if ((used.get(window.source) ?? 0) >= perSource) continue;
    used.set(window.source, (used.get(window.source) ?? 0) + 1);
    picked.push(window);
  }
  return picked;
}

export function windowTask(window: EvalWindow, kind: ExtraKind): ExtraTask {
  const options = { [kind]: true } as unknown as CombinedPromptOptions;
  const [task] = planExtraTasks(window.sentences, options);
  if (!task) throw new Error(`No ${kind} task for window ${window.id}`);
  return task;
}

export function windowPrompt(window: EvalWindow, kind: ExtraKind): string {
  return buildExtraPrompt(windowTask(window, kind), window.sentences);
}

export interface EvalResult {
  window: string;
  kind: ExtraKind;
  arm: string;
  ok: boolean;
  seconds: number;
  /** `validateExtraReply` message, or the backend error; null when the reply passed. */
  problem: string | null;
  reply: string | null;
}

export function checkReply(window: EvalWindow, kind: ExtraKind, reply: string): string | null {
  return validateExtraReply(windowTask(window, kind), reply);
}

export interface ArmSummary {
  arm: string;
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  medianSeconds: number;
}

export function summarize(results: readonly EvalResult[]): ArmSummary[] {
  const byArm = new Map<string, EvalResult[]>();
  for (const result of results) byArm.set(result.arm, [...(byArm.get(result.arm) ?? []), result]);
  return [...byArm].map(([arm, rows]) => {
    const passed = rows.filter((row) => row.ok).length;
    const times = rows.map((row) => row.seconds).sort((a, b) => a - b);
    return {
      arm,
      runs: rows.length,
      passed,
      failed: rows.length - passed,
      passRate: rows.length ? passed / rows.length : 0,
      medianSeconds: times.length ? times[Math.floor(times.length / 2)]! : 0,
    };
  });
}

/**
 * Blind review sheet: for every (window, kind) that at least two arms passed, the passing replies under
 * shuffled letters, plus a key mapping letters back to arms. Seeded so the sheet can be regenerated.
 */
export function blindSheet(
  results: readonly EvalResult[],
  seed = 1,
): { sheet: string; key: Record<string, Record<string, string>> } {
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const groups = new Map<string, EvalResult[]>();
  for (const result of results) {
    if (!result.ok || !result.reply) continue;
    const key = `${result.window}|${result.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const key: Record<string, Record<string, string>> = {};
  const parts: string[] = [];
  for (const [groupId, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (rows.length < 2) continue;
    const shuffled = [...rows];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
    }
    key[groupId] = {};
    parts.push(`######## ${groupId}`);
    shuffled.forEach((row, index) => {
      const letter = String.fromCharCode(65 + index);
      key[groupId]![letter] = row.arm;
      parts.push(`--- ${letter} ---`, row.reply!.trim(), '');
    });
    parts.push('Better: ?', '');
  }
  return { sheet: parts.join('\n'), key };
}
