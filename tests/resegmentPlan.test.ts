import { describe, expect, it } from 'vitest';

import {
  buildMiningRealignGroups,
  buildRealignGroups,
  buildResegmentPlan,
  concatCut,
  distributeTranslation,
  joinJapanese,
  mergeReviewRowUp,
  moveRowEdge,
  overlapRatio,
  removeReviewRow,
  seedResegmentReview,
  setRowBoundary,
  snapBoundariesToSilences,
  splitReviewRow,
  type ResegmentOldSentence,
  type ResegmentReviewedSegment,
  type ResegmentReviewRow,
} from '../src/lib/resegmentPlan';

const seg = (japanese: string, translation = ''): ResegmentReviewedSegment => ({
  japanese,
  translation,
  readingOnly: '',
  inlineReading: '',
  tokens: [],
});

const old = (
  id: string,
  japanese: string,
  studyItems: ResegmentOldSentence['studyItems'] = [],
  translation = '',
): ResegmentOldSentence => ({ id, japanese, translation, studyItems });

const si = (id: string, activityType: string, reviewCount = 0, fsrsReps = 0) => ({
  id,
  activityType,
  reviewCount,
  fsrsReps,
});

describe('overlapRatio', () => {
  it('clears the threshold when a fragment sits inside its merged sentence', () => {
    expect(overlapRatio('水希。たったの', 'たったの1ヶ月だよ。')).toBeGreaterThan(0.6);
  });
  it('is ~1 when a new sentence is one half of an old bundled cue', () => {
    expect(overlapRatio('たったの1ヶ月。1ヶ月たったってなんだよ。', '1ヶ月たったってなんだよ。')).toBeGreaterThan(0.9);
  });
  it('is low for unrelated sentences', () => {
    expect(overlapRatio('警察官です。', 'すごい偶然かな。')).toBeLessThan(0.6);
  });
});

describe('buildResegmentPlan', () => {
  it('migrates a fragment pair onto the merged sentence', () => {
    const olds = [
      old('sent_a', 'さすがです。水希。たったの', [si('study_1', 'comprehension', 5)]),
      old('sent_b', '1ヶ月だよ。私たちと変わんないじゃん。', [si('study_2', 'comprehension', 2)]),
    ];
    const segments = [seg('さすがです。'), seg('水希。'), seg('たったの1ヶ月だよ。'), seg('私たちと変わんないじゃん。')];
    const plan = buildResegmentPlan(olds, segments);

    // sent_a is mostly "さすがです。水希" so its history follows the first piece
    // (index 0); sent_b overlaps "私たちと変わんないじゃん。" (index 3) best.
    const move1 = plan.studyItemMoves.find((m) => m.studyItemId === 'study_1');
    const move2 = plan.studyItemMoves.find((m) => m.studyItemId === 'study_2');
    expect(move1?.targetIndex).toBe(0);
    expect(move2?.targetIndex).toBe(3);
    expect(plan.migratedCardCount).toBe(2);
    expect(plan.freshCardCount).toBe(0);
    expect(plan.retiredSentenceIds).toEqual(['sent_a', 'sent_b']);
  });

  it('keeps the more-reviewed card on an activity-type collision', () => {
    const olds = [
      old('sent_a', 'たったの1ヶ月。1', [si('study_hi', 'comprehension', 17)]),
      old('sent_b', 'ヶ月たったってなんだよ。', [si('study_lo', 'comprehension', 3)]),
    ];
    // Both old sentences collapse into one merged sentence.
    const segments = [seg('たったの1ヶ月。1ヶ月たったってなんだよ。')];
    const plan = buildResegmentPlan(olds, segments);

    const hi = plan.studyItemMoves.find((m) => m.studyItemId === 'study_hi');
    const lo = plan.studyItemMoves.find((m) => m.studyItemId === 'study_lo');
    expect(hi?.targetIndex).toBe(0);
    expect(lo?.targetIndex).toBeNull();
    expect(plan.migratedCardCount).toBe(1);
    expect(plan.freshCardCount).toBe(1);
  });

  it('retires study items with no good target', () => {
    const olds = [old('sent_x', '全然関係ない文です。', [si('study_x', 'listening', 4)])];
    const plan = buildResegmentPlan(olds, [seg('こんにちは。'), seg('元気ですか。')]);
    expect(plan.studyItemMoves[0]?.targetIndex).toBeNull();
    expect(plan.migratedCardCount).toBe(0);
  });

  it('does not collide cards of different activity types on the same target', () => {
    const olds = [
      old('sent_a', 'たったの1ヶ月。1', [
        si('study_c', 'comprehension', 5),
        si('study_r', 'reading_in_context', 5),
      ]),
      old('sent_b', 'ヶ月たったってなんだよ。', [si('study_c2', 'comprehension', 9)]),
    ];
    const plan = buildResegmentPlan(olds, [seg('たったの1ヶ月。1ヶ月たったってなんだよ。')]);
    expect(plan.studyItemMoves.find((m) => m.studyItemId === 'study_r')?.targetIndex).toBe(0);
    expect(plan.studyItemMoves.find((m) => m.studyItemId === 'study_c2')?.targetIndex).toBe(0);
    expect(plan.studyItemMoves.find((m) => m.studyItemId === 'study_c')?.targetIndex).toBeNull();
  });
});

