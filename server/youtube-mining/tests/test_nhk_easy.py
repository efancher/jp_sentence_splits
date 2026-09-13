from app.nhk_easy import (
    NhkEasySentence,
    assign_sentence_spans,
    parse_nhkeasier_description,
)

# Real shadowing-analysis-api `POST /align` response, fetched live 2026-09-13
# by aligning story 9952's real narration mp3 against its real transcript
# (not synthesized) — timestamps in seconds, rounded to 2 decimals.
REAL_ALIGN_WORDS = [
    {"start": 0.0, "end": 1.09, "text": "<eps>"}, {"start": 1.09, "end": 1.32, "text": "<unk>"},
    {"start": 1.32, "end": 1.62, "text": "も"}, {"start": 1.62, "end": 1.7, "text": "<eps>"},
    {"start": 1.7, "end": 2.44, "text": "本州"}, {"start": 2.44, "end": 2.62, "text": "の"},
    {"start": 2.62, "end": 3.4, "text": "太平洋"}, {"start": 3.4, "end": 3.64, "text": "側"},
    {"start": 3.64, "end": 3.89, "text": "など"}, {"start": 3.89, "end": 4.13, "text": "で"},
    {"start": 4.13, "end": 4.33, "text": "<eps>"}, {"start": 4.33, "end": 4.62, "text": "雨"},
    {"start": 4.62, "end": 4.76, "text": "が"}, {"start": 4.76, "end": 5.45, "text": "降りました"},
    {"start": 5.45, "end": 7.62, "text": "<eps>"}, {"start": 7.62, "end": 8.15, "text": "気象庁"},
    {"start": 8.15, "end": 8.27, "text": "に"}, {"start": 8.27, "end": 8.47, "text": "よる"},
    {"start": 8.47, "end": 8.79, "text": "と"}, {"start": 8.79, "end": 9.19, "text": "<eps>"},
    {"start": 9.19, "end": 9.41, "text": "これ"}, {"start": 9.41, "end": 9.69, "text": "から"},
    {"start": 9.69, "end": 9.93, "text": "も"}, {"start": 9.93, "end": 10.32, "text": "<eps>"},
    {"start": 10.32, "end": 11.08, "text": "しばらく"}, {"start": 11.08, "end": 11.3, "text": "雨"},
    {"start": 11.3, "end": 11.44, "text": "が"}, {"start": 11.44, "end": 11.72, "text": "降り"},
    {"start": 11.72, "end": 12.15, "text": "やすい"}, {"start": 12.15, "end": 12.53, "text": "天気"},
    {"start": 12.53, "end": 12.72, "text": "が"}, {"start": 12.72, "end": 13.34, "text": "続きそう"},
    {"start": 13.34, "end": 13.76, "text": "です"}, {"start": 13.76, "end": 16.29, "text": "<eps>"},
    {"start": 16.29, "end": 16.51, "text": "今"}, {"start": 16.51, "end": 16.8, "text": "まで"},
    {"start": 16.8, "end": 17.04, "text": "に"}, {"start": 17.04, "end": 17.07, "text": "<eps>"},
    {"start": 17.07, "end": 17.35, "text": "雨"}, {"start": 17.35, "end": 17.49, "text": "が"},
    {"start": 17.49, "end": 18.02, "text": "たくさん"}, {"start": 18.02, "end": 18.41, "text": "降った"},
    {"start": 18.41, "end": 18.76, "text": "所"}, {"start": 18.76, "end": 19.13, "text": "では"},
    {"start": 19.13, "end": 19.74, "text": "<eps>"}, {"start": 19.74, "end": 20.07, "text": "山"},
    {"start": 20.07, "end": 20.29, "text": "が"}, {"start": 20.29, "end": 20.71, "text": "崩れ"},
    {"start": 20.71, "end": 21.06, "text": "やすく"}, {"start": 21.06, "end": 21.35, "text": "なって"},
    {"start": 21.35, "end": 21.8, "text": "います"}, {"start": 21.8, "end": 23.32, "text": "<eps>"},
    {"start": 23.32, "end": 23.94, "text": "少ない"}, {"start": 23.94, "end": 24.15, "text": "雨"},
    {"start": 24.15, "end": 24.59, "text": "でも"}, {"start": 24.59, "end": 24.63, "text": "<eps>"},
    {"start": 24.63, "end": 25.09, "text": "崩れる"}, {"start": 25.09, "end": 25.31, "text": "かも"},
    {"start": 25.31, "end": 25.92, "text": "しれません"}, {"start": 25.92, "end": 26.72, "text": "<eps>"},
    {"start": 26.72, "end": 26.86, "text": "気"}, {"start": 26.86, "end": 26.95, "text": "を"},
    {"start": 26.95, "end": 27.28, "text": "つけて"}, {"start": 27.28, "end": 27.78, "text": "ください"},
    {"start": 27.78, "end": 30.79, "text": "<eps>"}, {"start": 30.79, "end": 31.03, "text": "<unk>"},
    {"start": 31.03, "end": 31.28, "text": "は"}, {"start": 31.28, "end": 31.66, "text": "<eps>"},
    {"start": 31.66, "end": 32.16, "text": "関東"}, {"start": 32.16, "end": 32.58, "text": "地方"},
    {"start": 32.58, "end": 32.82, "text": "など"}, {"start": 32.82, "end": 33.07, "text": "で"},
    {"start": 33.07, "end": 33.32, "text": "<eps>"}, {"start": 33.32, "end": 33.74, "text": "気温"},
    {"start": 33.74, "end": 33.87, "text": "が"}, {"start": 33.87, "end": 34.3, "text": "低く"},
    {"start": 34.3, "end": 34.91, "text": "なりました"}, {"start": 34.91, "end": 36.71, "text": "<eps>"},
    {"start": 36.71, "end": 37.11, "text": "いつも"}, {"start": 37.11, "end": 37.26, "text": "の"},
    {"start": 37.26, "end": 37.55, "text": "年"}, {"start": 37.55, "end": 37.88, "text": "の"},
    {"start": 37.88, "end": 37.95, "text": "<eps>"}, {"start": 37.95, "end": 38.47, "text": "<unk>"},
    {"start": 38.47, "end": 38.83, "text": "ぐらい"}, {"start": 38.83, "end": 38.98, "text": "の"},
    {"start": 38.98, "end": 39.33, "text": "気温"}, {"start": 39.33, "end": 39.44, "text": "に"},
    {"start": 39.44, "end": 40.04, "text": "なりました"}, {"start": 40.04, "end": 41.93, "text": "<eps>"},
    {"start": 41.93, "end": 42.18, "text": "かぜ"}, {"start": 42.18, "end": 42.51, "text": "など"},
    {"start": 42.51, "end": 42.58, "text": "を"}, {"start": 42.58, "end": 43.12, "text": "ひかない"},
    {"start": 43.12, "end": 43.3, "text": "よう"}, {"start": 43.3, "end": 43.54, "text": "に"},
    {"start": 43.54, "end": 43.82, "text": "<eps>"}, {"start": 43.82, "end": 43.95, "text": "気"},
    {"start": 43.95, "end": 44.04, "text": "を"}, {"start": 44.04, "end": 44.35, "text": "つけて"},
    {"start": 44.35, "end": 44.86, "text": "ください"}, {"start": 44.86, "end": 45.48, "text": "<eps>"},
]

