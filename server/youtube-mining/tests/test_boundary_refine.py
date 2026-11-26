"""Boundary refinement: pure decision logic plus the degrade path."""

from __future__ import annotations

from app import boundary_refine as br


def w(text, start, end, phones=None):
    d = {"text": text, "start": start, "end": end}
    if phones is not None:
        d["phones"] = phones
    return d


def decide(words, transcript="今日は晴れです", **kw):
    args = dict(window_start_ms=1000, window_end_ms=9000, start_ms=2000, end_ms=6000)
    args.update(kw)
    return br.refine_from_words(words, transcript=transcript, **args)


def test_prepare_transcript_strips_punctuation_and_collapses_elongation():
    assert br.prepare_transcript("えーーっと、今日は…晴れ。") == "えーっと今日は晴れ"
    assert br.prepare_transcript("「はい」！") == "はい"


def test_refines_to_first_and_last_speech_word():
    words = [
        w("<eps>", 0.0, 1.2),
        w("今日", 1.3, 1.8),
        w("は", 1.8, 1.9),
        w("晴れです", 1.9, 3.2),
        w("<eps>", 3.2, 4.0),
    ]
    r = decide(words, end_ms=4500)
    assert r.status == "refined"
    assert (r.start_ms, r.end_ms) == (2300, 4200)
    assert r.shift_start_ms == 300


def test_stretched_alignment_is_not_trusted():
    # 7 chars forced over 6 s = ~860 ms/char: text was stretched over music/other speech.
    r = decide([w("今日は晴れです", 0.5, 6.5)], window_start_ms=0)
    assert r.status == "unchanged" and "stretched" in r.flags
    assert (r.start_ms, r.end_ms) == (2000, 6000)


def test_speech_at_window_edge_is_not_trusted():
    r = decide([w("今日は晴れです", 0.01, 1.2)], window_start_ms=1000)
    assert r.status == "unchanged" and "hit-window-edge" in r.flags


def test_held_sound_is_flagged_but_still_refined():
    words = [w("んー", 1.0, 3.0, phones=["N", "N:"]), w("今日は晴れです", 3.0, 4.2)]
    r = decide(words, transcript="んー今日は晴れです")
    assert "held-sound" in r.flags
    assert r.status == "refined"


def test_large_shift_flagged_but_applied_and_huge_shift_rejected():
    big = decide([w("今日は晴れです", 1.6, 2.8)], window_start_ms=1000, end_ms=4200)
    assert big.status == "refined" and "large-shift" in big.flags
    huge = decide(
        [w("今日は晴れです", 4.0, 5.2)], window_start_ms=1000, start_ms=1000, end_ms=3000
    )
    assert huge.status == "unchanged" and "shift-too-large" in huge.flags


def test_no_speech_skips():
    assert decide([w("<eps>", 0, 3)]).status == "skipped"


def test_refine_span_degrades_when_aligner_down(monkeypatch, tmp_path):
    monkeypatch.setattr(br.clip, "clip_audio", lambda s, o, **k: o.write_bytes(b"x") or 1)
    monkeypatch.setattr(br.align_client, "align_audio", lambda *a: None)
    r = br.refine_span(tmp_path / "s.opus", "今日は晴れです", 2000, 6000)
    assert (r.status, r.start_ms, r.end_ms, r.reason) == (
        "skipped",
        2000,
        6000,
        "aligner-unavailable",
    )
