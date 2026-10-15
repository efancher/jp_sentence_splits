/**
 * Saves the optional parts of a quick-import reply (focus targets, structure,
 * constructions, comprehension checks, particle questions) once the book
 * exists. The assistant keyed everything by its own sentence numbers; each is
 * mapped here onto the sentence the learner actually committed (rows removed
 * in review simply have no sentence, so their extras are dropped). Every part
 * goes through the same parsers/savers as the book-page prompts, so the same
 * validation applies and nothing here can overwrite a learner's own data.
 */
import { getDb } from '../db/database';
import {
  getEpisodePreparationContext,
  saveEpisodePackReply,
  setSentenceComprehensionCheck,
  reportChunkIssues,
  setSentenceParticleChecks,
} from '../db/repository';
import { buildComprehensionCheck, parseBatchComprehensionCheckReply, parseBatchExtraWrong, parseBatchReadings } from './comprehensionCheck';
import { checkSentenceReading } from './meaningCheckAutogen';
import { mergeDistractors } from './meaningChoices';
import { remapSentenceHandles, type CombinedReplySections } from './combinedImportPrompt';
import { parseBookParticleReply } from './particleChecks';

export interface QuickImportExtrasResult {
  targets: number;
  structure: number;
  constructions: number;
  walkthroughs: number;
  comprehension: number;
  readingsFixed: number;
  particles: number;
  problems: string[];
  /** Entries the parsers skipped, one per sentence, so callers can group them by reason. */
  rejections: Rejection[];
}

export interface Rejection {
  kind: 'structure' | 'constructions' | 'walkthroughs';
  /** Reason with the quoted text and numbers removed, so equal causes group together. */
  reason: string;
}

const REJECTION_LABELS: Record<Rejection['kind'], string> = { structure: 'Structure', constructions: 'Construction', walkthroughs: 'Walkthrough' };

function normalizeReason(reason: string): string {
  return reason.replace(/“[^”]*”/g, '“…”').replace(/\d+/g, 'N').trim();
}

/** "Structure: 40 × The chunks do not rebuild the sentence exactly (cut off?). Construction: 3 × “…” is not in the sentence." */
export function describeRejections(rejections: readonly Rejection[]): string {
  const counts = new Map<string, number>();
  for (const { kind, reason } of rejections) {
    const key = `${REJECTION_LABELS[kind]}: ${reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${count} × ${key}`).join('; ');
}

export function hasQuickImportExtras(sections: CombinedReplySections): boolean {
  return Boolean(sections.pack || sections.structure || sections.comprehension || sections.particles);
}

/** `sentenceIdByNumber[n - 1]` is the committed sentence id for the assistant's S<n>, or undefined if that row was removed. */
export async function applyQuickImportExtras(
  bookId: string,
  chapterId: string | undefined,
  sections: CombinedReplySections,
  sentenceIdByNumber: ReadonlyArray<string | undefined>,
  options: { replaceCheckSentenceIds?: ReadonlySet<string> } = {},
): Promise<QuickImportExtrasResult> {
  const result: QuickImportExtrasResult = {
    targets: 0,
    structure: 0,
    constructions: 0,
    walkthroughs: 0,
    comprehension: 0,
    readingsFixed: 0,
    particles: 0,
    problems: [],
    rejections: [],
  };

  if (sections.comprehension) {
    const comprehension = parseBatchComprehensionCheckReply(sections.comprehension, sentenceIdByNumber.length);
    const extraWrong = parseBatchExtraWrong(sections.comprehension, sentenceIdByNumber.length);
    const readings = parseBatchReadings(sections.comprehension, sentenceIdByNumber.length);
    const flags: { sentenceId: string; chunks: string[]; note: string }[] = [];
    for (const [index, parsed] of comprehension.entries()) {
      const sentenceId = sentenceIdByNumber[index];
      if (!sentenceId) continue;
      // A check that already exists (the background worker can win the race right after commit) is a full bank; keep it.
      const hasCheck =
        !options.replaceCheckSentenceIds?.has(sentenceId) && Boolean((await getDb().analyses.get(sentenceId))?.comprehensionCheck);
      if (parsed && !hasCheck) {
        let check = buildComprehensionCheck(parsed, 'ai_suggested');
        const wrong = extraWrong[index] ?? [];
        if (wrong.length > 0) check = mergeDistractors(check, wrong).check;
        await setSentenceComprehensionCheck(sentenceId, check);
        result.comprehension += 1;
      }
      const reading = readings[index];
      if (!reading) continue;
      const outcome = await checkSentenceReading(sentenceId, reading);
      result.readingsFixed += outcome.fixed;
      for (const flag of outcome.flagged) flags.push({ sentenceId, chunks: [], note: `Reading check — ${flag}` });
    }
    if (flags.length > 0) await reportChunkIssues('meaning_checks', flags);
  }

  if (sections.particles) {
    const particles = parseBookParticleReply(sections.particles, sentenceIdByNumber.length);
    for (const [index, checks] of particles.entries()) {
      const sentenceId = sentenceIdByNumber[index];
      if (!checks || !sentenceId) continue;
      await setSentenceParticleChecks(sentenceId, checks);
      if (checks.length > 0) result.particles += 1;
    }
  }

  if (sections.pack || sections.structure) {
    const book = await getDb().books.get(bookId);
    const resolvedChapterId = chapterId ?? (book?.chapters.length === 1 ? book.chapters[0]!.id : undefined);
    if (!resolvedChapterId) {
      result.problems.push('Could not tell which chapter to attach the focus targets and structure to.');
      return result;
    }
    const { context } = await getEpisodePreparationContext(bookId, resolvedChapterId);
    const handleMap = new Map<number, number>();
    sentenceIdByNumber.forEach((sentenceId, index) => {
      if (!sentenceId) return;
      const position = context.sentences.findIndex((sentence) => sentence.id === sentenceId);
      if (position >= 0) handleMap.set(index + 1, position + 1);
    });
    const reply = [sections.pack, sections.structure]
      .filter(Boolean)
      .map((part) => remapSentenceHandles(part, handleMap))
      .join('\n\n');
    const saved = await saveEpisodePackReply(bookId, resolvedChapterId, reply);
    if (saved.error) {
      result.problems.push(saved.error);
    } else {
      result.targets = saved.preparation?.targets.length ?? 0;
      result.structure = saved.structureSaved;
      result.constructions = saved.constructionsSaved;
      result.walkthroughs = saved.walkthroughsSaved;
      const collect = (kind: Rejection['kind'], items: { reason: string }[]) =>
        result.rejections.push(...items.map((item) => ({ kind, reason: normalizeReason(item.reason) })));
      collect('structure', saved.rejectedStructure);
      collect('constructions', saved.rejectedConstructions);
      collect('walkthroughs', saved.rejectedWalkthroughs);
      if (result.rejections.length > 0) result.problems.push(`Skipped or partly kept: ${describeRejections(result.rejections)}.`);
    }
  }
  return result;
}
