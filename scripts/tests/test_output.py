"""Tests for metadata-first clip validation and incremental tracking."""

import json

from agent.output import load_processed_episodes, validate_clip


def _sample_clip():
    return {
        "id": 101,
        "title": "A useful idea",
        "tag": "Business",
        "duration": 4.0,
        "clip_start_sec": 124.5,
        "clip_end_sec": 128.5,
        "difficulty": "B1+",
        "info_takeaway": "Learn a useful framing.",
        "source": {
            "podcast": "Demo Podcast",
            "episode": "Episode 1",
            "audio_url": "https://cdn.example.com/audio/episode.mp3?token=abc",
            "episode_url": "https://example.com/episodes/1",
            "feed_url": "https://example.com/feed.xml",
            "timestamp_start": "02:04",
            "timestamp_end": "02:08",
            "pub_date": "2026-04-16T00:00:00",
            "tier": "Business",
        },
        "lines": [
            {
                "start": 0.0,
                "end": 1.8,
                "en": "Hello world.",
                "zh": "你好，世界。",
                "words": [
                    {"word": "Hello", "start": 0.0, "end": 0.7, "cefr": "A1"},
                    {"word": "world", "start": 0.8, "end": 1.4, "cefr": "A1"},
                ],
            },
            {
                "start": 2.0,
                "end": 3.8,
                "en": "Nice to meet you.",
                "zh": "很高兴见到你。",
                "words": [
                    {"word": "Nice", "start": 2.0, "end": 2.4, "cefr": "A1"},
                    {"word": "to", "start": 2.5, "end": 2.7, "cefr": "A1"},
                    {"word": "meet", "start": 2.8, "end": 3.1, "cefr": "A2"},
                    {"word": "you", "start": 3.2, "end": 3.5, "cefr": "A1"},
                ],
            },
        ],
    }


class TestValidateClip:
    def test_accepts_metadata_only_clip(self, tmp_path):
        issues = validate_clip(_sample_clip(), str(tmp_path))
        assert issues == []

    def test_rejects_missing_audio_url(self, tmp_path):
        clip = _sample_clip()
        clip["source"]["audio_url"] = ""
        issues = validate_clip(clip, str(tmp_path))
        assert any("source.audio_url 缺失或非法" in issue for issue in issues)

    def test_rejects_invalid_clip_window(self, tmp_path):
        clip = _sample_clip()
        clip["clip_end_sec"] = clip["clip_start_sec"] - 1
        issues = validate_clip(clip, str(tmp_path))
        assert any("clip 时间窗非法" in issue for issue in issues)


class TestProcessedEpisodes:
    def test_load_processed_episodes_prefers_normalized_audio_url(self, tmp_path):
        new_clips = {
            "clips": [
                {
                    "id": 1,
                    "source": {
                        "audio_url": "HTTPS://CDN.EXAMPLE.COM/audio/episode.mp3?token=123",
                    },
                }
            ]
        }
        tracking = [
            "https://cdn.example.com/audio/other.mp3?x=1",
        ]

        (tmp_path / "new_clips.json").write_text(json.dumps(new_clips), encoding="utf-8")
        (tmp_path / "processed_episodes.json").write_text(json.dumps(tracking), encoding="utf-8")

        processed = load_processed_episodes(str(tmp_path))
        assert "https://cdn.example.com/audio/episode.mp3" in processed
        assert "https://cdn.example.com/audio/other.mp3" in processed
