import type { PhoneAlignment } from '../domain/types';

import { parseInlineReadings } from './parseInlineReadings';
import { segmentIntoMorae } from './mora';

/**
 * Sub-token timing: which slice of a forced-aligned word token belongs to
 * which mora.
 *
 * The aligner (MFA `japanese_mfa`) times whole dictionary tokens and, inside
 * each, its phones — but nothing says which phones make up which mora. Two
 * pieces here supply that:
 *
 *  - `phonesToMoraIntervals`: derives a token's mora boundaries from its own
 *    phone labels. Japanese is regular enough for this (label inventory
 *    checked against our corpus, docs/STATUS.md 2026-09-20): a vowel phone is
 *    one mora, a long vowel (`oː`) is two, a geminate consonant (`tɕː`) is
 *    っ plus the onset of the next mora, a moraic nasal is one mora; every other
 *    consonant is an onset that belongs to the vowel after it.
 *  - `buildMoraMap`: for each character of the sentence, the [start, end) range
 *    of mora indices it reads as, from the sentence's ruby reading
 *    (`生まれ[うまれ]た`).
 *
 * Together they let a target that ends mid-token (生まれ inside 生まれた) be cut at
 * its last mora instead of at the token's end. Both are conservative: any
 * inconsistency (a phone pattern that doesn't yield the reading's mora count, a
 * reading that doesn't cover the text) yields null and callers keep the
 * whole-token span.
 */

export interface MoraInterval {
  /** Seconds, same clock as `PhoneAlignment`. */
  start: number;
  end: number;
}

const VOWEL = /^[aeiouɯɨ]/u;
const GLIDE = /^[jwɰ](?!̃)/u; // j, w, ɰ — but not nasalized ɰ̃ (that's ん)
const NASAL_BASE = /^[nmɲŋɴ]/u;
const NON_SPEECH = new Set(['sil', 'sp', '', 'spn']);
const LONG = 'ː';

/** Voiceless obstruents: a high vowel between two of these (or after one, word-finally) devoices and the aligner often drops it. */
const VOICELESS = /^(?:k|t|s|ɕ|ç|h|ɸ|p|ts|tɕ|c|ʔ)$/u;
const isVoiceless = (label: string) => VOICELESS.test(label);
const isVowel = (label: string) => VOWEL.test(label);
const isLong = (label: string) => label.includes(LONG);
const isNasal = (label: string) => NASAL_BASE.test(label) || label.startsWith('ɰ̃');
/** ɴ and ɰ̃ occur only as ん. */
const isAlwaysMoraicNasal = (label: string) => label.startsWith('ɴ') || label.startsWith('ɰ̃');

/**
 * Mora intervals for one token's phones, in order, or null when the phones
 * don't parse cleanly (spoken-noise label, a nasal directly after an onset, a
 * voiced consonant left without a vowel).
 *
 * A devoiced vowel that the aligner dropped altogether (して → `ɕ t e`, ます →
 * `m a s`) is recovered: a voiceless consonant followed by another voiceless
 * consonant, or ending the token, stands as its own mora (its span is just the
 * consonant's — the vowel itself left no phone to time).
 */
export function phonesToMoraIntervals(phones: PhoneAlignment[]): MoraInterval[] | null {
  const morae: MoraInterval[] = [];
  let pendingStart: number | null = null;
  /** The last onset phone since the previous mora, to spot a deleted devoiced vowel. */
  let pendingLast: PhoneAlignment | null = null;

  for (let i = 0; i < phones.length; i += 1) {
    const phone = phones[i]!;
    const label = phone.text;
    if (label === 'spn') return null;
    if (NON_SPEECH.has(label)) continue;

    if (isVowel(label)) {
      const start = pendingStart ?? phone.start;
      pendingStart = null;
      pendingLast = null;
      if (isLong(label)) {
        const mid = phone.start + (phone.end - phone.start) / 2;
        morae.push({ start, end: mid }, { start: mid, end: phone.end });
      } else {
        morae.push({ start, end: phone.end });
      }
      continue;
    }

    if (isNasal(label)) {
      const next = phones[i + 1]?.text;
      const geminate = isLong(label);
      const moraic =
        geminate || isAlwaysMoraicNasal(label) || next === undefined || !(isVowel(next) || GLIDE.test(next));
      if (moraic) {
        if (pendingStart !== null) return null; // an onset can't precede ん
        pendingLast = null;
        if (geminate) {
          // ん + the onset of the next mora share one long nasal.
          const mid = phone.start + (phone.end - phone.start) / 2;
          morae.push({ start: phone.start, end: mid });
          pendingStart = mid;
        } else {
          morae.push({ start: phone.start, end: phone.end });
        }
        continue;
      }
      pendingStart ??= phone.start; // an ordinary nasal onset (な, ま, にゃ …)
      pendingLast = phone;
      continue;
    }

    if (isLong(label)) {
      // Geminate obstruent: っ, then the onset of the following mora.
      if (pendingStart !== null) return null;
      const mid = phone.start + (phone.end - phone.start) / 2;
      morae.push({ start: phone.start, end: mid });
      pendingStart = mid;
      pendingLast = null;
      continue;
    }

    // Plain consonant / glide onset. Two voiceless consonants in a row mean the
    // vowel between them was devoiced and dropped: close the first as a mora.
    if (pendingStart !== null && pendingLast) {
      if (isVoiceless(pendingLast.text) && isVoiceless(label)) {
        morae.push({ start: pendingStart, end: pendingLast.end });
        pendingStart = null;
      } else if (!GLIDE.test(label)) {
        return null; // any other consonant cluster isn't Japanese phonotactics — don't guess
      }
    }
    pendingStart ??= phone.start;
    pendingLast = phone;
  }

  if (pendingStart === null) return morae;
  // A token-final voiceless consonant is a dropped devoiced vowel (…ます → m a s).
  if (pendingLast && isVoiceless(pendingLast.text)) {
    morae.push({ start: pendingStart, end: pendingLast.end });
    return morae;
  }
  return null;
}

