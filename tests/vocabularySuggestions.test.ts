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
    // na-adjectives (modern UniDic tags them 形状詞); not the そう/よう stems.
    expect(isContentPos('形状詞/一般')).toBe(true);
    expect(isContentPos('形状詞/助動詞語幹')).toBe(false);
    const defaults = defaultSelectionsFromSuggestions(suggestions, japanese);
    expect(defaults.map((item) => item.expression)).toEqual(['世話', 'する']);
  });

  it('does not default-select a 〜て auxiliary verb, but keeps the content verb', () => {
    const japanese = '毎日走っています。';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: '毎日', start: 0, end: 2, lemma: '毎日', reading: 'まいにち', pos: '名詞/普通名詞' },
      { surface: '走っ', start: 2, end: 4, lemma: '走る', reading: 'はしっ', pos: '動詞/一般' },
      { surface: 'て', start: 4, end: 5, lemma: 'て', reading: 'て', pos: '助詞/接続助詞' },
      { surface: 'い', start: 5, end: 6, lemma: 'いる', reading: 'い', pos: '動詞/非自立可能' },
      { surface: 'ます', start: 6, end: 8, lemma: 'ます', reading: 'ます', pos: '助動詞' },
      { surface: '。', start: 8, end: 9, lemma: '。', reading: '', pos: '補助記号/句点' },
    ]);
    const defaults = defaultSelectionsFromSuggestions(suggestions, japanese);
    expect(defaults.map((item) => item.expression)).toEqual(['毎日', '走る']);
    // The いる suggestion is still present, just not checked.
    expect(suggestions.find((s) => s.expression === 'いる')?.selectedByDefault).toBe(false);
  });

  it('does not default-select degree/discourse adverbs, keeps manner adverbs and 色々-adjacent content', () => {
    const japanese = '色々あって、やっぱりゆっくり休む。';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: '色々', start: 0, end: 2, lemma: '色々', reading: 'いろいろ', pos: '副詞' },
      { surface: 'あっ', start: 2, end: 4, lemma: '有る', reading: 'あっ', pos: '動詞/非自立可能' },
      { surface: 'て', start: 4, end: 5, lemma: 'て', reading: 'て', pos: '助詞/接続助詞' },
      { surface: '、', start: 5, end: 6, lemma: '、', reading: '', pos: '補助記号/読点' },
      { surface: 'やっぱり', start: 6, end: 10, lemma: '矢張り', reading: 'やっぱり', pos: '副詞' },
      { surface: 'ゆっくり', start: 10, end: 14, lemma: 'ゆっくり', reading: 'ゆっくり', pos: '副詞' },
      { surface: '休む', start: 14, end: 16, lemma: '休む', reading: 'やすむ', pos: '動詞/一般' },
      { surface: '。', start: 16, end: 17, lemma: '。', reading: '', pos: '補助記号/句点' },
    ]);
    const checked = suggestions.filter((s) => s.selectedByDefault).map((s) => s.expression);
    // 色々 / やっぱり dropped; ゆっくり (manner) and 有る / 休む kept.
    expect(checked).toEqual(['有る', 'ゆっくり', '休む']);
  });

  it('does not default-select a kana-written formal noun, but keeps a kanji-written one', () => {
    const kana = '本を読むつもりだ。';
    const kanaSuggestions = suggestionsFromTokens(kana, [
      { surface: '本', start: 0, end: 1, lemma: '本', reading: 'ほん', pos: '名詞/普通名詞' },
      { surface: 'を', start: 1, end: 2, lemma: 'を', reading: 'を', pos: '助詞/格助詞' },
      { surface: '読む', start: 2, end: 4, lemma: '読む', reading: 'よむ', pos: '動詞/一般' },
      { surface: 'つもり', start: 4, end: 7, lemma: 'つもり', reading: 'つもり', pos: '名詞/普通名詞' },
      { surface: 'だ', start: 7, end: 8, lemma: 'だ', reading: 'だ', pos: '助動詞' },
      { surface: '。', start: 8, end: 9, lemma: '。', reading: '', pos: '補助記号/句点' },
    ]);
    expect(
      kanaSuggestions.filter((s) => s.selectedByDefault).map((s) => s.expression),
    ).toEqual(['本', '読む']);

    const kanji = '大事な事を話す。';
    const kanjiSuggestions = suggestionsFromTokens(kanji, [
      { surface: '大事', start: 0, end: 2, lemma: '大事', reading: 'だいじ', pos: '形状詞/一般' },
      { surface: 'な', start: 2, end: 3, lemma: 'だ', reading: 'な', pos: '助動詞' },
      { surface: '事', start: 3, end: 4, lemma: '事', reading: 'こと', pos: '名詞/普通名詞' },
      { surface: 'を', start: 4, end: 5, lemma: 'を', reading: 'を', pos: '助詞/格助詞' },
      { surface: '話す', start: 5, end: 7, lemma: '話す', reading: 'はなす', pos: '動詞/一般' },
      { surface: '。', start: 7, end: 8, lemma: '。', reading: '', pos: '補助記号/句点' },
    ]);
    // 事 written with its kanji is taken at face value.
    expect(kanjiSuggestions.find((s) => s.surface === '事')?.selectedByDefault).toBe(true);
  });

  it('still default-selects a content verb that merely follows a comma-broken て', () => {
    const japanese = '歩いて、学ぶ。';
    const suggestions = suggestionsFromTokens(japanese, [
      { surface: '歩い', start: 0, end: 2, lemma: '歩く', reading: 'あるい', pos: '動詞/一般' },
      { surface: 'て', start: 2, end: 3, lemma: 'て', reading: 'て', pos: '助詞/接続助詞' },
      { surface: '、', start: 3, end: 4, lemma: '、', reading: '', pos: '補助記号/読点' },
      { surface: '学ぶ', start: 4, end: 6, lemma: '学ぶ', reading: 'まなぶ', pos: '動詞/一般' },
      { surface: '。', start: 6, end: 7, lemma: '。', reading: '', pos: '補助記号/句点' },
    ]);
    const defaults = defaultSelectionsFromSuggestions(suggestions, japanese);
    expect(defaults.map((item) => item.expression)).toEqual(['歩く', '学ぶ']);
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

    it('prefers the contextual surface reading over lemmaReading when surface === lemma (uninflected compound member)', () => {
      // 母 alone has kanaBase (lemmaReading) はは, but inside お母さん its
      // contextual reading is かあ — surface === lemma here (no inflection to
      // bridge), so lemmaReading must not override the tokenizer's own
      // in-context reading (card_issue_7a01be04: お母さん -> おははさん).
      const suggestion = suggestionFromToken(
        {
          surface: '母',
          start: 1,
          end: 2,
          lemma: '母',
          reading: 'かあ',
          lemmaReading: 'はは',
          pos: '名詞/普通名詞',
        },
        'お母さん',
      );
      expect(suggestion?.reading).toBe('かあ');
    });
  });
});
