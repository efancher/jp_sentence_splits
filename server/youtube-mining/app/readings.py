"""Kana reading generation, ported from shadowmine/readings.py unchanged.

fugashi + unidic-lite + jaconv are optional: any import/initialization
failure degrades to "no reading" rather than raising, exactly as in the
original CLI.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Callable, Optional

# CJK ideographs (incl. extension A), compatibility ideographs, and the
# common iteration / repetition marks used with kanji.
_KANJI_RE = re.compile(r"[㐀-鿿豈-﫿々〆〤ヶ]")


def has_kanji(text: str) -> bool:
    return bool(_KANJI_RE.search(text))


# Surface forms whose unidic-lite lemma reading is a poor default for this
# learner tool. unidic-lite tags the standalone pronoun 私 with the formal
# reading ワタクシ; わたし is overwhelmingly the intended reading in the drama
# transcripts this service segments (the learner can still edit it). Keyed on
# the exact token surface, so compounds like 私たち are unaffected.
#
# 日本 similarly defaults to にっぽん, but every corpus sentence checked
# (casual conversation, weather, news) actually uses the far more common
# にほん — found via a learner card-issue report on 日本語コンテッペイ
# ("Nihongo con Teppei"). The one known exception is the fixed political
# party name 日本維新の会 (にっぽんいしんのかい), which this override will
# get wrong going forward — same known tradeoff as 私, fix by hand if it
# recurs.
READING_OVERRIDES: dict[str, str] = {
    "私": "わたし",
    "日本": "にほん",
    # unidic-lite reads these compound tokens as なにじん / なんどき.
    "何人": "なんにん",
    "何時": "なんじ",
}


# unidic-lite reads every standalone 何 as ナン. Before these particles/words
# native speakers say なに (何か, 何が, 何を, 何も, 何より); before counters and
# た/だ/な-row sounds it stays なん, which the default already covers.
_NANI_FOLLOWERS = ("か", "が", "を", "も", "より")
# 何か月 / 何か所 / 何か国 are counters (なんかげつ), not 何か + noun.
_NANI_COUNTER_FOLLOWERS = ("か月", "か所", "か国", "ヶ月", "ヶ所", "ヶ国", "カ月", "カ所", "カ国")


def nani_override(surface: str, next_surface: str) -> Optional[str]:
    if (
        surface == "何"
        and next_surface.startswith(_NANI_FOLLOWERS)
        and not next_surface.startswith(_NANI_COUNTER_FOLLOWERS)
    ):
        return "なに"
    return None


_MAE_PREV_POS = ("連体詞", "数詞", "接尾辞")


def mae_override(surface: str, prev_pos: str, next_surface: str) -> Optional[str]:
    """unidic-lite flips a standalone 前 between マエ and ゼン on neighbouring
    words (bare この前 -> マエ, but この前スペイン / この前、 -> ゼン). ゼン is
    right only as a prefix on a following kanji word (前社長) that doesn't
    follow a demonstrative/numeral/counter (この前, 三日前); otherwise まえ."""
    if surface != "前":
        return None
    is_prefix = bool(next_surface) and has_kanji(next_surface[0]) and not prev_pos.startswith(
        _MAE_PREV_POS
    )
    return None if is_prefix else "まえ"


@lru_cache(maxsize=1)
def _load_engine() -> Optional[tuple[object, Callable[[str], str]]]:
    try:
        import fugashi
        import jaconv
    except ImportError:
        return None
    try:
        tagger = fugashi.Tagger()
    except Exception:
        return None
    return tagger, jaconv.kata2hira


def reading_engine_available() -> bool:
    return _load_engine() is not None


def generate_reading(text: str) -> Optional[str]:
    """Return a hiragana reading for ``text``, or None if not needed/available."""
    text = text.strip()
    if not text or not has_kanji(text):
        return None
    engine = _load_engine()
    if engine is None:
        return None
    tagger, kata2hira = engine

    parts: list[str] = []
    words = list(tagger(text))
    for i, word in enumerate(words):
        surface = word.surface
        next_surface = words[i + 1].surface if i + 1 < len(words) else ""
        prev_pos = getattr(words[i - 1].feature, "pos1", "") or "" if i > 0 else ""
        override = (
            nani_override(surface, next_surface)
            or mae_override(surface, prev_pos, next_surface)
            or READING_OVERRIDES.get(surface)
        )
        if override:
            parts.append(override)
            continue
        if not has_kanji(surface):
            parts.append(surface)
            continue
        kana = getattr(word.feature, "kana", None) or getattr(word.feature, "pron", None)
        parts.append(kata2hira(kana) if kana else surface)

    reading = "".join(parts).strip()
    if not reading or reading == text:
        return None
    return reading
