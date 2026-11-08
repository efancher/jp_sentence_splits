import json
import subprocess

import pytest

from app import asr_client, config


def test_choose_cuts_prefers_silence_nearest_target():
    cuts = asr_client.choose_cuts(
        1_500_000,
        [300_000, 470_000, 600_000, 940_000, 1_000_000],
        target_ms=480_000,
        min_ms=240_000,
        max_ms=720_000,
    )
    assert cuts == [470_000, 940_000]


def test_choose_cuts_hard_cuts_without_silence_and_keeps_tail_long():
    cuts = asr_client.choose_cuts(
        1_000_000, [], target_ms=480_000, min_ms=240_000, max_ms=720_000
    )
    assert cuts == [480_000]
    # A silence too close to the end would leave a tail below min_ms.
    cuts = asr_client.choose_cuts(
        730_000, [725_000], target_ms=480_000, min_ms=240_000, max_ms=720_000
    )
    assert cuts == [480_000]


def test_choose_cuts_short_source_is_one_chunk():
    assert asr_client.choose_cuts(
        600_000, [300_000], target_ms=480_000, min_ms=240_000, max_ms=720_000
    ) == []


@pytest.fixture
def chunked(tmp_path, monkeypatch):
    """A 'source' the client thinks is 30 min long, with scripted cuts."""
    audio = tmp_path / "src.ogg"
    audio.write_bytes(b"x" * 10)
    monkeypatch.setattr(config, "ANALYSIS_API_BASE", "http://asr.test")
    monkeypatch.setattr(config, "USE_ASR_TRANSCRIPT", True)
    monkeypatch.setattr(asr_client.clip, "probe_duration_ms", lambda _p: 1_800_000)
    monkeypatch.setattr(
        asr_client, "_silence_midpoints_ms", lambda _p: [480_000, 960_000, 1_440_000]
    )
    monkeypatch.setattr(
        asr_client, "_cut_chunk", lambda _a, _s, _e, dest: dest.write_bytes(b"w")
    )
    return audio


def _fake_post(calls, fail_on=None):
    def post(_path, _mime, _timeout):
        calls.append(1)
        if fail_on is not None and len(calls) == fail_on:
            raise RuntimeError("boom")
        return [
            {
                "text": f"文{len(calls)}。",
                "startMs": 1000,
                "endMs": 2000,
                "words": [{"text": "文", "startMs": 1000, "endMs": 1500}],
            }
        ]

    return post


def test_chunks_are_offset_onto_the_full_source(chunked, monkeypatch, tmp_path):
    calls: list[int] = []
    monkeypatch.setattr(asr_client, "_post_segments", _fake_post(calls))
    progress: list[str] = []
    cues = asr_client.transcribe_source(
        chunked, checkpoint_dir=tmp_path / "ck", on_progress=progress.append
    )
    assert [c.startMs for c in cues] == [1000, 481_000, 961_000, 1_441_000]
    assert cues[1].words[0].startMs == 481_000
    assert progress[-1] == "Transcribing audio… part 4 of 4"


def test_failed_chunk_falls_back_and_retry_resumes(chunked, monkeypatch, tmp_path):
    ck = tmp_path / "ck"
    calls: list[int] = []
    monkeypatch.setattr(asr_client, "_post_segments", _fake_post(calls, fail_on=3))
    assert asr_client.transcribe_source(chunked, checkpoint_dir=ck) is None
    assert len(calls) == 3  # chunks 1-2 done and checkpointed, 3 raised

    calls.clear()
    monkeypatch.setattr(asr_client, "_post_segments", _fake_post(calls))
    cues = asr_client.transcribe_source(chunked, checkpoint_dir=ck)
    assert len(calls) == 2  # only chunks 3 and 4 are transcribed again
    assert len(cues) == 4


def test_changed_source_discards_stale_chunks(chunked, monkeypatch, tmp_path):
    ck = tmp_path / "ck"
    ck.mkdir()
    (ck / "manifest.txt").write_text("other-source")
    (ck / "chunk_1.json").write_text(
        json.dumps([{"text": "古い。", "startMs": 0, "endMs": 1}])
    )
    calls: list[int] = []
    monkeypatch.setattr(asr_client, "_post_segments", _fake_post(calls))
    cues = asr_client.transcribe_source(chunked, checkpoint_dir=ck)
    assert len(calls) == 4
    assert all(c.text != "古い。" for c in cues)


def test_short_source_is_a_single_unchunked_request(chunked, monkeypatch):
    monkeypatch.setattr(asr_client.clip, "probe_duration_ms", lambda _p: 600_000)
    seen: list[str] = []
    monkeypatch.setattr(
        asr_client,
        "_post_segments",
        lambda _p, mime, _t: seen.append(mime)
        or [{"text": "あ。", "startMs": 0, "endMs": 5}],
    )
    assert len(asr_client.transcribe_source(chunked)) == 1
    assert seen == ["audio/ogg"]


def test_silence_midpoints_parse_ffmpeg_output(monkeypatch):
    stderr = (
        "[silencedetect] silence_start: 10.0\n"
        "[silencedetect] silence_end: 12.0 | silence_duration: 2\n"
        "[silencedetect] silence_start: 20.5\n"
        "[silencedetect] silence_end: 21.5 | silence_duration: 1\n"
    )
    monkeypatch.setattr(
        asr_client.subprocess,
        "run",
        lambda *a, **_k: subprocess.CompletedProcess(a, 0, stdout="", stderr=stderr),
    )
    assert asr_client._silence_midpoints_ms(None) == [11_000, 21_000]
