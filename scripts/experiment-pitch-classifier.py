#!/usr/bin/env python3
"""Offline comparison of high/low pitch-shape rules on native clips (docs/STATUS.md 2026-09-20).

Input: the per-mora F0 dump written by
  EXACT_MORAE=1 DUMP_CLIPS=/tmp/pitch-clips-dump2.json npx tsx scripts/audit-pitch-accent-clips.ts
Run (needs numpy — the `mfa` conda env has it):
  /home/ed/miniforge3/envs/mfa/bin/python3.14 scripts/experiment-pitch-classifier.py [dump.json]

Scores each rule by how often its measured in-word shape equals the dictionary shape, overall and per shape
group. Reproduces the app's per-mora "mean threshold" rule as the baseline (71/178 = 40% on 219 clips), then
tries fitting a valid accent shape (55%), with variants: median, middle-of-mora frames, outlier trimming, a
drift term. Result: the plain valid-shape fit on all frames is best -> src/lib/pitchShapeFit.ts.
"""
import json, statistics as st, itertools, sys
try:
    import numpy as np
except ImportError:
    np = None
clips = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/pitch-clips-dump2.json'))
import math
def prep(c, mid=None, trim=None):
    # returns c with 'frames' as plain semitone lists, optionally only the middle fraction of each mora and/or outliers removed
    out = []
    allst = [x[1] for f in c['frames'] for x in f]
    med = st.median(allst) if allst else 0
    for f in c['frames']:
        vals = [x for x in f if mid is None or (mid[0] <= x[0] <= mid[1])]
        vals = [x[1] for x in vals]
        if trim is not None: vals = [v for v in vals if abs(v - med) <= trim]
        out.append(vals)
    return {**c, 'frames': out}

MIN_VOICED = 2  # replaced below if the TS constant differs

def expected(n, pos):
    if pos == 0 or pos >= n: return 'l' + 'h' * (n - 1)
    if pos == 1: return 'h' + 'l' * (n - 1)
    return 'l' + 'h' * (pos - 1) + 'l' * (n - pos)

def valid_shapes(n):
    return sorted({expected(n, p) for p in range(0, n + 1)})

def bucket_stats(c, fn=st.mean):
    return [fn(f) if f else None for f in c['frames']]

def baseline(c):
    fr = c['frames']; n = c['moraCount']
    allf = [x for f in fr for x in f]
    if not allf: return None
    overall = st.mean(allf)
    means = [st.mean(f) if f else None for f in fr]
    if sum(m is not None for m in means) < min(MIN_VOICED, n): return None
    out = []; last = 'l'
    for m in means:
        if m is not None: last = 'h' if m >= overall else 'l'
        out.append(last)
    return ''.join(out)

def template_fit(c, fn=st.mean, slope=False, min_delta=0.0):
    n = c['moraCount']; fr = c['frames']
    means = [fn(f) if f else None for f in fr]
    idx = [i for i, m in enumerate(means) if m is not None]
    if len(idx) < min(MIN_VOICED, n): return None
    y = np.array([means[i] for i in idx])
    t = np.array([float(i) for i in idx])
    best = None
    for shape in valid_shapes(n):
        h = np.array([1.0 if shape[i] == 'h' else 0.0 for i in idx])
        cols = [np.ones(len(idx)), h] + ([t] if slope else [])
        A = np.stack(cols, axis=1)
        coef, *_ = np.linalg.lstsq(A, y, rcond=None)
        delta = coef[1]
        if np.linalg.matrix_rank(A) < A.shape[1] or delta < min_delta:
            continue  # H must sit at least min_delta semitones above L (and both classes must be present among voiced morae)
        cost = float(((A @ coef - y) ** 2).sum())
        if best is None or cost < best[0] - 1e-9: best = (cost, shape, delta)
    return best[1] if best else None

def score(name, fn):
    ok = tot = 0; by = {}
    for c in clips:
        if c['moraCount'] < 2: continue
        got = fn(c)
        if got is None: continue
        exp = expected(c['moraCount'], c['position'])
        tot += 1; hit = (got == exp); ok += hit
        key = f"{c['moraCount']}-mora {exp}"
        a = by.setdefault(key, [0, 0]); a[0] += hit; a[1] += 1
    print(f"{name:34} agree {ok}/{tot} = {100*ok/tot:.0f}%")
    return by

print('clips', len(clips))
def run(name, mid=None, trim=None, fn=st.mean, min_delta=0.0):
    return score(name, lambda c: template_fit(prep(c, mid, trim), fn=fn, min_delta=min_delta))
score('baseline (mean threshold)', lambda c: baseline(prep(c)))
run('template (all frames, mean)')
run('template, middle 60% of each mora', mid=(0.2, 0.8))
run('template, middle 40%', mid=(0.3, 0.7))
run('template, second half of each mora', mid=(0.5, 1.0))
run('template, drop outliers > 6 st', trim=6)
run('template, drop outliers > 4 st', trim=4)
run('template, middle 60% + outliers > 6', mid=(0.2, 0.8), trim=6)
run('template, median, middle 60%', mid=(0.2, 0.8), fn=st.median)
