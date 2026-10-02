import type { ParticleCheck } from '../domain/types';
import { getDb } from '../db/database';
import { setSentenceParticleChecks } from '../db/repository';

// Contextual particle questions for the glossing "try it first" check. The
// generic check asks "where to / when / to whom" for any に; this one asks
// about the sentence's own words ("what is the bin to the putting?") with four
// concrete readings. Authored per sentence by an external AI through a
// book-wide prompt file (same copy/paste-or-file round trip as the meaning
// choices), stored on `SentenceAnalysis.particleChecks`.

/** Particles whose relation depends on the verb; the settled ones (を が から…) need no context. */
export const CONTEXTUAL_PARTICLES = ['に', 'で', 'と'] as const;
const PARTICLE_RE = /[にでと]/;

export interface ParticleCheckRequest {
  japanese: string;
  context: readonly string[];
  translation?: string;
}

export interface ParticleCheckCandidate {
  sentenceId: string;
  request: ParticleCheckRequest;
}

/** Book sentences with a に/で/と and no authored checks yet, in book order. */
export async function findParticleCheckCandidates(bookId: string): Promise<ParticleCheckCandidate[]> {
  const db = getDb();
  const memberships = (await db.bookSentences.where('bookId').equals(bookId).sortBy('position'));
  const ids = memberships.map((m) => m.sentenceId);
  const [sentences, analyses] = await Promise.all([db.sentences.bulkGet(ids), db.analyses.bulkGet(ids)]);
  const seen = new Set<string>();
  const out: ParticleCheckCandidate[] = [];
  ids.forEach((id, index) => {
    const sentence = sentences[index];
    if (!sentence || seen.has(id) || analyses[index]?.particleChecks) return;
    seen.add(id);
    if (!PARTICLE_RE.test(sentence.japanese)) return;
    out.push({
      sentenceId: id,
      request: {
        japanese: sentence.japanese,
        context: sentences.slice(Math.max(0, index - 2), index).flatMap((prev) => (prev ? [prev.japanese] : [])),
        translation: sentence.translation?.trim() || undefined,
      },
    });
  });
  return out;
}

const HEADER = [
  'You are writing particle-meaning questions for a Japanese learner, one block per',
  'numbered sentence below. For each sentence pick every に, で and と that marks a noun',
  'phrase and whose role depends on the verb (skip quotative と, particles inside fixed',
  'expressions, and ones whose role is obvious from the sentence). Ask about the role of',
  'that phrase IN THIS SENTENCE, in plain English using the sentence\'s own words, e.g.',
  '"What is the bin to the action of putting?" — not "what does に mean?".',
  '',
  'Give exactly 4 options, each a concrete reading phrased with the sentence\'s own nouns',
  'and verb (e.g. "the bin is where the thing ends up", "the bin is where the putting',
  'happens", "the bin is who receives it", "the bin is what it is being put along with").',
  'One option is correct; the other three are readings a learner could plausibly pick for',
  'a different verb but that are wrong here. Do not write grammar-category labels.',
  'Use the English translation and context when given.',
  '',
  'Reply with one section per sentence, keeping each "=== Sentence N ===" header. For each',
  'chosen particle write a block exactly like this (correct option starts with "*"):',
  '=== Sentence 1 ===',
  'CHUNK: ゴミ箱に',
  'Q: What is the bin to the action of putting?',
  '1. the bin is where it happens',
  '*2. the bin is where the thing ends up',
  '3. the bin is who receives it',
  '4. the bin is what it is compared to',
  '',
  'If a sentence has nothing worth asking, write only "NONE" under its header.',
  'CHUNK is the bunsetsu-style chunk ending in the particle (noun phrase + particle).',
].join('\n');

export function formatBookParticlePromptForAI(items: readonly ParticleCheckRequest[]): string {
  const sections = items.map((item, i) =>
    [
      `=== Sentence ${i + 1} ===`,
      ...(item.context.length ? ['--- context (preceding sentences) ---', ...item.context] : []),
      '--- target sentence ---',
      item.japanese,
      ...(item.translation ? ['--- English translation ---', item.translation] : []),
    ].join('\n'),
  );
  return [HEADER, ...sections].join('\n\n');
}

const SECTION_RE = /^===\s*Sentence\s+(\d+)\s*===$/;
const OPTION_RE = /^(\*)?\s*([1-4])[.)]\s*(.+)$/;

function parseBlock(lines: string[]): ParticleCheck | null {
  let chunk = '';
  let question = '';
  const options = new Map<number, { text: string; correct: boolean }>();
  for (const raw of lines) {
    const line = raw.trim();
    if (/^CHUNK\s*[:：]/i.test(line)) chunk = line.replace(/^CHUNK\s*[:：]\s*/i, '').trim();
    else if (/^Q\s*[:：]/i.test(line)) question = line.replace(/^Q\s*[:：]\s*/i, '').trim();
    else {
      const match = OPTION_RE.exec(line);
      if (match) options.set(Number(match[2]), { text: match[3]!.trim(), correct: Boolean(match[1]) });
    }
  }
  if (!chunk || !question || options.size !== 4) return null;
  const particle = [...chunk.replace(/[。、\s]/g, '')].pop() ?? '';
  if (!(CONTEXTUAL_PARTICLES as readonly string[]).includes(particle)) return null;
  const ordered = [1, 2, 3, 4].map((n) => options.get(n));
  if (ordered.some((entry) => !entry?.text)) return null;
  const correct = ordered.flatMap((entry, i) => (entry!.correct ? [i] : []));
  if (correct.length !== 1) return null;
  const texts = ordered.map((entry) => entry!.text);
  if (new Set(texts).size !== 4) return null;
  return { chunk, particle, question, options: texts, correctIndex: correct[0]! };
}

/**
 * One entry per `1..expectedCount`: the parsed checks (`[]` for NONE), or `null` when the
 * section is missing or had no usable block, so it stays a candidate.
 */
export function parseBookParticleReply(reply: string, expectedCount: number): Array<ParticleCheck[] | null> {
  const sections = new Map<number, string[]>();
  let current: string[] | null = null;
  for (const raw of reply.split('\n')) {
    const match = SECTION_RE.exec(raw.trim());
    if (match) {
      current = [];
      sections.set(Number(match[1]), current);
    } else current?.push(raw);
  }
  const results: Array<ParticleCheck[] | null> = [];
  for (let n = 1; n <= expectedCount; n += 1) {
    const lines = sections.get(n);
    if (!lines) {
      results.push(null);
      continue;
    }
    const blocks: string[][] = [];
    for (const line of lines) {
      if (/^\s*CHUNK\s*[:：]/i.test(line)) blocks.push([line]);
      else blocks.at(-1)?.push(line);
    }
    const checks = blocks.flatMap((block) => {
      const parsed = parseBlock(block);
      return parsed ? [parsed] : [];
    });
    // Blocks present but none usable → leave the sentence as a candidate; no blocks = NONE.
    results.push(blocks.length > 0 && checks.length === 0 ? null : checks);
  }
  return results;
}

/** Apply a parsed reply; never overwrites checks that appeared meanwhile. Returns sentences saved. */
export async function applyBookParticleReply(
  candidates: readonly ParticleCheckCandidate[],
  parsed: ReadonlyArray<ParticleCheck[] | null>,
): Promise<number> {
  const db = getDb();
  let saved = 0;
  for (const [index, candidate] of candidates.entries()) {
    const checks = parsed[index];
    if (!checks) continue;
    if ((await db.analyses.get(candidate.sentenceId))?.particleChecks) continue;
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
