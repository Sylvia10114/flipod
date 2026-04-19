"""Step 5: Audio cutting with boundary snap to natural pauses.

Input: source audio path, start/end times, Whisper segments
Output: trimmed MP3 file with fade in/out
"""

import os
import re
import subprocess

from .config import FFMPEG
from .utils import log


REMOTE_INPUT_FLAGS = [
    "-rw_timeout", "30000000",
    "-timeout", "30000000",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "2",
    "-user_agent", "Mozilla/5.0",
]


def _ffmpeg_input_args(source_path):
    args = []
    if str(source_path).startswith(("http://", "https://")):
        args.extend(REMOTE_INPUT_FLAGS)
    args.extend(["-i", str(source_path)])
    return args


def _cut_timeout_seconds(source_path):
    return 150 if str(source_path).startswith(("http://", "https://")) else 60


def compute_segment_gaps(segments):
    """Compute gaps between consecutive Whisper segments.

    Returns list of (gap_start, gap_end, gap_midpoint) sorted by time.
    """
    gaps = []
    for i in range(len(segments) - 1):
        prev_end = segments[i].get("end", 0)
        next_start = segments[i + 1].get("start", 0)
        gap = next_start - prev_end
        if gap > 0.05:  # Only meaningful gaps
            midpoint = prev_end + gap / 2
            gaps.append((prev_end, next_start, midpoint))
    return gaps


def snap_boundary(target_time, gaps, direction, window=2.0):
    """Snap a cut boundary to the nearest segment gap within a window.

    Args:
        target_time: original cut time
        gaps: list of (gap_start, gap_end, gap_midpoint)
        direction: 'start' (search backward) or 'end' (search forward)
        window: max search distance in seconds

    Returns:
        snapped time (gap midpoint), or original time if no gap found.
    """
    best_gap = None
    best_dist = float("inf")

    for gap_start, gap_end, midpoint in gaps:
        if direction == "start":
            # Look for gaps within [target - window, target]
            if gap_start < target_time - window:
                continue
            if midpoint > target_time + 0.5:
                continue
            dist = abs(target_time - midpoint)
        else:  # end
            # Look for gaps within [target, target + window]
            if midpoint < target_time - 0.5:
                continue
            if gap_end > target_time + window:
                continue
            dist = abs(target_time - midpoint)

        if dist < best_dist:
            best_dist = dist
            best_gap = midpoint

    if best_gap is not None:
        return best_gap
    return target_time


def cut_audio(source_path, start_time, end_time, output_path, segments=None):
    """Cut audio from source_path and apply fade in/out.

    If Whisper segments are provided, snaps boundaries to natural pauses.
    Returns True on success.
    """
    # Snap boundaries if segments available
    original_start, original_end = start_time, end_time
    if segments:
        gaps = compute_segment_gaps(segments)
        start_time = snap_boundary(start_time, gaps, "start")
        end_time = snap_boundary(end_time, gaps, "end")
        if start_time != original_start or end_time != original_end:
            log(f"  Snap: [{original_start:.1f}s-{original_end:.1f}s] → "
                f"[{start_time:.1f}s-{end_time:.1f}s]", "info")

    duration = end_time - start_time
    log(f"Step 5: 切割音频 [{start_time:.1f}s - {end_time:.1f}s]", "step")

    try:
        fade_out_start = max(0, duration - 0.3)
        cmd = [
            FFMPEG, "-y",
            "-ss", str(start_time),
        ]
        cmd.extend(_ffmpeg_input_args(source_path))
        cmd.extend([
            "-t", str(duration),
            "-af", f"afade=t=in:st=0:d=0.3,afade=t=out:st={fade_out_start}:d=0.3",
            "-b:a", "128k",
            output_path
        ])
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=_cut_timeout_seconds(source_path),
        )

        if result.returncode != 0 or not os.path.exists(output_path):
            log(f"  切割失败: {result.stderr[:200]}", "error")
            return False

        silence_issue = _detect_tail_silence(output_path)
        if silence_issue:
            log(f"  切割结果异常静音: {silence_issue}", "error")
            try:
                os.remove(output_path)
            except OSError:
                pass
            return False

        size_kb = os.path.getsize(output_path) // 1024
        log(f"  切割完成: {size_kb}KB, {duration:.1f}s", "ok")
        return True

    except Exception as e:
        log(f"  切割异常: {e}", "error")
        return False


def _detect_tail_silence(audio_path, min_silence_duration=8.0, max_silence_ratio=0.35):
    """Detect clips whose back half is mostly silence.

    Returns a human-readable issue string or None.
    """
    try:
        probe = subprocess.run([
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1",
            audio_path
        ], capture_output=True, text=True, timeout=15)
        if probe.returncode != 0:
            return None
        duration = float(probe.stdout.strip() or 0)
        if duration <= 0:
            return None

        result = subprocess.run([
            FFMPEG, "-hide_banner", "-i", audio_path,
            "-af", "silencedetect=noise=-35dB:d=2",
            "-f", "null", "-"
        ], capture_output=True, text=True, timeout=30)
        if result.returncode not in (0, 255):
            return None

        starts = [float(x) for x in re.findall(r"silence_start:\s*([0-9.]+)", result.stderr)]
        ends = [
            (float(end), float(silence_duration))
            for end, silence_duration in re.findall(
                r"silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)",
                result.stderr
            )
        ]

        if starts and len(ends) < len(starts):
            ends.append((duration, duration - starts[-1]))

        for idx, start in enumerate(starts):
            silence_end, silence_duration = ends[idx]
            if silence_duration < min_silence_duration:
                continue
            if start >= duration * 0.5:
                return f"尾段静音 {silence_duration:.1f}s ({start:.1f}s - {silence_end:.1f}s)"
            if silence_duration / duration >= max_silence_ratio:
                return f"长静音占比过高 {silence_duration:.1f}s / {duration:.1f}s"
    except Exception:
        return None

    return None
