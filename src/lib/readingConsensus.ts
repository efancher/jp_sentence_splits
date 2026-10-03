import type { WordAlignment } from '../domain/types';

import { phonesToSoundedMorae } from './moraTiming';
import { parseInlineReadings, type RubySegment } from './parseInlineReadings';

const SILENCE = new Set(['', '<eps>', '<unk>', '<sil>', '<pad>', 'sil', 'sp', 'spn']);

const toHiragana = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const VOWEL_OF: Record<string, string> = {};
for (const [vowel, row] of Object.entries({
  あ: 'あかがさざただなはばぱまやゃらわ',
  い: 'いきぎしじちぢにひびぴみり',
  う: 'うくぐすずつづぬふぶぷむゆゅる',
  え: 'えけげせぜてでねへべぺめれ',
  お: 'おこごそぞとどのほぼぽもよょろをょ',
})) {
  for (const ch of row) VOWEL_OF[ch] = vowel;
}

/** Collapse vowel-length spellings (おもー / おもう, きょー / きょう) so only genuine kana differences remain. */
export function normalizeKanaForCompare(kana: string): string {
  const out: string[] = [];
  for (const ch of toHiragana(kana)) {
    const prev = out[out.length - 1];
    const prevVowel = prev ? (prev === 'ー' ? undefined : VOWEL_OF[prev]) : undefined;
    if (ch === 'ー' && prevVowel) out.push(prevVowel);
    else if (ch === 'う' && (prevVowel === 'お' || prevVowel === 'う')) out.push(prevVowel);
    else if (ch === 'い' && (prevVowel === 'え' || prevVowel === 'い')) out.push(prevVowel);
    else if (ch === 'お' && prevVowel === 'お') out.push('お');
    else out.push(ch);
  }
  return out.join('');
}

export const sameReading = (a: string, b: string): boolean =>
  normalizeKanaForCompare(a) === normalizeKanaForCompare(b);

/** What each independent signal says a ruby span reads as, keyed by the span's segment index. */
export type SpanReadings = Map<number, string>;

/** The sentence's kana string as the tokenizer's furigana reads it, plus where each ruby span sits in it. */
export function inlineKana(inline: string): {
  kana: string;
  spans: { segIndex: number; start: number; end: number }[];
} {
  let kana = '';
  const spans: { segIndex: number; start: number; end: number }[] = [];
  parseInlineReadings(inline).forEach((seg, segIndex) => {
    if (seg.kind === 'ruby' && seg.reading) {
      spans.push({ segIndex, start: kana.length, end: kana.length + seg.reading.length });
      kana += seg.reading;
    } else {
      kana += seg.base;
    }
  });
  return { kana, spans };
}

/**
 * Where each boundary of `a` lands in `b` under a minimal-edit alignment, so a
 * span of the tokenizer's kana can be read off the LLM's whole-sentence kana
 * even when the two differ elsewhere.
 */
function boundaryMap(a: string, b: string): number[] {
  const n = a.length;
  const m = b.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) cost[i]![0] = i;
  for (let j = 0; j <= m; j += 1) cost[0]![j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const sub = cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      cost[i]![j] = Math.min(sub, cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
    }
  }
  const map = new Array<number>(n + 1).fill(0);
  let i = n;
  let j = m;
  map[n] = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i]![j] === cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      i -= 1;
      j -= 1;
    } else if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
    map[i] = j;
  }
  return map;
}

/**
 * Per-ruby-span readings taken from a whole-sentence hiragana rendering (e.g.
 * an LLM reading the sentence in context). A span with no counterpart in the
 * other string (empty after alignment) is left out rather than guessed.
 */
export function llmSpanReadings(inline: string, llmKana: string): SpanReadings {
  const { kana, spans } = inlineKana(inline);
  const target = toHiragana(llmKana.replace(/\s+/g, ''));
  const out: SpanReadings = new Map();
  if (!target) return out;
  const map = boundaryMap(toHiragana(kana.replace(/\s+/g, '')), target);
  // boundaryMap runs on the whitespace-free string; remap span offsets to it.
  const stripOffset = (pos: number) => kana.slice(0, pos).replace(/\s+/g, '').length;
  for (const span of spans) {
    const reading = target.slice(map[stripOffset(span.start)]!, map[stripOffset(span.end)]!);
    if (reading) out.set(span.segIndex, reading);
  }
  return out;
}

/**
 * Per-ruby-span readings the speaker actually produced, from forced alignment:
 * the aligner word whose text equals the span's base, converted phones -> kana.
 */
export function audioSpanReadings(inline: string, words: WordAlignment[]): SpanReadings {
  const audible = words.filter((w) => !SILENCE.has(w.text));
  const out: SpanReadings = new Map();
  let cursor = 0;
  parseInlineReadings(inline).forEach((seg: RubySegment, segIndex) => {
    if (seg.kind !== 'ruby' || !seg.reading) return;
    const at = audible.findIndex((w, i) => i >= cursor && w.text === seg.base);
    if (at < 0) return;
    cursor = at + 1;
    const morae = phonesToSoundedMorae(audible[at]!.phones);
    if (morae) out.set(segIndex, morae.map((m) => m.kana).join(''));
  });
  return out;
}

export type SpanVerdict =
  | { kind: 'agree' }
  | { kind: 'fix'; reading: string }
  | { kind: 'flag'; audio?: string; llm?: string }
  | { kind: 'unchecked' };

/**
 * One span, up to two independent opinions against the tokenizer's reading.
 * Auto-fix only when audio and the LLM both disagree with the tokenizer and
 * agree with each other; a lone dissent (or a split one) is flagged for a
 * human, because each signal has its own failure mode (aligner picks an odd
 * dictionary pronunciation; the LLM guesses a reading it can't hear).
 */
export function judgeSpan(tokenizer: string, audio?: string, llm?: string): SpanVerdict {
  if (audio === undefined && llm === undefined) return { kind: 'unchecked' };
  const audioAgrees = audio === undefined || sameReading(audio, tokenizer);
  const llmAgrees = llm === undefined || sameReading(llm, tokenizer);
  if (audioAgrees && llmAgrees) return { kind: 'agree' };
  if (audio !== undefined && llm !== undefined && sameReading(audio, llm)) {
    return { kind: 'fix', reading: llm };
  }
  return { kind: 'flag', audio: audioAgrees ? undefined : audio, llm: llmAgrees ? undefined : llm };
}

/** Re-serialize `inline` with some spans' readings replaced; null if the markup wouldn't round-trip exactly. */
export function applyReadingFixes(inline: string, fixes: SpanReadings): string | null {
  const segments = parseInlineReadings(inline);
  const serialize = (override: SpanReadings) =>
    segments
      .map((seg, i) =>
        seg.kind === 'ruby' && seg.reading ? `${seg.base}[${override.get(i) ?? seg.reading}]` : seg.base,
      )
      .join('');
  if (serialize(new Map()) !== inline) return null;
  return serialize(fixes);
}
