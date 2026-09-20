#!/usr/bin/env python3
"""Transcribes every clip in a manifest to hiragana with the CTC kana model
(`sakasegawa/japanese-wav2vec2-large-hiragana-ctc`, code in
github.com/nyosegawa/hiragana-asr) — a judge that structurally cannot
hallucinate stock phrases the way Whisper does on very short clips.

Runs in its own venv (torch + transformers; NOT the `mfa` conda env):

  ~/tools/hiragana-asr/.venv/bin/python scripts/ctc-transcribe-clips.py <clips_dir> [--pad-ms N] [--out NAME]

`--pad-ms N` surrounds each clip with N ms of digital silence (the model was
trained on whole utterances; bare sub-second clips mostly come back empty).

Reads <clips_dir>/manifest.jsonl (the format the experiment scripts write),
writes <clips_dir>/ctc-kana.json ({clipFile: kana}) and prints timing to
stderr. Score the result with `score-pad-variants.py <clips_dir> --texts
<clips_dir>/ctc-kana.json`. The checkpoint loads with `weights_only=True`
(hiragana-asr's `load_checkpoint`), so an unpickled file can't run code.
"""
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
from transformers import Wav2Vec2FeatureExtractor

ROOT = Path(os.environ.get("HIRAGANA_ASR_DIR", Path.home() / "tools" / "hiragana-asr"))
sys.path.insert(0, str(ROOT))
from src.asr.kana_vocab import KanaVocab  # noqa: E402
from src.asr.model import load_checkpoint  # noqa: E402

CHECKPOINT = ROOT / "models" / "checkpoints" / "best-medium-ep5-inference.pt"
PRETRAINED = "reazon-research/japanese-wav2vec2-large"
SAMPLE_RATE = 16_000


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def main() -> None:
    clips_dir = Path(sys.argv[1])
    rows = [json.loads(l) for l in (clips_dir / "manifest.jsonl").read_text().splitlines() if l.strip()]
    pad_ms = int(sys.argv[sys.argv.index("--pad-ms") + 1]) if "--pad-ms" in sys.argv else 0
    out_name = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "ctc-kana.json"
    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))

    t0 = time.perf_counter()
    model = load_checkpoint(str(CHECKPOINT), PRETRAINED).eval()
    extractor = Wav2Vec2FeatureExtractor.from_pretrained(PRETRAINED)
    vocab = KanaVocab()
    print(f"loaded in {time.perf_counter() - t0:.1f}s, {len(rows)} clips", file=sys.stderr)

    out: dict[str, str] = {}
    total_audio = total_time = 0.0
    for i, row in enumerate(rows):
        samples = decode(clips_dir / row["clipFile"])
        if pad_ms:
            silence = np.zeros(int(SAMPLE_RATE * pad_ms / 1000), dtype=np.float32)
            samples = np.concatenate([silence, samples, silence])
        inputs = extractor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt", return_attention_mask=True)
        start = time.perf_counter()
        with torch.no_grad():
            logits = model(inputs.input_values, attention_mask=inputs.attention_mask)["kana_logits"]
        total_time += time.perf_counter() - start
        total_audio += len(samples) / SAMPLE_RATE
        out[row["clipFile"]] = vocab.decode(logits.squeeze(0).argmax(dim=-1).tolist())
        if (i + 1) % 25 == 0:
            print(f"[{i + 1}/{len(rows)}] {row['surfaceForm']}: {out[row['clipFile']]}", file=sys.stderr)

    (clips_dir / out_name).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(f"done: {total_audio:.0f}s audio in {total_time:.1f}s compute (RTF {total_time / max(total_audio, 1e-9):.2f}), peak RSS {peak_mb:.0f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
