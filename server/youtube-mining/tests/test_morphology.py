"""Tests for UniDic morphology token spans."""

from __future__ import annotations

import pytest

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
