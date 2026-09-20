#!/usr/bin/env python3
"""Summarizes a `score-pad-variants.py` result (token vs mora clips) overall and
by mora-clip length — the breakdown that showed Whisper can't judge sub-250 ms
clips. Plain Python, no dependencies.

  python3 scripts/summarize-clip-judge.py <scored.json> <mora-ms.json>

`scored.json` is the scorer's stdout; `mora-ms.json` is written by
`experiment-mora-cut.ts --keep DIR --prepare-only` (into DIR).
"""
import json
import sys

scored = json.load(open(sys.argv[1]))
duration = json.load(open(sys.argv[2]))
mean = lambda xs: sum(xs) / len(xs) if xs else float("nan")


def line(title, rows):
    better = sum(1 for r in rows if r["sims"]["mora"] - r["sims"]["token"] > 0.05)
    worse = sum(1 for r in rows if r["sims"]["token"] - r["sims"]["mora"] > 0.05)
    print(f"{title:22} n={len(rows):3}  token={mean([r['sims']['token'] for r in rows]):.3f}  "
          f"mora={mean([r['sims']['mora'] for r in rows]):.3f}  mora better {better} / worse {worse}")


line("all", scored)
for label, lo, hi in [("mora clip < 250 ms", 0, 250), ("250–400 ms", 250, 400), (">= 400 ms", 400, 1e9)]:
    line(label, [r for r in scored if lo <= duration.get(r["id"], 0) < hi])
print("empty transcripts: token %d, mora %d" % (
    sum(1 for r in scored if not r["texts"]["token"].strip()),
    sum(1 for r in scored if not r["texts"]["mora"].strip())))
