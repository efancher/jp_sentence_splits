import type { TargetVocabulary } from '../domain/types';
import {
  splitTrailingEngine,
  splitTrailingParticle,
} from './chunking';

/**
 * Local sticky-English suggestions (Cure Dolly style).
 *
 * Content words come from target vocabulary, a small built-in lexicon, and
 * optional Satori English as a word bag — never from a cloud translation API.
 */

const PARTICLE_STICKY: Record<string, string> = {
  が: 'が',
  は: 'as-for',
  を: 'を',
  に: 'at',
  で: 'at/with',
  て: 'and',
  んで: 'and',
  いで: 'and',
  へ: 'toward',
  と: 'with/and',
  や: 'and/or',
  も: 'also',
  の: "'s",
  から: 'from',
  まで: 'until',
  より: 'than',
  では: 'at-as-for',
  には: 'at-as-for',
  へは: 'toward-as-for',
  とは: 'with-as-for',
  ては: 'if/when',
  ので: 'because',
  のに: 'although',
  のは: 'nom-as-for',
  のが: 'nom-が',
  のを: 'nom-を',
  って: 'って',
  ても: 'even-if',
  でも: 'even/but',
  だけ: 'only',
  しか: 'only-(neg)',
  など: 'etc',
  とか: 'and/or',
  たら: 'if/when',
  たり: 'and-such',
  なら: 'if',
};

const ENGINE_STICKY: Record<string, string> = {
  です: 'is.POLITE',
  でした: 'was.POLITE',
  ます: 'POLITE',
  ました: 'POLITE.PAST',
  ません: 'POLITE.NEG',
  ありません: 'exist-not.POLITE',
  ありませんでした: 'exist-not.POLITE.PAST',
  ない: 'not',
  だった: 'was',
  じゃない: 'is-not',
  ではない: 'is-not',
  た: 'PAST',
  だ: 'COP',
  て: 'and/ing',
  で: 'and/ing',
  たい: 'want-to',
};

/** Whole-phrase / connector sticky English used without MT. */
const PHRASE_STICKY: Record<string, string> = {
  そして: 'and-then',
  しかし: 'however',
  でも: 'but',
  それで: 'and-so',
  だから: 'so',
  つまり: 'in-other-words',
  たとえば: 'for-example',
  ある: 'a-certain',
  その: 'that',
  この: 'this',
  あの: 'that-(far)',
  きれい: 'pretty',
  大きい: 'big',
  小さい: 'small',
  青い: 'blue',
  空: 'sky',
  木: 'tree',
  緑: 'green',
  小鳥: 'little-bird',
  夫婦: 'couple',
  巣: 'nest',
  作る: 'make',
  作り: 'make',
  来: 'come',
  来ま: 'come',
  春: 'spring',
  暖かい: 'warm',
};

const CONTENT_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'he',
  'her',
  'him',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'she',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'they',
  'this',
  'to',
  'us',
  'was',
  'we',
  'were',
  'with',
  'you',
  'your',
]);

export interface StickyEnglishOptions {
  role?: string;
  englishHint?: string;
  vocabulary?: TargetVocabulary[];
}

function stripClausePunctuation(chunk: string): string {
  return chunk.replace(/[。．！？!?、，,」』）)「『（(\s]/g, '');
}

function normalizeTeFormParticle(
  bare: string,
  stem: string,
  particle: string,
): [string, string] {
  if (particle === 'で' && bare.endsWith('んで')) return [bare.slice(0, -2), 'んで'];
  if (particle === 'で' && bare.endsWith('いで')) return [bare.slice(0, -2), 'いで'];
  return [stem, particle];
}

