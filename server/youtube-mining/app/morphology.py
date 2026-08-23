"""Fugashi/UniDic morphology tokenization, ported from shadowmine/morphology.py.

Token spans are dictionary-neutral: surface form, Unicode character offsets,
lemma (orthBase preferred), hiragana reading, and POS — the same shape this
app's vocabulary-suggestion picker already consumes
(src/lib/vocabularySuggestions.ts's MorphologyToken).
"""

from __future__ import annotations

from app.models import MorphemeToken
from app.readings import _load_engine, has_kanji


def _feature_str(feature: object, name: str) -> str:
    value = getattr(feature, name, None)
    if value is None or value in {"", "*"}:
        return ""
    return str(value)


def _lemma_from_feature(feature: object, surface: str) -> str:
    """Prefer orthBase (やる) over lemma (遣る / 為る-スル)."""
    orth_base = _feature_str(feature, "orthBase")
    if orth_base:
        return orth_base
    lemma = _feature_str(feature, "lemma")
    if lemma:
        return lemma.split("-", 1)[0]
    return surface


def _reading_from_feature(feature: object, surface: str, kata2hira) -> str:
    kana = _feature_str(feature, "kana") or _feature_str(feature, "pron")
    if kana:
        return kata2hira(kana)
    if not has_kanji(surface):
        return surface
    return ""


def _pos_from_feature(feature: object) -> str:
    pos1 = _feature_str(feature, "pos1")
    pos2 = _feature_str(feature, "pos2")
    if pos1 and pos2:
        return f"{pos1}/{pos2}"
    return pos1


def tokenize_japanese(text: str) -> list[MorphemeToken]:
    """Tokenize ``text`` into character-aligned MorphemeToken spans.

    Returns an empty list when the reading engine is unavailable or the
    text is empty. Offsets are Unicode code-point indexes into ``text``
    such that ``text[start:end] == surface``.
    """
    if not text:
        return []
    engine = _load_engine()
    if engine is None:
        return []
    tagger, kata2hira = engine

    tokens: list[MorphemeToken] = []
    cursor = 0
    for word in tagger(text):
        surface = word.surface
        if not surface:
            continue
        start = text.find(surface, cursor)
        if start < 0:
            start = cursor
        end = start + len(surface)
        if text[start:end] != surface:
            cursor = max(cursor, end)
            continue
        feature = word.feature
        tokens.append(
            MorphemeToken(
                surface=surface,
                start=start,
                end=end,
                lemma=_lemma_from_feature(feature, surface),
                reading=_reading_from_feature(feature, surface, kata2hira),
                pos=_pos_from_feature(feature),
            )
        )
        cursor = end
    return tokens
