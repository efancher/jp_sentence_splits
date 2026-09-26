#!/usr/bin/env python3
"""Scores word-clip boundary candidates for
`backfill-word-audio-range.ts` via round-trip ASR: for each
`sentence_vocabulary` occurrence, the TS script extracts two clips —
`default` (the fixed -60/+120ms pad `isolatedWordRange` always applies)
and `tight` (the aligner's raw, unpadded match) — and this re-transcribes
both with a bigger model than the diagnostic one shadowing-analysis-api
keeps warm for other checks, scoring each against the word's surface form.

Findings this backfill is built on (docs/STATUS.md 2026-09-18): across two
samples (37 and 177 words) neither fixed pad wins consistently — `default`
and `tight` split the wins roughly evenly, so a per-word choice beats
either constant — and `large-v3-turbo` scores ~50% higher (relative) than
the diagnostic "base" model on the same clips, making it a meaningfully
more trustworthy judge for this decision.

Only ever recommends switching *to* `tight`: `default` is already what
`isolatedWordRange` produces at runtime when no override is stored, so a
`default` win means "leave it alone, no write needed" — writing an
identical value would be a no-op with extra steps. Requires a similarity
floor (MIN_SIMILARITY) and a margin over `default` (MIN_MARGIN) before
recommending an override — this writes into `SentenceVocabulary.
audioStartMs/EndMs`, a genuine correction, not a hedge-worded diagnostic
signal like `validate.py`'s, so it needs real confidence before acting,
not just "which of two noisy numbers happened to be bigger."

Comparison logic is intentionally a standalone copy of youtube-mining's
`app.validate.normalize_for_comparison`/`app.readings.generate_reading`
(kanji -> hiragana reading via fugashi/unidic-lite, katakana -> hiragana
fold, strip common punctuation, difflib ratio) rather than a cross-repo
import — this runs in the `mfa` conda env (shadowing-analysis-api's
faster-whisper), not youtube-mining's own venv, and the two apps
deliberately don't share a Python environment. Keep this in sync by hand
if that algorithm changes.

Usage (reads manifest.jsonl from the given dir, writes decisions JSON to
stdout — all progress/logging goes to stderr so stdout stays parseable):

  /home/ed/miniforge3/envs/mfa/bin/python3.14 scripts/score-word-audio-candidates.py \
      <clips_dir> > decisions.json
"""
from __future__ import annotations

import difflib
import json
import re
import sys
from functools import lru_cache
from pathlib import Path

import jaconv
from faster_whisper import WhisperModel

MODEL_NAME = "large-v3-turbo"
MIN_SIMILARITY = 0.5
MIN_MARGIN = 0.1

_KANJI_RE = re.compile(r"[㐀-鿿豈-﫿々〆〤ヶ]")
_STRIP_CHARS = "、。！？「」『』・…　 \n\t​"
_READING_OVERRIDES = {"私": "わたし", "日本": "にほん"}


def _has_kanji(text: str) -> bool:
    return bool(_KANJI_RE.search(text))


@lru_cache(maxsize=1)
def _tagger():
    import fugashi

    return fugashi.Tagger()


def _generate_reading(text: str) -> str | None:
    text = text.strip()
    if not text or not _has_kanji(text):
        return None
    parts: list[str] = []
    for word in _tagger()(text):
        surface = word.surface
        override = _READING_OVERRIDES.get(surface)
        if override:
            parts.append(override)
            continue
        if not _has_kanji(surface):
            parts.append(surface)
            continue
        kana = getattr(word.feature, "kana", None) or getattr(word.feature, "pron", None)
        parts.append(jaconv.kata2hira(kana) if kana else surface)
    reading = "".join(parts).strip()
    return reading if reading and reading != text else None


def normalize_for_comparison(text: str) -> str:
    reading = _generate_reading(text)
    base = jaconv.kata2hira(reading if reading is not None else text)
    return "".join(ch for ch in base if ch not in _STRIP_CHARS)


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, normalize_for_comparison(a), normalize_for_comparison(b)).ratio()


def main() -> None:
    clips_dir = Path(sys.argv[1])
    manifest_path = clips_dir / "manifest.jsonl"
    rows = [json.loads(line) for line in manifest_path.read_text().splitlines() if line.strip()]

    by_id: dict[str, dict] = {}
    for row in rows:
        by_id.setdefault(row["id"], {})[row["label"]] = row

    print(f"{len(by_id)} word occurrence(s), {len(rows)} clip(s). Loading {MODEL_NAME}...", file=sys.stderr)
    model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")

    def transcribe(clip_file: str) -> str:
        segments, _info = model.transcribe(str(clips_dir / clip_file), language="ja")
        return "".join(seg.text for seg in segments).strip()

    decisions = []
    for i, (vocab_id, labels) in enumerate(by_id.items()):
        default_row = labels.get("default")
        tight_row = labels.get("tight")
        if not default_row or not tight_row:
            continue
        surface_form = default_row["surfaceForm"]
        default_text = transcribe(default_row["clipFile"])
        tight_text = transcribe(tight_row["clipFile"])
        default_sim = similarity(default_text, surface_form)
        tight_sim = similarity(tight_text, surface_form)

        decision = "no-change"
        if tight_sim >= MIN_SIMILARITY and tight_sim - default_sim >= MIN_MARGIN:
            decision = "tight"

        print(
            f"[{i + 1}/{len(by_id)}] {surface_form}: default={default_sim:.2f} "
            f"tight={tight_sim:.2f} -> {decision}",
            file=sys.stderr,
        )
        decisions.append(
            {
                "id": vocab_id,
                "surfaceForm": surface_form,
                "decision": decision,
                "defaultSimilarity": default_sim,
                "tightSimilarity": tight_sim,
                "tightStartMs": tight_row["startMs"],
                "tightEndMs": tight_row["endMs"],
            }
        )

    print(json.dumps(decisions))


if __name__ == "__main__":
    main()
