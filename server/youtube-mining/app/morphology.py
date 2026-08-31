"""Fugashi/UniDic morphology tokenization, ported from shadowmine/morphology.py.

Token spans are dictionary-neutral: surface form, Unicode character offsets,
lemma (orthBase preferred), hiragana reading, and POS — the same shape this
app's vocabulary-suggestion picker already consumes
(src/lib/vocabularySuggestions.ts's MorphologyToken).
"""

from __future__ import annotations

from app.models import MorphemeToken
from app.name_readings import lookup_name_reading
from app.readings import READING_OVERRIDES, _load_engine, has_kanji


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
    override = READING_OVERRIDES.get(surface)
    if override:
        return override
    kana = _feature_str(feature, "kana") or _feature_str(feature, "pron")
    if kana:
        return kata2hira(kana)
    if not has_kanji(surface):
        return surface
    return ""


def _lemma_reading_from_feature(feature: object, lemma: str, kata2hira) -> str:
    """Reading of the *dictionary form* — UniDic's kanaBase (読ん → よむ, not
    よん). This is what the vocabulary suggestion wants; `reading` above is the
    conjugated-surface reading for furigana. "" when unavailable."""
    override = READING_OVERRIDES.get(lemma)
    if override:
        return override
    kana_base = _feature_str(feature, "kanaBase") or _feature_str(feature, "pronBase")
    if kana_base:
        return kata2hira(kana_base)
    if not has_kanji(lemma):
        return lemma
    return ""


def _pos_from_feature(feature: object) -> str:
    pos1 = _feature_str(feature, "pos1")
    pos2 = _feature_str(feature, "pos2")
    if pos1 and pos2:
        return f"{pos1}/{pos2}"
    return pos1


def _accent_type_from_feature(feature: object) -> str:
    """UniDic `aType` — accent nucleus mora index, "0" = heiban. Only a plain
    integer is returned; "*" (unknown) and compound forms like "1,3" / "C2"
    come back as "" for the caller to ignore."""
    raw = _feature_str(feature, "aType")
    return raw if raw.isdigit() else ""


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
        lemma = _lemma_from_feature(feature, surface)
        pos = _pos_from_feature(feature)
        reading = _reading_from_feature(feature, surface, kata2hira)
        lemma_reading = _lemma_reading_from_feature(feature, lemma, kata2hira)
        accent_type = _accent_type_from_feature(feature)

        # JMnedict second opinion for a proper-noun reading UniDic-lite
        # likely fumbled (distinctive given names / surnames). Only when it
        # actually disagrees; drop the UniDic accent, which was derived for
        # its own — now overridden — reading (Kanjium fills it back post-hoc).
        if "固有名詞" in pos and has_kanji(surface):
            name_reading = lookup_name_reading(surface)
            if name_reading and name_reading != reading:
                reading = name_reading
                lemma_reading = name_reading
                accent_type = ""

        tokens.append(
            MorphemeToken(
                surface=surface,
                start=start,
                end=end,
                lemma=lemma,
                reading=reading,
                lemmaReading=lemma_reading,
                pos=pos,
                accentType=accent_type,
            )
        )
        cursor = end
    return tokens
