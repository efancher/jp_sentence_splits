/**
 * Book-page "Generate extras with the assistant": works out, per extra, which
 * sentences have none (`missing`) and which already have one (`existing`, only
 * replaced when the learner says so), and saves a finished box run back onto
 * the book. Saving re-checks the book first, so anything that appeared while the
 * run was going (a hand edit, the background meaning-check worker) is kept
 * unless the learner explicitly approved replacing that sentence.
 */
import { getDb } from '../db/database';
import { saveSentenceExtras } from '../db/repository';
import { getBookWithExtras } from '../db/sentenceExtras';
import { CONTEXT_WALKTHROUGH_VERSION, mergeChapterWalkthroughs, sentencesNeedingWalkthrough, validWalkthroughFor } from './contextWalkthrough';
import { chunksMatchSource } from './chunking';
import { linkablePatterns, parseBookGrammarReply, type GrammarPatternRef } from './grammarLinkReply';
import { constructionChecked, validLayersFor } from './phraseConstruction';
import { applyQuickImportExtras, type Rejection } from './quickImportExtras';
import { BOOK_EXTRA_KINDS, mergeBookExtraReplies, planBookExtraTasks, type BookExtraKind, type BookExtraSelection } from './bookAssistRun';

export interface BookExtraSentence {
  id: string;
  /** 1-based position in the whole book (the assistant's S-number). */
  handle: number;
  japanese: string;
  translation: string;
  chapterId: string;
}

export interface BookExtraStatus {
  missing: number[];
  /** Sentences that already have this extra, with a short description of what is there. */
  existing: { handle: number; summary: string }[];
  /** Subset of `existing` (by handle) saved in an older format than the current one, so a regenerate would enrich them. */
  outdated: number[];
}

export interface BookExtrasPlan {
  sentences: BookExtraSentence[];
  kinds: Record<BookExtraKind, BookExtraStatus>;
}

export const BOOK_EXTRA_LABELS: Record<BookExtraKind, { label: string; hint: string; existingNoun: string }> = {
  walkthroughs: { label: 'Walkthrough explanations', hint: 'how the parts make the meaning in context', existingNoun: 'a walkthrough' },
  comprehension: { label: 'Meaning checks', hint: 'the right meaning plus wrong ones, and a contextual reading check', existingNoun: 'a meaning check' },
  particles: { label: 'Particle questions', hint: 'what each に/で/と… is doing here', existingNoun: 'particle questions' },
  structure: { label: 'Sentence structure', hint: 'how the sentence splits into chunks', existingNoun: 'a saved analysis or draft' },
  constructions: { label: 'Phrase construction', hint: 'how inflections and helpers build a phrase', existingNoun: 'construction layers' },
  grammar: { label: 'Grammar links', hint: 'which of your grammar patterns each sentence uses (shown once the sentence is walked through)', existingNoun: 'grammar links' },
};

