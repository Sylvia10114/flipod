"""Tests for audio_cut.py — boundary snap logic."""

import pytest
from agent.audio_cut import compute_segment_gaps, snap_boundary


# ── Mock Whisper segments ──────────────────────────────────────

MOCK_SEGMENTS = [
    {"start": 0.0, "end": 5.2, "text": "Welcome to the show."},
    {"start": 5.5, "end": 12.3, "text": "Today we're talking about climate."},
    # Gap: 12.3 → 15.0 (2.7s gap, midpoint = 13.65)
    {"start": 15.0, "end": 22.1, "text": "The research is clear."},
    # Gap: 22.1 → 22.5 (0.4s gap, midpoint = 22.3)
    {"start": 22.5, "end": 30.0, "text": "We need to act now."},
    # Gap: 30.0 → 33.0 (3.0s gap, midpoint = 31.5)
    {"start": 33.0, "end": 40.0, "text": "Thank you for listening."},
]


class TestComputeSegmentGaps:
    def test_finds_all_gaps(self):
        gaps = compute_segment_gaps(MOCK_SEGMENTS)
        # Should find 4 gaps between 5 segments
        assert len(gaps) == 4

    def test_gap_midpoints(self):
        gaps = compute_segment_gaps(MOCK_SEGMENTS)
        # First gap: 5.2 → 5.5, midpoint = 5.35
        assert abs(gaps[0][2] - 5.35) < 0.01
        # Second gap: 12.3 → 15.0, midpoint = 13.65
        assert abs(gaps[1][2] - 13.65) < 0.01

    def test_no_gaps_for_continuous(self):
        segments = [
            {"start": 0.0, "end": 5.0},
            {"start": 5.0, "end": 10.0},
        ]
        gaps = compute_segment_gaps(segments)
        assert len(gaps) == 0  # No actual gap


class TestSnapBoundary:
    def setup_method(self):
        self.gaps = compute_segment_gaps(MOCK_SEGMENTS)

    def test_snap_start_to_nearby_gap(self):
        # Target start is 14.0, nearest gap midpoint is 13.65 (within 2s window)
        snapped = snap_boundary(14.0, self.gaps, "start", window=2.0)
        assert abs(snapped - 13.65) < 0.01

    def test_snap_end_to_nearby_gap(self):
        # Target end is 22.0, nearest gap midpoint forward is 22.3 (within 2s)
        snapped = snap_boundary(22.0, self.gaps, "end", window=2.0)
        assert abs(snapped - 22.3) < 0.01

    def test_no_snap_when_no_gap_in_window(self):
        # Target at 8.0, nearest gaps are at 5.35 and 13.65 — both > 2s away
        snapped = snap_boundary(8.0, self.gaps, "start", window=2.0)
        assert snapped == 8.0  # Unchanged

    def test_no_snap_when_no_gaps(self):
        snapped = snap_boundary(10.0, [], "start")
        assert snapped == 10.0

    def test_snap_preserves_direction_start(self):
        # For start, prefer gaps before the target
        snapped = snap_boundary(13.0, self.gaps, "start", window=2.0)
        # Gap at 13.65 is after target but within tolerance
        assert snapped <= 14.0
