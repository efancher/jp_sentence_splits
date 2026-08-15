"""Tokenize a batch of sentences with the same fugashi/UniDic engine
Shadowmine uses for .zip package imports (`shadowmine.morphology`).

Deliberately thin: this script owns no Supabase/network code and no
selection/POS-default logic — that all stays in
scripts/backfill-vocabulary-suggestions.ts, reusing the existing, tested
suggestionsFromTokens() rather than duplicating it in Python. This script's
only job is bridging fugashi's output to that TypeScript function's input.

Usage: reads a JSON array of {"id": str, "japanese": str} from stdin,
writes a JSON array of {"id": str, "tokens": [...]} to stdout, where each
token is {surface, start, end, lemma, reading, pos} — the exact shape
MorphologyToken expects on the TypeScript side.

Requires the `shadowmine` package importable (see README.md for the local
venv / editable-install setup, or the CI workflow that installs it from a
sibling checkout of the `shadowing` repo).
"""

from __future__ import annotations

import json
import sys

from shadowmine.morphology import tokenize_japanese


def main() -> None:
    raw = sys.stdin.read()
    sentences = json.loads(raw) if raw.strip() else []

    results = []
    for sentence in sentences:
        tokens = tokenize_japanese(sentence["japanese"])
        results.append(
            {
                "id": sentence["id"],
                "tokens": [token.model_dump(mode="json") for token in tokens],
            }
        )

    json.dump(results, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
