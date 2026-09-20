import { describe, expect, it } from 'vitest';

import type { PhoneAlignment, WordAlignment } from '../src/domain/types';
import { segmentIntoMorae } from '../src/lib/mora';
import type { PitchAnalysisPayload, PitchFrame } from '../src/lib/pitch';
import { buildPhrasePitch, describeShape, groupIntoPhrases, phraseFeedback } from '../src/lib/phrasePitch';

/** A token whose morae are consecutive CV pairs of `moraMs` each, starting at `startMs`. */
function token(text: string, startMs: number, cvs: [string, string][], moraMs = 100): WordAlignment {
  const phones: PhoneAlignment[] = [];
  let t = startMs;
  for (const [c, v] of cvs) {
    phones.push({ text: c, start: t / 1000, end: (t + moraMs / 2) / 1000 });
    phones.push({ text: v, start: (t + moraMs / 2) / 1000, end: (t + moraMs) / 1000 });
    t += moraMs;
  }
  return { text, start: startMs / 1000, end: t / 1000, phones };
}

// はし|が|たかい|です — 3 + 5 morae in two phrases: [はしが] [たかいです]
const words = (moraMs = 100): WordAlignment[] => [
  token('はし', 0, [['h', 'a'], ['ɕ', 'i']], moraMs),
  token('が', 200, [['g', 'a']], moraMs),
  token('たかい', 300, [['t', 'a'], ['k', 'a'], ['k', 'i']], moraMs),
  token('です', 600, [['d', 'e'], ['s', 'ɨ']], moraMs),
];
const moraUnits = segmentIntoMorae('はしがたかいです');

/** Pitch at the given semitone level for each mora (100 ms each), voiced frames every 10 ms; `offset` shifts the clock. */
function pitchFor(levels: (number | null)[], offset = 0): PitchAnalysisPayload {
  const frames: PitchFrame[] = [];
  levels.forEach((level, i) => {
    for (let step = 0; step < 10; step += 1) {
      const timeSeconds = i * 0.1 + step * 0.01 + 0.005 - offset;
      frames.push(
        level === null
          ? { timeSeconds, hz: null, voiced: false, confidence: 0, relativeSemitones: null }
          : { timeSeconds, hz: 150, voiced: true, confidence: 1, relativeSemitones: level },
      );
    }
  });
  return { frames, medianHz: 150, voicedRatio: 1, durationSeconds: 0.8 };
}

//                 は  し  が   た  か  い  で  す
const NATIVE = pitchFor([0, 4, 4, 0, 4, 4, 0, 0]); // [はしが] = lhh (heiban), [たかいです] = lhhll

describe('groupIntoPhrases', () => {
  const tokens = [
    { text: '本', start: 0, end: 0.3 },
    { text: 'を', start: 0.3, end: 0.4 },
    { text: '読む', start: 0.4, end: 0.8 },
    { text: 'の', start: 1.3, end: 1.4 }, // a particle, but after a 0.5 s pause
  ];
  it('attaches particles and endings to the word before them, and starts a phrase at every content word', () => {
    expect(groupIntoPhrases(tokens.slice(0, 3))).toEqual([[0, 1], [2]]);
  });

  it('starts a new phrase at a pause, even for a particle', () => {
    expect(groupIntoPhrases(tokens)).toEqual([[0, 1], [2], [3]]);
  });

  it('treats an unknown token as its own phrase (splits too finely, never merges content words)', () => {
    expect(groupIntoPhrases([{ text: '猫', start: 0, end: 0.2 }, { text: '犬', start: 0.2, end: 0.4 }])).toEqual([[0], [1]]);
  });
});

describe('describeShape', () => {
  it('says how a phrase moves, naming the mora it falls after', () => {
    expect(describeShape(['l', 'h', 'h'], ['は', 'し', 'が'])).toBe('starts low, rises, and stays high');
    expect(describeShape(['h', 'l', 'l'], ['あ', 'め', 'が'])).toBe('starts high, then falls after あ');
    expect(describeShape(['l', 'h', 'h', 'l', 'l'], ['た', 'か', 'い', 'で', 'す'])).toBe('starts low, rises, then falls after い');
  });
});

