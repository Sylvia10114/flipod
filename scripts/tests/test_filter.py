"""Tests for agent/filter.py — each rule has pass + fail cases."""

import pytest
from agent.filter import (
    _check_duration,
    _check_start,
    _check_end_completeness,
    _check_ad_pattern,
    _check_repetition,
    filter_candidates,
)


# ── Rule 1: Duration ──────────────────────────────────────────

class TestDurationCheck:
    def test_normal_tier_pass(self):
        cand = {"start_time": 0, "end_time": 90, "duration_sec": 90}
        assert _check_duration(cand, "Business") is None

    def test_normal_tier_too_long(self):
        cand = {"start_time": 0, "end_time": 130, "duration_sec": 130}
        assert _check_duration(cand, "Tech") is not None

    def test_story_tier_allows_150(self):
        cand = {"start_time": 0, "end_time": 140, "duration_sec": 140}
        assert _check_duration(cand, "Story") is None

    def test_story_tier_too_long(self):
        cand = {"start_time": 0, "end_time": 160, "duration_sec": 160}
        assert _check_duration(cand, "Story") is not None

    def test_too_short(self):
        cand = {"start_time": 0, "end_time": 45, "duration_sec": 45}
        assert _check_duration(cand, "Business") is not None


# ── Rule 2: Start blacklist ───────────────────────────────────

class TestStartCheck:
    def test_clean_start_pass(self):
        cand = {"text": "Research shows that climate change affects crop yields significantly."}
        assert _check_start(cand) is None

    def test_hard_reject_echo_response(self):
        """Pure echo as standalone sentence → hard reject."""
        cand = {"text": "Exactly. That's what I was saying about the market."}
        result = _check_start(cand)
        assert result is not None
        assert "hard_reject" in result

    def test_hard_reject_antecedent_ref(self):
        """Reference to prior context in first 15 words → hard reject."""
        cand = {"text": "And that's exactly what you just said about the economy in your earlier point."}
        result = _check_start(cand)
        assert result is not None
        assert "antecedent" in result

    def test_soft_flag_but_not_rejected(self):
        """'But' opening with substance → soft flag, NOT rejected."""
        cand = {"text": "But here's the thing about artificial intelligence that nobody talks about in the industry."}
        result = _check_start(cand)
        assert result is None  # Not hard-rejected
        assert "soft_open_connective" in cand.get("soft_flags", [])

    def test_yeah_with_substance_not_rejected(self):
        """'Yeah' followed by substance → soft flag, NOT rejected."""
        cand = {"text": "Yeah. So Vortec watch company is like Vortex and Tik Tok combined into one brand."}
        result = _check_start(cand)
        assert result is None  # Not hard-rejected

    def test_clean_question_no_flags(self):
        """Direct question → no flags, no rejection."""
        cand = {"text": "Are you regular? Because most people aren't and they don't even know it."}
        result = _check_start(cand)
        assert result is None
        assert not cand.get("soft_flags")


# ── Rule 3: End completeness ─────────────────────────────────

class TestEndCompleteness:
    def test_proper_ending_pass(self):
        cand = {"text": "That's how the story ended."}
        assert _check_end_completeness(cand) is None

    def test_question_mark_pass(self):
        cand = {"text": "Can you believe what happened?"}
        assert _check_end_completeness(cand) is None

    def test_no_punctuation_fail(self):
        cand = {"text": "And then they went to the store and"}
        result = _check_end_completeness(cand)
        assert result is not None

    def test_dangling_word_fail(self):
        # Ends with "because" even if there's a period-ish scenario
        cand = {"text": "They left early because"}
        result = _check_end_completeness(cand)
        assert result is not None


# ── Rule 4: Ad/promo pattern ─────────────────────────────────

class TestAdPattern:
    def test_clean_text_pass(self):
        cand = {"text": "The economy grew by three percent last quarter and experts are optimistic."}
        assert _check_ad_pattern(cand) is None

    def test_sponsored_by_fail(self):
        cand = {"text": "This segment is sponsored by our friends at Squarespace."}
        result = _check_ad_pattern(cand)
        assert result is not None
        assert "sponsored" in result.lower()

    def test_subscribe_fail(self):
        cand = {"text": "Don't forget to subscribe to our newsletter for more updates."}
        result = _check_ad_pattern(cand)
        assert result is not None


# ── Rule 5: Internal silence (skipped — requires ffmpeg) ──────
# Tested via integration; unit test would need mocking subprocess.


# ── Rule 6: Repetition ───────────────────────────────────────

class TestRepetition:
    def test_normal_text_pass(self):
        cand = {"text": ("The discovery was made in a laboratory in Cambridge. "
                         "Scientists were examining samples under a microscope "
                         "when they noticed an unusual pattern. This pattern "
                         "suggested a new mechanism for protein folding "
                         "that had never been observed before in nature.")}
        assert _check_repetition(cand) is None

    def test_repetitive_text_fail(self):
        # Front and back share the same words
        words = (["the", "quick", "brown", "fox"] * 5 +
                 ["jumps", "over", "lazy", "dog"] * 3 +
                 ["the", "quick", "brown", "fox"] * 5)
        cand = {"text": " ".join(words)}
        result = _check_repetition(cand)
        assert result is not None
        assert "repetition" in result

    def test_short_text_skip(self):
        cand = {"text": "Hello world."}
        assert _check_repetition(cand) is None


# ── Integration: filter_candidates ────────────────────────────

class TestFilterCandidates:
    def test_good_candidate_passes(self):
        cand = {
            "start_time": 10, "end_time": 80, "duration_sec": 70,
            "text": "Research shows that the average person spends about two hours per day on their phone. "
                    "This has significant implications for productivity and mental health.",
            "hook_strength": "high",
        }
        # No audio path needed if we don't test silence check
        result = filter_candidates([cand], "/nonexistent/path.mp3", "Business", clips_per_episode=3)
        assert len(result) == 1
        assert result[0]["filter_result"] == "passed"

    def test_bad_candidate_rejected(self):
        cand = {
            "start_time": 10, "end_time": 80, "duration_sec": 70,
            "text": "So anyway this episode is sponsored by our friends at Audible and",
            "hook_strength": "low",
        }
        result = filter_candidates([cand], "/nonexistent/path.mp3", "Business", clips_per_episode=3)
        assert len(result) == 0
