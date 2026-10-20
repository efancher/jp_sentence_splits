import type { AnalysisChunk, ParticleCheck } from '../domain/types';
import { getDb } from '../db/database';
import { setSentenceParticleChecks } from '../db/repository';
import { getBookWithExtras } from '../db/sentenceExtras';
import { previewHeuristicChunks } from './analysisHelpers';
import { getMeaningBank } from './meaningChoices';

export { CONTEXTUAL_PARTICLES, parseBookChunkIssues, parseBookParticleReply } from './particleReply';

// Contextual particle questions for the glossing "try it first" check. The
// generic check asks "where to / when / to whom" for any に; this one asks
// about the sentence's own words ("what role does the bin play?") with four
// concrete readings. Authored per sentence by an external AI through a
// book-wide prompt file (same copy/paste-or-file round trip as the meaning
// choices), stored on `SentenceAnalysis.particleChecks`.

const PARTICLE_RE = /[にでとへをがはも]|から|まで|より/;

export interface ParticleCheckRequest {
  japanese: string;
  context: readonly string[];
  translation?: string;
  /** The app's own chunking of the sentence, so the reply can name chunks exactly. */
  chunks?: readonly string[];
}

export interface ParticleCheckCandidate {
  sentenceId: string;
  request: ParticleCheckRequest;
  /** Existing checks no longer line up with the current chunks; a reply replaces them. */
  replacing?: boolean;
}

/**
 * Book sentences with a case/topic particle and no authored checks yet, in book
 * order. With `stale`, instead the sentences whose authored checks name a chunk
 * that the current chunking (saved, AI draft or heuristic) no longer produces.
 */
export async function findParticleCheckCandidates(
  bookId: string,
  options: { stale?: boolean } = {},
): Promise<ParticleCheckCandidate[]> {
  const db = getDb();
  const memberships = (await db.bookSentences.where('bookId').equals(bookId).sortBy('position'));
  const ids = memberships.map((m) => m.sentenceId);
  const [sentences, analyses, book] = await Promise.all([db.sentences.bulkGet(ids), db.analyses.bulkGet(ids), getBookWithExtras(bookId)]);
  const seen = new Set<string>();
  const out: ParticleCheckCandidate[] = [];
  ids.forEach((id, index) => {
    const sentence = sentences[index];
    if (!sentence || seen.has(id)) return;
    seen.add(id);
    const existing = analyses[index]?.particleChecks;
    if (!options.stale && existing) return;
    if (options.stale && !existing?.length) return;
    if (!PARTICLE_RE.test(sentence.japanese)) return;
    const draft = book?.chapters.find((chapter) => chapter.id === memberships[index]!.chapterId)?.structureDrafts?.[id];
    const bank = getMeaningBank(analyses[index]?.comprehensionCheck);
    const chunks = chunkSurfaces(sentence.japanese, analyses[index]?.chunks, draft?.map((chunk) => chunk.japanese));
    if (options.stale && existing!.every((check) => chunks.includes(check.chunk))) return;
    out.push({
      replacing: options.stale || undefined,
      sentenceId: id,
      request: {
        japanese: sentence.japanese,
        context: sentences.slice(Math.max(0, index - 2), index).flatMap((prev) => (prev ? [prev.japanese] : [])),
        translation: sentence.translation?.trim() || bank?.correct || undefined,
        chunks,
      },
    });
  });
  return out;
}

/** Saved chunks, else the chapter's AI draft, else the heuristic split — whichever the walkthrough would show. */
function chunkSurfaces(japanese: string, saved: readonly AnalysisChunk[] | undefined, draft: readonly string[] | undefined): string[] {
  const flat = japanese.replace(/\s+/g, '');
  const fromSaved = (saved ?? [])
    .filter((chunk) => chunk.kind !== 'zero_ga' && chunk.japanese)
    .sort((a, b) => a.order - b.order)
    .map((chunk) => chunk.japanese);
  if (fromSaved.length > 0 && fromSaved.join('') === flat) return fromSaved;
  if (draft && draft.length > 0 && draft.join('') === flat) return [...draft];
  return previewHeuristicChunks(japanese).parts;
}

