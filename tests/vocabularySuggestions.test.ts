import { describe, expect, it } from 'vitest';

import {
  buildMorphStrip,
  canMergeSuggestionIntoSelection,
  combineSuggestions,
  defaultSelectionsFromSuggestions,
  isContentPos,
  mergeSuggestionIntoSelection,
  selectionFromSuggestion,
  suggestionsFromTokens,
  validateSpan,
} from '../src/lib/vocabularySuggestions';

describe('vocabularySuggestions', () => {
  it('builds suggestions and marks content POS selected by default', () => {
    const japanese = '世話をしました。';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: '世話', start: 0, end: 2, lemma: '世話', reading: 'せわ', pos: '名詞/普通名詞' },
      { surface: 'を', start: 2, end: 3, lemma: 'を', reading: 'を', pos: '助詞/格助詞' },
      { surface: 'し', start: 3, end: 4, lemma: 'する', reading: 'し', pos: '動詞/非自立可能' },
      { surface: 'まし', start: 4, end: 6, lemma: 'ます', reading: 'まし', pos: '助動詞' },
      { surface: 'た', start: 6, end: 7, lemma: 'た', reading: 'た', pos: '助動詞' },
      { surface: '。', start: 7, end: 8, lemma: '。', reading: '', pos: '補助記号/句点' },
    ]);
    expect(suggestions.map((item) => item.expression)).toEqual([
      '世話',
      'を',
      'する',
      'ます',
      'た',
      '。',
    ]);
    expect(isContentPos('動詞/非自立可能')).toBe(true);
    expect(isContentPos('助詞/格助詞')).toBe(false);
    const defaults = defaultSelectionsFromSuggestions(suggestions, japanese);
    expect(defaults.map((item) => item.expression)).toEqual(['世話', 'する']);
  });

  it('builds a contiguous morph strip with gaps filled', () => {
    const japanese = 'あの、先輩';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'あの', start: 0, end: 2, lemma: 'あの', reading: 'あの', pos: '感動詞' },
      { surface: '先輩', start: 3, end: 5, lemma: '先輩', reading: 'せんぱい', pos: '名詞' },
    ]);
    const strip = buildMorphStrip(japanese, suggestions);
    expect(
      strip.map((piece) =>
        piece.kind === 'token' ? piece.suggestion.surface : piece.surface,
      ),
    ).toEqual(['あの', '、', '先輩']);
    expect(strip[1]).toMatchObject({ kind: 'gap', start: 2, end: 3 });
  });

  it('rejects combining non-adjacent tokens', () => {
    const japanese = 'あの先輩';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'あの', start: 0, end: 2, lemma: 'あの', reading: 'あの', pos: '感動詞' },
      { surface: '先輩', start: 2, end: 4, lemma: '先輩', reading: 'せんぱい', pos: '名詞' },
    ]);
    expect(combineSuggestions(suggestions.slice(0, 1), japanese)).toBeNull();
  });

  it('combines adjacent tokens for やって来る', () => {
    const japanese = 'やって来ました。';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'やっ', start: 0, end: 2, lemma: 'やる', reading: 'やっ', pos: '動詞' },
      { surface: 'て', start: 2, end: 3, lemma: 'て', reading: 'て', pos: '助詞' },
      { surface: '来', start: 3, end: 4, lemma: '来る', reading: 'き', pos: '動詞' },
      { surface: 'まし', start: 4, end: 6, lemma: 'ます', reading: 'まし', pos: '助動詞' },
      { surface: 'た', start: 6, end: 7, lemma: 'た', reading: 'た', pos: '助動詞' },
    ]);
    const combined = combineSuggestions(suggestions.slice(0, 5), japanese);
    expect(combined).not.toBeNull();
    expect(combined!.surface).toBe('やって来ました');
    expect(combined!.expression).toBe('やるて来るますた');
    expect(validateSpan(japanese, combined!.start, combined!.end, combined!.surface)).toBe(
      true,
    );
  });

  it('merges an adjacent suggestion into a selection', () => {
    const japanese = 'やって来ました。';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'やっ', start: 0, end: 2, lemma: 'やる', reading: 'やっ', pos: '動詞' },
      { surface: 'て', start: 2, end: 3, lemma: 'て', reading: 'て', pos: '助詞' },
      { surface: '来', start: 3, end: 4, lemma: '来る', reading: 'き', pos: '動詞' },
      { surface: 'まし', start: 4, end: 6, lemma: 'ます', reading: 'まし', pos: '助動詞' },
    ]);
    const te = selectionFromSuggestion(suggestions[1]!);
    expect(canMergeSuggestionIntoSelection(suggestions[0]!, te, japanese)).toBe(
      true,
    );
    expect(canMergeSuggestionIntoSelection(suggestions[2]!, te, japanese)).toBe(
      true,
    );
    expect(canMergeSuggestionIntoSelection(suggestions[3]!, te, japanese)).toBe(
      false,
    );

    const withYatte = mergeSuggestionIntoSelection(suggestions[0]!, te, japanese);
    expect(withYatte).not.toBeNull();
    expect(withYatte!.id).toBe(te.id);
    expect(withYatte!.surface).toBe('やって');
    expect(withYatte!.expression).toBe('やるて');
    expect(withYatte!.source).toBe('combined');

    const withKur = mergeSuggestionIntoSelection(
      suggestions[2]!,
      withYatte!,
      japanese,
    );
    expect(withKur!.surface).toBe('やって来');
    expect(withKur!.expression).toBe('やるて来る');
  });

  it('treats already-covered merge as a no-op', () => {
    const japanese = 'やって';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'やっ', start: 0, end: 2, lemma: 'やる', reading: 'やっ', pos: '動詞' },
      { surface: 'て', start: 2, end: 3, lemma: 'て', reading: 'て', pos: '助詞' },
    ]);
    const combined = combineSuggestions(suggestions, japanese)!;
    const again = mergeSuggestionIntoSelection(
      suggestions[0]!,
      combined,
      japanese,
    );
    expect(again).toBe(combined);
  });

  it('rejects invalid spans', () => {
    expect(validateSpan('abc', 0, 2, 'ab')).toBe(true);
    expect(validateSpan('abc', 0, 2, 'xx')).toBe(false);
  });
});