describe('distributeTranslation', () => {
  it('assigns one English sentence per piece when counts match', () => {
    expect(distributeTranslation('A. B? C!', 3)).toEqual(['A.', 'B?', 'C!']);
  });
  it('dumps everything on the first piece when the counts do not line up', () => {
    expect(distributeTranslation('Only this.', 3)).toEqual(['Only this.', '', '']);
    expect(distributeTranslation('A. B. C. D.', 2)).toEqual(['A. B. C. D.', '']);
  });
});

describe('buildRealignGroups', () => {
  it('groups consecutive rows by shared provenance and maps each row back', () => {
    const old = [
      { japanese: 'A。B。', translation: 'Ay. Bee.' },
      { japanese: 'C。', translation: 'See.' },
    ];
    const rows = [
      { japanese: 'A。', sourceIndexes: [0] },
      { japanese: 'B。', sourceIndexes: [0] },
      { japanese: 'C。', sourceIndexes: [1] },
    ];
    const { groups, assignments } = buildRealignGroups(rows, old);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      originalJapanese: 'A。B。',
      originalTranslation: 'Ay. Bee.',
      pieces: ['A。', 'B。'],
    });
    expect(groups[1]!.pieces).toEqual(['C。']);
    expect(assignments).toEqual([
      { groupIndex: 0, rank: 0 },
      { groupIndex: 0, rank: 1 },
      { groupIndex: 1, rank: 0 },
    ]);
  });

  it('joins the originals of a merged run', () => {
    const old = [
      { japanese: 'X', translation: 'Ex.' },
      { japanese: 'Y', translation: 'Why.' },
    ];
    const rows = [
      { japanese: 'XY一。', sourceIndexes: [0, 1] },
      { japanese: 'XY二。', sourceIndexes: [0, 1] },
    ];
    const { groups } = buildRealignGroups(rows, old);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      originalJapanese: 'XY',
      originalTranslation: 'Ex. Why.',
      pieces: ['XY一。', 'XY二。'],
    });
  });
});

describe('buildMiningRealignGroups', () => {
  it('takes original text/translation from the rows themselves', () => {
    const rows = [
      { japanese: 'ねこ。', translation: 'Cat.', sourceIndexes: [0] },
      { japanese: 'いぬ。', translation: 'Dog.', sourceIndexes: [0] },
      { japanese: 'とり。', translation: 'Bird.', sourceIndexes: [1] },
    ];
    const { groups, assignments } = buildMiningRealignGroups(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      originalJapanese: 'ねこ。いぬ。',
      originalTranslation: 'Cat. Dog.',
      pieces: ['ねこ。', 'いぬ。'],
    });
    expect(groups[1]!.originalTranslation).toBe('Bird.');
    expect(assignments[2]).toEqual({ groupIndex: 1, rank: 0 });
  });
});

