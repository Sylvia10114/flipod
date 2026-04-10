#!/usr/bin/env python3
"""
Podcast Clip Processor Agent v2
按照 AGENT-podcast-processor.md 规格实现。
从播客 RSS 自动发现、下载、转录、筛选片段、CEFR 标注、输出 data.json + mp3。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ──
AZURE_ENDPOINT = os.environ.get("AZURE_ENDPOINT", "https://us-east-02-gpt-01.openai.azure.com")
AZURE_API_KEY = os.environ["AZURE_API_KEY"]
WHISPER_DEPLOYMENT = "whisper0614"
WHISPER_API_VERSION = "2024-06-01"
GPT_DEPLOYMENT = "gpt-5.4-global-01"
GPT_API_VERSION = "2024-10-21"
FFMPEG = "/opt/homebrew/bin/ffmpeg"

LOG = []

# ── COCA-based CEFR mapping ──
# Approximate: COCA rank -> CEFR level
# We load a small built-in table for the most common ~8000 words
CEFR_WORD_MAP = {}

def init_cefr_map():
    """Initialize CEFR word map from cache or generate base table via LLM."""
    global CEFR_WORD_MAP
    cefr_cache_path = os.path.join(os.path.dirname(__file__) or ".", "cefr_wordlist.json")
    if os.path.exists(cefr_cache_path):
        with open(cefr_cache_path, "r") as f:
            CEFR_WORD_MAP = json.load(f)
        log(f"CEFR 词表已加载: {len(CEFR_WORD_MAP)} 词", "ok")
        if len(CEFR_WORD_MAP) >= 3000:
            return
        log("词表较小，将补充生成...", "info")

    # Generate base COCA-mapped CEFR table via LLM in batches
    log("生成 COCA-CEFR 基础词表（首次运行，约需 2 分钟）...", "step")
    coca_ranges = [
        ("A1", "1-200", 200),
        ("A2", "201-800", 600),
        ("B1", "801-2000", 1200),
        ("B2", "2001-4000", 2000),
        ("C1", "4001-7000", 3000),
        ("C2", "7001-10000", 3000),
    ]
    for level, rank_range, count in coca_ranges:
        existing_at_level = sum(1 for v in CEFR_WORD_MAP.values() if v == level)
        if existing_at_level > count * 0.5:
            continue
        prompt = f"""List the most common English words ranked approximately {rank_range} in COCA frequency.
