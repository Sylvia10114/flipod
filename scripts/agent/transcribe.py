"""Step 3: Whole-episode Whisper transcription via chunked temp audio.

Input: source audio URL or temp local file
Output: dict {text, words, segments} with absolute episode timestamps
"""

import json
import os
import shutil
import subprocess
import time

from . import config
from .download import materialize_audio_window, probe_audio_duration, _download_full_audio
from .utils import hash_key, log, normalize_audio_url


def _transcript_cache_path(audio_source, cache_dir):
    """Cache transcript by normalized source audio URL, not by local temp file path."""
    cache_key = hash_key(normalize_audio_url(audio_source) or str(audio_source))
    return os.path.join(cache_dir, f"{cache_key}.transcript.json")


def build_chunk_windows(duration_sec, chunk_seconds=600, overlap_seconds=3):
    """Build fixed-size chunk windows with a small overlap between adjacent chunks."""
    if duration_sec <= 0:
        return []

    windows = []
    start = 0.0
    duration_sec = float(duration_sec)
    while start < duration_sec - 0.01:
        end = min(duration_sec, start + chunk_seconds)
        windows.append((round(start, 3), round(end, 3)))
        if end >= duration_sec:
            break
        start = max(0.0, end - overlap_seconds)
    return windows


def _transcribe_local_file(audio_path):
    """Transcribe a local chunk using Azure Whisper API via curl."""
    url = (f"{config.WHISPER_ENDPOINT}/openai/deployments/{config.WHISPER_DEPLOYMENT}"
           f"/audio/transcriptions?api-version={config.WHISPER_API_VERSION}")

    file_size = os.path.getsize(audio_path)
    if file_size > 25 * 1024 * 1024:
        log(f"  Chunk 文件过大 ({file_size // 1024 // 1024}MB)，跳过", "warn")
        return None

    for attempt in range(3):
        try:
            result = subprocess.run([
                "curl", "-s", "-X", "POST", url,
                "-H", f"api-key: {config.WHISPER_API_KEY}",
                "-F", f"file=@{audio_path};type=audio/mpeg",
                "-F", "response_format=verbose_json",
                "-F", "timestamp_granularities[]=word",
                "-F", "timestamp_granularities[]=segment",
                "-F", "language=en",
                "--connect-timeout", "15",
                "--max-time", "240",
            ], capture_output=True, text=True, timeout=250)

            if result.returncode != 0:
                log(f"  chunk 转录 curl 失败 (尝试 {attempt+1}/3): {result.stderr[:200]}", "error")
                if attempt < 2:
                    time.sleep(3)
                continue

            data = json.loads(result.stdout)
            if "error" in data:
                log(f"  Whisper API 错误 (尝试 {attempt+1}/3): {data['error'].get('message', '')[:200]}", "error")
                if attempt < 2:
                    time.sleep(3)
                continue

            return {
                "text": data.get("text", ""),
                "words": data.get("words", []) or [],
                "segments": data.get("segments", []) or [],
                "language": (data.get("language") or "").lower(),
            }
        except Exception as e:
            log(f"  chunk 转录失败 (尝试 {attempt+1}/3): {e}", "error")
            if attempt < 2:
                time.sleep(3)

    return None


def merge_chunk_transcript(merged, chunk_transcript, chunk_start):
    """Merge one chunk transcript into an episode-level absolute transcript."""
    words = merged.setdefault("words", [])
    segments = merged.setdefault("segments", [])

    last_word_end = words[-1]["end"] if words else -1.0
    for word in chunk_transcript.get("words", []):
        abs_start = round(float(chunk_start) + float(word.get("start", 0)), 2)
        abs_end = round(float(chunk_start) + float(word.get("end", 0)), 2)
        if abs_end <= last_word_end + 0.05:
            continue
        merged_word = dict(word)
        merged_word["start"] = abs_start
        merged_word["end"] = abs_end
        words.append(merged_word)
        last_word_end = abs_end

    last_seg_end = segments[-1]["end"] if segments else -1.0
    for seg in chunk_transcript.get("segments", []):
        abs_start = round(float(chunk_start) + float(seg.get("start", 0)), 2)
        abs_end = round(float(chunk_start) + float(seg.get("end", 0)), 2)
        if abs_end <= last_seg_end + 0.05:
            continue
        merged_seg = dict(seg)
        merged_seg["start"] = abs_start
        merged_seg["end"] = abs_end
        segments.append(merged_seg)
        last_seg_end = abs_end

    merged["text"] = " ".join(seg.get("text", "").strip() for seg in segments if seg.get("text")).strip()
    return merged