const HEADER = [
  'You are writing particle-meaning questions for a Japanese learner, one block per',
  'numbered sentence below. Each sentence is shown with its English meaning (when known)',
  'and its chunk boundaries. For each sentence pick the chunks that end in a case or topic',
  'particle (に で と へ を が は も から まで より) whose role is worth a question — skip',
  'chunks where the role is trivially obvious, quotative と, and particles inside fixed',
  'expressions. Ask about the role of that phrase IN THIS SENTENCE, in plain English using',
  'the sentence\'s own words, e.g. "What role does the bin play in putting it in?" — not',
  '"what does に mean?".',
  '',
  'Give exactly 4 options, each a concrete reading phrased with the sentence\'s own nouns',
  'and verb (e.g. "the bin is where the thing ends up", "the bin is where the putting',
  'happens", "the bin is who receives it", "the bin is what it is being put along with").',
  'One option is correct; the other three are readings a learner could plausibly pick for',
  'a different verb but that are wrong here. Do not write grammar-category labels. Use the',
  'English meaning and context to be sure which reading is right.',
  '',
  'Reply with one section per sentence, keeping each "=== Sentence N ===" header. For each',
  'chosen particle write a block exactly like this (correct option starts with "*"):',
  '=== Sentence 1 ===',
  'CHUNK: ゴミ箱に',
  'Q: What role does the bin play in putting it in?',
  '1. the bin is where it happens',
  '*2. the bin is where the thing ends up',
  '3. the bin is who receives it',
  '4. the bin is what it is compared to',
  '',
  'CHUNK must be copied exactly from that sentence\'s "chunks" line. If a sentence has',
  'nothing worth asking, write only "NONE" under its header.',
  '',
  'Also check each sentence\'s chunk boundaries. The chunker is a heuristic and sometimes',
  'splits inside a single word (e.g. "ありが | とう", "と | き", "朝ごは | ん") or leaves two',
  'phrases glued together. For every such error add a line under that sentence\'s header:',
  'ISSUE: ありが | とう → ありがとう',
  '(the wrong boundary as shown, then → the correct form, plus a few words of explanation',
  'if the fix is not obvious). Report only real errors, one ISSUE line each; a bad boundary',
  'should not stop you writing questions for the other chunks.',
].join('\n');

export function formatBookParticlePromptForAI(items: readonly ParticleCheckRequest[]): string {
  const sections = items.map((item, i) =>
    [
      `=== Sentence ${i + 1} ===`,
      ...(item.context.length ? ['--- context (preceding sentences) ---', ...item.context] : []),
      '--- target sentence ---',
      item.japanese,
      ...(item.chunks?.length ? ['--- chunks ---', item.chunks.join(' | ')] : []),
      ...(item.translation ? ['--- English meaning ---', item.translation] : []),
    ].join('\n'),
  );
  return [HEADER, ...sections].join('\n\n');
}

/** Apply a parsed reply; only candidates marked `replacing` may overwrite checks, otherwise checks that appeared meanwhile are kept. Returns sentences saved. */
export async function applyBookParticleReply(
  candidates: readonly ParticleCheckCandidate[],
  parsed: ReadonlyArray<ParticleCheck[] | null>,
): Promise<number> {
  const db = getDb();
  let saved = 0;
  for (const [index, candidate] of candidates.entries()) {
    const checks = parsed[index];
    if (!checks) continue;
    if (!candidate.replacing && (await db.analyses.get(candidate.sentenceId))?.particleChecks) continue;
    await setSentenceParticleChecks(candidate.sentenceId, checks);
    saved += 1;
  }
  return saved;
}

/** Save text as a file download (used for prompts to hand to an external assistant). */
export function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
