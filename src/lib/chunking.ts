/**
 * Cure Dolly–style heuristic chunking ported from reference/satori_gloss.py.
 * Suggestions only — the UI remains fully manually editable.
 */

import { stripMarkup } from './normalize';

const PARTICLE_TOKENS = [
  'から',
  'まで',
  'より',
  'ほど',
  'だけ',
  'しか',
  'など',
  'とか',
  'って',
  'ては',
  'ても',
  'では',
  'には',
  'へは',
  'とは',
  'のも',
  'でも',
  'のは',
  'のが',
  'のを',
  'ので',
  'のに',
  'たら',
  'たり',
  'なら',
  'が',
  'を',
  'に',
  'で',
  'て',
  'へ',
  'と',
  'や',
  'も',
  'は',
  'の',
] as const;

const SENTENCE_FINAL_PARTICLES = new Set(['な', 'ね', 'よ', 'か', 'ぞ', 'わ', 'さ']);

const CLAUSE_END_CHARS = new Set([
  '。',
  '．',
  '！',
  '？',
  '!',
  '?',
  '、',
  '，',
  ',',
  '」',
  '』',
  '）',
  ')',
  '…',
  '‥',
  '〟',
  '"',
  "'",
]);

const PARTICLE_LOOKAHEAD_BLOCK: Record<string, readonly string[]> = {
  で: [
    'です',
    'でした',
    'である',
    'であり',
    'でき',
    '出来る',
    'できます',
    'できない',
    'できません',
    'できた',
    '出来',
  ],
  て: ['ている', 'ています', 'てる', 'てしまう', 'ておく', 'てみる'],
};

const TE_KURU_CONTINUATIONS = [
  '来',
  'くる',
  'きます',
  'きました',
  'きた',
  'きて',
  'こない',
  'こなかった',
] as const;

const STANDALONE_ADVERBS = [
  'しばらくすると',
  'なんとか',
  'とっても',
  'そして',
  'しかし',
] as const;

const LEXICAL_PARTICLE_LOOKALIKE = new Set([...STANDALONE_ADVERBS, 'すごく']);

const ENGINE_SUFFIXES = [
  'ありませんでした',
  'ありません',
  'でした',
  'です',
  'ました',
  'ません',
  'ます',
  'だった',
  'じゃない',
  'ではない',
  'ない',
  'たい',
  'れる',
  'られる',
  'させる',
  'た',
  'だ',
  'て',
  'で',
] as const;

export const PARTICLE_ROLE: Record<string, string> = {
  が: 'Aが',
  は: 'topic は',
  を: 'を-car',
  に: 'に-car',
  で: 'で-car',
  て: 'て-car',
  んで: 'て-car',
  いで: 'て-car',
  へ: 'へ-car',
  と: 'と-car',
  や: 'や-car',
  も: 'も-car',
  の: 'の-car',
  から: 'から-car',
  まで: 'まで-car',
  より: 'より-car',
  では: 'で-car + topic は',
  には: 'に-car + topic は',
  へは: 'へ-car + topic は',
  とは: 'と-car + topic は',
  ので: 'ので (because)',
  のに: 'のに (although)',
  のは: 'nominalizer + topic は',
  のが: 'nominalizer + Aが',
  のを: 'nominalizer + を-car',
  って: 'って-car',
};

function particleAt(text: string, index: number): string | null {
  if (index <= 0) return null;
  for (const particle of [...PARTICLE_TOKENS, ...SENTENCE_FINAL_PARTICLES]) {
    if (!text.startsWith(particle, index)) continue;
    const rest = text.slice(index);
    const blocked = PARTICLE_LOOKAHEAD_BLOCK[particle] ?? [];
    if (blocked.some((form) => rest.startsWith(form))) continue;

    if (SENTENCE_FINAL_PARTICLES.has(particle)) {
      const after = text.slice(index + particle.length);
      if (after && ![...after].every((char) => CLAUSE_END_CHARS.has(char))) {
        continue;
      }
    }

    if (
      (particle === 'とか' || particle === 'と' || particle === 'か') &&
      ((index >= 2 && text.startsWith('なんとか', index - 2)) ||
        (index >= 1 && text.startsWith('なんとか', index - 1)) ||
        text.startsWith('なんとか', index))
    ) {
      continue;
    }

    if (particle === 'と' && index >= 1 && text.slice(index - 1, index + 1) === 'こと') {
      continue;
    }

    if (particle === 'が' && text.startsWith('がり', index)) {
      continue;
    }

    if (
      (particle === 'って' || particle === 'ても' || particle === 'て' || particle === 'も') &&
      ((index >= 1 && text.startsWith('とっても', index - 1)) ||
        (index >= 2 && text.startsWith('とっても', index - 2)) ||
        (index >= 3 && text.startsWith('とっても', index - 3)) ||
        text.startsWith('とっても', index))
    ) {
      continue;
    }

    if (particle === 'て' && index >= 3 && text.slice(index - 3, index + 1) === 'そして') {
      continue;
    }

    const afterParticle = text.slice(index + particle.length);
    if (
      (particle === 'て' || particle === 'で' || particle === 'って') &&
      TE_KURU_CONTINUATIONS.some((form) => afterParticle.startsWith(form))
    ) {
      continue;
    }

    return particle;
  }
  return null;
}

