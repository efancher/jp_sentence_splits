import { getDb } from '../db/database';
import type { StructureDraftChunk } from '../domain/types';
import { chunksMatchSource } from './chunking';
import { buildStructureInstructions, parseStructureLines, STRUCTURE_LINE_EXAMPLE, STRUCTURE_SENTENCES_PER_PART } from './episodeStructure';

// Book-wide chunking by an external AI (same download-prompt / upload-reply
// round trip as the particle checks). Results are stored as chapter
// `structureDrafts`, which the walkthrough and the particle checks already read
// when a sentence has no saved analysis.

export interface ChunkingCandidate {
  sentenceId: string;
  chapterId: string;
  japanese: string;
  translation?: string;
  context: string[];
}

/** Book sentences with neither saved analysis chunks nor a draft that still rebuilds the text, in book order. */
export async function findChunkingCandidates(bookId: string): Promise<ChunkingCandidate[]> {
  const db = getDb();
  const memberships = await db.bookSentences.where('bookId').equals(bookId).sortBy('position');
  const ids = memberships.map((m) => m.sentenceId);
  const [sentences, analyses, book] = await Promise.all([db.sentences.bulkGet(ids), db.analyses.bulkGet(ids), db.books.get(bookId)]);
  const seen = new Set<string>();
  const out: ChunkingCandidate[] = [];
  ids.forEach((id, index) => {
    const sentence = sentences[index];
    if (!sentence || seen.has(id)) return;
    seen.add(id);
    if (analyses[index]?.chunks?.length) return;
    const chapterId = memberships[index]!.chapterId;
    if (!chapterId) return;
    const draft = book?.chapters.find((chapter) => chapter.id === chapterId)?.structureDrafts?.[id];
    if (draft && chunksMatchSource(draft.map((chunk) => chunk.japanese), sentence.japanese)) return;
    out.push({
      sentenceId: id,
      chapterId,
      japanese: sentence.japanese,
      translation: sentence.translation?.trim() || undefined,
      context: sentences.slice(Math.max(0, index - 2), index).flatMap((prev) => (prev ? [prev.japanese] : [])),
    });
  });
  return out;
}

export function formatBookChunkingPrompt(items: readonly ChunkingCandidate[]): string {
  const header = [
    'You are chunking Japanese sentences for a learner. Each numbered sentence below is shown',
    'with the sentences before it and its English meaning (when known).',
    '',
    ...buildStructureInstructions(),
    '',
    'Reply with one line per chunk, in the form "S<number> | chunk | role | gloss", for every sentence,',
    'and nothing else. Example:',
    STRUCTURE_LINE_EXAMPLE,
  ].join('\n');
  const sections = items.map((item, i) =>
    [
      `=== S${i + 1} ===`,
      ...(item.context.length ? ['context:', ...item.context] : []),
      `sentence: ${item.japanese}`,
      ...(item.translation ? [`English: ${item.translation}`] : []),
    ].join('\n'),
  );
  return [header, ...sections].join('\n\n');
}

/** The next batch to hand to the assistant; the rest stay pending for later rounds. */
export function nextChunkingBatch(pending: readonly ChunkingCandidate[]): ChunkingCandidate[] {
  return pending.slice(0, STRUCTURE_SENTENCES_PER_PART);
}

export function parseBookChunkingReply(reply: string, batch: readonly ChunkingCandidate[]) {
  const parsed = parseStructureLines(reply, {
    title: '',
    sentences: batch.map((item) => ({ id: item.sentenceId, japanese: item.japanese })),
    vocabulary: [],
    grammar: [],
  });
  const chapterBySentence = new Map(batch.map((item) => [item.sentenceId, item.chapterId]));
  const byChapter = new Map<string, Record<string, StructureDraftChunk[]>>();
  for (const [sentenceId, chunks] of parsed.drafts) {
    const chapterId = chapterBySentence.get(sentenceId);
    if (!chapterId) continue;
    byChapter.set(chapterId, { ...byChapter.get(chapterId), [sentenceId]: chunks });
  }
  return { byChapter, saved: parsed.drafts.size, rejected: parsed.rejected };
}
