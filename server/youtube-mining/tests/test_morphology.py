"""Tests for UniDic morphology token spans."""

from __future__ import annotations

import pytest

from app import morphology, name_readings
from app.morphology import tokenize_japanese
from app.readings import reading_engine_available

pytestmark = pytest.mark.skipif(
    not reading_engine_available(),
    reason="fugashi + unidic-lite reading engine is not installed",
)


def _assert_spans(text: str, tokens) -> None:
    for token in tokens:
        assert text[token.start : token.end] == token.surface
        assert token.end > token.start
        assert token.lemma


def test_tokenize_tabemashita() -> None:
    text = "食べました。"
    tokens = tokenize_japanese(text)
    _assert_spans(text, tokens)
    lemmas = [token.lemma for token in tokens]
    assert "食べる" in lemmas


def test_tokenize_shimashita_lemma_is_suru() -> None:
    text = "世話をしました。"
    tokens = tokenize_japanese(text)
    _assert_spans(text, tokens)
    suru = next(token for token in tokens if token.surface == "し")
    assert suru.lemma == "する"


def test_tokenize_empty_and_unavailable() -> None:
    assert tokenize_japanese("") == []


def test_lemma_reading_is_dictionary_form_not_surface() -> None:
    """`lemmaReading` (UniDic kanaBase) is the dictionary-form reading — the
    case `deriveDictionaryReading` on the client exists to recover."""
    tokens = {t.surface: t for t in tokenize_japanese("本を読んで見つけました。")}
    assert tokens["読ん"].lemma == "読む"
    assert tokens["読ん"].reading == "よん"  # surface, for furigana
    assert tokens["読ん"].lemmaReading == "よむ"  # dictionary form, for vocab
    assert tokens["見つけ"].lemmaReading == "みつける"


def test_lemma_reading_respects_overrides() -> None:
    watashi = next(t for t in tokenize_japanese("私は学生です。") if t.surface == "私")
    assert watashi.reading == "わたし"
    assert watashi.lemmaReading == "わたし"


def test_accent_type_is_a_plain_integer_or_blank() -> None:
    sensei = tokenize_japanese("先生")[0]
    assert sensei.accentType == "3"  # 先生 is nakadaka on the 3rd mora
    tokyo = tokenize_japanese("東京")[0]
    assert tokyo.accentType == "0"  # heiban
    # A conjugated/particle token or an unknown-accent word yields "".
    ta = next(t for t in tokenize_japanese("食べた") if t.surface == "た")
    assert ta.accentType == ""


def test_proper_noun_reading_overridden_from_name_dictionary(monkeypatch) -> None:
    """A 固有名詞 token whose UniDic reading disagrees with JMnedict takes
    the dictionary reading, and its (now-stale) UniDic accent is dropped.
    A deliberately impossible reading proves the override fired regardless
    of UniDic-lite's own guess for 水希."""
    monkeypatch.setattr(
        name_readings, "_table", {"水希": "ぜったいちがう"}, raising=False
    )
    monkeypatch.setattr(name_readings.config, "NAME_READING_CHECK", True)

    tokens = {t.surface: t for t in tokenize_japanese("水希さんです。")}
    mizuki = tokens["水希"]
    assert "固有名詞" in mizuki.pos
    assert mizuki.reading == "ぜったいちがう"
    assert mizuki.lemmaReading == "ぜったいちがう"
    assert mizuki.accentType == ""
    # A common word is untouched by the name check.
    assert tokens["さん"].reading == "さん"


def test_name_check_can_be_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        name_readings, "_table", {"水希": "ぜったいちがう"}, raising=False
    )
    monkeypatch.setattr(name_readings.config, "NAME_READING_CHECK", False)
    mizuki = next(t for t in tokenize_japanese("水希さん") if t.surface == "水希")
    assert mizuki.reading != "ぜったいちがう"  # UniDic's own reading, unchanged


def test_name_lookup_is_a_noop_without_the_data_file(monkeypatch) -> None:
    monkeypatch.setattr(name_readings, "_table", {}, raising=False)
    monkeypatch.setattr(name_readings.config, "NAME_READING_CHECK", True)
    # Just shouldn't raise; whatever UniDic gives stands.
    assert tokenize_japanese("田中さんです。")
