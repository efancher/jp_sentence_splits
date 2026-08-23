from app.models import Cue
from app.resegment import merge_incomplete_cues, resegment_cues, split_multi_sentence_cues


def test_merge_incomplete_cues_joins_cutoff_sentence() -> None:
    cues = [
        Cue(index=0, startMs=0, endMs=1000, text="今日はどこへ"),
        Cue(index=1, startMs=1000, endMs=2000, text="行くんですか。"),
        Cue(index=2, startMs=2500, endMs=3000, text="わかりました。"),
    ]
    merged = merge_incomplete_cues(cues)
    assert [cue.text for cue in merged] == [
        "今日はどこへ行くんですか。",
        "わかりました。",
    ]
    assert merged[0].startMs == 0
    assert merged[0].endMs == 2000


def test_merge_incomplete_cues_keeps_trailing_fragment() -> None:
    """A track can simply end mid-sentence — don't drop the last fragment."""
    cues = [
        Cue(index=0, startMs=0, endMs=1000, text="こんにちは。"),
        Cue(index=1, startMs=1000, endMs=2000, text="それから"),
    ]
    merged = merge_incomplete_cues(cues)
    assert [cue.text for cue in merged] == ["こんにちは。", "それから"]


def test_merge_incomplete_cues_handles_closing_bracket_after_punctuation() -> None:
    cues = [
        Cue(index=0, startMs=0, endMs=1000, text="彼は「はい"),
        Cue(index=1, startMs=1000, endMs=2000, text="そうです。」と言った。"),
    ]
    merged = merge_incomplete_cues(cues)
    assert len(merged) == 1
    assert merged[0].text == "彼は「はいそうです。」と言った。"


def test_split_multi_sentence_cues_divides_bundled_caption() -> None:
    cue = Cue(index=0, startMs=0, endMs=1000, text="それはすごい。今日は晴れです。")
    split = split_multi_sentence_cues([cue])
    assert [c.text for c in split] == ["それはすごい。", "今日は晴れです。"]
    # Timing divided proportionally by character count and contiguous.
    assert split[0].startMs == 0
    assert split[0].endMs == split[1].startMs
    assert split[1].endMs == 1000


def test_split_multi_sentence_cues_leaves_single_sentence_untouched() -> None:
    cue = Cue(index=0, startMs=100, endMs=200, text="こんにちは。")
    split = split_multi_sentence_cues([cue])
    assert len(split) == 1
    assert split[0].startMs == 100
    assert split[0].endMs == 200


def test_resegment_cues_merges_then_splits() -> None:
    # One cue is a cut-off fragment; once merged with the next, the combined
    # text turns out to bundle two sentences that should end up separate.
    cues = [
        Cue(index=0, startMs=0, endMs=500, text="彼は来た。今日は"),
        Cue(index=1, startMs=500, endMs=1000, text="晴れです。"),
    ]
    result = resegment_cues(cues)
    assert [cue.text for cue in result] == ["彼は来た。", "今日は晴れです。"]
    assert [cue.index for cue in result] == [0, 1]
