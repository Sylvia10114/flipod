"""Tests for agent/cefr.py — word lookup and LLM fallback path."""

import pytest
from unittest.mock import patch
from agent.cefr import get_cefr, batch_cefr_annotation, CEFR_WORD_MAP


class TestGetCefr:
    def setup_method(self):
        # Seed some known words
        CEFR_WORD_MAP.clear()
        CEFR_WORD_MAP.update({
            "the": "A1",
            "hello": "A1",
            "economic": "B2",
            "sustainability": "C1",
        })

    def test_known_word(self):
        assert get_cefr("hello") == "A1"

    def test_known_word_with_punctuation(self):
        assert get_cefr("economic,") == "B2"

    def test_known_word_uppercase(self):
        assert get_cefr("THE") == "A1"

    def test_unknown_word(self):
        assert get_cefr("xyzzyplugh") is None

    def test_empty_string(self):
        assert get_cefr("") is None

    def test_punctuation_only(self):
        assert get_cefr("...") is None


class TestBatchCefrAnnotation:
    def setup_method(self):
        CEFR_WORD_MAP.clear()
        CEFR_WORD_MAP.update({"the": "A1", "cat": "A1"})

    def test_all_known_no_llm_call(self):
        lines = [{
            "en": "The cat.",
            "words": [
                {"word": "The", "start": 0, "end": 0.5, "cefr": "A1"},
                {"word": "cat", "start": 0.5, "end": 1.0, "cefr": "A1"},
            ]
        }]
        with patch("agent.cefr.call_gpt") as mock_gpt:
            result = batch_cefr_annotation(lines)
            mock_gpt.assert_not_called()
        assert result[0]["words"][0]["cefr"] == "A1"

    def test_unknown_words_trigger_llm(self):
        lines = [{
            "en": "The unprecedented cat.",
            "words": [
                {"word": "The", "start": 0, "end": 0.3, "cefr": "A1"},
                {"word": "unprecedented", "start": 0.3, "end": 0.8, "cefr": None},
                {"word": "cat", "start": 0.8, "end": 1.0, "cefr": "A1"},
            ]
        }]
        mock_response = '{"unprecedented": "C1"}'
        with patch("agent.cefr.call_gpt", return_value=mock_response):
            result = batch_cefr_annotation(lines)
        assert result[0]["words"][1]["cefr"] == "C1"

    def test_llm_failure_graceful(self):
        lines = [{
            "en": "The marvelous cat.",
            "words": [
                {"word": "The", "start": 0, "end": 0.3, "cefr": "A1"},
                {"word": "marvelous", "start": 0.3, "end": 0.8, "cefr": None},
                {"word": "cat", "start": 0.8, "end": 1.0, "cefr": "A1"},
            ]
        }]
        with patch("agent.cefr.call_gpt", return_value=None):
            result = batch_cefr_annotation(lines)
        # Should not crash; word stays None
        assert result[0]["words"][1]["cefr"] is None