def transcribe_audio(audio_source, tmp_dir, cache_dir, duration_sec=None, use_cache=True,
                     chunk_seconds=600, overlap_seconds=3):
    """Transcribe a full episode by chunking it into temporary audio windows."""
    cache_path = _transcript_cache_path(audio_source, cache_dir)

    if use_cache and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            log(
                f"  📦 命中整集 transcript 缓存: {len(cached.get('words', []))} 词, "
                f"{len(cached.get('segments', []))} 段 ({os.path.basename(cache_path)})",
                "ok",
            )
            return cached
        except Exception as e:
            log(f"  ⚠️ transcript 缓存读取失败, 重新转录: {e}", "warn")

    log("Step 3: 整集分块转录...", "step")

    os.makedirs(cache_dir, exist_ok=True)
    duration = duration_sec or probe_audio_duration(audio_source)
    if not duration:
        log("  无法探测音频总时长，无法分块转录", "error")
        return None

    current_source = audio_source
    current_duration = duration
    temp_local_source = None
    used_local_retry = False

    try:
        while True:
            chunk_dir = os.path.join(
                tmp_dir,
                "chunks",
                hash_key(normalize_audio_url(current_source) or str(current_source)),
            )
            os.makedirs(chunk_dir, exist_ok=True)
            windows = build_chunk_windows(
                current_duration,
                chunk_seconds=chunk_seconds,
                overlap_seconds=overlap_seconds,
            )
            total_chunks = len(windows)
            merged = {"text": "", "words": [], "segments": []}
            seen_english_content = False
            restart_with_local = False

            for idx, (chunk_start, chunk_end) in enumerate(windows, start=1):
                chunk_path = os.path.join(chunk_dir, f"chunk_{idx:03d}.mp3")
                if not materialize_audio_window(current_source, chunk_start, chunk_end, chunk_path, timeout=240):
                    if (
                        current_source == audio_source
                        and not used_local_retry
                        and str(audio_source).startswith(("http://", "https://"))
                    ):
                        raw_dir = os.path.join(tmp_dir, "raw")
                        os.makedirs(raw_dir, exist_ok=True)
                        temp_local_source = os.path.join(
                            raw_dir,
                            f"transcribe_fallback_{hash_key(normalize_audio_url(audio_source) or str(audio_source))[:12]}.mp3",
                        )
                        log("  远端 chunk materialize 失败，回退整集本地副本后重试", "warn")
                        if not _download_full_audio(audio_source, temp_local_source):
                            log(f"  chunk {idx}/{total_chunks} materialize 失败", "error")
                            return None
                        local_duration = probe_audio_duration(temp_local_source)
                        if local_duration:
                            current_duration = local_duration
                        current_source = temp_local_source
                        used_local_retry = True
                        restart_with_local = True
                        break
                    log(f"  chunk {idx}/{total_chunks} materialize 失败", "error")
                    return None

                log(
                    f"  chunk {idx}/{total_chunks}: {chunk_start/60:.1f}-{chunk_end/60:.1f} 分钟 "
                    f"({chunk_end - chunk_start:.0f}s)",
                    "info",
                )
                chunk_transcript = _transcribe_local_file(chunk_path)

                try:
                    os.remove(chunk_path)
                except OSError:
                    pass

                if chunk_transcript is None:
                    return None

                chunk_words = chunk_transcript.get("words", [])
                chunk_segments = chunk_transcript.get("segments", [])
                if not chunk_words and not chunk_segments:
                    log(f"  chunk {idx}/{total_chunks} 无有效语音内容，跳过", "warn")
                    continue

                detected_lang = chunk_transcript.get("language", "")
                if detected_lang and detected_lang not in ("english", "en"):
                    if not seen_english_content:
                        log(f"  检测到非英语内容 (lang={detected_lang})，整集跳过", "warn")
                        return None
                    log(f"  chunk {idx}/{total_chunks} 非英语 (lang={detected_lang})，跳过该块", "warn")
                    continue

                seen_english_content = True
                merge_chunk_transcript(merged, chunk_transcript, chunk_start)

            shutil.rmtree(chunk_dir, ignore_errors=True)
            if restart_with_local:
                continue

            if not merged["words"] and not merged["segments"]:
                log("  整集转录结果为空", "error")
                return None

            merged["duration_sec"] = round(float(current_duration), 2)

            try:
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(merged, f, ensure_ascii=False)
                log(f"  💾 整集 transcript 缓存已写入: {os.path.basename(cache_path)}", "info")
            except Exception as e:
                log(f"  ⚠️ transcript 缓存写入失败 (忽略): {e}", "warn")

            log(f"  转录完成: {len(merged['words'])} 词, {len(merged['segments'])} 段", "ok")
            return merged
    finally:
        if temp_local_source:
            try:
                if os.path.exists(temp_local_source):
                    os.remove(temp_local_source)
            except OSError:
                pass