function peelLeadingAdverbs(chunks: string[]): string[] {
  const peeled: string[] = [];
  for (const chunk of chunks) {
    let remainder = chunk;
    while (remainder) {
      let matched = false;
      for (const adverb of STANDALONE_ADVERBS) {
        if (!remainder.startsWith(adverb) || remainder.length <= adverb.length) continue;
        const rest = remainder.slice(adverb.length);
        if (rest && CLAUSE_END_CHARS.has(rest[0]!)) {
          peeled.push(adverb + rest[0]);
          remainder = rest.slice(1);
        } else {
          peeled.push(adverb);
          remainder = rest;
        }
        matched = true;
        break;
      }
      if (!matched) {
        peeled.push(remainder);
        break;
      }
    }
  }
  return peeled;
}

export function chunkJapaneseSentence(japanese: string): string[] {
  const text = stripMarkup(japanese).replace(/\s+/g, '');
  if (!text) return [];

  const chunks: string[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const particle = index > start ? particleAt(text, index) : null;
    if (particle) {
      const end = index + particle.length;
      chunks.push(text.slice(start, end));
      start = end;
      index = end;
      continue;
    }
    index += 1;
  }
  if (start < text.length) {
    chunks.push(text.slice(start));
  }

  const cleaned: string[] = [];
  for (let chunk of chunks) {
    if (!chunk) continue;
    if (cleaned.length && ['。', '．', '！', '？', '!', '?', '、', '，', ','].includes(chunk)) {
      cleaned[cleaned.length - 1] += chunk;
      continue;
    }
    if (cleaned.length && '、，,'.includes(chunk[0]!)) {
      cleaned[cleaned.length - 1] += chunk[0];
      chunk = chunk.slice(1);
      if (!chunk) continue;
    }
    cleaned.push(chunk);
  }

  const peeled = peelLeadingAdverbs(cleaned);
  return peeled.length ? peeled : [text];
}

export function splitTrailingParticle(chunk: string): [string, string] {
  for (const lookalike of LEXICAL_PARTICLE_LOOKALIKE) {
    if (chunk === lookalike || chunk.startsWith(lookalike)) {
      return [chunk, ''];
    }
  }
  for (const particle of PARTICLE_TOKENS) {
    if (chunk.endsWith(particle) && chunk.length > particle.length) {
      const blocked = PARTICLE_LOOKAHEAD_BLOCK[particle] ?? [];
      if (blocked.some((form) => chunk.endsWith(form))) continue;
      if (
        (particle === 'て' || particle === 'で' || particle === 'って') &&
        TE_KURU_CONTINUATIONS.some((form) => chunk.endsWith(particle + form))
      ) {
        continue;
      }
      if (particle === 'と' && chunk.endsWith('こと')) continue;
      if (particle === 'が' && chunk.endsWith('がり')) continue;
      return [chunk.slice(0, -particle.length), particle];
    }
  }
  return [chunk, ''];
}

export function splitTrailingEngine(chunk: string): [string, string] {
  for (const lookalike of LEXICAL_PARTICLE_LOOKALIKE) {
    if (chunk === lookalike || chunk.startsWith(lookalike)) {
      return [chunk, ''];
    }
  }
  for (const suffix of ENGINE_SUFFIXES) {
    if (chunk === suffix) return ['', suffix];
    if (chunk.endsWith(suffix) && chunk.length > suffix.length) {
      return [chunk.slice(0, -suffix.length), suffix];
    }
  }
  return [chunk, ''];
}

export function normalizeTeFormParticle(
  originalChunk: string,
  bare: string,
  stem: string,
  particle: string,
): [string, string] {
  if (particle === 'で' && bare.endsWith('んで')) return [bare.slice(0, -2), 'んで'];
  if (particle === 'で' && bare.endsWith('いで')) return [bare.slice(0, -2), 'いで'];
  // 思って / 思い切って: trailing って is usually て-form + sokuon, not quotative って.
  if (particle === 'って') {
    if (isQuotativeOrTopicTte(originalChunk, bare, stem)) {
      return [stem, 'って'];
    }
    // Keep っ on the stem; role the final て as て-car.
    return [bare.slice(0, -1), 'て'];
  }
  return [stem, particle];
}

/** Quotative/topic って (「…」って, bare って, だって…) vs verb て-form (切って). */
function isQuotativeOrTopicTte(
  originalChunk: string,
  bare: string,
  stem: string,
): boolean {
  if (/[「『」』]/.test(originalChunk)) return true;
  if (!stem || bare === 'って') return true;
  if (/だって$/.test(bare) || /ですって$/.test(bare)) return true;
  return false;
}

export function roleForChunk(chunk: string, isFinal: boolean): string {
  const bare = chunk.replace(/[。．！？!?、，,」』）)「『（(\s]/g, '');
  let [stem, particle] = splitTrailingParticle(bare);
  [stem, particle] = normalizeTeFormParticle(chunk, bare, stem, particle);
  if (particle) {
    return PARTICLE_ROLE[particle] ?? `${particle}-car`;
  }
  const [, engine] = splitTrailingEngine(bare);
  if (engine || isFinal) return 'engine';
  if (bare) return 'modifier/content';
  return 'chunk';
}

export function suggestRoles(chunks: string[]): string[] {
  return chunks.map((chunk, index) =>
    roleForChunk(chunk, index === chunks.length - 1),
  );
}

export function chunksToSpacedText(chunks: string[]): string {
  return chunks.join(' ');
}

export function spacedTextToChunks(spaced: string): string[] {
  return spaced
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Combined chunk text without inserted spaces must match normalized source. */
export function chunksMatchSource(chunks: string[], sourceJapanese: string): boolean {
  const combined = chunks.join('').replace(/\s+/g, '');
  const source = stripMarkup(sourceJapanese).replace(/\s+/g, '');
  return combined === source;
}