Output exactly as a JSON array of lowercase strings, no explanations.
Give me {min(count, 500)} words. Only single words, no phrases."""
        response = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=4000)
        if not response:
            continue
        try:
            response = response.strip()
            if response.startswith("```"):
                response = re.sub(r"^```\w*\n?", "", response)
                response = re.sub(r"\n?```$", "", response)
            words = json.loads(response)
            for w in words:
                if isinstance(w, str) and w.lower() not in CEFR_WORD_MAP:
                    CEFR_WORD_MAP[w.lower()] = level
            log(f"  {level} ({rank_range}): +{len(words)} 词", "ok")
        except Exception as e:
            log(f"  {level} 生成失败: {e}", "error")

    # Save immediately
    with open(cefr_cache_path, "w") as f:
        json.dump(CEFR_WORD_MAP, f, ensure_ascii=False, indent=2)
    log(f"CEFR 基础词表已生成并缓存: {len(CEFR_WORD_MAP)} 词", "ok")


def get_cefr(word):
    """Get CEFR level for a word. Returns A1-C2 or None for proper nouns."""
    clean = re.sub(r"[^a-zA-Z']", "", word).lower()
    if not clean:
        return None
    # Proper noun heuristic: if original word starts with uppercase and isn't sentence-start
    if clean in CEFR_WORD_MAP:
        return CEFR_WORD_MAP[clean]
    return None  # will be batch-filled by LLM


STEP_TIMERS = {}  # step_name -> start_time

def log(msg, level="info"):
    entry = {"time": datetime.now().isoformat(), "level": level, "msg": msg}
    LOG.append(entry)
    icon = {"info": "ℹ️", "ok": "✅", "warn": "⚠️", "error": "❌", "step": "🔹"}.get(level, "  ")
    print(f"{icon} {msg}")

def step_start(name):
    """Mark the start of a timed step."""
    STEP_TIMERS[name] = time.time()

def step_end(name):
    """Return elapsed seconds since step_start, or None."""
    start = STEP_TIMERS.pop(name, None)
    if start is not None:
        return round(time.time() - start, 1)
    return None


# ── Step 0: Discover podcasts via iTunes ──
def discover_podcasts(keywords, feeds_per_keyword=5):
    feeds = []
    for kw in keywords:
        log(f"Step 0: 搜索关键词 '{kw}'...", "step")
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(kw)}&media=podcast&limit=20&lang=en_us"
        raw = fetch_url(url, timeout=15)
        if not raw:
            log(f"iTunes 搜索失败", "error")
            continue
        try:
            data = json.loads(raw)
        except Exception as e:
            log(f"iTunes 搜索解析失败: {e}", "error")
            continue

        count = 0
        for r in data.get("results", []):
            if count >= feeds_per_keyword:
                break
            feed_url = r.get("feedUrl")
            name = r.get("collectionName", "Unknown")
            if not feed_url:
                continue
            if any(skip in name.lower() for skip in ["kids", "children", "music only"]):
                log(f"  跳过（儿童/音乐）: {name}", "info")
                continue
            # Language filter: only English podcasts
            lang = (r.get("languageCodesISO2A", "") or "").lower()
            primary_genre = r.get("primaryGenreName", "").lower()
            if lang and lang not in ("en", ""):
                log(f"  跳过（非英语 lang={lang}）: {name}", "info")
                continue
            feeds.append({"url": feed_url, "name": name})
            log(f"  发现: {name}", "ok")
            count += 1

    log(f"共发现 {len(feeds)} 个播客 feed", "info")
    return feeds


# ── Step 1: Parse RSS ──
def fetch_url(url, timeout=20):
    """Fetch URL using curl (bypasses Python 3.9 SSL issues)."""
    try:
        result = subprocess.run(
            ["curl", "-s", "-L", "--connect-timeout", "10", "--max-time", str(timeout),
             "-A", "Mozilla/5.0", url],
            capture_output=True, timeout=timeout + 5
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout
    except Exception:
        pass
    return None


def parse_rss(feed_url, feed_name, episodes_per_feed=3):
    log(f"Step 1: 解析 RSS - {feed_name}", "step")
    xml_data = fetch_url(feed_url)
    if not xml_data:
        log(f"  RSS 获取失败", "error")
        return []

    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError as e:
        log(f"  RSS 解析失败: {e}", "error")
        return []

    channel = root.find("channel")
    if channel is None:
        return []

    episodes = []
    for item in channel.findall("item"):
        if len(episodes) >= episodes_per_feed:
            break
        title = item.findtext("title", "Untitled")
        enclosure = item.find("enclosure")
        if enclosure is None:
            continue
        audio_url = enclosure.get("url", "")
        audio_type = enclosure.get("type", "")
        if not audio_url or "audio" not in audio_type:
            continue
        link = item.findtext("link", "")
        desc = item.findtext("description", "")
        desc = re.sub(r"<[^>]+>", "", desc)[:500]

        episodes.append({
            "title": title,
            "audio_url": audio_url,
            "description": desc,
            "podcast_name": feed_name,
            "feed_url": feed_url,
            "episode_url": link,
        })
        log(f"  集: {title[:60]}", "info")

    log(f"  共 {len(episodes)} 集可处理", "ok")
    return episodes


# ── Step 2: Download audio ──
def download_audio(episode, tmp_dir, max_seconds=300):
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
            if not download_audio_via_curl_partial(episode["audio_url"], out_path, max_seconds):
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


def download_audio_via_curl_partial(audio_url, out_path, max_seconds=300):
    """Fallback downloader: curl first N bytes locally, then trim with ffmpeg."""
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


# ── Step 3: Whisper transcription ──
def transcribe_audio(audio_path):
    log("Step 3: 转录音频...", "step")

    url = (f"{AZURE_ENDPOINT}/openai/deployments/{WHISPER_DEPLOYMENT}"
           f"/audio/transcriptions?api-version={WHISPER_API_VERSION}")

    file_size = os.path.getsize(audio_path)
    if file_size > 25 * 1024 * 1024:
        log(f"  文件过大 ({file_size // 1024 // 1024}MB)，跳过", "warn")
        return None

    # Use curl to bypass Python 3.9 SSL issues
    for attempt in range(3):
        try:
            result = subprocess.run([
                "curl", "-s", "-X", "POST", url,
                "-H", f"api-key: {AZURE_API_KEY}",
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
                if attempt < 2: time.sleep(3)
                continue

            data = json.loads(result.stdout)
            if "error" in data:
                log(f"  Whisper API 错误 (尝试 {attempt+1}/3): {data['error'].get('message', '')[:200]}", "error")
                if attempt < 2: time.sleep(3)
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
            return {"text": data.get("text", ""), "words": words, "segments": segments}

        except Exception as e:
            log(f"  转录失败 (尝试 {attempt+1}/3): {e}", "error")
            if attempt < 2:
                time.sleep(3)

    return None


# ── Step 4: LLM segment identification ──
def call_gpt(messages, temperature=0.3, max_tokens=4000):
    """Call Azure GPT via curl (bypasses Python 3.9 SSL issues)."""
    url = (f"{AZURE_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
           f"/chat/completions?api-version={GPT_API_VERSION}")

    payload = json.dumps({
        "messages": messages,
        "temperature": temperature,
        "max_completion_tokens": max_tokens,
    })

    for attempt in range(3):
        try:
            result = subprocess.run([
                "curl", "-s", "-X", "POST", url,
                "-H", f"api-key: {AZURE_API_KEY}",
                "-H", "Content-Type: application/json",
                "-d", payload,
                "--connect-timeout", "15",
                "--max-time", "90",
            ], capture_output=True, text=True, timeout=100)

            if result.returncode != 0:
                log(f"  GPT curl 失败 (尝试 {attempt+1}/3): {result.stderr[:200]}", "error")
                if attempt < 2: time.sleep(5)
                continue

            data = json.loads(result.stdout)
            if "error" in data:
                log(f"  GPT API 错误 (尝试 {attempt+1}/3): {data['error'].get('message', '')[:200]}", "error")
                if attempt < 2: time.sleep(5)
                continue

            return data["choices"][0]["message"]["content"]
        except Exception as e:
            log(f"  GPT 调用失败 (尝试 {attempt+1}/3): {e}", "error")
            if attempt < 2:
                time.sleep(5)
    return None


def identify_segments(transcript, episode_info, clip_duration_min=60, clip_duration_max=120):
    log("Step 4: LLM 识别优质片段...", "step")

    segments = transcript["segments"]
    seg_text = ""
    for seg in segments:
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        text = seg.get("text", "").strip()
        seg_text += f"[{start:.1f}s - {end:.1f}s] {text}\n"

    prompt = f"""你是一个英语听力产品的内容筛选专家。以下是一集播客的转录文本（带时间戳）。

