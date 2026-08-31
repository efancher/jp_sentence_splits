"""Proper-noun reading second opinion for the tokenizer.

fugashi/UniDic-lite carries a name dictionary but fumbles distinctive
given names and surnames, and every re-mine of the same video pulls the
same wrong reading. `data/name_readings.json.gz` (built by
`scripts/build-name-readings.ts` from JMnedict — person-name entries with
exactly one reading, ~220k) lets `morphology.py` override a 固有名詞
token's reading when the dictionary disagrees.

Loaded lazily and once. If the file is missing the lookup just returns
None — the service still tokenizes, only without the cross-check.
"""

from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path

from app import config

logger = logging.getLogger("youtube_mining_api.name_readings")

_DATA_PATH = Path(__file__).parent / "data" / "name_readings.json.gz"
_table: dict[str, str] | None = None


def _load() -> dict[str, str]:
    global _table
    if _table is None:
        try:
            with gzip.open(_DATA_PATH, "rt", encoding="utf-8") as handle:
                _table = json.load(handle)
            logger.info("Loaded %d proper-noun readings", len(_table))
        except FileNotFoundError:
            logger.warning(
                "name_readings.json.gz missing — run `npm run build:name-readings`. "
                "Proper-noun reading cross-check disabled."
            )
            _table = {}
        except (OSError, ValueError):
            logger.exception("Failed to load name_readings.json.gz")
            _table = {}
    return _table


def lookup_name_reading(expression: str) -> str | None:
    """Hiragana reading for a proper-noun `expression`, or None when it's
    not a single-reading person name in JMnedict (or the check is off)."""
    if not config.NAME_READING_CHECK:
        return None
    return _load().get(expression)
