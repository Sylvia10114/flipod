"""Tests for agent/transcribe.py chunk windowing and overlap merge."""

from agent.transcribe import build_chunk_windows, merge_chunk_transcript


class TestBuildChunkWindows:
    def test_builds_overlapping_windows(self):
        windows = build_chunk_windows(1205, chunk_seconds=600, overlap_seconds=3)
        assert windows == [(0.0, 600.0), (597.0, 1197.0), (1194.0, 1205.0)]


class TestMergeChunkTranscript:
    def test_merges_absolute_times_without_overlap_duplicates(self):
        merged = {"text": "", "words": [], "segments": []}

        first = {
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.4},
                {"word": "world", "start": 0.5, "end": 0.9},
                {"word": "again", "start": 599.2, "end": 599.6},
            ],
            "segments": [
                {"text": "Hello world.", "start": 0.0, "end": 0.9},
                {"text": "Again.", "start": 599.2, "end": 599.6},
            ],
        }
        second = {
            "words": [
                {"word": "again", "start": 2.2, "end": 2.6},
                {"word": "today", "start": 3.0, "end": 3.4},
            ],
            "segments": [
                {"text": "Again.", "start": 2.2, "end": 2.6},
                {"text": "Today.", "start": 3.0, "end": 3.4},
            ],
        }

        merge_chunk_transcript(merged, first, 0)
        merge_chunk_transcript(merged, second, 597)

        words = merged["words"]
        segments = merged["segments"]

        assert [w["word"] for w in words] == ["Hello", "world", "again", "today"]
        assert words[0]["start"] == 0.0
        assert words[-1]["start"] == 600.0
        assert [s["text"] for s in segments] == ["Hello world.", "Again.", "Today."]
        assert all(words[i]["start"] <= words[i + 1]["start"] for i in range(len(words) - 1))
        assert all(segments[i]["start"] <= segments[i + 1]["start"] for i in range(len(segments) - 1))
