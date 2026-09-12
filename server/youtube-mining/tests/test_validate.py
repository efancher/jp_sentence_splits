"""app/validate.py — cross-checking a sentence's stored Japanese against a
fresh ASR pass of its own clip. `asr_client.transcribe_clip` and
`readings.generate_reading` are monkeypatched out so this runs anywhere
without the analysis service or fugashi/unidic installed — only the
comparison logic itself is under test.
"""

from __future__ import annotations

import pytest

from app import validate


def test_normalize_strips_punctuation_and_uses_reading(monkeypatch):
    monkeypatch.setattr(validate, "generate_reading", lambda text: "いろいろあるんですけど")
    assert validate.normalize_for_comparison("色々あるんですけど、") == "いろいろあるんですけど"


def test_normalize_falls_back_to_raw_text_when_no_reading(monkeypatch):
    monkeypatch.setattr(validate, "generate_reading", lambda text: None)
    assert validate.normalize_for_comparison("ねえ、") == "ねえ"


def test_katakana_asr_name_matches_kanji_hiragana_spelling(monkeypatch):
    # Whisper routinely renders a name in katakana (サトウユージ) against a
    # stored kanji+hiragana spelling (佐藤ゆうじ) -- found live-testing this
    # module against prod data (2026-09-12). generate_reading only fires on
    # kanji, so the katakana->hiragana fold has to be independent of it.
    # Not a perfect 1.0: kata2hira doesn't expand the chōonpu (ー) to match
    # hiragana's vowel-doubling convention (ユージ -> ゆーじ, not ゆうじ), so a
    # one-character residual diff is expected and fine -- comfortably above
    # the default flagging threshold (0.6) is the actual bar, not exactness.
    readings = {"佐藤ゆうじです。": "さとうゆうじです"}
    monkeypatch.setattr(
        validate, "generate_reading", lambda text: readings.get(text)
    )
    monkeypatch.setattr(validate.asr_client, "transcribe_clip", lambda *_: "サトウユージです")
    result = validate.validate_sentence_audio(b"fake-audio", "audio/mp4", "佐藤ゆうじです。")
    assert result["similarity"] >= 0.8


def test_kanji_kana_spelling_variants_compare_as_identical(monkeypatch):
    # 色々/いろいろ are the same word, zero raw character overlap -- this is
    # exactly the false-positive class hiragana normalization exists to avoid.
    readings = {"色々あるんですけど": "いろいろあるんですけど"}
    monkeypatch.setattr(
        validate, "generate_reading", lambda text: readings.get(text, text)
    )
    monkeypatch.setattr(
        validate.asr_client, "transcribe_clip", lambda *_: "いろいろあるんですけど"
    )
    result = validate.validate_sentence_audio(b"fake-audio", "audio/mp4", "色々あるんですけど")
    assert result["asrText"] == "いろいろあるんですけど"
    assert result["similarity"] == pytest.approx(1.0)
    assert result["reason"] is None


def test_flags_a_genuine_mismatch(monkeypatch):
    monkeypatch.setattr(validate, "generate_reading", lambda text: None)
    monkeypatch.setattr(validate.asr_client, "transcribe_clip", lambda *_: "この8月はね")
    result = validate.validate_sentence_audio(b"fake-audio", "audio/mp4", "ま、色々あるんですけど")
    assert result["asrText"] == "この8月はね"
    assert result["similarity"] < 0.5


def test_asr_unavailable_reports_reason_not_a_mismatch(monkeypatch):
    monkeypatch.setattr(validate.asr_client, "transcribe_clip", lambda *_: None)
    result = validate.validate_sentence_audio(b"fake-audio", "audio/mp4", "何か")
    assert result["asrText"] is None
    assert result["similarity"] is None
    assert result["reason"]
