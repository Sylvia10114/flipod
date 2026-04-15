"""Tests for agent/translate.py — batch JSON translation and fallback."""

import json
import pytest
from unittest.mock import patch, call
from agent.translate import _translate_batch_json, translate_lines


class TestTranslateBatchJson:
    def test_successful_batch(self):
        lines = [
            {"en": "Hello world.", "zh": ""},
            {"en": "Good morning.", "zh": ""},
        ]
        mock_response = json.dumps([
            {"idx": 0, "zh": "你好世界。"},
            {"idx": 1, "zh": "早上好。"},
        ])
        with patch("agent.translate.call_gpt", return_value=mock_response):
            result = _translate_batch_json(lines)
        assert result is True
        assert lines[0]["zh"] == "你好世界。"
        assert lines[1]["zh"] == "早上好。"

    def test_count_mismatch_retries(self):
        lines = [
            {"en": "Hello.", "zh": ""},
            {"en": "World.", "zh": ""},
        ]
        # First call returns wrong count, second succeeds
        bad_response = json.dumps([{"idx": 0, "zh": "你好。"}])
        good_response = json.dumps([
            {"idx": 0, "zh": "你好。"},
            {"idx": 1, "zh": "世界。"},
        ])
        with patch("agent.translate.call_gpt", side_effect=[bad_response, good_response]):
            result = _translate_batch_json(lines)
        assert result is True
        assert lines[1]["zh"] == "世界。"

    def test_json_parse_failure(self):
        lines = [{"en": "Hello.", "zh": ""}]
        with patch("agent.translate.call_gpt", return_value="not json at all"):
            result = _translate_batch_json(lines)
        assert result is False

    def test_gpt_returns_none(self):
        lines = [{"en": "Hello.", "zh": ""}]
        with patch("agent.translate.call_gpt", return_value=None):
            result = _translate_batch_json(lines)
        assert result is False


class TestTranslateLines:
    def test_fallback_to_single_line(self):
        lines = [
            {"en": "Hello.", "zh": ""},
            {"en": "World.", "zh": ""},
        ]
        # Batch fails, then single-line calls succeed
        with patch("agent.translate.call_gpt") as mock_gpt:
            mock_gpt.side_effect = [
                None,  # batch attempt 1 fails
                "你好。",  # single line 1
                "世界。",  # single line 2
            ]
            translate_lines(lines)
        assert lines[0]["zh"] == "你好。"
        assert lines[1]["zh"] == "世界。"

    def test_already_translated_lines_skipped(self):
        lines = [
            {"en": "Hello.", "zh": "你好。"},
            {"en": "World.", "zh": ""},
        ]
        good_response = json.dumps([
            {"idx": 0, "zh": "你好。"},
            {"idx": 1, "zh": "世界。"},
        ])
        with patch("agent.translate.call_gpt", return_value=good_response):
            translate_lines(lines)
        # Both should have translations
        assert lines[0]["zh"] == "你好。"
        assert lines[1]["zh"] == "世界。"
