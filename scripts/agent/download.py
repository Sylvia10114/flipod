"""Step 2: Audio download (ffmpeg direct + curl fallback).

Input: episode dict with 'audio_url'
Output: sets episode['local_audio'] on success, returns True/False
"""

import os
import re
import subprocess

from .config import FFMPEG
from .utils import log


def download_audio(episode, tmp_dir, max_seconds=300):
    """Download episode audio to *tmp_dir*, trimmed to *max_seconds*.

    On success, sets episode['local_audio'] and returns True.
    """
    title_safe = re.sub(r"[^\w\-]", "_", episode["title"])[:40]
    out_path = os.path.join(tmp_dir, f"{title_safe}.mp3")

    if os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
        log(f"  已存在，跳过下载: {title_safe}", "info")
        episode["local_audio"] = out_path
        return True

    log(f"Step 2: 下载音频 - {episode['title'][:50]}", "step")

    try:
        result = subprocess.run([
            FFMPEG, "-y",
            "-rw_timeout", "30000000",
            "-timeout", "30000000",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "2",
            "-user_agent", "Mozilla/5.0",
            "-t", str(max_seconds),
            "-i", episode["audio_url"],
            "-c", "copy",
            out_path
        ], capture_output=True, text=True, timeout=120)

        if result.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 10000:
            log(f"  直连下载失败，尝试 curl fallback: {result.stderr[:200]}", "warn")
            if not _download_via_curl_partial(episode["audio_url"], out_path, max_seconds):
                log(f"  下载失败: {result.stderr[:200]}", "error")
                return False

        size_kb = os.path.getsize(out_path) // 1024
        log(f"  下载完成: {size_kb}KB", "ok")
        episode["local_audio"] = out_path
        return True

    except subprocess.TimeoutExpired:
        log("  下载超时", "error")
        return False
    except Exception as e:
        log(f"  下载异常: {e}", "error")
        return False


def _download_via_curl_partial(audio_url, out_path, max_seconds=300):
    """Fallback: curl first N bytes, then trim with ffmpeg."""
    partial_path = f"{out_path}.partial.mp3"
    target_bytes = max(8 * 1024 * 1024, int(max_seconds * 80 * 1024))

    try:
        curl_result = subprocess.run([
            "curl", "-L",
            "--connect-timeout", "15",
            "--max-time", "180",
            "--range", f"0-{target_bytes - 1}",
            "-A", "Mozilla/5.0",
            "-o", partial_path,
            audio_url,
        ], capture_output=True, text=True, timeout=190)

        if curl_result.returncode != 0 or not os.path.exists(partial_path) or os.path.getsize(partial_path) < 50000:
            return False

        trim_result = subprocess.run([
            FFMPEG, "-y",
            "-i", partial_path,
            "-t", str(max_seconds),
            "-c", "copy",
            out_path,
        ], capture_output=True, text=True, timeout=90)

        return trim_result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 10000
    except Exception:
        return False
    finally:
        try:
            if os.path.exists(partial_path):
                os.remove(partial_path)
        except OSError:
            pass
