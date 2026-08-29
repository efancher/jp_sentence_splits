import { describe, expect, it } from 'vitest';

import {
  buildResegmentPlan,
  distributeTranslation,
  overlapRatio,
  seedResegmentReview,
  type ResegmentOldSentence,
  type ResegmentReviewedSegment,
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
});