function hyphenateContent(words: string[]): string {
  return words
    .map((word) => word.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .join('-');
}

function englishHintWords(english: string): string[] {
  return (english.match(/[A-Za-z0-9']+/g) ?? [])
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 1 && !CONTENT_STOPWORDS.has(part));
}

function vocabGloss(english: string): string {
  const first = english
    .split(/[;/,|]/)[0]
    ?.trim()
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  if (!first) return '';
  const words = englishHintWords(first);
  return hyphenateContent(words.length ? words : first.split(/\s+/));
}

function contentFromVocabulary(
  japanese: string,
  vocabulary: TargetVocabulary[] | undefined,
): string {
  if (!vocabulary?.length || !japanese) return '';
  const matches = vocabulary
    .filter((item) => item.expression && japanese.includes(item.expression))
    .sort((a, b) => b.expression.length - a.expression.length);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const item of matches) {
    const gloss = vocabGloss(item.english);
    if (!gloss || seen.has(gloss)) continue;
    seen.add(gloss);
    parts.push(gloss);
  }
  return parts.join('-');
}

function contentFromLexicon(japanese: string): string {
  if (!japanese) return '';
  if (PHRASE_STICKY[japanese]) return PHRASE_STICKY[japanese]!;
  const parts: string[] = [];
  let rest = japanese;
  // Greedy longest-key scan from the left.
  while (rest) {
    let matched = '';
    for (const key of Object.keys(PHRASE_STICKY).sort(
      (a, b) => b.length - a.length,
    )) {
      if (rest.startsWith(key)) {
        matched = key;
        break;
      }
    }
    if (!matched) break;
    parts.push(PHRASE_STICKY[matched]!);
    rest = rest.slice(matched.length);
  }
  return parts.join('-');
}

function contentFromEnglishHint(
  japanese: string,
  englishHint: string | undefined,
): string {
  if (!englishHint?.trim() || !japanese) return '';
  // Only use the EN bag when we already have some structural Japanese match
  // elsewhere; bare EN would invent fluent order. Prefer single-token stems.
  if (japanese.length > 6) return '';
  const words = englishHintWords(englishHint);
  if (words.length === 1) return words[0]!;
  return '';
}

function stickyContent(
  japanese: string,
  options: StickyEnglishOptions,
): string {
  return (
    contentFromVocabulary(japanese, options.vocabulary) ||
    contentFromLexicon(japanese) ||
    contentFromEnglishHint(japanese, options.englishHint) ||
    japanese
  );
}

export function normalizeStickyLiteral(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[。．！？!?、，,]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Suggest Japanese-order sticky English for one analysis chunk.
 * Returns '' when the chunk is empty after stripping punctuation.
 */
export function suggestStickyEnglish(
  chunkJapanese: string,
  options: StickyEnglishOptions = {},
): string {
  const bare = stripClausePunctuation(chunkJapanese);
  if (!bare) return '';

  let [stem, particle] = splitTrailingParticle(bare);
  [stem, particle] = normalizeTeFormParticle(bare, stem, particle);
  if (particle) {
    const sticky = PARTICLE_STICKY[particle] ?? particle;
    if (!stem) return sticky;
    const content = stickyContent(stem, options);
    return `${content}-${sticky}`;
  }

  const [engineStem, engine] = splitTrailingEngine(bare);
  if (engine) {
    const sticky = ENGINE_STICKY[engine] ?? engine;
    if (!engineStem) return sticky;
    const content = stickyContent(engineStem, options);
    return `${content}-${sticky}`;
  }

  if (options.role === 'engine') {
    const sticky = ENGINE_STICKY[bare];
    if (sticky) return sticky;
  }

  const trailingPunct = chunkJapanese.match(/[、，,。．！？!?]+$/)?.[0] ?? '';
  const content = stickyContent(bare, options);
  if (trailingPunct.includes('、') || trailingPunct.includes(',')) {
    return `${content},`;
  }
  return content;
}

export function stickyLiteralsDiffer(user: string, suggested: string): boolean {
  if (!suggested.trim()) return false;
  return normalizeStickyLiteral(user) !== normalizeStickyLiteral(suggested);
}