describe('buildPhrasePitch', () => {
  it('fits each native phrase and compares yours: match, flat, different', () => {
    const learnerPitch = pitchFor([0, 4, 4, 2, 2.1, 1.9, 2, 2]); // phrase 1 matches; phrase 2 is flat
    const result = buildPhrasePitch({
      moraUnits,
      reference: { words: words(), pitch: NATIVE },
      learner: { words: words(), pitch: learnerPitch },
    });
    expect(result.unavailable).toBeUndefined();
    expect(result.learnerUnavailable).toBe(false);
    expect(result.rows.map((r) => r.text)).toEqual(['はしが', 'たかいです']);

    const [first, second] = result.rows;
    expect(first!.kana).toEqual(['は', 'し', 'が']);
    expect(first!.native.join('')).toBe('lhh');
    expect(first!.learner!.join('')).toBe('lhh');
    expect(first!.status).toBe('match');
    expect(phraseFeedback(first!)).toMatch(/Matches the native phrase/);

    expect(second!.native.join('')).toBe('lhhll');
    expect(second!.status).toBe('flat');
    expect(phraseFeedback(second!)).toBe('Your pitch is flat here. The native phrase starts low, rises, then falls after い.');
  });

  it('flags a different valid shape with plain words for both', () => {
    const learnerPitch = pitchFor([0, 4, 4, 0, 4, 4, 4, 4]); // phrase 2 stays high instead of dropping
    const result = buildPhrasePitch({
      moraUnits,
      reference: { words: words(), pitch: NATIVE },
      learner: { words: words(), pitch: learnerPitch },
    });
    const second = result.rows[1]!;
    expect(second.status).toBe('different');
    expect(second.learner!.join('')).toBe('lhhhh');
    expect(phraseFeedback(second)).toBe('Native: starts low, rises, then falls after い. You: starts low, rises, and stays high.');
  });

  it('returns each mora’s height within the phrase so the raw contour can be drawn beside the fitted H/L', () => {
    const result = buildPhrasePitch({ moraUnits, reference: { words: words(), pitch: NATIVE } });
    expect(result.rows[0]!.nativeLevels).toEqual([0, 1, 1]);
    expect(result.rows[1]!.nativeLevels).toEqual([0, 1, 1, 0, 0]);
    expect(result.rows[0]!.learner).toBeNull();
    expect(result.rows[0]!.status).toBe('no-learner');
  });

  it('reads reference pitch on the pitch clock when it was sliced to a practice range', () => {
    // The word timings are for the full clip (this sentence starts 1.0 s in); the pitch was extracted from the
    // sliced practice range, so its frames start at 0 — `pitchOffsetSeconds` bridges the two clocks.
    const fullClipWords = words().map((w) => ({ ...w, start: w.start + 1, end: w.end + 1, phones: w.phones.map((p) => ({ ...p, start: p.start + 1, end: p.end + 1 })) }));
    const result = buildPhrasePitch({
      moraUnits,
      reference: { words: fullClipWords, pitch: NATIVE, pitchOffsetSeconds: 1.0 },
    });
    // Without the offset the frames would be read a second late and nothing would be voiced there.
    expect(buildPhrasePitch({ moraUnits, reference: { words: fullClipWords, pitch: NATIVE } }).rows).toEqual([]);
    expect(result.rows.map((r) => r.native.join(''))).toEqual(['lhh', 'lhhll']);
  });

  it('says there is nothing to judge against when the native phrase itself is flat', () => {
    const result = buildPhrasePitch({
      moraUnits,
      reference: { words: words(), pitch: pitchFor([2, 2.1, 1.9, 2, 2, 2.1, 1.9, 2]) },
      learner: { words: words(), pitch: NATIVE },
    });
    expect(result.rows.every((r) => r.status === 'weak-native')).toBe(true);
  });

  it('reports the learner side unavailable — never guessed — when their phones do not add up to the reading', () => {
    const learnerWords = words();
    learnerWords[3] = token('です', 600, [['d', 'e']]); // one mora short: 7 vs 8
    const result = buildPhrasePitch({
      moraUnits,
      reference: { words: words(), pitch: NATIVE },
      learner: { words: learnerWords, pitch: NATIVE },
    });
    expect(result.learnerUnavailable).toBe(true);
    expect(result.rows.every((r) => r.status === 'no-learner')).toBe(true);
    expect(result.rows[0]!.native.join('')).toBe('lhh'); // the native side still shows
  });

  it('shows nothing when the reference cannot be lined up mora by mora', () => {
    const noPhones = words().map((w) => ({ ...w, phones: [] }));
    expect(buildPhrasePitch({ moraUnits, reference: { words: noPhones, pitch: NATIVE } })).toMatchObject({
      rows: [],
      unavailable: 'no-reference-timing',
    });
    expect(buildPhrasePitch({ moraUnits: [], reference: { words: words(), pitch: NATIVE } }).unavailable).toBe('no-reading');
  });

  it('skips one-mora phrases and phrases with no voiced native pitch', () => {
    const silent = pitchFor([null, null, null, 0, 4, 4, 0, 0]);
    const result = buildPhrasePitch({ moraUnits, reference: { words: words(), pitch: silent } });
    expect(result.rows.map((r) => r.text)).toEqual(['たかいです']); // [はしが] had nothing voiced
  });
});