describe('seedResegmentReview', () => {
  it('inherits a single source translation and does not flag it', () => {
    const rows = seedResegmentReview(
      [{ translation: 'Only one month?' }],
      [{ japanese: 'たったの1ヶ月。', sourceIndexes: [0] }],
    );
    expect(rows[0]).toMatchObject({ translation: 'Only one month?', needsTranslationReview: false });
  });

  it('joins distinct source translations and flags for review', () => {
    const rows = seedResegmentReview(
      [{ translation: 'A.' }, { translation: 'B.' }],
      [{ japanese: 'AB。', sourceIndexes: [0, 1] }],
    );
    expect(rows[0]!.translation).toBe('A. B.');
    expect(rows[0]!.needsTranslationReview).toBe(true);
  });

  it('flags an empty translation for review', () => {
    const rows = seedResegmentReview(
      [{ translation: '' }],
      [{ japanese: 'なにか。', sourceIndexes: [0] }],
    );
    expect(rows[0]!.needsTranslationReview).toBe(true);
  });

  it('spreads a bundled translation across the pieces of a pure split', () => {
    const rows = seedResegmentReview(
      [{ translation: 'Yeah. It is okay to stop being polite? Right, Mizuki?' }],
      [
        { japanese: 'うん。', sourceIndexes: [0] },
        { japanese: '敬語じゃなくてもいい?', sourceIndexes: [0] },
        { japanese: '水希。', sourceIndexes: [0] },
      ],
    );
    expect(rows.map((r) => r.translation)).toEqual([
      'Yeah.',
      'It is okay to stop being polite?',
      'Right, Mizuki?',
    ]);
    expect(rows.every((r) => r.needsTranslationReview)).toBe(true);
  });

  it('distributes a merged run of fragments across its split pieces', () => {
    // Originals 0,1,2 were each cut off mid-sentence, merged, then re-split
    // into 3 clean sentences — every piece carries the same [0,1,2] provenance.
    const rows = seedResegmentReview(
      [{ translation: 'No, younger.' }, { translation: 'Only one.' }, { translation: 'Casual is fine.' }],
      [
        { japanese: 'いや、私は下だから。', sourceIndexes: [0, 1, 2] },
        { japanese: 'たったの1つじゃん。', sourceIndexes: [0, 1, 2] },
        { japanese: 'いいでしょ。', sourceIndexes: [0, 1, 2] },
      ],
    );
    expect(rows.map((r) => r.translation)).toEqual([
      'No, younger.',
      'Only one.',
      'Casual is fine.',
    ]);
    expect(rows.every((r) => r.needsTranslationReview)).toBe(true);
  });

  it('puts everything on the first piece of a split when the counts do not line up', () => {
    const rows = seedResegmentReview(
      [{ translation: 'No, younger.' }, { translation: 'Only one year, and casual is fine.' }],
      [
        { japanese: 'いや、私は下だから。', sourceIndexes: [0, 1] },
        { japanese: 'たったの1つじゃん。', sourceIndexes: [0, 1] },
        { japanese: 'いいでしょ。', sourceIndexes: [0, 1] },
      ],
    );
    expect(rows[0]!.translation).toBe('No, younger. Only one year, and casual is fine.');
    expect(rows.slice(1).every((r) => r.translation === '')).toBe(true);
  });

  it('never pastes the same full translation onto more than one split piece', () => {
    const rows = seedResegmentReview(
      [{ translation: 'Yeah, we are the same age. Is it okay to stop being polite, Mizuki?' }],
      [
        { japanese: 'うん。', sourceIndexes: [0] },
        { japanese: '同い年です。', sourceIndexes: [0] },
        { japanese: '水希。', sourceIndexes: [0] },
      ],
    );
    const nonEmpty = rows.map((r) => r.translation).filter(Boolean);
    expect(new Set(nonEmpty).size).toBe(nonEmpty.length);
    expect(rows.every((r) => r.needsTranslationReview)).toBe(true);
    // the whole old translation is still available as a hint
    expect(rows[2]!.sourceTranslations[0]).toContain('Mizuki');
  });

  it('carries cue timings onto the review rows', () => {
    const rows = seedResegmentReview(
      [{ translation: '' }],
      [
        { japanese: 'A。', sourceIndexes: [0], startMs: 1000, endMs: 2000 },
        { japanese: 'B。', sourceIndexes: [0], startMs: 2000, endMs: 3000 },
      ],
    );
    expect(rows.map((r) => [r.startMs, r.endMs])).toEqual([
      [1000, 2000],
      [2000, 3000],
    ]);
  });
});

