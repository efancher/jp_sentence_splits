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
import { buildComprehensionCheck, parseBatchComprehensionCheckReply, parseBatchReadings } from './comprehensionCheck';
import { autoGenerateMeaningChecks, checkSentenceReading } from './meaningCheckAutogen';
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
  };

  const comprehension = parseBatchComprehensionCheckReply(sections.comprehension, sentenceIdByNumber.length);
  if (sections.comprehension) {
    for (const [index, parsed] of comprehension.entries()) {
      const sentenceId = sentenceIdByNumber[index];
      if (!parsed || !sentenceId) continue;
      await setSentenceComprehensionCheck(sentenceId, buildComprehensionCheck(parsed, 'ai_suggested'));
      result.comprehension += 1;
    }
    const readings = parseBatchReadings(sections.comprehension, sentenceIdByNumber.length);
    const flags: { sentenceId: string; chunks: string[]; note: string }[] = [];
    for (const [index, reading] of readings.entries()) {
      const sentenceId = sentenceIdByNumber[index];
      if (!reading || !sentenceId) continue;
      const outcome = await checkSentenceReading(sentenceId, reading);
      result.readingsFixed += outcome.fixed;
      for (const flag of outcome.flagged) flags.push({ sentenceId, chunks: [], note: `Reading check — ${flag}` });
    }
    if (flags.length > 0) await reportChunkIssues('meaning_checks', flags);
    // Import gives each check only 3 wrong options; grow it to a full bank (background, best effort; backs off when AI is unavailable).
    autoGenerateMeaningChecks({ mode: 'topup', bookId, limit: 200 }).catch((err) => {
      console.error('Meaning bank top-up after import failed', err);
    });
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
      const rejected = saved.rejectedStructure.length + saved.rejectedConstructions.length + saved.rejectedWalkthroughs.length;
      if (rejected > 0) result.problems.push(`${rejected} structure/construction/walkthrough entries did not match their sentence (or were only partly kept) and were skipped.`);
    }
  }
  return result;
}
