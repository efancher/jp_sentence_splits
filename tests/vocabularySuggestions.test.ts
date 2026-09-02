import { describe, expect, it } from 'vitest';

import {
  buildMorphStrip,
  canMergeSelections,
  canMergeSuggestionIntoSelection,
  combineSuggestions,
  combinedExpressionWarning,
  defaultSelectionsFromSuggestions,
  isContentPos,
  mergeSelections,
  mergeSuggestionIntoSelection,
  mergeVocabularySuggestions,
  selectionFromSuggestion,
  selectionNeedsMeaning,
  suggestionFromToken,
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

  it('combines tokens separated only by a readability space, keeping the space in surface', () => {
    // Some source sentences insert a space between clauses (e.g. before a
    // trailing auxiliary) even though there's no real token boundary there.
    const japanese = 'して あげるから';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'し', start: 0, end: 1, lemma: 'する', reading: 'し', pos: '動詞' },
      { surface: 'て', start: 1, end: 2, lemma: 'て', reading: 'て', pos: '助詞' },
      { surface: 'あげる', start: 3, end: 6, lemma: 'あげる', reading: 'あげる', pos: '動詞' },
      { surface: 'から', start: 6, end: 8, lemma: 'から', reading: 'から', pos: '助詞' },
    ]);
    const shite = combineSuggestions(suggestions.slice(0, 2), japanese)!;
    expect(shite.surface).toBe('して');

    const ageru = suggestions[2]!;
    expect(canMergeSuggestionIntoSelection(ageru, shite, japanese)).toBe(true);

    const shiteAsSuggestion = { ...suggestions[1]!, start: shite.start, end: shite.end, surface: shite.surface };
    const combined = combineSuggestions([shiteAsSuggestion, ageru], japanese);
    expect(combined).not.toBeNull();
    expect(combined!.surface).toBe('して あげる');
  });

  it('rejects merging across a real (non-whitespace) gap like punctuation', () => {
    const japanese = 'あの、先輩';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: 'あの', start: 0, end: 2, lemma: 'あの', reading: 'あの', pos: '感動詞' },
      { surface: '先輩', start: 3, end: 5, lemma: '先輩', reading: 'せんぱい', pos: '名詞' },
    ]);
    expect(combineSuggestions(suggestions, japanese)).toBeNull();
  });

  it('merges two selections separated only by whitespace', () => {
    const japanese = 'して あげるから';
    const shite = selectionFromSuggestion(
      suggestionsFromTokens(japanese, [
        { surface: 'して', start: 0, end: 2, lemma: 'する', reading: 'して', pos: '動詞' },
      ])[0]!,
    );
    const ageru = selectionFromSuggestion(
      suggestionsFromTokens(japanese, [
        { surface: 'あげる', start: 3, end: 6, lemma: 'あげる', reading: 'あげる', pos: '動詞' },
      ])[0]!,
    );
    expect(canMergeSelections(shite, ageru, japanese)).toBe(true);
    const merged = mergeSelections(ageru, shite, japanese);
    expect(merged?.surface).toBe('して あげる');
  });

  it('rejects invalid spans', () => {
    expect(validateSpan('abc', 0, 2, 'ab')).toBe(true);
    expect(validateSpan('abc', 0, 2, 'xx')).toBe(false);
  });

  describe('selectionNeedsMeaning', () => {
    it('expects a gloss on content words and POS-less manual additions', () => {
      expect(selectionNeedsMeaning('名詞/普通名詞')).toBe(true);
      expect(selectionNeedsMeaning('動詞/一般')).toBe(true);
      expect(selectionNeedsMeaning(undefined)).toBe(true);
      expect(selectionNeedsMeaning('')).toBe(true);
    });

    it('treats a gloss as optional for particles and auxiliaries', () => {
      expect(selectionNeedsMeaning('助詞/格助詞')).toBe(false);
      expect(selectionNeedsMeaning('助動詞')).toBe(false);
    });
  });

  describe('mergeVocabularySuggestions', () => {
    it('drops incoming suggestions whose offsets no longer match the kept sentence text', () => {
      const japanese = '穴が空いている木を見つけました。';
      const existing = suggestionsFromTokens(japanese, [
        { surface: '空い', start: 2, end: 4, lemma: '空く', reading: 'あい', pos: '動詞' },
      ]);
      // Tokenized against a slightly different (e.g. extra-space) copy of the
      // sentence, so these offsets are shifted relative to `japanese`.
      const incoming = suggestionsFromTokens('穴が 空いている木を見つけました。', [
        { surface: 'て', start: 5, end: 6, lemma: 'て', reading: 'て', pos: '助詞' },
      ]);
      const merged = mergeVocabularySuggestions(existing, incoming, japanese);
      expect(merged.map((item) => item.surface)).toEqual(['空い']);
    });

    it('keeps suggestions from both sides when offsets still match the kept text', () => {
      const japanese = '空いている木';
      const [a] = suggestionsFromTokens(japanese, [
        { surface: '空い', start: 0, end: 2, lemma: '空く', reading: 'あい', pos: '動詞' },
      ]);
      const [b] = suggestionsFromTokens(japanese, [
        { surface: 'て', start: 2, end: 3, lemma: 'て', reading: 'て', pos: '助詞' },
      ]);
      const merged = mergeVocabularySuggestions([a], [b], japanese);
      expect(merged.map((item) => item.surface)).toEqual(['空い', 'て']);
      expect(combineSuggestions(merged, japanese)?.surface).toBe('空いて');
    });
  });

  describe('combinedExpressionWarning', () => {
    it('warns when a combined selection includes a particle and auxiliary verb', () => {
      const japanese = 'やって来ました。';
      const suggestions = suggestionsFromTokens(japanese, [
        { surface: 'やっ', start: 0, end: 2, lemma: 'やる', reading: 'やっ', pos: '動詞' },
        { surface: 'て', start: 2, end: 3, lemma: 'て', reading: 'て', pos: '助詞' },
        { surface: '来', start: 3, end: 4, lemma: '来る', reading: 'き', pos: '動詞' },
        { surface: 'まし', start: 4, end: 6, lemma: 'ます', reading: 'まし', pos: '助動詞' },
        { surface: 'た', start: 6, end: 7, lemma: 'た', reading: 'た', pos: '助動詞' },
      ]);
      const combined = combineSuggestions(suggestions.slice(0, 5), japanese)!;
      const warning = combinedExpressionWarning(combined);
      expect(warning).toContain('particle');
      expect(warning).toContain('auxiliary verb');
    });

    it('does not warn on a combined selection made entirely of content words', () => {
      const japanese = '学校生活';
      const suggestions = suggestionsFromTokens(japanese, [
        { surface: '学校', start: 0, end: 2, lemma: '学校', reading: 'がっこう', pos: '名詞' },
        { surface: '生活', start: 2, end: 4, lemma: '生活', reading: 'せいかつ', pos: '名詞' },
      ]);
      const combined = combineSuggestions(suggestions, japanese)!;
      expect(combinedExpressionWarning(combined)).toBeNull();
    });

    it('does not warn on a non-combined (single-token) selection', () => {
      const suggestion = suggestionsFromTokens('て', [
        { surface: 'て', start: 0, end: 1, lemma: 'て', reading: 'て', pos: '助詞' },
      ])[0]!;
      const selection = selectionFromSuggestion(suggestion);
      expect(combinedExpressionWarning(selection)).toBeNull();
    });
  });

  describe('suggestionFromToken reading derivation', () => {
    const japanese = '見つけました';

    it('derives the dictionary reading when surface is a prefix of the lemma (ichidan る-drop)', () => {
      const suggestion = suggestionFromToken(
        { surface: '見つけ', start: 0, end: 3, lemma: '見つける', reading: 'みつけ', pos: '動詞' },
        japanese,
      );
      expect(suggestion?.expression).toBe('見つける');
      expect(suggestion?.reading).toBe('みつける');
    });

    it('derives the dictionary reading for a single-kanji ichidan stem (見る)', () => {
      const suggestion = suggestionFromToken(
        { surface: '見', start: 0, end: 1, lemma: '見る', reading: 'み', pos: '動詞' },
        '見た',
      );
      expect(suggestion?.expression).toBe('見る');
      expect(suggestion?.reading).toBe('みる');
    });

    it('leaves the surface reading untouched when surface is not a prefix of the lemma (godan stem change)', () => {
      const suggestion = suggestionFromToken(
        { surface: '話し', start: 0, end: 2, lemma: '話す', reading: 'はなし', pos: '動詞' },
        '話した',
      );
      expect(suggestion?.expression).toBe('話す');
      expect(suggestion?.reading).toBe('はなし');
    });

    it('does not derive a reading for 来る, whose reading changes irregularly across forms', () => {
      const suggestion = suggestionFromToken(
        { surface: '来', start: 0, end: 1, lemma: '来る', reading: 'き', pos: '動詞' },
        '来ました',
      );
      expect(suggestion?.expression).toBe('来る');
      expect(suggestion?.reading).toBe('き');
    });

    it('does not double-append the tail when the reading is already correct (idempotent rerun)', () => {
      const suggestion = suggestionFromToken(
        { surface: '見つけ', start: 0, end: 3, lemma: '見つける', reading: 'みつける', pos: '動詞' },
        japanese,
      );
      expect(suggestion?.reading).toBe('みつける');
    });

    it('leaves the reading as-is when the surface already equals the lemma', () => {
      const suggestion = suggestionFromToken(
        { surface: '先輩', start: 0, end: 2, lemma: '先輩', reading: 'せんぱい', pos: '名詞' },
        '先輩',
      );
      expect(suggestion?.reading).toBe('せんぱい');
    });

    it('recovers the dictionary reading from a godan っ-onbin stem (持つ)', () => {
      const suggestion = suggestionFromToken(
        { surface: '持っ', start: 0, end: 2, lemma: '持つ', reading: 'もっ', pos: '動詞' },
        '持って',
      );
      expect(suggestion?.expression).toBe('持つ');
      expect(suggestion?.reading).toBe('もつ');
    });

    it('recovers the dictionary reading from a godan ん-onbin stem (呼ぶ)', () => {
      const suggestion = suggestionFromToken(
        { surface: '呼ん', start: 0, end: 2, lemma: '呼ぶ', reading: 'よん', pos: '動詞' },
        '呼んだ',
      );
      expect(suggestion?.reading).toBe('よぶ');
    });

    it('recovers the dictionary reading from a kana godan っ-onbin stem (たつ)', () => {
      const suggestion = suggestionFromToken(
        { surface: 'たっ', start: 0, end: 2, lemma: 'たつ', reading: 'たっ', pos: '動詞' },
        'たった',
      );
      expect(suggestion?.reading).toBe('たつ');
    });

    it('does not touch a godan し-onbin stem (話す) — left for POS-aware lookup', () => {
      const suggestion = suggestionFromToken(
        { surface: '話し', start: 0, end: 2, lemma: '話す', reading: 'はなし', pos: '動詞' },
        '話して',
      );
      expect(suggestion?.reading).toBe('はなし');
    });

    it('uses the token lemmaReading verbatim when present, skipping derivation', () => {
      // し-onbin: derivation punts (keeps はなし); lemmaReading has the answer.
      const suggestion = suggestionFromToken(
        {
          surface: '話し',
          start: 0,
          end: 2,
          lemma: '話す',
          reading: 'はなし',
          lemmaReading: 'はなす',
          pos: '動詞',
        },
        '話して',
      );
      expect(suggestion?.expression).toBe('話す');
      expect(suggestion?.reading).toBe('はなす');
    });

    it('falls back to derivation when lemmaReading is blank', () => {
      const suggestion = suggestionFromToken(
        {
          surface: '見つけ',
          start: 0,
          end: 3,
          lemma: '見つける',
          reading: 'みつけ',
          lemmaReading: '',
          pos: '動詞',
        },
        japanese,
      );
      expect(suggestion?.reading).toBe('みつける');
    });
  });
});
