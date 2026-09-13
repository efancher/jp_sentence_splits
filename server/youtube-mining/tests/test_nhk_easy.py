from app.nhk_easy import parse_nhkeasier_description

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
