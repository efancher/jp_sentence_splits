import { describe, expect, it } from 'vitest';

import { AFTER_WORK_VOCAB_CURATED } from '../src/data/afterWorkVocabCurated';
import {
  curatedVocabForSourceKey,
  selectionFromCuratedPick,
  selectionsFromCuratedPicks,
} from '../src/lib/curatedVocabulary';
import { suggestionsFromTokens } from '../src/lib/vocabularySuggestions';

describe('curatedVocabulary', () => {
  it('resolves the After Work source key', () => {
    expect(
      curatedVocabForSourceKey('shadowing:source-FkX4A-ZLBrc')?.title,
    ).toContain('After Work');
  });

  it('maps おいくつ / 先輩 picks onto morphology suggestions', () => {
    const japanese = 'あの、し吾先輩っておいくつなんですか?';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'あの', start: 0, end: 2, lemma: 'あの', reading: 'あの', pos: '感動詞' },
      { surface: '、', start: 2, end: 3, lemma: '、', reading: '', pos: '補助記号' },
      { surface: 'し', start: 3, end: 4, lemma: 'する', reading: 'し', pos: '動詞' },
      { surface: '吾', start: 4, end: 5, lemma: '吾', reading: 'われ', pos: '代名詞' },
      { surface: '先輩', start: 5, end: 7, lemma: '先輩', reading: 'せんぱい', pos: '名詞' },
      { surface: 'って', start: 7, end: 9, lemma: 'って', reading: 'って', pos: '助詞' },
      { surface: 'お', start: 9, end: 10, lemma: 'お', reading: 'お', pos: '接頭辞' },
      { surface: 'いく', start: 10, end: 12, lemma: 'いく', reading: 'いく', pos: '名詞' },
      { surface: 'つ', start: 12, end: 13, lemma: 'つ', reading: 'つ', pos: '接尾辞' },
    ]);
    const picks = AFTER_WORK_VOCAB_CURATED[japanese]!;
    const selections = selectionsFromCuratedPicks(japanese, picks, suggestions);
    expect(selections.map((item) => item.expression).sort()).toEqual([
      'おいくつ',
      '先輩',
    ]);
  });

  it('falls back to manual spans when suggestions are missing', () => {
    const japanese = 'ため口になってんじゃん';
    const selection = selectionFromCuratedPick(
      japanese,
      {
        surface: 'ため口',
        start: 0,
        end: 3,
        expression: 'ため口',
        reading: 'ためぐち',
      },
      [],
    );
    expect(selection).toMatchObject({
      surface: 'ため口',
      expression: 'ため口',
      source: 'manual',
    });
  });
});
