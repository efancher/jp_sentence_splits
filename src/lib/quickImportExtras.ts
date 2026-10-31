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
  ensureGrammarPattern,
  ensureSentenceGrammar,
  getEpisodePreparationContext,
  saveEpisodePackReply,
  setSentenceComprehensionCheck,
  reportChunkIssues,
  setSentenceParticleChecks,
} from '../db/repository';
import { buildComprehensionCheck, parseBatchComprehensionCheckReply, parseBatchExtraSwaps, parseBatchExtraWrong, parseBatchReadings } from './comprehensionCheck';
import { checkSentenceReading } from './meaningCheckAutogen';
import { mergeDistractorsWithSwaps } from './meaningChoices';
import { remapSentenceHandles, type CombinedReplySections } from './combinedImportPrompt';
import { planGrammarLinks } from './grammarLinkApply';
import { parseBookGrammarReply } from './grammarLinkReply';
import { parseBookParticleReply } from './particleChecks';

export interface QuickImportExtrasResult {
  targets: number;
  structure: number;
  constructions: number;
  walkthroughs: number;
  comprehension: number;
  readingsFixed: number;
  particles: number;
  /** Sentence-to-pattern links saved by the book page's grammar extra. */
  grammarLinks: number;
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
  return Boolean(sections.pack || sections.structure || sections.comprehension || sections.particles || sections.grammar);
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
    grammarLinks: 0,
    problems: [],
    rejections: [],
  };

  if (sections.comprehension) {
    const comprehension = parseBatchComprehensionCheckReply(sections.comprehension, sentenceIdByNumber.length);
    const extraWrong = parseBatchExtraWrong(sections.comprehension, sentenceIdByNumber.length);
    const extraSwaps = parseBatchExtraSwaps(sections.comprehension, sentenceIdByNumber.length);
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
        const swaps = extraSwaps[index] ?? [];
        const wrong = extraWrong[index] ?? [];
        if (swaps.length + wrong.length > 0) check = mergeDistractorsWithSwaps(check, swaps, wrong).check;
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

  if (sections.grammar) {
    result.grammarLinks = await applyGrammarLinks(sections.grammar, sentenceIdByNumber, result.problems);
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

const noticeKey = (bookId: string) => `importExtrasNotice:${bookId}`;

/** Remember that part of a quick import's extras was not saved, for the book page to show once. */
export function writeImportExtrasNotice(bookId: string, message: string): void {
  try {
    localStorage.setItem(noticeKey(bookId), message);
  } catch {
    // Storage unavailable: the notice is best-effort.
  }
}

/** Returns and clears the pending notice for a book. */
export function takeImportExtrasNotice(bookId: string): string | null {
  try {
    const message = localStorage.getItem(noticeKey(bookId));
    if (message) localStorage.removeItem(noticeKey(bookId));
    return message;
  } catch {
    return null;
  }
}

/**
 * Saves the assistant's grammar links as unconfirmed `ai_suggested` occurrences. A pattern it names that the learner
 * does not have is created (also `ai_suggested`) and reused by later sentences in the same reply. An occurrence the
 * learner already confirmed, or that already has a span, is left exactly as it is.
 */
async function applyGrammarLinks(
  reply: string,
  sentenceIdByNumber: ReadonlyArray<string | undefined>,
  problems: string[],
): Promise<number> {
  const db = getDb();
  const parsed = parseBookGrammarReply(reply, sentenceIdByNumber.length);
  const ids = sentenceIdByNumber.filter((id): id is string => Boolean(id));
  const sentences = new Map((await db.sentences.bulkGet(ids)).flatMap((row) => (row ? [[row.id, row] as const] : [])));
  const patterns = await db.grammarPatterns.toArray();
  let saved = 0;
  let dropped = 0;
  for (const [index, links] of parsed.entries()) {
    const sentenceId = sentenceIdByNumber[index];
    const sentence = sentenceId ? sentences.get(sentenceId) : undefined;
    if (!links || links.length === 0 || !sentenceId || !sentence) continue;
    const { planned, dropped: bad } = planGrammarLinks(sentence.japanese, links, patterns);
    dropped += bad.length;
    for (const link of planned) {
      let patternId = link.patternId;
      if (!patternId && link.newPattern) {
        const created = await ensureGrammarPattern(link.newPattern.name, {
          shortMeaning: link.newPattern.meaning || undefined,
          structuralTemplate: link.newPattern.template || undefined,
          provenance: 'ai_suggested',
        });
        patterns.push(created);
        patternId = created.id;
      }
      if (!patternId) continue;
      const existing = await db.sentenceGrammar.where('[sentenceId+grammarPatternId]').equals([sentenceId, patternId]).first();
      if (existing && (existing.confirmedByLearner || existing.start !== undefined)) continue;
      await ensureSentenceGrammar(sentenceId, patternId, {
        surfaceForm: link.surfaceForm,
        start: link.start,
        end: link.end,
        occurrenceExplanation: link.note || undefined,
        confirmedByLearner: false,
        source: 'ai_suggested',
      });
      saved += 1;
    }
  }
  if (dropped > 0) problems.push(`Grammar: ${dropped} link${dropped === 1 ? '' : 's'} skipped because the quoted text was not in the sentence.`);
  return saved;
}