播客: {episode_info.get('podcast_name', '')}
集名: {episode_info.get('title', '')}

转录文本:
{seg_text[:12000]}

请从中识别 1-3 个适合作为独立听力片段的段落。

**核心要求（必须满足）**：
1. 不能是广告、赞助商口播、节目开头/结尾套话。
2. 时长 {clip_duration_min}-{clip_duration_max} 秒（英语约 150 词/分钟）。
3. 片段必须有一个相对完整的意思（不需要是完美的故事弧，但不能是半截话）。

**加分项（不强制）**：
- 开头有钩子或悬念
- 信息密度高
- 有故事性或趣味性

**重要：宁可多选不要漏选。** 只要不是广告且有一个完整的意思表达，就可以选。不要太挑剔。

返回纯 JSON（不要 markdown 代码块）：
{{
  "segments": [
    {{
      "start_time": 12.5,
      "end_time": 78.2,
      "text_preview": "前两句内容...",
      "reason": "选择原因",
      "suggested_title": "中文钩子标题（简短、有悬念、让人想听）",
      "suggested_tag": "Science",
      "hook_strength": "high/medium/low — 开头钩子吸引力",
      "completeness": "high/medium/low — 叙事完整度"
    }}
  ]
}}

标签从以下选择: Science, Culture, Business, Tech, Psychology, History, Health, Society, Storytelling, Language

如果整集没有合格片段，返回 {{"segments": []}}。"""

    response = call_gpt([{"role": "user", "content": prompt}])
    if not response:
        return []

    try:
        response = response.strip()
        if response.startswith("```"):
            response = re.sub(r"^```\w*\n?", "", response)
            response = re.sub(r"\n?```$", "", response)
        data = json.loads(response)
        result = data.get("segments", [])
        log(f"  识别到 {len(result)} 个片段", "ok")
        return result
    except json.JSONDecodeError as e:
        log(f"  LLM 输出解析失败: {e}", "error")
        log(f"  原始输出: {response[:300]}", "error")
        return []


# ── Step 5: Cut audio ──
def cut_audio(source_path, start_time, end_time, output_path):
    log(f"Step 5: 切割音频 [{start_time:.1f}s - {end_time:.1f}s]", "step")
    duration = end_time - start_time

    try:
        fade_out_start = max(0, duration - 0.3)
        result = subprocess.run([
            FFMPEG, "-y",
            "-ss", str(start_time),
            "-i", source_path,
            "-t", str(duration),
            "-af", f"afade=t=in:st=0:d=0.3,afade=t=out:st={fade_out_start}:d=0.3",
            "-b:a", "128k",
            output_path
        ], capture_output=True, text=True, timeout=30)

        if result.returncode != 0 or not os.path.exists(output_path):
            log(f"  切割失败: {result.stderr[:200]}", "error")
            return False

        silence_issue = detect_tail_silence(output_path)
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


def detect_tail_silence(audio_path, min_silence_duration=8.0, max_silence_ratio=0.35):
    """Detect clips whose back half is mostly silence.

    Returns a human-readable issue string when suspicious silence is found,
    otherwise returns None.
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


