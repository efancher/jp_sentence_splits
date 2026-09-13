"""Tests for the offline-generated JMDict common-word set
(app/common_words.py, data/common_words.json)."""

from __future__ import annotations

from app import common_words


def test_is_common_word_true_for_a_known_common_word() -> None:
    assert common_words.is_common_word("食べる")


def test_is_common_word_false_for_empty_or_unknown() -> None:
    assert not common_words.is_common_word("")
    assert not common_words.is_common_word("絶対にこんな単語はない123xyz")