describe('concatCut', () => {
  const clip = (startMs: number, endMs: number) => ({
    startMs,
    endMs,
    durationMs: endMs - startMs,
  });

  it('maps a range inside one clip to a file offset', () => {
    expect(concatCut(1500, 2500, [clip(1000, 4000)])).toEqual({
      startMs: 500,
      endMs: 1500,
    });
  });

  it('clamps a range that starts before / ends after the clips', () => {
    expect(concatCut(0, 9999, [clip(1000, 4000)])).toEqual({
      startMs: 0,
      endMs: 3000,
    });
  });

  it('walks across concatenated clips', () => {
    // clip A [1000,3000] -> file [0,2000]; clip B [3000,5000] -> file [2000,4000]
    expect(concatCut(2000, 4000, [clip(1000, 3000), clip(3000, 5000)])).toEqual({
      startMs: 1000,
      endMs: 3000,
    });
  });
});

describe('review-row editing helpers', () => {
  const row = (over: Partial<ResegmentReviewRow> = {}): ResegmentReviewRow => ({
    japanese: 'あいうえお。',
    translation: 'Vowels.',
    readingOnly: '',
    inlineReading: '',
    tokens: [],
    sourceIndexes: [0],
    startMs: 0,
    endMs: 1000,
    sourceTranslations: ['Vowels.'],
    needsTranslationReview: false,
    ...over,
  });

  describe('joinJapanese', () => {
    it('omits the space between CJK, keeps it otherwise', () => {
      expect(joinJapanese('あい', 'うえ')).toBe('あいうえ');
      expect(joinJapanese('ok', 'go')).toBe('ok go');
      expect(joinJapanese('', 'x')).toBe('x');
    });
  });

  describe('mergeReviewRowUp', () => {
    it('folds a row into its predecessor and flags the result', () => {
      const rows = [
        row({ japanese: 'A。', translation: 'a', sourceIndexes: [0], startMs: 0, endMs: 500, sourceTranslations: ['a'] }),
        row({ japanese: 'B。', translation: 'b', sourceIndexes: [1], startMs: 500, endMs: 900, sourceTranslations: ['b'] }),
      ];
      const merged = mergeReviewRowUp(rows, 1);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({
        japanese: 'A。B。',
        translation: 'a b',
        sourceIndexes: [0, 1],
        startMs: 0,
        endMs: 900,
        needsTranslationReview: true,
      });
    });

    it('is a no-op at index 0 or out of range', () => {
      const rows = [row(), row()];
      expect(mergeReviewRowUp(rows, 0)).toBe(rows);
      expect(mergeReviewRowUp(rows, 5)).toBe(rows);
    });
  });

  describe('splitReviewRow', () => {
    it('splits on internal sentence-enders and divides the span by length', () => {
      const out = splitReviewRow(
        [row({ japanese: 'ねこ。いぬ。', translation: 'Cat. Dog.', startMs: 0, endMs: 900 })],
        0,
      );
      expect(out.map((r) => r.japanese)).toEqual(['ねこ。', 'いぬ。']);
      expect(out.map((r) => r.translation)).toEqual(['Cat.', 'Dog.']);
      expect(out[0]!.startMs).toBe(0);
      expect(out[0]!.endMs).toBe(out[1]!.startMs);
      expect(out[1]!.endMs).toBe(900);
      expect(out.every((r) => r.needsTranslationReview)).toBe(true);
    });

    it('is a no-op when there is nothing to split', () => {
      const rows = [row({ japanese: 'ねこだけ。' })];
      expect(splitReviewRow(rows, 0)).toBe(rows);
    });
  });

  describe('removeReviewRow', () => {
    it('drops the row but never the last one', () => {
      expect(removeReviewRow([row(), row(), row()], 1)).toHaveLength(2);
      const one = [row()];
      expect(removeReviewRow(one, 0)).toBe(one);
    });
  });

  describe('setRowBoundary', () => {
    const pair = () => [
      row({ startMs: 0, endMs: 1000 }),
      row({ startMs: 1000, endMs: 2000 }),
    ];

    it('moves both sides of the shared edge and flags them', () => {
      const out = setRowBoundary(pair(), 1, 1300);
      expect(out[0]).toMatchObject({ endMs: 1300, needsTranslationReview: true });
      expect(out[1]).toMatchObject({ startMs: 1300, needsTranslationReview: true });
    });

    it('clamps so neither row collapses', () => {
      expect(setRowBoundary(pair(), 1, -50)[0]!.endMs).toBe(1);
      expect(setRowBoundary(pair(), 1, 99999)[1]!.startMs).toBe(1999);
    });

    it('is a no-op at the ends or when unchanged', () => {
      const rows = pair();
      expect(setRowBoundary(rows, 0, 500)).toBe(rows);
      expect(setRowBoundary(rows, 2, 500)).toBe(rows);
      expect(setRowBoundary(rows, 1, 1000)).toBe(rows);
    });
  });

  describe('moveRowEdge', () => {
    const trio = () => [
      row({ startMs: 1000, endMs: 2000 }),
      row({ startMs: 2000, endMs: 3000 }),
      row({ startMs: 3000, endMs: 4000 }),
    ];

    it('moves an internal edge as the shared boundary (both rows)', () => {
      const out = moveRowEdge(trio(), 1, 'start', 2200);
      expect(out[0]).toMatchObject({ endMs: 2200 });
      expect(out[1]).toMatchObject({ startMs: 2200 });
      const out2 = moveRowEdge(trio(), 1, 'end', 2800);
      expect(out2[1]).toMatchObject({ endMs: 2800 });
      expect(out2[2]).toMatchObject({ startMs: 2800 });
    });

    it('moves the first row start alone, clamped to 0', () => {
      const out = moveRowEdge(trio(), 0, 'start', 300);
      expect(out[0]).toMatchObject({ startMs: 300, needsTranslationReview: true });
      expect(out[1]!.startMs).toBe(2000); // untouched
      expect(moveRowEdge(trio(), 0, 'start', -500)[0]!.startMs).toBe(0);
    });

    it('moves the last row end alone', () => {
      const out = moveRowEdge(trio(), 2, 'end', 4600);
      expect(out[2]).toMatchObject({ endMs: 4600, needsTranslationReview: true });
      expect(out[1]!.endMs).toBe(3000);
    });

    it('clamps an outer edge so the row cannot collapse, and no-ops when unchanged', () => {
      expect(moveRowEdge(trio(), 0, 'start', 99999)[0]!.startMs).toBe(1999);
      const rows = trio();
      expect(moveRowEdge(rows, 0, 'start', 1000)).toBe(rows);
      expect(moveRowEdge(rows, 5, 'start', 0)).toBe(rows);
    });
  });

  describe('snapBoundariesToSilences', () => {
    it('pulls each boundary onto the nearest pause within range', () => {
      const rows = [
        row({ startMs: 0, endMs: 1000 }),
        row({ startMs: 1000, endMs: 2000 }),
        row({ startMs: 2000, endMs: 3000 }),
      ];
      const out = snapBoundariesToSilences(rows, [1120, 2450], 400);
      expect(out[0]!.endMs).toBe(1120);
      expect(out[1]!.startMs).toBe(1120);
      expect(out[1]!.endMs).toBe(2000); // 2450 is >400ms away, left alone
    });

    it('returns the same array when nothing is close enough', () => {
      const rows = [row({ startMs: 0, endMs: 1000 }), row({ startMs: 1000, endMs: 2000 })];
      expect(snapBoundariesToSilences(rows, [50], 100)).toBe(rows);
    });
  });
});
