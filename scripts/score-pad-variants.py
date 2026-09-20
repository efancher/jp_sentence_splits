#!/usr/bin/env python3
"""Round-trip ASR scorer for `experiment-pad-comparison.ts`: transcribes every
clip in a manifest with large-v3-turbo and scores it against the word's surface
form, using the same normalization/similarity as
`score-word-audio-candidates.py` (imported, not copied). Any number of
labelled variants per word. Writes a JSON list of
{id, surfaceForm, differs, sims: {label: similarity}} to stdout; progress to
stderr.

  /home/ed/miniforge3/envs/mfa/bin/python3.14 scripts/score-pad-variants.py <clips_dir>
"""
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "score_word_audio_candidates", Path(__file__).with_name("score-word-audio-candidates.py")
)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main() -> None:
    clips_dir = Path(sys.argv[1])
    rows = [json.loads(l) for l in (clips_dir / "manifest.jsonl").read_text().splitlines() if l.strip()]
    by_id: dict[str, dict] = {}
    for row in rows:
        entry = by_id.setdefault(row["id"], {"surfaceForm": row["surfaceForm"], "differs": row["differs"], "clips": {}})
        entry["clips"][row["label"]] = row["clipFile"]

    print(f"{len(by_id)} words, {len(rows)} clips. Loading {base.MODEL_NAME}...", file=sys.stderr)
    model = base.WhisperModel(base.MODEL_NAME, device="cpu", compute_type="int8")

    out = []
    for i, (vid, entry) in enumerate(by_id.items()):
        sims = {}
        texts = {}
        for label, clip in entry["clips"].items():
            segments, _ = model.transcribe(str(clips_dir / clip), language="ja")
            text = "".join(seg.text for seg in segments).strip()
            texts[label] = text
            sims[label] = base.similarity(text, entry["surfaceForm"])
        print(f"[{i + 1}/{len(by_id)}] {entry['surfaceForm']}: " + " ".join(f"{k}={v:.2f}" for k, v in sims.items()), file=sys.stderr)
        out.append({"id": vid, "surfaceForm": entry["surfaceForm"], "differs": entry["differs"], "sims": sims, "texts": texts})
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
