import { describe, expect, it } from 'vitest';

import {
  fixNumeralsInInlineReading,
  fixNumeralsInReadingOnly,
} from '../src/lib/fixNumeralReadings';

describe('fixNumeralsInReadingOnly', () => {
  it('fuses digit + counter in a plain kana transcription', () => {
    expect(fixNumeralsInReadingOnly('それより2にんともいえどこなの?')).toBe(
      'それよりふたりともいえどこなの?',
    );
    expect(fixNumeralsInReadingOnly('はい、20さいです')).toBe('はい、はたちです');
    expect(fixNumeralsInReadingOnly('あのみせでもう1かげつもはたらいてるし')).toBe(
      'あのみせでもういっかげつもはたらいてるし',
    );
    expect(fixNumeralsInReadingOnly('あるいて5ふんくらい')).toBe('あるいてごふんくらい');
    expect(fixNumeralsInReadingOnly('こうこう3ねんせいのとき')).toBe(
      'こうこうさんねんせいのとき',
    );
    expect(fixNumeralsInReadingOnly('わたしは2にんの1つしただから')).toBe(
      'わたしはふたりのひとつしただから',
    );
  });

  it('leaves digit-free strings untouched', () => {
    expect(fixNumeralsInReadingOnly('なつかしいおもいでだな')).toBe(
      'なつかしいおもいでだな',
    );
  });
});

describe('fixNumeralsInInlineReading', () => {
  it('recomputes a mis-fused counter reading', () => {
    expect(fixNumeralsInInlineReading('それより2人[にん]とも家[いえ]どこなの?')).toBe(
      'それより2人[ふたり]とも家[いえ]どこなの?',
    );
    expect(fixNumeralsInInlineReading('あの店[みせ]でもう1ヶ月[かげつ]も働い[はたらい]てるし。')).toBe(
      'あの店[みせ]でもう1ヶ月[いっかげつ]も働い[はたらい]てるし。',
    );
    expect(fixNumeralsInInlineReading('高校[こうこう]3年[ねん]生[せい]の時[とき]')).toBe(
      '高校[こうこう]3年[さんねん]生[せい]の時[とき]',
    );
    expect(fixNumeralsInInlineReading('22歳[さい]だよ。')).toBe('22歳[にじゅうにさい]だよ。');
  });

  it('gives a bracket-less digit + counter its own ruby', () => {
    expect(fixNumeralsInInlineReading('電車[でんしゃ]で2つ先[さき]の駅[えき]。')).toBe(
      '電車[でんしゃ]で2つ[ふたつ]先[さき]の駅[えき]。',
    );
    expect(fixNumeralsInInlineReading('いや、私[わたし]は2人[にん]の1つ下[した]だから。')).toBe(
      'いや、私[わたし]は2人[ふたり]の1つ[ひとつ]下[した]だから。',
    );
  });

  it('leaves already-correct or unrelated markup alone', () => {
    expect(fixNumeralsInInlineReading('１[いち] 羽[わ]のひなが')).toBe('１[いち] 羽[わ]のひなが');
    expect(fixNumeralsInInlineReading('懐かしい[なつかしい]思い出[おもいで]だな。')).toBe(
      '懐かしい[なつかしい]思い出[おもいで]だな。',
    );
  });
});