function truncate(text: string, max = 70): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function planBookAssistExtras(bookId: string): Promise<BookExtrasPlan> {
  const db = getDb();
  const [book, memberships] = await Promise.all([
    getBookWithExtras(bookId),
    db.bookSentences.where('bookId').equals(bookId).sortBy('position'),
  ]);
  const seen = new Set<string>();
  const unique = memberships.filter((m) => m.chapterId && !seen.has(m.sentenceId) && seen.add(m.sentenceId));
  const rows = await db.sentences.bulkGet(unique.map((m) => m.sentenceId));
  const sentences: BookExtraSentence[] = [];
  unique.forEach((m, i) => {
    const row = rows[i];
    if (row) {
      sentences.push({
        id: row.id,
        handle: sentences.length + 1,
        japanese: row.japanese,
        translation: row.translation?.trim() ?? '',
        chapterId: m.chapterId!,
      });
    }
  });
  const [analyses, grammarRows, extraRows] = await Promise.all([
    db.analyses.bulkGet(sentences.map((s) => s.id)),
    db.sentenceGrammar.where('sentenceId').anyOf(sentences.map((s) => s.id)).toArray(),
    db.sentenceExtras.bulkGet(sentences.map((s) => s.id)),
  ]);
  const grammarCounts = new Map<string, number>();
  for (const row of grammarRows) grammarCounts.set(row.sentenceId, (grammarCounts.get(row.sentenceId) ?? 0) + 1);
  const chapters = book?.chapters ?? [];
  const chapterOf = new Map(chapters.map((c) => [c.id, c]));
  const walkthroughs = mergeChapterWalkthroughs(chapters);
  const needsWalkthrough = new Set(sentencesNeedingWalkthrough(sentences, walkthroughs));

  const emptyStatus = (): BookExtraStatus => ({ missing: [], existing: [], outdated: [] });
  const kinds: Record<BookExtraKind, BookExtraStatus> = {
    structure: emptyStatus(),
    constructions: emptyStatus(),
    walkthroughs: emptyStatus(),
    comprehension: emptyStatus(),
    particles: emptyStatus(),
    grammar: emptyStatus(),
  };
  sentences.forEach((sentence, index) => {
    const analysis = analyses[index];
    const chapter = chapterOf.get(sentence.chapterId);
    const mark = (kind: BookExtraKind, summary: string | null) => {
      if (summary === null) kinds[kind].missing.push(sentence.handle);
      else kinds[kind].existing.push({ handle: sentence.handle, summary });
    };

    if (needsWalkthrough.has(sentence.id)) mark('walkthroughs', null);
    else {
      const walkthrough = validWalkthroughFor(sentence.japanese, walkthroughs[sentence.id]);
      const older = (walkthrough?.version ?? 1) < CONTEXT_WALKTHROUGH_VERSION;
      mark('walkthroughs', `${older ? 'older format, no word-by-word: ' : ''}${truncate(walkthrough?.natural ?? 'walkthrough')}`);
      if (older) kinds.walkthroughs.outdated.push(sentence.handle);
    }

    const check = analysis?.comprehensionCheck;
    mark('comprehension', check ? truncate(check.options[check.correctIndex] ?? 'meaning check') : null);

    const particles = analysis?.particleChecks;
    mark('particles', particles ? (particles.length === 0 ? 'checked, no particle questions' : `${particles.length} question${particles.length === 1 ? '' : 's'}`) : null);

    const linked = grammarCounts.get(sentence.id) ?? 0;
    if (linked > 0) mark('grammar', `${linked} pattern${linked === 1 ? '' : 's'}`);
    else mark('grammar', extraRows[index]?.grammarChecked ? 'checked, nothing to link' : null);

    const draft = chapter?.structureDrafts?.[sentence.id];
    if (analysis?.chunks?.length) mark('structure', `saved analysis: ${truncate(analysis.chunks.map((c) => c.japanese).join(' / '))}`);
    else if (draft && chunksMatchSource(draft.map((chunk) => chunk.japanese), sentence.japanese)) {
      mark('structure', `draft: ${truncate(draft.map((c) => c.japanese).join(' / '))}`);
    } else mark('structure', null);

    const constructionDraft = chapter?.constructionDrafts?.[sentence.id];
    const layers = validLayersFor(sentence.japanese, constructionDraft);
    if (layers.length > 0) mark('constructions', `${layers.length} layer${layers.length === 1 ? '' : 's'}`);
    else mark('constructions', constructionChecked(sentence.japanese, constructionDraft) ? 'checked, nothing to build' : null);
  });
  return { sentences, kinds };
}

/** What a run was started for, kept on the device that started it so saving can re-check the book. */
export interface BookExtrasRunSnapshot {
  bookId: string;
  /** Sentence ids by handle - 1, as they were when the run started. */
  sentenceIds: string[];
  /** Per kind: the handles sent, and the subset of those the learner approved replacing. */
  kinds: Partial<Record<BookExtraKind, { handles: number[]; replaceHandles: number[] }>>;
}

export function selectionOf(snapshot: BookExtrasRunSnapshot): BookExtraSelection {
  return Object.fromEntries(Object.entries(snapshot.kinds).map(([kind, value]) => [kind, value.handles]));
}

export interface BookExtrasSaveResult {
  saved: Partial<Record<BookExtraKind, number>>;
  keptExisting: Partial<Record<BookExtraKind, number>>;
  problems: string[];
  /** Skipped entries across all chapters, for grouping by reason. */
  rejections: Rejection[];
}

export async function saveBookAssistExtras(
  snapshot: BookExtrasRunSnapshot,
  extraReplies: Readonly<Record<string, string>>,
): Promise<BookExtrasSaveResult> {
  const current = await planBookAssistExtras(snapshot.bookId);
  const currentHandleById = new Map(current.sentences.map((s) => [s.id, s]));
  const result: BookExtrasSaveResult = { saved: {}, keptExisting: {}, problems: [], rejections: [] };

  for (const kind of BOOK_EXTRA_KINDS) {
    const entry = snapshot.kinds[kind];
    if (!entry) continue;
    const sections = mergeBookExtraReplies(kind, extraReplies);
    if (!sections.pack && !sections.structure && !sections.comprehension && !sections.particles && !sections.grammar) continue;

    const stillMissing = new Set(current.kinds[kind].missing);
    const replace = new Set(entry.replaceHandles);
    // Allowed ids for this kind, by the handle the assistant's reply uses (the handle at run start).
    const allowed = new Map<number, string>();
    let kept = 0;
    for (const handle of entry.handles) {
      const id = snapshot.sentenceIds[handle - 1];
      const now = id ? currentHandleById.get(id) : undefined;
      if (!id || !now) continue;
      if (replace.has(handle) || stillMissing.has(now.handle)) allowed.set(handle, id);
      else kept += 1;
    }
    if (kept > 0) result.keptExisting[kind] = kept;
    if (allowed.size === 0) continue;

    // Reply handles are the run-start book positions; apply once per chapter so structure/walkthrough/construction drafts land on the right chapter.
    const chapterIds = [...new Set([...allowed.values()].map((id) => currentHandleById.get(id)!.chapterId))];
    const replaceIds = new Set([...allowed].filter(([handle]) => replace.has(handle)).map(([, id]) => id));
    const byNumber = (chapterId: string | undefined) =>
      snapshot.sentenceIds.map((id, index) => {
        const handle = index + 1;
        const allowedId = allowed.get(handle);
        if (!allowedId || allowedId !== id) return undefined;
        return !chapterId || currentHandleById.get(id)?.chapterId === chapterId ? id : undefined;
      });
    const perChapter = kind === 'structure' || kind === 'constructions' || kind === 'walkthroughs';
    for (const chapterId of perChapter ? chapterIds : [undefined]) {
      const applied = await applyQuickImportExtras(snapshot.bookId, chapterId, sections, byNumber(chapterId), {
        replaceCheckSentenceIds: replaceIds,
      });
      result.saved[kind] = (result.saved[kind] ?? 0) + (kind === 'grammar' ? applied.grammarLinks : applied[kind]);
      // Each per-chapter call sees the other chapters' sentences as unknown handles: that is noise, not a rejection.
      result.rejections.push(...applied.rejections.filter((r) => chapterIds.length === 1 || !r.reason.startsWith('Unknown sentence handle')));
      result.problems.push(...applied.problems.filter((p) => !p.startsWith('Skipped or partly kept')));
    }
    if (kind === 'constructions') await markCheckedWithoutLayers(snapshot, extraReplies, allowed, replace, currentHandleById);
    if (kind === 'grammar') await markGrammarChecked(snapshot, sections.grammar ?? '', allowed, currentHandleById);
  }
  return result;
}