# ── LLM punctuation fallback ──
def llm_add_punctuation(raw_text):
    """When Whisper segments lack proper punctuation, use LLM to add it.
    Only called when a segment has >25 words without sentence-ending punctuation."""
    prompt = (
        "Below is an English podcast transcript that is missing punctuation. "
        "Add proper punctuation (periods, commas, question marks, exclamation marks) "
        "and capitalize the first letter of each sentence. "
        "Do NOT change, add, or remove any words — only add punctuation and fix capitalization.\n\n"
        f"Text: {raw_text}\n\n"
        "Output the corrected text only, nothing else."
    )
    result = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=2000)
    if result and result.strip():
        return result.strip()
    # Fallback: return original text unchanged
    return raw_text


def split_long_sentence(text, max_words=25):
    """Split a sentence that exceeds max_words at clause boundaries."""
    words = text.split()
    if len(words) <= max_words:
        return [text]

    # Try splitting at: semicolons, dashes, commas + conjunctions
    # Priority 1: semicolons
    parts = re.split(r';\s*', text)
    if len(parts) > 1:
        return [p.strip() for p in parts if p.strip()]

    # Priority 2: dashes
    parts = re.split(r'\s*[—–]\s*|\s+--\s+', text)
    if len(parts) > 1:
        return [p.strip() for p in parts if p.strip()]

    # Priority 3: comma + conjunction
    parts = re.split(r',\s*(?=and |but |or |so |because |although |when |while |if )', text)
    if len(parts) > 1:
        return [p.strip() for p in parts if p.strip()]

    # Give up, return as-is
    return [text]


# ── Step 6: Extract word timestamps + CEFR ──
def extract_clip_words(transcript, start_time, end_time):
    """Extract word-level timestamps for a clip, using segment text for sentence splitting.

    Whisper segments have punctuation; words don't. So we:
    1. Find segments overlapping the clip time range
    2. Split segment text into sentences by punctuation
    3. Map word-level timestamps onto each sentence by alignment
    """
    words = transcript["words"]
    segments = transcript.get("segments", [])

    # Collect all words in clip range (with zero-based timestamps)
    clip_words = []
    for w in words:
        ws = w.get("start", 0)
        we = w.get("end", 0)
        if ws >= start_time - 0.05 and we <= end_time + 0.05:
            clip_words.append({
                "word": w.get("word", "").strip(),
                "start": round(max(0, ws - start_time), 2),
                "end": round(max(0, we - start_time), 2),
            })

    if not clip_words:
        return []

    # Collect segment texts overlapping clip range, split into sentences
    # Three-tier strategy:
    #   Tier 1: Split by existing punctuation (.!?)
    #   Tier 2: If any "sentence" > 25 words, call LLM to add punctuation
    #   Tier 3: If still > 25 words, split at clause boundaries
    sentences = []

    for seg in segments:
        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", 0)
        # Segment overlaps clip range
        if seg_end <= start_time - 0.5 or seg_start >= end_time + 0.5:
            continue
        text = seg.get("text", "").strip()
        if not text:
            continue

        # Tier 1: Split by existing punctuation
        parts = re.split(r'(?<=[.!?])\s+', text)
        parts = [p.strip() for p in parts if p.strip()]

        # Tier 2: Check if any part is too long (missing punctuation)
        needs_llm = any(len(p.split()) > 25 for p in parts)
        if needs_llm:
            log(f"    Tier 2: LLM 补标点 (segment 有 {len(text.split())} 词无标点)", "info")
            punctuated = llm_add_punctuation(text)
            parts = re.split(r'(?<=[.!?])\s+', punctuated)
            parts = [p.strip() for p in parts if p.strip()]

        # Tier 3: Split remaining long sentences at clause boundaries
        final_parts = []
        for p in parts:
            if len(p.split()) > 25:
                final_parts.extend(split_long_sentence(p))
            else:
                final_parts.append(p)

        sentences.extend(final_parts)

    if not sentences:
        # Fallback: one big line
        en_text = " ".join(w["word"] for w in clip_words)
        for w in clip_words:
            w["cefr"] = get_cefr(w["word"])
        return [{
            "start": clip_words[0]["start"],
            "end": clip_words[-1]["end"],
            "en": en_text,
            "zh": "",
            "words": clip_words,
        }]

    # Map words to sentences by greedy alignment
    # For each sentence, consume words from clip_words that match
    lines = []
    word_idx = 0

    for sent in sentences:
        # Tokenize sentence into bare words for matching
        sent_tokens = re.findall(r"[a-zA-Z']+|\d+", sent)
        if not sent_tokens:
            continue

        matched_words = []
        scan_idx = word_idx

        for token in sent_tokens:
            # Find next matching word starting from scan_idx
            found = False
            for j in range(scan_idx, min(scan_idx + 5, len(clip_words))):
                clean_word = re.sub(r"[^a-zA-Z'0-9]", "", clip_words[j]["word"])
                if clean_word.lower() == token.lower():
                    matched_words.append(clip_words[j])
                    scan_idx = j + 1
                    found = True
                    break
            if not found:
                # Skip this token (punctuation artifact or mismatch)
                pass

        if matched_words:
            # Add CEFR to each word
            for mw in matched_words:
                mw["cefr"] = get_cefr(mw["word"])

            lines.append({
                "start": matched_words[0]["start"],
                "end": matched_words[-1]["end"],
                "en": sent,
                "zh": "",
                "words": matched_words,
            })
            word_idx = scan_idx

    # Pick up any remaining unmatched words as a final line
    if word_idx < len(clip_words):
        remaining = clip_words[word_idx:]
        for rw in remaining:
            rw["cefr"] = get_cefr(rw["word"])
        en_text = " ".join(w["word"] for w in remaining)
        if len(remaining) >= 2:
            lines.append({
                "start": remaining[0]["start"],
                "end": remaining[-1]["end"],
                "en": en_text,
                "zh": "",
                "words": remaining,
            })

    return lines


