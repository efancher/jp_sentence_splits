/**
 * Book-page "Generate extras with the assistant": works out, per extra, which
 * sentences have none (`missing`) and which already have one (`existing`, only
 * replaced when the learner says so), and saves a finished box run back onto
 * the book. Saving re-checks the book first, so anything that appeared while the
 * run was going (a hand edit, the background meaning-check worker) is kept
 * unless the learner explicitly approved replacing that sentence.
 */
import { getDb } from '../db/database';
import { getBookWithExtras } from '../db/sentenceExtras';
import { mergeChapterWalkthroughs, sentencesNeedingWalkthrough, validWalkthroughFor } from './contextWalkthrough';
import { chunksMatchSource } from './chunking';
import { validLayersFor } from './phraseConstruction';
import { applyQuickImportExtras } from './quickImportExtras';
import { BOOK_EXTRA_KINDS, mergeBookExtraReplies, type BookExtraKind, type BookExtraSelection } from './bookAssistRun';

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
  const analyses = await db.analyses.bulkGet(sentences.map((s) => s.id));
  const chapters = book?.chapters ?? [];
  const chapterOf = new Map(chapters.map((c) => [c.id, c]));
  const walkthroughs = mergeChapterWalkthroughs(chapters);
  const needsWalkthrough = new Set(sentencesNeedingWalkthrough(sentences, walkthroughs));

  const emptyStatus = (): BookExtraStatus => ({ missing: [], existing: [] });
  const kinds: Record<BookExtraKind, BookExtraStatus> = {
    structure: emptyStatus(),
    constructions: emptyStatus(),
    walkthroughs: emptyStatus(),
    comprehension: emptyStatus(),
    particles: emptyStatus(),
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
      mark('walkthroughs', truncate(walkthrough?.natural ?? 'walkthrough'));
    }

    const check = analysis?.comprehensionCheck;
    mark('comprehension', check ? truncate(check.options[check.correctIndex] ?? 'meaning check') : null);

    const particles = analysis?.particleChecks;
    mark('particles', particles ? (particles.length === 0 ? 'checked, no particle questions' : `${particles.length} question${particles.length === 1 ? '' : 's'}`) : null);

    const draft = chapter?.structureDrafts?.[sentence.id];
    if (analysis?.chunks?.length) mark('structure', `saved analysis: ${truncate(analysis.chunks.map((c) => c.japanese).join(' / '))}`);
    else if (draft && chunksMatchSource(draft.map((chunk) => chunk.japanese), sentence.japanese)) {
      mark('structure', `draft: ${truncate(draft.map((c) => c.japanese).join(' / '))}`);
    } else mark('structure', null);

    const layers = validLayersFor(sentence.japanese, chapter?.constructionDrafts?.[sentence.id]);
    mark('constructions', layers.length > 0 ? `${layers.length} layer${layers.length === 1 ? '' : 's'}` : null);
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
}

export async function saveBookAssistExtras(
  snapshot: BookExtrasRunSnapshot,
  extraReplies: Readonly<Record<string, string>>,
): Promise<BookExtrasSaveResult> {
  const current = await planBookAssistExtras(snapshot.bookId);
  const currentHandleById = new Map(current.sentences.map((s) => [s.id, s]));
  const result: BookExtrasSaveResult = { saved: {}, keptExisting: {}, problems: [] };

  for (const kind of BOOK_EXTRA_KINDS) {
    const entry = snapshot.kinds[kind];
    if (!entry) continue;
    const sections = mergeBookExtraReplies(kind, extraReplies);
    if (!sections.pack && !sections.structure && !sections.comprehension && !sections.particles) continue;

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
      result.saved[kind] = (result.saved[kind] ?? 0) + applied[kind];
      result.problems.push(...applied.problems.filter((p) => chapterIds.length === 1 || !p.includes('did not match')));
    }
  }
  return result;
}
