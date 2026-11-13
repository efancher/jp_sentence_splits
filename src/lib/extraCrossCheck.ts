/**
 * Deterministic cross-checks of assistant extras replies against UniDic morphology
 * (docs/ASSIST_MODEL_EVAL_PLAN.md, milestone 2). Two claims nothing else verifies:
 * a particles CHUNK really ends in a case/topic particle, and a structure role label
 * agrees with the part of speech at the end of its chunk. Pure; tokens come from the
 * mining service's /resegment.
 */
export interface CheckToken {
  surface: string;
  start: number;
  end: number;
  pos: string;
}

export interface CrossCheckIssue {
  chunk: string;
  role?: string;
  problem: string;
}

const CASE_PARTICLES = new Set(['に', 'で', 'と', 'へ', 'を', 'が', 'から', 'まで', 'より', 'の']);
const TOPIC_PARTICLES = new Set(['は', 'も']);

/** Tokens inside the chunk, without trailing punctuation or sentence-final particles. */
export function chunkCoreTokens(sentence: string, tokens: CheckToken[], chunk: string, from = 0): { core: CheckToken[]; next: number } | null {
  const text = chunk.trim();
  const start = sentence.indexOf(text, from);
  if (!text || start < 0) return null;
  const end = start + text.length;
  const inside = tokens.filter((t) => t.start >= start && t.end <= end);
  const core = [...inside];
  while (core.length && (core[core.length - 1]!.pos.startsWith('補助記号') || core[core.length - 1]!.pos.startsWith('助詞/終助詞'))) core.pop();
  return { core, next: end };
}

/** A particles CHUNK must end in one case or topic particle token. */
export function checkParticleChunk(sentence: string, tokens: CheckToken[], chunk: string): CrossCheckIssue | null {
  const found = chunkCoreTokens(sentence, tokens, chunk);
  if (!found) return { chunk, problem: 'chunk is not a substring of the sentence' };
  const last = found.core[found.core.length - 1];
  if (!last || !last.pos.startsWith('助詞')) return { chunk, problem: `ends in ${last ? `${last.surface} (${last.pos})` : 'nothing'}, not a particle` };
  const ok = CASE_PARTICLES.has(last.surface) || TOPIC_PARTICLES.has(last.surface);
  if (!ok) return { chunk, problem: `ends in particle ${last.surface} (${last.pos}), not a case/topic particle` };
  if (last.surface === 'が' && !last.pos.includes('格助詞')) return { chunk, problem: `が is ${last.pos}, not a case particle` };
  return null;
}

/**
 * Does the role label contradict the UniDic tokens of the chunk? Deliberately lenient:
 * compound particles (に対して), a dropped は and verb phrases ending in a connective are
 * normal, so only a clear contradiction is reported (the claimed particle is absent, or a
 * different particle closes the chunk, or no verbal token exists under an engine label).
 */
export function checkStructureRole(core: CheckToken[], role: string): string | null {
  const last = core[core.length - 1];
  if (!last) return null;
  const label = (t: CheckToken) => `${t.surface} (${t.pos})`;
  const text = core.map((t) => t.surface).join('');
  const tail = core.slice(-3);
  const hasParticle = (surface: string) => tail.some((t) => t.surface === surface && t.pos.startsWith('助詞')) || text.endsWith(surface);
  const stripped = role.replace(/^nominalizer \+ /, '');
  const car = /^(.+?)-car(?: \+ topic は)?$/.exec(stripped);
  if (car) {
    if (!hasParticle(car[1]!)) return `role wants ${car[1]} but the chunk has no ${car[1]}; it ends in ${label(last)}`;
    if (stripped.includes('topic は') && !hasParticle('は')) return `role wants は but the chunk ends in ${label(last)}`;
    return null;
  }
  const wanted = stripped === 'Aが' ? 'が' : stripped === 'topic は' ? 'は' : null;
  if (wanted) {
    if (hasParticle(wanted)) return null;
    // A missing particle is fine (dropped は/が); a different closing particle is a contradiction.
    return last.pos.startsWith('助詞') ? `role wants ${wanted} but the chunk ends in ${label(last)}` : null;
  }
  if (role === 'engine: verb') return core.some((t) => /^(動詞|助動詞)/.test(t.pos)) ? null : `role wants a verb but the chunk has none; it ends in ${label(last)}`;
  if (role === 'engine: い-adjective') return core.some((t) => /^(形容詞|助動詞)/.test(t.pos)) ? null : `role wants an i-adjective but the chunk has none; it ends in ${label(last)}`;
  return null;
}

/** Structure lines `S<n> | chunk | role | gloss` for one sentence, in order. */
export function checkStructureSentence(sentence: string, tokens: CheckToken[], lines: { chunk: string; role: string }[]): CrossCheckIssue[] {
  const issues: CrossCheckIssue[] = [];
  let from = 0;
  for (const line of lines) {
    const found = chunkCoreTokens(sentence, tokens, line.chunk, from);
    if (!found) continue;
    from = found.next;
    const problem = checkStructureRole(found.core, line.role);
    if (problem) issues.push({ chunk: line.chunk, role: line.role, problem });
  }
  return issues;
}
