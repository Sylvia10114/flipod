"""Step 3: Whisper transcription via Azure OpenAI.

Input: local audio file path
Output: dict {text, words, segments} or None
"""

import json
import os
import subprocess
import time

from . import config
from .utils import log


def _transcript_cache_path(audio_path):
    """派生 transcript 缓存路径：<dir>/<basename>.transcript.json

    存在 mp3 隔壁。单 episode 缓存 ~1MB，够 refilter / 调 filter / 调 prompt 反复复用，
    避免重烧 Whisper（~$0.30/集）。
    """
    base = os.path.splitext(audio_path)[0]
    return f"{base}.transcript.json"


def transcribe_audio(audio_path, use_cache=True):
    """Transcribe audio using Azure Whisper API (via curl).

    Returns {text, words, segments} on success, None on failure.
    Requires both word-level and segment-level timestamp_granularities.

    缓存策略（2026-04-14 加）：
    - 如果 audio_path 旁边已有 `<basename>.transcript.json`，直接读取返回。
    - 新转录成功后自动落盘到上述路径。
    - 测试/强制重转录时传 use_cache=False。
    """
    cache_path = _transcript_cache_path(audio_path)

    if use_cache and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            n_words = len(cached.get("words", []))
            n_segs = len(cached.get("segments", []))
            log(f"  📦 命中 transcript 缓存: {n_words} 词, {n_segs} 段 "
                f"({os.path.basename(cache_path)})", "ok")
            return cached
        except Exception as e:
            log(f"  ⚠️ 缓存读取失败, 重新转录: {e}", "warn")

    log("Step 3: 转录音频...", "step")

    url = (f"{config.WHISPER_ENDPOINT}/openai/deployments/{config.WHISPER_DEPLOYMENT}"
           f"/audio/transcriptions?api-version={config.WHISPER_API_VERSION}")

    file_size = os.path.getsize(audio_path)
    if file_size > 25 * 1024 * 1024:
        log(f"  文件过大 ({file_size // 1024 // 1024}MB)，跳过", "warn")
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
                "--max-time", "120",
            ], capture_output=True, text=True, timeout=130)

            if result.returncode != 0:
                log(f"  转录 curl 失败 (尝试 {attempt+1}/3): {result.stderr[:200]}", "error")
                if attempt < 2:
                    time.sleep(3)
                continue

            data = json.loads(result.stdout)
            if "error" in data:
                log(f"  Whisper API 错误 (尝试 {attempt+1}/3): {data['error'].get('message', '')[:200]}", "error")
                if attempt < 2:
                    time.sleep(3)
                continue

            words = data.get("words", [])
            segments = data.get("segments", [])

            if not words and not segments:
                log("  转录结果为空", "error")
                return None

            # Verify language is English
            detected_lang = data.get("language", "english").lower()
            if detected_lang not in ("english", "en"):
                log(f"  检测到非英语内容 (lang={detected_lang})，跳过", "warn")
                return None

            log(f"  转录完成: {len(words)} 词, {len(segments)} 段, 语言: {detected_lang}", "ok")
            transcript = {"text": data.get("text", ""), "words": words, "segments": segments}

            # 落盘缓存，下次命中无需重转录
            try:
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(transcript, f, ensure_ascii=False)
                log(f"  💾 transcript 缓存已写入: {os.path.basename(cache_path)}", "info")
            except Exception as e:
                log(f"  ⚠️ transcript 缓存写入失败 (忽略): {e}", "warn")

            return transcript

        except Exception as e:
            log(f"  转录失败 (尝试 {attempt+1}/3): {e}", "error")
            if attempt < 2:
                time.sleep(3)

    return None
