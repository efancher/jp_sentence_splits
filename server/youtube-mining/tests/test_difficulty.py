"""Tests for the difficulty screening checkpoint (app/difficulty.py) — see
docs/ROADMAP.md, "Podcast mining" item 5."""

from __future__ import annotations

import pytest

from app import difficulty
from app.models import MorphemeToken
from app.readings import reading_engine_available


def _token(surface: str, lemma: str, pos: str) -> MorphemeToken:
    return MorphemeToken(surface=surface, start=0, end=len(surface), lemma=lemma, pos=pos)


def test_score_difficulty_empty_input_returns_all_none() -> None:
    score = difficulty.score_difficulty([])
    assert score.commonWordRatio is None
    assert score.avgSentenceLength is None
    assert score.moraePerSecond is None
    assert score.level is None


def test_score_difficulty_ignores_function_words_and_punctuation_in_ratio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(difficulty, "is_common_word", lambda lemma: lemma == "食べる")
    sentence = [
        _token("食べ", "食べる", "動詞/一般"),
        _token("た", "た", "助動詞"),  # function word, excluded from the ratio
        _token("。", "。", "補助記号/句点"),  # punctuation, excluded
    ]
    score = difficulty.score_difficulty([sentence])
    assert score.commonWordRatio == 1.0  # only the verb counts, and it's common
    assert score.avgSentenceLength == 3  # sentence length still counts every token
    assert score.level == "beginner"


def test_score_difficulty_uncommon_words_lower_the_ratio(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(difficulty, "is_common_word", lambda lemma: lemma == "食べる")
    sentence = [_token("食べる", "食べる", "動詞/一般"), _token("珍語", "珍語", "名詞/普通名詞")]
    score = difficulty.score_difficulty([sentence])
    assert score.commonWordRatio == 0.5
    assert score.level == "advanced"


def test_score_difficulty_long_sentences_keep_it_out_of_beginner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(difficulty, "is_common_word", lambda lemma: True)
    long_sentence = [_token(f"語{i}", f"語{i}", "名詞/普通名詞") for i in range(16)]
    score = difficulty.score_difficulty([long_sentence])
    assert score.commonWordRatio == 1.0
    assert score.avgSentenceLength == 16
    assert score.level == "advanced"  # 100% common vocab, but the sentence is long


def test_score_difficulty_morae_per_second_needs_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(difficulty, "is_common_word", lambda lemma: True)
    sentence = [_token("猫", "猫", "名詞/普通名詞")]
    sentence[0].reading = "ねこ"
    assert difficulty.score_difficulty([sentence]).moraePerSecond is None
    assert difficulty.score_difficulty([sentence], duration_seconds=2.0).moraePerSecond == 1.0


def test_mora_count_excludes_small_yoon_but_keeps_sokuon() -> None:
    assert difficulty._mora_count("きゃく") == 2  # きゃ + く, not 3
    assert difficulty._mora_count("がっこう") == 4  # が + っ + こ + う


@pytest.mark.skipif(
    not reading_engine_available(),
    reason="fugashi + unidic-lite reading engine is not installed",
)
def test_tokenize_segments_for_scoring_splits_on_sentence_punctuation() -> None:
    segments = [("今日は晴れです。明日も晴れでしょう。", 0, 4000)]
    groups, duration_seconds = difficulty.tokenize_segments_for_scoring(segments)
    assert len(groups) == 2
    assert duration_seconds == 4.0


@pytest.mark.skipif(
    not reading_engine_available(),
    reason="fugashi + unidic-lite reading engine is not installed",
)
def test_tokenize_segments_for_scoring_keeps_decimal_point_together() -> None:
    segments = [("350.5ミリの雨が降りました。", 0, 3000)]
    groups, _ = difficulty.tokenize_segments_for_scoring(segments)
    assert len(groups) == 1


@pytest.mark.skipif(
    not reading_engine_available(),
    reason="fugashi + unidic-lite reading engine is not installed",
)
def test_tokenize_segments_for_scoring_unpunctuated_asr_falls_back_to_whole_segment() -> None:
    segments = [("今日は晴れです明日も晴れでしょう", 0, 4000)]
    groups, _ = difficulty.tokenize_segments_for_scoring(segments)
    assert len(groups) == 1
