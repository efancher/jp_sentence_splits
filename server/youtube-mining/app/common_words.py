"""Loads the offline-generated JMDict "common" word set.

JMDict itself only lives on the Node/TS side of this app
(scripts/lib/jmdict.ts) — see docs/ARCHITECTURE.md on it being an
offline-script dependency, not bundled at runtime. But Japanese
tokenization (fugashi/UniDic) only runs here in the Python service, so a
per-lemma difficulty score (app/difficulty.py) needs the "common" flag
ported across that boundary. `scripts/generate-common-words-asset.ts`
flattens every kanji/kana spelling JMDict marks common into this file;
re-run it (`npm run generate:common-words-asset`) whenever JMDict updates.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_ASSET_PATH = Path(__file__).parent / "data" / "common_words.json"


@lru_cache(maxsize=1)
def _load_common_words() -> frozenset[str]:
    try:
        with _ASSET_PATH.open("r", encoding="utf-8") as f:
            return frozenset(json.load(f))
    except FileNotFoundError:
        return frozenset()


def is_common_word(lemma: str) -> bool:
    return bool(lemma) and lemma in _load_common_words()
