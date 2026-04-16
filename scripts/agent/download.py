"""Step 2: Source-audio preparation and temporary window materialization.

Input: episode dict with 'audio_url'
Output: sets episode['audio_source'] plus duration/mode metadata
"""

import os
import re
import subprocess

from .config import FFMPEG
from .utils import hash_key, log


REMOTE_INPUT_FLAGS = [
    "-rw_timeout", "30000000",
    "-timeout", "30000000",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "2",
    "-user_agent", "Mozilla/5.0",
]


def _is_remote_source(audio_source):
    return str(audio_source).startswith(("http://", "https://"))


def _ffmpeg_input_args(audio_source):
    args = []
    if _is_remote_source(audio_source):
        args.extend(REMOTE_INPUT_FLAGS)
    args.extend(["-i", str(audio_source)])
    return args


def probe_audio_duration(audio_source):
    """Probe audio duration in seconds for a local file or remote source."""
    cmd = ["ffprobe", "-v", "error"]
    if _is_remote_source(audio_source):
        cmd.extend(["-rw_timeout", "30000000", "-timeout", "30000000", "-user_agent", "Mozilla/5.0"])
    cmd.extend([
        "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1",
        str(audio_source),
    ])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        if result.returncode != 0:
            return None
        duration = float((result.stdout or "").strip() or 0)
        return duration if duration > 0 else None
    except Exception:
        return None


def materialize_audio_window(audio_source, start_time, end_time, output_path, bitrate="64k", timeout=180):
    """Materialize an audio window to a local MP3 for Whisper/QA use."""
    duration = max(0, float(end_time) - float(start_time))
    if duration <= 0:
        return False

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cmd = [
        FFMPEG, "-y",
        "-ss", str(max(0, round(float(start_time), 3))),
    ]
    cmd.extend(_ffmpeg_input_args(audio_source))
    cmd.extend([
        "-t", str(round(duration, 3)),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", bitrate,
        output_path,
    ])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 5000
    except Exception:
        return False


def _download_full_audio(audio_url, out_path):
    """Fallback: download the full source audio to a temp local MP3."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    try:
        curl_result = subprocess.run([
            "curl", "-L",
            "--connect-timeout", "20",
            "--max-time", "300",
            "-A", "Mozilla/5.0",
            "-o", out_path,
            audio_url,
        ], capture_output=True, text=True, timeout=310)
        if curl_result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
            return True
    except Exception:
        pass

    cmd = [FFMPEG, "-y"]
    cmd.extend(_ffmpeg_input_args(audio_url))
    cmd.extend([
        "-vn",
        "-ac", "1",
        "-ar", "22050",
        "-b:a", "96k",
        out_path,
    ])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 10000
    except Exception:
        return False


def download_audio(episode, tmp_dir):
    """Prepare an episode audio source for metadata-first processing.

    Primary path keeps the RSS source URL and tests whether remote chunk extraction works.
    Fallback downloads the full episode into tmp/raw for local chunking only.
    """
    audio_url = episode.get("audio_url", "")
    if not audio_url:
        log("  缺少 audio_url，无法处理", "error")
        return False

    log(f"Step 2: 准备源音频 - {episode['title'][:50]}", "step")

    duration = probe_audio_duration(audio_url)
    if duration:
        episode["audio_duration_sec"] = round(duration, 3)
        episode["audio_source"] = audio_url
        episode["audio_source_mode"] = "remote"

        test_dir = os.path.join(tmp_dir, "probes")
        test_path = os.path.join(test_dir, f"{hash_key(audio_url)}.mp3")
        if materialize_audio_window(audio_url, 0, min(duration, 12), test_path, timeout=120):
            try:
                os.remove(test_path)
            except OSError:
                pass
            log(f"  远端 chunk 可用，按源流直取 (总时长 {duration/60:.1f} 分钟)", "ok")
            return True
        log("  远端 seek/range 不稳定，回退整集临时下载", "warn")
    else:
        log("  远端无法直接探测音频时长，回退整集临时下载", "warn")

    title_safe = re.sub(r"[^\w\-]", "_", episode["title"])[:40]
    raw_dir = os.path.join(tmp_dir, "raw")
    full_path = os.path.join(raw_dir, f"{title_safe}_{hash_key(audio_url)[:10]}.mp3")

    if os.path.exists(full_path) and os.path.getsize(full_path) > 10000:
        local_duration = probe_audio_duration(full_path)
        if local_duration:
            episode["audio_duration_sec"] = round(local_duration, 3)
        episode["audio_source"] = full_path
        episode["audio_source_mode"] = "local_fallback"
        episode["local_audio"] = full_path
        log("  远端 seek 不稳定，命中本地整集缓存", "warn")
        return True

    if not _download_full_audio(audio_url, full_path):
        log("  整集临时下载失败", "error")
        return False

    local_duration = probe_audio_duration(full_path)
    if local_duration:
        episode["audio_duration_sec"] = round(local_duration, 3)
    episode["audio_source"] = full_path
    episode["audio_source_mode"] = "local_fallback"
    episode["local_audio"] = full_path
    size_mb = os.path.getsize(full_path) / (1024 * 1024)
    log(f"  临时整集音频已落地: {size_mb:.1f}MB", "ok")
    return True


def cleanup_episode_audio(episode):
    """Delete temporary full-episode fallback files after processing."""
    local_audio = episode.get("local_audio")
    if not local_audio:
        return
    try:
        if os.path.exists(local_audio):
            os.remove(local_audio)
    except OSError:
        pass
