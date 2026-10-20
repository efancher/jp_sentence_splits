/**
 * Per-sentence checks for assistant-generated extras, run while the box-side
 * run is still going. The importer parsers (`parseStructureLines`,
 * `parseWalkthroughs`, …) only discard unusable sentences after the book is
 * committed, when the only fix is to redo the extra by hand. Running the same
 * parsers on each finished piece lets the run re-ask for just the sentences
 * that would have been dropped, and splice the corrected answers in.
 */
import type { ExtraKind } from './combinedImportPrompt';
import { parseBatchComprehensionCheckReply } from './comprehensionCheck';
import { extractJson, type PreparationContext } from './episodePreparation';
import { parseStructureLines } from './episodeStructure';
import { parseConstructions } from './phraseConstruction';
import { parseBookParticleReply } from './particleChecks';
import { parseWalkthroughs } from './contextWalkthrough';

export interface RepairTask {
  kind: ExtraKind;
  from: number;
  to: number;
  handles?: number[];
}

export interface RepairSentence {
  handle: number;
  japanese: string;
}

export interface BadHandle {
  handle: number;
  reason: string;
}

/** Kinds whose output is per-sentence and can be checked and repaired one sentence at a time. */
export function isRepairable(kind: ExtraKind): boolean {
  return kind !== 'targets';
}

export function stripFences(reply: string): string {
  return reply
    .split(/\r?\n/)
    .filter((line) => !/^\s*```/.test(line))
    .join('\n')
    .trim();
}

export function jsonObject(reply: string): Record<string, unknown> | null {
  try {
    const raw = extractJson(reply);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function coveredHandles(task: Pick<RepairTask, 'from' | 'to' | 'handles'>): number[] {
  if (task.handles) return task.handles;
  return Array.from({ length: task.to - task.from + 1 }, (_, i) => task.from + i);
}

function handleOf(raw: string): number {
  const match = /(\d+)/.exec(raw);
  return match ? Number(match[1]) : Number.NaN;
}

const SECTION_HEADER = /^===\s*Sentence\s+(\d+)\s*===$/;
const STRUCTURE_LINE = /^[\s>*\-•|]*\**\s*[SsＳ]\s*(\d+)\s*[.):：]?\s*[|⏐｜\t]/;

/**
 * Covered handles whose answer in `reply` would be dropped (or is missing) by the
 * importer. Partly kept walkthroughs/constructions are not reported: the importer
 * keeps their good steps, and asking again could replace them with something worse.
 */
export function findBadHandles(task: RepairTask, reply: string, sentences: RepairSentence[]): BadHandle[] {
  if (!isRepairable(task.kind)) return [];
  const text = stripFences(reply);
  const covered = coveredHandles(task);
  const context = {
    title: '',
    sentences: sentences.map((sentence) => ({ id: `S${sentence.handle}`, japanese: sentence.japanese })),
    vocabulary: [],
    grammar: [],
  } as unknown as PreparationContext;
  const missing = (drafted: (handle: number) => boolean, rejected: { handle: string; reason: string }[], requireRejection: boolean) =>
    covered.flatMap((handle) => {
      if (drafted(handle)) return [];
      const rejection = rejected.find((item) => handleOf(item.handle) === handle);
      if (requireRejection && !rejection) return [];
      return [{ handle, reason: rejection?.reason ?? 'No usable answer was given for this sentence.' }];
    });

  switch (task.kind) {
    case 'structure': {
      const parsed = parseStructureLines(text, context);
      return missing((handle) => parsed.drafts.has(`S${handle}`), parsed.rejected, false);
    }
    case 'walkthroughs': {
      const parsed = parseWalkthroughs(jsonObject(text)?.walkthroughs, context);
      return missing((handle) => parsed.drafts.has(`S${handle}`), parsed.rejected, false);
    }
    case 'constructions': {
      // A sentence with no constructions is a legitimate answer, so only flagged sentences count.
      const parsed = parseConstructions(jsonObject(text)?.constructions, context);
      return missing((handle) => parsed.drafts.has(`S${handle}`), parsed.rejected, true);
    }
    case 'comprehension': {
      const parsed = parseBatchComprehensionCheckReply(text, Math.max(...covered));
      return covered.filter((handle) => !parsed[handle - 1]).map((handle) => ({ handle, reason: 'The check was missing or unreadable.' }));
    }
    case 'particles': {
      const parsed = parseBookParticleReply(text, Math.max(...covered));
      return covered.filter((handle) => !parsed[handle - 1]).map((handle) => ({ handle, reason: 'The questions were missing or unreadable.' }));
    }
    default:
      return [];
  }
}

/** `text` reduced to (keep) or without (!keep) the answers for `handles`. */
function filterByHandle(kind: ExtraKind, text: string, handles: ReadonlySet<number>, keep: boolean): string {
  const wanted = (handle: number) => handles.has(handle) === keep;
  if (kind === 'constructions' || kind === 'walkthroughs') {
    const object = (jsonObject(text)?.[kind] ?? {}) as Record<string, unknown>;
    const filtered = Object.fromEntries(Object.entries(object).filter(([key]) => wanted(handleOf(key))));
    return JSON.stringify({ [kind]: filtered });
  }
  const out: string[] = [];
  let include = !keep;
  let current: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const section = SECTION_HEADER.exec(line.trim());
    const structure = kind === 'structure' ? STRUCTURE_LINE.exec(line) : null;
    if (section) current = Number(section[1]);
    else if (structure) current = Number(structure[1]);
    else if (kind === 'structure') continue; // chatter between structure lines
    include = current === null ? !keep : wanted(current);
    if (include) out.push(line);
  }
  return out.join('\n');
}

/** Original reply with the answers for `handles` replaced by those in `repair` (other sentences are never touched). */
export function mergeRepair(kind: ExtraKind, reply: string, repair: string, handles: ReadonlySet<number>): string {
  const kept = filterByHandle(kind, stripFences(reply), handles, false);
  const fixed = filterByHandle(kind, stripFences(repair), handles, true);
  if (kind === 'constructions' || kind === 'walkthroughs') {
    const merged = { ...((jsonObject(kept)?.[kind] ?? {}) as object), ...((jsonObject(fixed)?.[kind] ?? {}) as object) };
    return JSON.stringify({ [kind]: merged });
  }
  return [kept, fixed].filter(Boolean).join('\n');
}

export function describeBad(bad: BadHandle[]): string[] {
  return bad.map((item) => `S${item.handle}: ${item.reason}`);
}