# The exact 8 sentences REAL_ALIGN_WORDS above was aligned against (story
# 9952's real transcript). japanese-only matters for assign_sentence_spans;
# inline_reading is left equal to japanese since spans don't use it.
REAL_ALIGN_SENTENCES = [
    NhkEasySentence(japanese=j, inline_reading=j)
    for j in [
        "11日も、本州の太平洋側などで雨が降りました。",
        "気象庁によると、これからも、しばらく、雨が降りやすい天気が続きそうです。",
        "今までに雨がたくさん降った所では、山が崩れやすくなっています。",
        "少ない雨でも崩れるかもしれません。",
        "気をつけてください。",
        "11日は、関東地方などで、気温が低くなりました。",
        "いつもの年の10月ぐらいの気温になりました。",
        "かぜなどをひかないように、気をつけてください。",
    ]
]

# A real nhkeasier.com RSS item <description>, fetched live 2026-09-13 from
# https://nhkeasier.com/feed/ (story 9952) — not synthesized, so this
# exercises the actual markup shape (numerals immediately preceding a ruby
# span, multiple <p> blocks, trailing <img>/<audio>/<ul> boilerplate).
REAL_DESCRIPTION = """
                    <img src="https://nhkeasier.com/media/jpg/20260911de49675.jpg" alt="Story illustration">
                    <p>11<ruby>日<rt>にち</rt></ruby>も、<ruby>本州<rt>ほんしゅう</rt></ruby>の<ruby>太平洋<rt>たいへいよう</rt></ruby><ruby>側<rt>がわ</rt></ruby>などで<ruby>雨<rt>あめ</rt></ruby>が<ruby>降<rt>ふ</rt></ruby>りました。<ruby>気象庁<rt>きしょうちょう</rt></ruby>によると、これからも、しばらく、<ruby>雨<rt>あめ</rt></ruby>が<ruby>降<rt>ふ</rt></ruby>りやすい<ruby>天気<rt>てんき</rt></ruby>が<ruby>続<rt>つづ</rt></ruby>きそうです。</p>
<p><ruby>今<rt>いま</rt></ruby>までに<ruby>雨<rt>あめ</rt></ruby>がたくさん<ruby>降<rt>ふ</rt></ruby>った<ruby>所<rt>ところ</rt></ruby>では、<ruby>山<rt>やま</rt></ruby>が<ruby>崩<rt>くず</rt></ruby>れやすくなっています。<ruby>少<rt>すく</rt></ruby>ない<ruby>雨<rt>あめ</rt></ruby>でも<ruby>崩<rt>くず</rt></ruby>れるかもしれません。<ruby>気<rt>き</rt></ruby>をつけてください。</p>
                    <audio src="https://nhkeasier.com/media/mp3/20260911de49675.mp3" controls preload="none"></audio>
                <ul>
                        <li><a href="https://www3.nhk.or.jp/news/easy/20260911de49675/20260911de49675.html">Original</a></li>
                    <li><a href="https://nhkeasier.com/story/9952/" class="permalink">Permalink</a></li>
                </ul>
"""


