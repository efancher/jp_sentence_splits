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
    for word in tagger(text):
        surface = word.surface
        if not has_kanji(surface):
            parts.append(surface)
            continue
        kana = getattr(word.feature, "kana", None) or getattr(word.feature, "pron", None)
        parts.append(kata2hira(kana) if kana else surface)

    reading = "".join(parts).strip()
    if not reading or reading == text:
        return None
    return reading
