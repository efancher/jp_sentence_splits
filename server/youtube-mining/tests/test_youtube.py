from app.youtube import extract_video_id, info_to_source


def test_extract_video_id() -> None:
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("not a url") is None


def test_info_to_source_from_dict() -> None:
    source = info_to_source(
        {
            "id": "dQw4w9WgXcQ",
            "title": "Example",
            "channel": "Channel",
            "duration": 120.5,
            "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }
    )
    assert source.videoId == "dQw4w9WgXcQ"
    assert source.durationMs == 120500
    assert source.id == "source-dQw4w9WgXcQ"
