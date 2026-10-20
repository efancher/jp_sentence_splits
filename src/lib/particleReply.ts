import type { ParticleCheck } from '../domain/types';

// Parsing of the assistant's particle-check reply. Kept free of database imports so the
// box-side assist run (compiled outside the app project) can use it.

/** Case/topic particles that can carry a sentence-specific question (longest first for suffix matching). */
export const CONTEXTUAL_PARTICLES = ['から', 'まで', 'より', 'に', 'で', 'と', 'へ', 'を', 'が', 'は', 'も'] as const;

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
  const stem = chunk.replace(/[。、！？\s]/g, '');
  const particle = CONTEXTUAL_PARTICLES.find((candidate) => stem.endsWith(candidate));
  if (!particle) return null;
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

/** `ISSUE:` lines per sentence (index = sentence number - 1); empty when none were flagged. */
export function parseBookChunkIssues(reply: string, expectedCount: number): string[][] {
  const out: string[][] = Array.from({ length: expectedCount }, () => []);
  let current = -1;
  for (const raw of reply.split('\n')) {
    const line = raw.trim();
    const section = SECTION_RE.exec(line);
    if (section) {
      current = Number(section[1]) - 1;
      continue;
    }
    const issue = /^ISSUE\s*[:：]\s*(.+)$/i.exec(line);
    if (issue && current >= 0 && current < expectedCount) out[current]!.push(issue[1]!.trim());
  }
  return out;
}