/**
 * The assistant omits sentences with nothing to build, so a finished construction call leaves those with no
 * layers and they would count as "without" forever. Record an empty draft for every sentence a finished call
 * covered that its reply did not mention (and that still has no draft), meaning "looked at, nothing to build".
 */
async function markCheckedWithoutLayers(
  snapshot: BookExtrasRunSnapshot,
  extraReplies: Readonly<Record<string, string>>,
  allowed: ReadonlyMap<number, string>,
  replace: ReadonlySet<number>,
  currentById: ReadonlyMap<string, BookExtraSentence>,
): Promise<void> {
  const handles = snapshot.kinds.constructions?.handles ?? [];
  const tasks = planBookExtraTasks(new Array(snapshot.sentenceIds.length), { constructions: handles });
  const db = getDb();
  for (const task of tasks) {
    const reply = extraReplies[task.id];
    if (task.kind !== 'constructions' || reply === undefined) continue;
    const mentioned = new Set([...reply.matchAll(/"S(\d+)"\s*:/g)].map((m) => Number(m[1])));
    const covered = task.handles ?? handles.filter((h) => h >= task.from && h <= task.to);
    const byChapter = new Map<string, string[]>();
    for (const handle of covered) {
      const id = allowed.get(handle);
      if (!id || replace.has(handle) || mentioned.has(handle)) continue;
      const chapterId = currentById.get(id)?.chapterId;
      if (!chapterId) continue;
      if ((await db.sentenceExtras.get(id))?.constructionDraft !== undefined) continue;
      byChapter.set(chapterId, [...(byChapter.get(chapterId) ?? []), id]);
    }
    for (const [chapterId, ids] of byChapter) {
      await saveSentenceExtras(snapshot.bookId, chapterId, ids.map((id) => [id, { constructionDraft: [] }] as const));
    }
  }
}

/**
 * A sentence the assistant answered for (links or NONE) is marked checked so it is not asked again; one whose
 * section was missing or unusable stays unmarked and is retried on the next run.
 */
async function markGrammarChecked(
  snapshot: BookExtrasRunSnapshot,
  grammarReply: string,
  allowed: ReadonlyMap<number, string>,
  currentById: ReadonlyMap<string, BookExtraSentence>,
): Promise<void> {
  const parsed = parseBookGrammarReply(grammarReply, snapshot.sentenceIds.length);
  const byChapter = new Map<string, string[]>();
  for (const [handle, id] of allowed) {
    if (parsed[handle - 1] === null || parsed[handle - 1] === undefined) continue;
    const chapterId = currentById.get(id)?.chapterId;
    if (chapterId) byChapter.set(chapterId, [...(byChapter.get(chapterId) ?? []), id]);
  }
  for (const [chapterId, ids] of byChapter) {
    await saveSentenceExtras(snapshot.bookId, chapterId, ids.map((id) => [id, { grammarChecked: true }] as const));
  }
}

/** The learner's patterns as the grammar extra should see them: everything except entries tagged no-auto-link. */
export async function loadLinkableGrammarPatterns(): Promise<GrammarPatternRef[]> {
  const patterns = await getDb().grammarPatterns.orderBy('canonicalName').toArray();
  return linkablePatterns(patterns).map((pattern) => ({
    id: pattern.id,
    name: pattern.canonicalName,
    template: pattern.structuralTemplate || undefined,
    aliases: pattern.aliases,
  }));
}
