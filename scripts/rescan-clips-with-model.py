#!/usr/bin/env python3
"""One-off comparison: re-transcribes the clips kept by
`experiment-word-boundary-verification.ts` (KEEP_CLIPS_DIR=... run) with a
bigger faster-whisper model and compares against the base-model similarity
already recorded in manifest.jsonl by that run's live `/validate-transcript`
call — same clips, same boundary candidates, only the model varies.

Not wired into any service; run manually with the same Python interpreter
shadowing-analysis-api uses (has faster-whisper installed):

  /home/ed/miniforge3/envs/mfa/bin/python3.14 scripts/rescan-clips-with-model.py \
      /tmp/word-boundary-clips --model large-v3-turbo

Comparison metric is a simplified stand-in for youtube-mining's
`validate.normalize_for_comparison` (katakana->hiragana fold + strip
common punctuation, difflib ratio) — no kanji->reading step (that needs
fugashi/unidic-lite, not worth installing into the aligner's conda env for
a throwaway comparison). This under-scores kanji/kana spelling mismatches
that the real production comparison would treat as a match, so absolute
numbers here run a bit lower than the original run's; the base-vs-bigger-
model *relative* comparison, computed with this same metric for both, is
still apples-to-apples.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
from pathlib import Path

import jaconv
from faster_whisper import WhisperModel

_STRIP_CHARS = "、。！？「」『』・…　 \n\t​"


def normalize(text: str) -> str:
    folded = jaconv.kata2hira(text)
    return "".join(ch for ch in folded if ch not in _STRIP_CHARS)


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clips_dir", type=Path)
    parser.add_argument("--model", default="large-v3-turbo")
    args = parser.parse_args()

    manifest_path = args.clips_dir / "manifest.jsonl"
    rows = [json.loads(line) for line in manifest_path.read_text().splitlines() if line.strip()]
    print(f"{len(rows)} clips in manifest. Loading {args.model}...")
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    win_counts: dict[str, int] = {}
    sim_sums: dict[str, list[float]] = {}
    base_sim_sums: dict[str, list[float]] = {}
    by_word: dict[str, list[dict]] = {}
    for row in rows:
        by_word.setdefault(row["sentenceId"] + "|" + row["surfaceForm"], []).append(row)

    tested = 0
    for word_key, word_rows in by_word.items():
        surface_form = word_rows[0]["surfaceForm"]
        scored = []
        for row in word_rows:
            clip_path = args.clips_dir / row["clipFile"]
            segments, _info = model.transcribe(str(clip_path), language="ja")
            asr_text = "".join(seg.text for seg in segments).strip()
            sim = similarity(asr_text, surface_form)
            base_sim = row.get("baseSimilarity")
            scored.append(
                {
                    "label": row["candidateLabel"],
                    "sim": sim,
                    "asrText": asr_text,
                    "baseSim": base_sim,
                }
            )
            sim_sums.setdefault(row["candidateLabel"], []).append(sim)
            if base_sim is not None:
                base_sim_sums.setdefault(row["candidateLabel"], []).append(similarity(row["baseAsrText"] or "", surface_form))
        if not scored:
            continue
        tested += 1
        best = max(scored, key=lambda s: s["sim"])
        win_counts[best["label"]] = win_counts.get(best["label"], 0) + 1
        detail = ", ".join(f"{s['label']}={s['sim']:.2f}(base={s['baseSim']})" for s in scored)
        print(f"[{tested}] {surface_form}: best={best['label']} ({best['sim']:.2f}) heard=\"{best['asrText']}\" [{detail}]")

    print(f"\n{args.model} — win rate by candidate:")
    for label, count in sorted(win_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {label}: {count}/{tested} ({count / tested * 100:.0f}%)")

    print(f"\n{args.model} mean similarity by candidate (this script's simplified metric):")
    for label, sims in sim_sums.items():
        print(f"  {label}: {sum(sims) / len(sims):.3f} (n={len(sims)})")

    print("\nSame clips, base model ('base'), same simplified metric, for direct comparison:")
    for label, sims in base_sim_sums.items():
        print(f"  {label}: {sum(sims) / len(sims):.3f} (n={len(sims)})")


if __name__ == "__main__":
    main()