def test_parse_real_nhkeasier_description() -> None:
    sentences = parse_nhkeasier_description(REAL_DESCRIPTION)

    # 5 sentences across the 2 <p> blocks (3 in the first, 2 in the second);
    # the <img>/<audio>/<ul> boilerplate outside <p> tags contributes none.
    assert len(sentences) == 5

    first = sentences[0]
    assert first.japanese == "11日も、本州の太平洋側などで雨が降りました。"
    assert first.inline_reading == (
        "11日[にち]も、本州[ほんしゅう]の太平洋[たいへいよう]側[がわ]などで"
        "雨[あめ]が降[ふ]りました。"
    )

    last = sentences[-1]
    assert last.japanese == "気をつけてください。"
    assert last.inline_reading == "気[き]をつけてください。"


def test_ignores_boilerplate_outside_paragraph_tags() -> None:
    sentences = parse_nhkeasier_description(REAL_DESCRIPTION)
    joined = "".join(s.japanese for s in sentences)
    assert "Original" not in joined
    assert "Permalink" not in joined
    assert ".jpg" not in joined
    assert ".mp3" not in joined


def test_numeral_immediately_before_ruby_is_kept_plain() -> None:
    sentences = parse_nhkeasier_description(
        "<p>11<ruby>日<rt>にち</rt></ruby>です。</p>"
    )
    assert sentences[0].japanese == "11日です。"
    assert sentences[0].inline_reading == "11日[にち]です。"


def test_html_entities_are_unescaped() -> None:
    sentences = parse_nhkeasier_description("<p>A&amp;B<ruby>社<rt>しゃ</rt></ruby>です。</p>")
    assert sentences[0].japanese == "A&B社です。"


def test_empty_description_yields_no_sentences() -> None:
    assert parse_nhkeasier_description("<img src=\"x.jpg\">") == []


def test_decimal_point_is_not_a_sentence_end() -> None:
    # Real 2026-09-13 finding: NHK Easy articles report measurements like
    # this, and a naive split on "." (otherwise a valid sentence-end char)
    # cut "350.5ミリ" into two garbage fragments.
    sentences = parse_nhkeasier_description(
        "<p><ruby>勝山市<rt>かつやまし</rt></ruby>で350.5ミリの<ruby>雨<rt>あめ</rt></ruby>が"
        "<ruby>降<rt>ふ</rt></ruby>りました。</p>"
    )
    assert len(sentences) == 1
    assert sentences[0].japanese == "勝山市で350.5ミリの雨が降りました。"


def test_multiple_sentence_ends_do_not_produce_blank_sentences() -> None:
    sentences = parse_nhkeasier_description("<p>そうですか。。<ruby>本当<rt>ほんとう</rt></ruby>？</p>")
    assert [s.japanese for s in sentences] == ["そうですか。", "。", "本当？"]


def test_assign_sentence_spans_against_real_alignment() -> None:
    spans = assign_sentence_spans(REAL_ALIGN_SENTENCES, REAL_ALIGN_WORDS)
    assert spans is not None
    assert len(spans) == len(REAL_ALIGN_SENTENCES)

    # Contiguous and monotonically increasing — each sentence's start is the
    # previous one's end, no gaps or overlaps.
    assert spans[0].start_seconds == 0.0
    for prev, cur in zip(spans, spans[1:]):
        assert prev.end_seconds == cur.start_seconds
        assert cur.end_seconds > cur.start_seconds

    # Real anchor points from the fixture, hand-verified against the actual
    # word timeline: sentence 1 ends where "降りました" ends (real content,
    # not the eps pause after it); the OOV "11" numerals at the start of
    # sentences 1 and 6 don't throw off their *end* boundaries.
    assert spans[0].end_seconds == 5.45  # "...雨が降りました。"
    assert spans[4].end_seconds == 27.78  # "気をつけてください。" (1st occurrence)
    assert spans[5].end_seconds == 34.91  # "...気温が低くなりました。"
    assert spans[-1].end_seconds == 44.86  # "...気をつけてください。" (2nd occurrence)


def test_assign_sentence_spans_none_when_transcript_does_not_match_audio() -> None:
    unrelated = [NhkEasySentence(japanese="全然違う文章です。", inline_reading="全然違う文章です。")]
    assert assign_sentence_spans(unrelated, REAL_ALIGN_WORDS) is None


def test_assign_sentence_spans_none_with_no_words() -> None:
    assert assign_sentence_spans(REAL_ALIGN_SENTENCES, []) is None
