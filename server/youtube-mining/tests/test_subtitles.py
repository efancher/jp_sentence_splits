from app.models import Cue
from app.subtitles import (
    align_parallel_text,
    dedupe_rolling_captions,
    load_cues_from_dir,
    parse_srt,
    parse_webvtt,
)


def test_parse_webvtt_basic() -> None:
    content = """WEBVTT

1
00:01:23.420 --> 00:01:25.810
今日はどこへ行くんですか。
"""
    cues = parse_webvtt(content)
    assert len(cues) == 1
    assert cues[0].startMs == 83420
    assert cues[0].endMs == 85810
    assert "今日" in cues[0].text


def test_parse_webvtt_strips_non_speech_captions() -> None:
    content = """WEBVTT

1
00:00:01.000 --> 00:00:03.000
[音楽]私の時はスナックに寄ってました。

2
00:00:03.000 --> 00:00:05.000
♪ ラーラーラー ♪ もう1ヶ月。
"""
    cues = parse_webvtt(content)
    assert cues[0].text == "私の時はスナックに寄ってました。"
    assert cues[1].text == "ラーラーラー もう1ヶ月。"


def test_parse_srt_basic() -> None:
    content = """1
00:00:01,000 --> 00:00:02,500
こんにちは

2
00:00:02,500 --> 00:00:04,000
世界
"""
    cues = parse_srt(content)
    assert len(cues) == 2
    assert cues[0].text == "こんにちは"


def test_parse_youtube_rolling_captions() -> None:
    content = """WEBVTT
Kind: captions
Language: ja

00:00:00.919 --> 00:00:05.829 align:start position:0%
~
あの、先輩っておいくつなんですか?

00:00:05.829 --> 00:00:05.839 align:start position:0%
~
~

00:00:05.839 --> 00:00:08.910 align:start position:0%
~
え、急に

00:00:08.910 --> 00:00:08.920 align:start position:0%
~
~

00:00:08.920 --> 00:00:12.310 align:start position:0%
~
いいから教えてくださいよ。

00:00:12.310 --> 00:00:12.320 align:start position:0%
~
~

00:00:12.320 --> 00:00:12.990 align:start position:0%
~
22

00:00:12.990 --> 00:00:13.000 align:start position:0%
22
~

00:00:13.000 --> 00:00:13.990 align:start position:0%
22
歳だよ。

00:00:13.990 --> 00:00:14.000 align:start position:0%
歳だよ。
~

00:00:14.000 --> 00:00:17.230 align:start position:0%
歳だよ。
え、同い年じゃないですか?
""".replace("~", " ")
    cues = parse_webvtt(content)
    texts = [cue.text for cue in cues]
    assert texts == [
        "あの、先輩っておいくつなんですか?",
        "え、急に",
        "いいから教えてくださいよ。",
        "22歳だよ。",
        "え、同い年じゃないですか?",
    ]
    assert all(cue.isAuto for cue in cues)
    merged = cues[3]
    assert merged.startMs == 12320
    assert merged.endMs == 13990
    assert cues[0].startMs == 919
    assert cues[0].endMs == 5829


def test_dedupe_rolling_captions() -> None:
    cues = [
        Cue(index=0, startMs=0, endMs=1000, text="今日は", isAuto=True),
        Cue(index=1, startMs=200, endMs=1500, text="今日はどこへ", isAuto=True),
        Cue(index=2, startMs=400, endMs=2000, text="今日はどこへ行くんですか。", isAuto=True),
        Cue(index=3, startMs=2500, endMs=3000, text="わかりました。", isAuto=True),
    ]
    deduped = dedupe_rolling_captions(cues)
    assert len(deduped) == 2
    assert deduped[0].text == "今日はどこへ行くんですか。"
    assert deduped[0].startMs == 0
    assert deduped[1].text == "わかりました。"


def test_align_parallel_text_by_timestamp_overlap() -> None:
    japanese = [
        Cue(index=0, startMs=1000, endMs=3000, text="こんにちは。"),
        Cue(index=1, startMs=3000, endMs=5000, text="元気ですか。"),
    ]
    english = [
        Cue(index=0, startMs=900, endMs=2900, text="Hello."),
        Cue(index=1, startMs=3100, endMs=5100, text="How are you?"),
    ]

    assert align_parallel_text(japanese, english) == {
        0: "Hello.",
        1: "How are you?",
    }


def test_align_parallel_text_assigns_overlapping_translation_only_once() -> None:
    japanese = [
        Cue(index=0, startMs=919, endMs=5829, text="おいくつですか。"),
        Cue(index=1, startMs=5839, endMs=8910, text="え、急に"),
    ]
    english = [
        Cue(index=0, startMs=210, endMs=5040, text="How old are you?"),
        Cue(index=1, startMs=5040, endMs=8080, text="Huh? All of a sudden?"),
    ]

    assert align_parallel_text(japanese, english) == {
        0: "How old are you?",
        1: "Huh? All of a sudden?",
    }


def test_load_cues_from_dir_selects_requested_language(tmp_path) -> None:
    subtitle_dir = tmp_path / "subtitles"
    subtitle_dir.mkdir()
    (subtitle_dir / "video.ja-orig.vtt").write_text(
        "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nこんにちは。\n",
        encoding="utf-8",
    )
    (subtitle_dir / "video.en-orig.vtt").write_text(
        "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.\n",
        encoding="utf-8",
    )

    assert load_cues_from_dir(subtitle_dir, language="ja")[0].text == "こんにちは。"
    assert load_cues_from_dir(subtitle_dir, language="en")[0].text == "Hello."