export interface MoraMapEntry {
  /** [start, end) mora indices this character reads as (empty for punctuation). */
  moraStart: number;
  moraEnd: number;
  /** False for characters with no known reading (bare kanji/digits/latin) — timing across them can't be trusted. */
  readable: boolean;
}

/** What the client has of a sentence's kana reading; without ruby, only an all-kana sentence can be mapped. */
export interface SentenceReading {
  inlineReading?: string;
}

const KANA = /[ぁ-ゖァ-ヺー]/u;
const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/u;
const IGNORABLE = /[\p{P}\p{S}\p{Z}\p{Cc}]/u;

/**
 * Per-character mora ranges for `japanese`, or null when the sentence's ruby
 * reading doesn't spell out exactly the same text (then no per-character claim
 * is safe). A ruby base's characters all share the base's whole range — its
 * reading can't be split per kanji — so callers must treat a target that cuts
 * through one as unresolvable (see `resolveMoraRange`).
 */
export function buildMoraMap(japanese: string, reading: SentenceReading): MoraMapEntry[] | null {
  const source = reading.inlineReading?.trim() ? reading.inlineReading : japanese;
  const segments = parseInlineReadings(source);
  if (segments.map((s) => s.base).join('') !== japanese) return null;

  const map: MoraMapEntry[] = [];
  let mora = 0;
  for (const segment of segments) {
    if (segment.kind === 'ruby' && segment.reading) {
      const count = segmentIntoMorae(segment.reading).length;
      if (count === 0) return null;
      for (let i = 0; i < segment.base.length; i += 1) {
        map.push({ moraStart: mora, moraEnd: mora + count, readable: true });
      }
      mora += count;
      continue;
    }
    // Plain text: each kana is (part of) a mora; small kana fold into the previous one.
    for (const ch of segment.base) {
      const units = ch.length;
      let entry: MoraMapEntry;
      if (KANA.test(ch)) {
        if (SMALL_KANA.test(ch) && mora > 0) {
          entry = { moraStart: mora - 1, moraEnd: mora, readable: true };
        } else {
          entry = { moraStart: mora, moraEnd: mora + 1, readable: true };
          mora += 1;
        }
      } else {
        entry = { moraStart: mora, moraEnd: mora, readable: IGNORABLE.test(ch) };
      }
      for (let i = 0; i < units; i += 1) map.push(entry);
    }
  }
  return map.length === japanese.length ? map : null;
}

/**
 * The [start, end) mora range covered by raw characters [rawStart, rawEnd), or
 * null when it can't be pinned down: an unreadable character inside the range,
 * or a reading unit (ruby base) that straddles either edge.
 */
export function resolveMoraRange(
  map: MoraMapEntry[],
  rawStart: number,
  rawEnd: number,
): { start: number; end: number } | null {
  if (rawStart < 0 || rawEnd > map.length || rawStart >= rawEnd) return null;
  let start = Infinity;
  let end = -Infinity;
  for (let i = rawStart; i < rawEnd; i += 1) {
    const entry = map[i]!;
    if (!entry.readable) return null;
    if (entry.moraEnd === entry.moraStart) continue; // punctuation
    start = Math.min(start, entry.moraStart);
    end = Math.max(end, entry.moraEnd);
  }
  if (!Number.isFinite(start)) return null;
  // An edge cuts through a reading unit (a ruby base, or き+ゃ) when the characters
  // on either side of it read as the very same non-empty mora range.
  const sameUnit = (left: number, right: number) => {
    const a = map[left];
    const b = map[right];
    return !!a && !!b && a.moraEnd > a.moraStart && a.moraStart === b.moraStart && a.moraEnd === b.moraEnd;
  };
  if (sameUnit(rawStart - 1, rawStart) || sameUnit(rawEnd - 1, rawEnd)) return null;
  return { start, end };
}