def batch_cefr_annotation(lines):
    """Use LLM to annotate words that don't have CEFR levels yet."""
    unknown_words = set()
    for line in lines:
        for w in line["words"]:
            if w["cefr"] is None:
                clean = re.sub(r"[^a-zA-Z']", "", w["word"]).lower()
                if clean and len(clean) > 1:
                    unknown_words.add(clean)

    if not unknown_words:
        return lines

    log(f"Step 6b: LLM 标注 {len(unknown_words)} 个未知 CEFR 词...", "step")

    word_list = sorted(unknown_words)[:200]  # batch limit
    prompt = f"""为以下英文单词标注 CEFR 等级（A1/A2/B1/B2/C1/C2）。
专有名词（人名、地名、品牌名）标注 null。

返回纯 JSON 对象，key 是单词，value 是 CEFR 等级字符串或 null：
{json.dumps(word_list)}"""

    response = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=2000)
    if not response:
        return lines

    try:
        response = response.strip()
        if response.startswith("```"):
            response = re.sub(r"^```\w*\n?", "", response)
            response = re.sub(r"\n?```$", "", response)
        cefr_map = json.loads(response)

        # Apply to words
        for line in lines:
            for w in line["words"]:
                if w["cefr"] is None:
                    clean = re.sub(r"[^a-zA-Z']", "", w["word"]).lower()
                    if clean in cefr_map:
                        w["cefr"] = cefr_map[clean]

        # Cache for future use
        CEFR_WORD_MAP.update({k: v for k, v in cefr_map.items() if v is not None})
        log(f"  CEFR 标注完成", "ok")

    except Exception as e:
        log(f"  CEFR 标注解析失败: {e}", "error")

    return lines


# ── Step 7: Translate ──
TRANSLATE_BATCH_SIZE = 10

def _translate_batch_json(batch_lines):
    """Translate a batch of lines using JSON format for reliable alignment."""
    n = len(batch_lines)
    en_array = [{"idx": i, "en": l["en"]} for i, l in enumerate(batch_lines)]

    for attempt in range(2):
        prompt = f"""将以下 {n} 句英文翻译成中文。要求：口语化、简洁、不要翻译腔。

返回纯 JSON 数组，每个元素包含 idx 和 zh 字段，按原顺序：
{json.dumps(en_array, ensure_ascii=False)}

只返回 JSON 数组，不要 markdown 代码块。"""

        response = call_gpt([{"role": "user", "content": prompt}], temperature=0.2)
        if not response:
            break

        try:
            text = response.strip()
            if text.startswith("```"):
                text = re.sub(r"^```\w*\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
            result = json.loads(text)

            if isinstance(result, list) and len(result) == n:
                for item in result:
                    idx = item.get("idx", -1)
                    zh = item.get("zh", "")
                    if 0 <= idx < n:
                        batch_lines[idx]["zh"] = zh
                return True
            else:
                log(f"    JSON 翻译数量不匹配: 期望 {n}, 得到 {len(result) if isinstance(result, list) else 'non-array'} (尝试 {attempt+1}/2)", "warn")
        except (json.JSONDecodeError, TypeError) as e:
            log(f"    JSON 翻译解析失败 (尝试 {attempt+1}/2): {e}", "warn")

    return False


def translate_lines(lines):
    log(f"Step 7: 翻译 {len(lines)} 句...", "step")
    total = len(lines)

    # Split into batches of TRANSLATE_BATCH_SIZE
    for batch_start in range(0, total, TRANSLATE_BATCH_SIZE):
        batch_end = min(batch_start + TRANSLATE_BATCH_SIZE, total)
        batch = lines[batch_start:batch_end]
        batch_n = len(batch)

        success = _translate_batch_json(batch)

        if not success:
            # Fallback: translate this batch one by one
            log(f"    批次 {batch_start+1}-{batch_end} 退回逐句翻译...", "warn")
            for line in batch:
                if line.get("zh"):
                    continue  # already translated
                prompt = f"将以下英文翻译成中文，口语化、简洁。只输出中文翻译。\n\n{line['en']}"
                response = call_gpt([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=200)
                line["zh"] = response.strip() if response else ""

    # Verify all lines have translations
    missing = sum(1 for l in lines if not l.get("zh"))
    if missing:
        log(f"  翻译完成，但有 {missing} 句缺失翻译", "warn")
    else:
        log(f"  翻译完成", "ok")

    return lines


# ── Main pipeline ──
def process_episode(episode, tmp_dir, output_dir, clip_id_start,
                    clip_duration_min=60, clip_duration_max=120, clips_per_episode=3):
    clips = []
    ep_start = time.time()

    step_start("download")
    if not download_audio(episode, tmp_dir):
        return clips
    dl_time = step_end("download")
    if dl_time: log(f"  ⏱ 下载耗时: {dl_time}s", "info")

    step_start("transcribe")
    transcript = transcribe_audio(episode["local_audio"])
    if not transcript:
        return clips
    asr_time = step_end("transcribe")
    if asr_time: log(f"  ⏱ 转录耗时: {asr_time}s", "info")

    # Check for ads
    first_words = " ".join(w.get("word", "") for w in transcript["words"][:50]).lower()
    ad_indicators = ["sponsor", "brought to you", "promo code", "subscribe", "patreon", "membership"]
    if any(ind in first_words for ind in ad_indicators):
        log("  检测到片头广告，LLM 会自动跳过", "warn")

    step_start("identify")
    segments = identify_segments(transcript, episode, clip_duration_min, clip_duration_max)
    if not segments:
        log("  该集无合格片段", "warn")
        return clips
    id_time = step_end("identify")
    if id_time: log(f"  ⏱ 片段识别耗时: {id_time}s", "info")

    for i, seg in enumerate(segments[:clips_per_episode]):
        clip_id = clip_id_start + len(clips)
        start_t = seg.get("start_time", 0)
        end_t = seg.get("end_time", 0)
        duration = end_t - start_t

        if duration < clip_duration_min * 0.7 or duration > clip_duration_max * 1.2:
            log(f"  片段 {i+1} 时长 {duration:.0f}s 超出范围，跳过", "warn")
            continue

        # Step 5: Cut
        clip_filename = f"clips/clip_{clip_id:03d}.mp3"
        clip_path = os.path.join(output_dir, clip_filename)
        if not cut_audio(episode["local_audio"], start_t, end_t, clip_path):
            continue

        # Step 6: Word timestamps + CEFR
        step_start(f"cefr_{clip_id}")
        lines = extract_clip_words(transcript, start_t, end_t)
        if not lines:
            log(f"  片段 {i+1} 无法提取字幕行，跳过", "warn")
            continue

        # Step 6b: CEFR batch annotation
        lines = batch_cefr_annotation(lines)
        cefr_time = step_end(f"cefr_{clip_id}")
        if cefr_time: log(f"  ⏱ CEFR 标注耗时: {cefr_time}s", "info")

        # Step 7: Translate
        step_start(f"translate_{clip_id}")
        lines = translate_lines(lines)
        tr_time = step_end(f"translate_{clip_id}")
        if tr_time: log(f"  ⏱ 翻译耗时: {tr_time}s", "info")

        # Assemble clip
        start_mm_ss = f"{int(start_t)//60:02d}:{int(start_t)%60:02d}"
        end_mm_ss = f"{int(end_t)//60:02d}:{int(end_t)%60:02d}"

        clip_data = {
            "id": clip_id,
            "title": seg.get("suggested_title", f"片段 {clip_id}"),
            "tag": seg.get("suggested_tag", "Culture"),
            "audio": clip_filename,
            "duration": round(duration, 1),
            "source": {
                "podcast": episode.get("podcast_name", ""),
                "episode": episode.get("title", ""),
                "episode_url": episode.get("episode_url", ""),
                "timestamp_start": start_mm_ss,
                "timestamp_end": end_mm_ss,
            },
            "lines": lines,
        }
        clips.append(clip_data)
        log(f"  ✨ 片段 {clip_id} 完成: {clip_data['title']}", "ok")

    ep_elapsed = round(time.time() - ep_start, 1)
    log(f"  ⏱ 本集总耗时: {ep_elapsed}s, 产出 {len(clips)} 个片段", "info")
    return clips


# ── Step 9: Validate output ──
def validate_clip(clip, output_dir):
    """Validate a single clip. Returns list of issues (empty = valid)."""
    issues = []
    cid = clip.get("id", "?")

    # Audio file exists and is non-trivial
    audio_path = os.path.join(output_dir, clip.get("audio", ""))
    if not os.path.exists(audio_path):
        issues.append(f"clip {cid}: 音频文件不存在 {clip.get('audio')}")
    elif os.path.getsize(audio_path) < 5000:
        issues.append(f"clip {cid}: 音频文件过小 ({os.path.getsize(audio_path)} bytes)")

    # Has lines
    lines = clip.get("lines", [])
    if not lines:
        issues.append(f"clip {cid}: 无字幕行")
        return issues

    # Check each line
    prev_end = -1
    for i, line in enumerate(lines):
        # Timestamp continuity (allow 1s gap max)
        if line["start"] < prev_end - 0.1:
            issues.append(f"clip {cid} line {i}: 时间戳重叠 (start {line['start']:.2f} < prev_end {prev_end:.2f})")
        if prev_end >= 0 and line["start"] - prev_end > 2.0:
            issues.append(f"clip {cid} line {i}: 时间戳间隙过大 ({line['start'] - prev_end:.1f}s)")
        prev_end = line["end"]

        # Has Chinese translation
        if not line.get("zh"):
            issues.append(f"clip {cid} line {i}: 缺少中文翻译")

        # Has words with timestamps
        words = line.get("words", [])
        if not words:
            issues.append(f"clip {cid} line {i}: 缺少词级时间戳")
        else:
            # Check CEFR coverage
            no_cefr = sum(1 for w in words if w.get("cefr") is None and re.sub(r"[^a-zA-Z']", "", w["word"]))
            if no_cefr > len(words) * 0.3:
                issues.append(f"clip {cid} line {i}: CEFR 标注覆盖率低 ({no_cefr}/{len(words)} 词无标注)")

    # Has title and tag
    if not clip.get("title"):
        issues.append(f"clip {cid}: 缺少标题")
    if not clip.get("tag"):
        issues.append(f"clip {cid}: 缺少标签")

    return issues


def validate_all_clips(clips, output_dir):
    """Validate all clips. Returns (valid_clips, all_issues)."""
    all_issues = []
    valid_clips = []
    for clip in clips:
        issues = validate_clip(clip, output_dir)
        if issues:
            for issue in issues:
                log(f"  校验问题: {issue}", "warn")
            # Only reject if critical issues (no audio, no lines)
            critical = any("音频文件不存在" in i or "无字幕行" in i for i in issues)
            if not critical:
                valid_clips.append(clip)
            else:
                log(f"  clip {clip.get('id', '?')} 因严重问题被剔除", "error")
        else:
            valid_clips.append(clip)
        all_issues.extend(issues)

    log(f"Step 9: 校验完成 - {len(valid_clips)}/{len(clips)} 通过", "ok" if not all_issues else "warn")
    return valid_clips, all_issues


def save_cefr_cache():
    """Save accumulated CEFR word map to disk."""
    if CEFR_WORD_MAP:
        cache_path = os.path.join(os.path.dirname(__file__) or ".", "cefr_wordlist.json")
        with open(cache_path, "w") as f:
            json.dump(CEFR_WORD_MAP, f, ensure_ascii=False, indent=2)
        log(f"CEFR 词表缓存已保存: {len(CEFR_WORD_MAP)} 词", "ok")


def main():
    parser = argparse.ArgumentParser(description="Podcast Clip Processor Agent v2")
    parser.add_argument("--keywords", type=str, help="Comma-separated search keywords")
    parser.add_argument("--feeds", type=str, help="Comma-separated RSS feed URLs")
    parser.add_argument("--feeds-per-keyword", type=int, default=5)
    parser.add_argument("--episodes-per-feed", type=int, default=5)
    parser.add_argument("--clips-per-episode", type=int, default=3)
    parser.add_argument("--clip-duration-min", type=int, default=60)
    parser.add_argument("--clip-duration-max", type=int, default=120)
    parser.add_argument("--output-dir", type=str, default="./output")
    parser.add_argument("--target-clips", type=int, default=5)
    parser.add_argument("--start-id", type=int, default=6)
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output_dir)
    clips_dir = os.path.join(output_dir, "clips")
    logs_dir = os.path.join(output_dir, "logs")
    tmp_dir = os.path.join(output_dir, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    os.makedirs(clips_dir, exist_ok=True)
    os.makedirs(logs_dir, exist_ok=True)

    main_start = time.time()
    log("=== Podcast Clip Processor Agent v2 ===", "step")
    log(f"输出目录: {output_dir}", "info")
    log(f"目标片段数: {args.target_clips}, 时长 {args.clip_duration_min}-{args.clip_duration_max}s", "info")

    init_cefr_map()

    # Collect feeds
    feeds = []
    if args.keywords:
        keywords = [k.strip() for k in args.keywords.split(",")]
        feeds.extend(discover_podcasts(keywords, args.feeds_per_keyword))
    if args.feeds:
        for url in args.feeds.split(","):
            url = url.strip()
            if url:
                feeds.append({"url": url, "name": "Manual Feed"})

    # Dedup feeds by URL
    seen_feed_urls = set()
    unique_feeds = []
    for feed in feeds:
        normalized = feed["url"].split("?")[0].rstrip("/").lower()
        if normalized not in seen_feed_urls:
            seen_feed_urls.add(normalized)
            unique_feeds.append(feed)
        else:
            log(f"  跳过重复 feed: {feed['name']}", "info")
    feeds = unique_feeds
    log(f"去重后 {len(feeds)} 个 feed", "info")

    if not feeds:
        log("没有可处理的 feed，退出", "error")
        sys.exit(1)

    # Process
    all_clips = []
    clip_id = args.start_id
    seen_episodes = set()  # dedup by audio URL

    for feed in feeds:
        if len(all_clips) >= args.target_clips:
            break

        episodes = parse_rss(feed["url"], feed["name"], args.episodes_per_feed)

        for ep in episodes:
            if len(all_clips) >= args.target_clips:
                break

            # Dedup episodes by audio URL
            ep_key = ep["audio_url"].split("?")[0].rstrip("/").lower()
            if ep_key in seen_episodes:
                log(f"  跳过重复集: {ep['title'][:50]}", "info")
                continue
            seen_episodes.add(ep_key)

            log(f"\n{'='*50}", "info")
            log(f"处理: {ep['podcast_name']} - {ep['title'][:50]}", "step")

            new_clips = process_episode(
                ep, tmp_dir, output_dir, clip_id,
                args.clip_duration_min, args.clip_duration_max,
                args.clips_per_episode,
            )
            for c in new_clips:
                if len(all_clips) >= args.target_clips:
                    break
                all_clips.append(c)
                clip_id += 1

    # Step 9: Validate
    log(f"\n{'='*50}", "info")
    all_clips, validation_issues = validate_all_clips(all_clips, output_dir)
    log(f"总计生成 {len(all_clips)} 个有效片段", "ok")

    # Write data.json (only new clips, not overwriting existing)
    data_path = os.path.join(output_dir, "new_clips.json")
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump({"clips": all_clips}, f, ensure_ascii=False, indent=2)
    log(f"新片段数据已写入: {data_path}", "ok")

    # Save CEFR cache
    save_cefr_cache()

    # Write processing log
    log_path = os.path.join(logs_dir, "processing_log.json")
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(LOG, f, ensure_ascii=False, indent=2)
    log(f"处理日志已写入: {log_path}", "ok")

    total_time = round(time.time() - main_start, 1)
    total_mins = int(total_time // 60)
    total_secs = int(total_time % 60)

    print(f"\n🎉 完成！生成了 {len(all_clips)} 个片段")
    print(f"   总耗时: {total_mins}分{total_secs}秒")
    print(f"   new_clips.json: {data_path}")
    for c in all_clips:
        print(f"   {c['audio']}: {c['title']}")

    # Summary log
    log(f"=== 运行总结 ===", "step")
    log(f"总耗时: {total_time}s ({total_mins}分{total_secs}秒)", "info")
    log(f"有效片段: {len(all_clips)}/{len(all_clips) + len(validation_issues)} 通过校验", "info")
    log(f"CEFR 词表: {len(CEFR_WORD_MAP)} 词", "info")
    error_count = sum(1 for e in LOG if e["level"] == "error")
    warn_count = sum(1 for e in LOG if e["level"] == "warn")
    if error_count or warn_count:
        log(f"错误: {error_count}, 警告: {warn_count}", "warn" if warn_count else "error")


if __name__ == "__main__":
    main()
