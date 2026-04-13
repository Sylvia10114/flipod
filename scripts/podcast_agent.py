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
# Whisper (Azure OpenAI - US East)
WHISPER_ENDPOINT = os.environ.get("AZURE_WHISPER_OPENAI_ENDPOINT", "https://us-east-02-gpt-01.openai.azure.com")
WHISPER_API_KEY = os.environ.get("AZURE_WHISPER_OPENAI_API_KEY", "7d4766345d824df1b03d378b59dade54")
WHISPER_DEPLOYMENT = os.environ.get("AZURE_WHISPER_OPENAI_DEPLOYMENT", "whisper0614")
WHISPER_API_VERSION = os.environ.get("AZURE_WHISPER_OPENAI_API_VERSION", "2024-06-01")
# GPT (Azure OpenAI - Sweden Central)
GPT_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "https://sweden-central-gpt-01.openai.azure.com")
GPT_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY", "108e3a3c831340db943b043c8e943c18")
GPT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5-chat-global-01")
GPT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")
FFMPEG = "/opt/homebrew/bin/ffmpeg"

LOG = []

# ── Curated Feeds: Tier 1 手动精选源 ──
# 每个 tier 有不同的时效窗口和刷新策略
CONTENT_TIERS = {
    "Business": {"max_age_days": 7, "refresh": "weekly", "priority": 1},
    "Tech":     {"max_age_days": 7, "refresh": "weekly", "priority": 1},
    "Science":  {"max_age_days": 30, "refresh": "biweekly", "priority": 2},
    "Psychology": {"max_age_days": 30, "refresh": "monthly", "priority": 3},
    "Culture":  {"max_age_days": 30, "refresh": "monthly", "priority": 3},
    "Storytelling": {"max_age_days": 365, "refresh": "evergreen", "priority": 4},
}

# Tier 1: 精选播客源（高质量、稳定更新、英语原生）
# 格式: {"url": RSS_URL, "name": 显示名, "tier": "Business"|"Tech"|..., "info_weight": 0-1}
CURATED_FEEDS = [
    # ── Business / Finance ──
    {"url": "https://feeds.npr.org/510318/podcast.xml", "name": "Up First (NPR)", "tier": "Business", "info_weight": 0.9},
    {"url": "https://feeds.publicradio.org/public_feeds/marketplace", "name": "Marketplace (APM)", "tier": "Business", "info_weight": 0.85},
    {"url": "https://feeds.npr.org/510289/podcast.xml", "name": "Planet Money", "tier": "Business", "info_weight": 0.8},
    {"url": "https://feeds.megaphone.fm/ROOSTER7199250968", "name": "How I Built This", "tier": "Business", "info_weight": 0.7},
    {"url": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/825d4e29-b616-46f4-afd7-ae2b0013005c/8b1dd624-a026-43e9-8b57-ae2b00130066/podcast.rss", "name": "Big Take (Bloomberg)", "tier": "Business", "info_weight": 0.9},
    # ── Tech ──
    {"url": "https://feeds.simplecast.com/JGE3yC0V", "name": "Hard Fork (NYT)", "tier": "Tech", "info_weight": 0.9},
    {"url": "https://lexfridman.com/feed/podcast/", "name": "Lex Fridman Podcast", "tier": "Tech", "info_weight": 0.75},
    {"url": "https://feeds.megaphone.fm/vergecast", "name": "The Vergecast", "tier": "Tech", "info_weight": 0.85},
    {"url": "https://feeds.megaphone.fm/ridehome", "name": "Tech Brew Ride Home", "tier": "Tech", "info_weight": 0.7},
    # ── Science ──
    {"url": "https://feeds.npr.org/510351/podcast.xml", "name": "Short Wave (NPR)", "tier": "Science", "info_weight": 0.75},
    {"url": "https://www.nasa.gov/feeds/podcasts/curious-universe", "name": "NASA Curious Universe", "tier": "Science", "info_weight": 0.65},
    {"url": "https://feeds.megaphone.fm/sciencevs", "name": "Science Vs", "tier": "Science", "info_weight": 0.75},
    # ── Psychology / Culture ──
    {"url": "https://feeds.simplecast.com/kwWc0lhf", "name": "Hidden Brain (NPR)", "tier": "Psychology", "info_weight": 0.7},
    {"url": "https://feeds.npr.org/510333/podcast.xml", "name": "Throughline (NPR)", "tier": "Culture", "info_weight": 0.75},
    {"url": "https://feeds.npr.org/510298/podcast.xml", "name": "TED Radio Hour", "tier": "Culture", "info_weight": 0.7},
    # ── Storytelling (evergreen) ──
    {"url": "https://snap.feed.snapjudgment.org", "name": "Snap Judgment", "tier": "Storytelling", "info_weight": 0.5},
    {"url": "https://feeds.npr.org/510200/podcast.xml", "name": "StoryCorps", "tier": "Storytelling", "info_weight": 0.5},
]

# Tier 2 动态补充的搜索关键词（当 Tier 1 内容不够时启用）
TIER2_KEYWORDS = {
    "Business": ["business news podcast", "startup podcast", "economy podcast english"],
    "Tech":     ["technology news podcast", "AI podcast", "silicon valley podcast"],
    "Science":  ["science podcast english", "physics podcast", "biology podcast"],
    "Psychology": ["psychology podcast", "behavioral science podcast"],
    "Culture":  ["culture podcast english", "society podcast"],
    "Storytelling": ["storytelling podcast", "true stories podcast english"],
}

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


def parse_rss(feed_url, feed_name, episodes_per_feed=3, max_age_days=None):
    """Parse RSS feed. If max_age_days is set, only return episodes published within that window."""
    log(f"Step 1: 解析 RSS - {feed_name}" + (f" (最近{max_age_days}天)" if max_age_days else ""), "step")
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
    now = datetime.now()
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

        # Time window filtering
        pub_date_str = item.findtext("pubDate", "")
        pub_date = None
        if pub_date_str and max_age_days:
            try:
                # RFC 2822 format typical in RSS
                from email.utils import parsedate_to_datetime
                pub_date = parsedate_to_datetime(pub_date_str)
                age_days = (now - pub_date.replace(tzinfo=None)).days
                if age_days > max_age_days:
                    log(f"  跳过（{age_days}天前）: {title[:50]}", "info")
                    continue
            except Exception:
                pass  # Can't parse date, don't filter

        link = item.findtext("link", "")
        desc = item.findtext("description", "")
        desc = re.sub(r"<[^>]+>", "", desc)[:500]

        ep = {
            "title": title,
            "audio_url": audio_url,
            "description": desc,
            "podcast_name": feed_name,
            "feed_url": feed_url,
            "episode_url": link,
        }
        if pub_date:
            ep["pub_date"] = pub_date.isoformat()
        episodes.append(ep)
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

    url = (f"{WHISPER_ENDPOINT}/openai/deployments/{WHISPER_DEPLOYMENT}"
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
                "-H", f"api-key: {WHISPER_API_KEY}",
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
    url = (f"{GPT_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
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
                "-H", f"api-key: {GPT_API_KEY}",
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
    """Step 4: LLM 识别优质片段 — 信息价值优先 + 难度估算"""
    log("Step 4: LLM 识别优质片段...", "step")

    segments = transcript["segments"]
    seg_text = ""
    for seg in segments:
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        text = seg.get("text", "").strip()
        seg_text += f"[{start:.1f}s - {end:.1f}s] {text}\n"

    # 根据 feed 的 tier 调整 prompt 侧重
    feed_tier = episode_info.get("tier", "")
    tier_hint = ""
    if feed_tier in ("Business", "Tech"):
        tier_hint = """这是一档商业/科技播客。优先选择：
- 有具体数据、趋势、判断的段落（不是泛泛而谈的观点）
- 涉及近期事件或行业动态的内容
- 对用户有"信息增量"的段落——听完能获得一个新认知或新视角"""
    elif feed_tier == "Science":
        tier_hint = """这是一档科学播客。优先选择：
- 解释一个有趣现象的段落（有 aha moment）
- 有实验/数据支撑的内容，不只是科普常识
- 能激发好奇心的段落"""
    elif feed_tier == "Storytelling":
        tier_hint = """这是一档故事类播客。优先选择：
- 有叙事弧线的段落（至少包含一个转折点）
- 如果好故事的开头在 60s 内没有转折，宁可延长到 120s 也不截断在半截
- 情感张力强的段落"""
    else:
        tier_hint = "优先选择信息密度高、有独特视角或有趣观点的段落。"

    prompt = f"""你是 Flipod 的内容筛选引擎。Flipod 是一个英语播客内容产品——用户来这里消费有价值的信息，英语提升是副产品。

播客: {episode_info.get('podcast_name', '')}
集名: {episode_info.get('title', '')}

转录文本:
{seg_text[:12000]}

{tier_hint}

请从中识别 1-3 个最有信息价值的片段。

**硬性要求**：
1. 不能是广告、赞助商口播、节目开头/结尾套话
2. 时长 {clip_duration_min}-{clip_duration_max} 秒
3. 片段必须有完整的信息单元（一个论点说完、一个故事讲完、一个解释结束）

**选择标准（按重要性排序）**：
1. **信息价值** — 用户听完能带走什么？一个新知识、一个有用观点、一个有趣故事？
2. **开头吸引力** — 前 10 秒是否能抓住注意力（有悬念、有问题、有冲突）？
3. **叙事完整性** — 这个片段独立听是否成立，不需要上下文？
4. **语言可消化性** — 语速、词汇难度、口音清晰度是否适合中级英语学习者（B1-B2）？

返回纯 JSON（不要 markdown 代码块）：
{{
  "segments": [
    {{
      "start_time": 12.5,
      "end_time": 78.2,
      "text_preview": "前两句...",
      "reason": "这个片段有价值的原因（1句话）",
      "info_takeaway": "用户听完能获得的核心信息（1句话中文）",
      "suggested_title": "中文钩子标题（像新闻标题那样简短有力，让人想点进来）",
      "suggested_tag": "Science",
      "hook_strength": "high/medium/low",
      "completeness": "high/medium/low",
      "difficulty_estimate": {{
        "speech_rate": "slow/normal/fast",
        "vocabulary": "basic/intermediate/advanced",
        "accent_clarity": "clear/moderate/heavy",
        "overall": "B1/B1+/B2/B2+/C1"
      }}
    }}
  ]
}}

标签从以下选择: Science, Culture, Business, Tech, Psychology, History, Health, Society, Storytelling, Language

如果整集没有合格片段，返回 {{"segments": []}}。"""

    response = call_gpt([{"role": "user", "content": prompt}], max_tokens=6000)
    if not response:
        return []

    try:
        response = response.strip()
        if response.startswith("```"):
            response = re.sub(r"^```\w*\n?", "", response)
            response = re.sub(r"\n?```$", "", response)
        data = json.loads(response)
        result = data.get("segments", [])

        # Log difficulty info for each segment
        for seg in result:
            diff = seg.get("difficulty_estimate", {})
            overall = diff.get("overall", "?")
            info = seg.get("info_takeaway", "")[:40]
            log(f"  片段 [{seg.get('start_time',0):.0f}s-{seg.get('end_time',0):.0f}s] "
                f"难度:{overall} 信息:{info}", "info")

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

    # Trim incomplete boundary sentences (audio may not cover full sentence)
    if lines:
        # Check first line: how many words matched vs sentence word count
        first = lines[0]
        first_sent_word_count = len(re.findall(r"[a-zA-Z']+|\d+", first["en"]))
        first_matched = len(first.get("words", []))
        if first_sent_word_count > 0:
            match_ratio = first_matched / first_sent_word_count
            if match_ratio < 0.5:
                lines.pop(0)  # Discard — too few words have audio
            elif match_ratio < 1.0 and first["words"]:
                # Trim: replace en text with just the matched words
                first["en"] = " ".join(w["word"] for w in first["words"])
                first["start"] = first["words"][0]["start"]

        # Check last line similarly
        if lines:
            last = lines[-1]
            last_sent_word_count = len(re.findall(r"[a-zA-Z']+|\d+", last["en"]))
            last_matched = len(last.get("words", []))
            if last_sent_word_count > 0:
                match_ratio = last_matched / last_sent_word_count
                if match_ratio < 0.5:
                    lines.pop()
                elif match_ratio < 1.0 and last["words"]:
                    last["en"] = " ".join(w["word"] for w in last["words"])
                    last["end"] = last["words"][-1]["end"]

    return lines


# ── Collocation extraction ──

STOP_WORDS = frozenset([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "am", "i", "me",
    "my", "we", "our", "you", "your", "he", "she", "it", "its", "they",
    "them", "their", "this", "that", "these", "those", "of", "in", "to",
    "for", "with", "on", "at", "from", "by", "as", "or", "and", "but",
    "if", "not", "no", "so", "up", "out", "just", "than", "too", "very",
    "s", "t", "d", "ll", "re", "ve", "m", "don", "isn", "aren", "wasn",
    "weren", "doesn", "didn", "won", "wouldn", "shan", "shouldn", "about",
])


def extract_collocations(lines):
    """Extract meaningful 2-3 gram collocations from clip lines.

    Filters out pure stop-word combinations and returns a deduplicated,
    lowercased list like ["make a decision", "climate change"].
    """
    # Collect all clean words in order
    all_words = []
    for line in lines:
        tokens = re.findall(r"[a-zA-Z']+", line.get("en", ""))
        all_words.extend([t.lower() for t in tokens])

    seen = set()
    collocations = []

    def _has_content(ngram_words):
        """At least one word must be non-stop-word."""
        return any(w not in STOP_WORDS for w in ngram_words)

    # Bigrams
    for i in range(len(all_words) - 1):
        bg = (all_words[i], all_words[i + 1])
        if _has_content(bg):
            phrase = " ".join(bg)
            if phrase not in seen:
                seen.add(phrase)
                collocations.append(phrase)

    # Trigrams
    for i in range(len(all_words) - 2):
        tg = (all_words[i], all_words[i + 1], all_words[i + 2])
        if _has_content(tg):
            phrase = " ".join(tg)
            if phrase not in seen:
                seen.add(phrase)
                collocations.append(phrase)

    return collocations


def compute_overlap_scores(all_clips):
    """Compute pairwise collocation overlap for all clips.

    For each clip, overlap_score = average number of shared collocations
    with every other clip. Higher score means the clip's vocabulary
    recurs more across the feed — useful for ranking.
    """
    n = len(all_clips)
    if n <= 1:
        for clip in all_clips:
            clip["overlap_score"] = 0.0
        return

    # Build sets for fast intersection
    coll_sets = []
    for clip in all_clips:
        coll_sets.append(set(clip.get("collocations", [])))

    for i in range(n):
        total_overlap = 0
        for j in range(n):
            if i != j:
                total_overlap += len(coll_sets[i] & coll_sets[j])
        all_clips[i]["overlap_score"] = round(total_overlap / (n - 1), 2)


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


# ── Comprehension questions ──

def generate_comprehension_questions(lines, episode_info):
    """Generate 2 comprehension questions from clip content via GPT."""
    full_text = " ".join(line.get("en", "") for line in lines)
    if not full_text.strip():
        return []

    prompt = (
        "You are a podcast listening comprehension designer. Based ONLY on the following English passage, "
        "create exactly 2 multiple-choice questions.\n\n"
        "Rules:\n"
        "- Question 1 MUST test the MAIN IDEA or GIST: what is this passage mainly about? "
        "What is the speaker's core point? Do NOT ask about specific details, numbers, or names.\n"
        "- Question 2 MUST test the SPEAKER'S ATTITUDE, OPINION, or KEY TAKEAWAY: "
        "what does the speaker think/feel/conclude about the topic? What's the implication?\n"
        "- Both questions should be answerable by someone who understood the general meaning, "
        "even if they missed some specific words or details.\n"
        "- Each question has exactly 4 options (A, B, C, D), with 1 correct and 3 plausible distractors.\n"
        "- Questions are in English; keep them short and conversational (not academic).\n"
        "- explanation_zh is a brief Chinese explanation of why the answer is correct.\n"
        "- Return ONLY a JSON array, no other text.\n\n"
        "Format:\n"
        '[{"question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], '
        '"answer": "A", "explanation_zh": "..."}]\n\n'
        f"Passage:\n{full_text}"
    )

    response = call_gpt([{"role": "user", "content": prompt}], temperature=0.4, max_tokens=1500)
    if not response:
        return []

    # Parse JSON from response (strip markdown fences if present)
    text = response.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        questions = json.loads(text)
        if not isinstance(questions, list):
            log("  理解题生成: 返回格式不是数组", "warn")
            return []
        return questions
    except json.JSONDecodeError as e:
        log(f"  理解题生成: JSON 解析失败 — {e}", "warn")
        return []


def validate_questions(questions, lines):
    """Validate each question via a second GPT call — discard if not derivable from passage."""
    if not questions:
        return []

    full_text = " ".join(line.get("en", "") for line in lines)
    validated = []

    for q in questions:
        prompt = (
            "You are a strict validator. Given the passage and a multiple-choice question, "
            "determine whether the question can be answered SOLELY from the passage content.\n\n"
            "Additional rule: if the question asks about a SPECIFIC DETAIL such as a specific name, "
            "number, date, or statistic, answer \"no\" — we only want gist/attitude questions.\n\n"
            "Reply with ONLY \"yes\" or \"no\".\n\n"
            f"Passage:\n{full_text}\n\n"
            f"Question: {q.get('question', '')}\n"
            f"Options: {', '.join(q.get('options', []))}\n"
            f"Stated answer: {q.get('answer', '')}"
        )

        response = call_gpt([{"role": "user", "content": prompt}], temperature=0.0, max_tokens=10)
        if response and response.strip().lower().startswith("yes"):
            validated.append(q)
        else:
            log(f"  理解题校验不通过，丢弃: {q.get('question', '')[:50]}", "warn")

    return validated


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

        # Step 6 (before cut): Word timestamps + CEFR — extract lines first to
        # find actual sentence-aligned boundaries, then cut audio to match.
        step_start(f"cefr_{clip_id}")
        lines = extract_clip_words(transcript, start_t, end_t)
        if not lines:
            log(f"  片段 {i+1} 无法提取字幕行，跳过", "warn")
            continue

        # Re-align audio cut to actual sentence boundaries from lines
        actual_start = start_t + lines[0]["start"]
        actual_end = start_t + lines[-1]["end"]
        duration = actual_end - actual_start
        # Offset all timestamps so they are zero-based relative to actual_start
        time_offset = lines[0]["start"]
        if time_offset > 0:
            for ln in lines:
                ln["start"] = round(ln["start"] - time_offset, 2)
                ln["end"] = round(ln["end"] - time_offset, 2)
                for w in ln.get("words", []):
                    w["start"] = round(w["start"] - time_offset, 2)
                    w["end"] = round(w["end"] - time_offset, 2)

        # Step 5: Cut audio at sentence-aligned boundaries
        clip_filename = f"clips/clip_{clip_id:03d}.mp3"
        clip_path = os.path.join(output_dir, clip_filename)
        if not cut_audio(episode["local_audio"], actual_start, actual_end, clip_path):
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

        # Step 7b: Comprehension questions
        step_start(f"questions_{clip_id}")
        raw_questions = generate_comprehension_questions(lines, episode)
        questions = validate_questions(raw_questions, lines)
        q_time = step_end(f"questions_{clip_id}")
        if q_time: log(f"  ⏱ 理解题耗时: {q_time}s ({len(questions)}/{len(raw_questions)} 通过校验)", "info")

        # Assemble clip
        start_mm_ss = f"{int(actual_start)//60:02d}:{int(actual_start)%60:02d}"
        end_mm_ss = f"{int(actual_end)//60:02d}:{int(actual_end)%60:02d}"

        # Difficulty metadata from LLM
        difficulty = seg.get("difficulty_estimate", {})

        # Step 8: Extract collocations
        collocations = extract_collocations(lines)

        clip_data = {
            "id": clip_id,
            "title": seg.get("suggested_title", f"片段 {clip_id}"),
            "tag": seg.get("suggested_tag", "Culture"),
            "audio": clip_filename,
            "duration": round(duration, 1),
            "difficulty": difficulty.get("overall", "B1+"),
            "info_takeaway": seg.get("info_takeaway", ""),
            "source": {
                "podcast": episode.get("podcast_name", ""),
                "episode": episode.get("title", ""),
                "episode_url": episode.get("episode_url", ""),
                "timestamp_start": start_mm_ss,
                "timestamp_end": end_mm_ss,
                "pub_date": episode.get("pub_date", ""),
                "tier": episode.get("tier", ""),
            },
            "lines": lines,
            "collocations": collocations,
            "questions": questions,
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


def load_processed_episodes(output_dir):
    """Load set of already-processed episode audio URLs for incremental mode."""
    processed = set()
    # Check new_clips.json
    new_clips_path = os.path.join(output_dir, "new_clips.json")
    if os.path.exists(new_clips_path):
        try:
            with open(new_clips_path, "r") as f:
                data = json.load(f)
            for clip in data.get("clips", []):
                ep_url = clip.get("source", {}).get("episode_url", "")
                if ep_url:
                    processed.add(ep_url.split("?")[0].rstrip("/").lower())
        except Exception:
            pass
    # Check processed_episodes.json (incremental tracking file)
    tracking_path = os.path.join(output_dir, "processed_episodes.json")
    if os.path.exists(tracking_path):
        try:
            with open(tracking_path, "r") as f:
                processed.update(json.load(f))
        except Exception:
            pass
    return processed


def save_processed_episodes(output_dir, processed_set):
    """Save processed episode URLs for incremental dedup."""
    tracking_path = os.path.join(output_dir, "processed_episodes.json")
    try:
        with open(tracking_path, "w") as f:
            json.dump(sorted(processed_set), f, indent=2)
    except Exception as e:
        log(f"保存处理记录失败: {e}", "warn")


def get_next_clip_id(output_dir):
    """Auto-detect next clip ID from existing files."""
    clips_dir = os.path.join(output_dir, "clips")
    if not os.path.exists(clips_dir):
        return 1
    existing = [f for f in os.listdir(clips_dir) if f.startswith("clip_") and f.endswith(".mp3")]
    if not existing:
        return 1
    ids = []
    for f in existing:
        match = re.match(r"clip_(\d+)\.mp3", f)
        if match:
            ids.append(int(match.group(1)))
    return max(ids) + 1 if ids else 1


def main():
    parser = argparse.ArgumentParser(description="Podcast Clip Processor Agent v3 — Curated + Tiered")
    parser.add_argument("--mode", type=str, default="curated",
                        choices=["curated", "discover", "mixed"],
                        help="curated=精选源, discover=iTunes搜索, mixed=精选+补充")
    parser.add_argument("--keywords", type=str, help="Comma-separated search keywords (for discover/mixed mode)")
    parser.add_argument("--feeds", type=str, help="Comma-separated RSS feed URLs (additional)")
    parser.add_argument("--tiers", type=str, default="Business,Tech,Science,Psychology,Culture,Storytelling",
                        help="Comma-separated content tiers to process (curated mode)")
    parser.add_argument("--feeds-per-keyword", type=int, default=3)
    parser.add_argument("--episodes-per-feed", type=int, default=3)
    parser.add_argument("--clips-per-episode", type=int, default=3)
    parser.add_argument("--clip-duration-min", type=int, default=60)
    parser.add_argument("--clip-duration-max", type=int, default=120)
    parser.add_argument("--output-dir", type=str, default="./output")
    parser.add_argument("--target-clips", type=int, default=20)
    parser.add_argument("--start-id", type=int, default=None,
                        help="Starting clip ID (auto-detect if not set)")
    parser.add_argument("--incremental", action="store_true",
                        help="Skip already-processed episodes")
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output_dir)
    clips_dir = os.path.join(output_dir, "clips")
    logs_dir = os.path.join(output_dir, "logs")
    tmp_dir = os.path.join(output_dir, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    os.makedirs(clips_dir, exist_ok=True)
    os.makedirs(logs_dir, exist_ok=True)

    main_start = time.time()
    log("=== Podcast Clip Processor Agent v3 (Curated + Tiered) ===", "step")
    log(f"模式: {args.mode} | 输出: {output_dir}", "info")
    log(f"目标: {args.target_clips} 片段, 时长 {args.clip_duration_min}-{args.clip_duration_max}s", "info")

    init_cefr_map()

    # Incremental mode: load already-processed episodes
    processed_episodes = set()
    if args.incremental:
        processed_episodes = load_processed_episodes(output_dir)
        log(f"增量模式: 已处理 {len(processed_episodes)} 集", "info")

    # Auto-detect start ID
    clip_id = args.start_id if args.start_id is not None else get_next_clip_id(output_dir)
    log(f"起始 clip ID: {clip_id}", "info")

    # ── Phase 1: Collect feeds based on mode ──
    feeds = []
    active_tiers = [t.strip() for t in args.tiers.split(",")]

    if args.mode in ("curated", "mixed"):
        # Tier 1: Curated feeds with time-window filtering
        log(f"\n=== Phase 1: Curated Feeds ({', '.join(active_tiers)}) ===", "step")
        for cf in CURATED_FEEDS:
            if cf["tier"] not in active_tiers:
                continue
            tier_config = CONTENT_TIERS.get(cf["tier"], {})
            feeds.append({
                "url": cf["url"],
                "name": cf["name"],
                "tier": cf["tier"],
                "info_weight": cf.get("info_weight", 0.5),
                "max_age_days": tier_config.get("max_age_days"),
                "priority": tier_config.get("priority", 5),
            })
        # Sort by priority (Business/Tech first)
        feeds.sort(key=lambda f: f.get("priority", 5))
        log(f"  Tier 1 精选源: {len(feeds)} 个 feed", "ok")

    if args.mode in ("discover", "mixed"):
        # Tier 2: iTunes discovery
        keywords = []
        if args.keywords:
            keywords = [k.strip() for k in args.keywords.split(",")]
        elif args.mode == "mixed":
            # Auto-generate keywords from active tiers
            for tier in active_tiers:
                kws = TIER2_KEYWORDS.get(tier, [])
                keywords.extend(kws[:1])  # Take top keyword per tier
        if keywords:
            log(f"\n=== Phase 1b: Tier 2 Discovery ({', '.join(keywords[:5])}) ===", "step")
            discovered = discover_podcasts(keywords, args.feeds_per_keyword)
            for d in discovered:
                d["tier"] = ""  # Unknown tier for discovered feeds
                d["max_age_days"] = None
                d["priority"] = 10  # Lower priority than curated
            feeds.extend(discovered)

    # Manual feeds
    if args.feeds:
        for url in args.feeds.split(","):
            url = url.strip()
            if url:
                feeds.append({"url": url, "name": "Manual Feed", "tier": "", "max_age_days": None, "priority": 0})

    # Dedup feeds by URL
    seen_feed_urls = set()
    unique_feeds = []
    for feed in feeds:
        normalized = feed["url"].split("?")[0].rstrip("/").lower()
        if normalized not in seen_feed_urls:
            seen_feed_urls.add(normalized)
            unique_feeds.append(feed)
    feeds = unique_feeds
    log(f"去重后 {len(feeds)} 个 feed", "info")

    if not feeds:
        log("没有可处理的 feed，退出", "error")
        sys.exit(1)

    # ── Phase 2: Process feeds ──
    log(f"\n=== Phase 2: 处理内容 ===", "step")
    all_clips = []
    newly_processed = set()

    for feed in feeds:
        if len(all_clips) >= args.target_clips:
            break

        max_age = feed.get("max_age_days")
        episodes = parse_rss(feed["url"], feed["name"], args.episodes_per_feed, max_age_days=max_age)

        for ep in episodes:
            if len(all_clips) >= args.target_clips:
                break

            # Dedup: skip already-processed episodes (incremental mode)
            ep_key = ep["audio_url"].split("?")[0].rstrip("/").lower()
            ep_link_key = ep.get("episode_url", "").split("?")[0].rstrip("/").lower()
            if ep_key in processed_episodes or ep_link_key in processed_episodes:
                log(f"  跳过（已处理）: {ep['title'][:50]}", "info")
                continue
            if ep_key in newly_processed:
                log(f"  跳过重复集: {ep['title'][:50]}", "info")
                continue
            newly_processed.add(ep_key)
            if ep_link_key:
                newly_processed.add(ep_link_key)

            # Pass tier info to episode for prompt customization
            ep["tier"] = feed.get("tier", "")

            log(f"\n{'='*50}", "info")
            tier_label = f"[{ep['tier']}] " if ep.get("tier") else ""
            log(f"处理: {tier_label}{ep['podcast_name']} - {ep['title'][:50]}", "step")

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

    # ── Phase 3: Tier 2 auto-supplement (mixed mode) ──
    if args.mode == "mixed" and len(all_clips) < args.target_clips:
        shortfall = args.target_clips - len(all_clips)
        log(f"\n=== Phase 3: Tier 2 补充（还差 {shortfall} 条） ===", "step")
        # Try more keywords from underrepresented tiers
        tier_counts = {}
        for c in all_clips:
            t = c.get("source", {}).get("tier", "Other")
            tier_counts[t] = tier_counts.get(t, 0) + 1

        for tier in active_tiers:
            if len(all_clips) >= args.target_clips:
                break
            if tier_counts.get(tier, 0) >= 5:  # Already have enough from this tier
                continue
            extra_kws = TIER2_KEYWORDS.get(tier, [])
            if not extra_kws:
                continue
            log(f"  补充 {tier}: 搜索 {extra_kws[0]}", "info")
            extra_feeds = discover_podcasts([extra_kws[0]], 3)
            for ef in extra_feeds:
                if len(all_clips) >= args.target_clips:
                    break
                ef_norm = ef["url"].split("?")[0].rstrip("/").lower()
                if ef_norm in seen_feed_urls:
                    continue
                seen_feed_urls.add(ef_norm)
                episodes = parse_rss(ef["url"], ef["name"], 2)
                for ep in episodes:
                    if len(all_clips) >= args.target_clips:
                        break
                    ep_key = ep["audio_url"].split("?")[0].rstrip("/").lower()
                    if ep_key in processed_episodes or ep_key in newly_processed:
                        continue
                    newly_processed.add(ep_key)
                    ep["tier"] = tier
                    new_clips = process_episode(
                        ep, tmp_dir, output_dir, clip_id,
                        args.clip_duration_min, args.clip_duration_max,
                        2,  # Fewer clips per episode for supplement
                    )
                    for c in new_clips:
                        if len(all_clips) >= args.target_clips:
                            break
                        all_clips.append(c)
                        clip_id += 1

    # ── Phase 4: Validate & Output ──
    log(f"\n{'='*50}", "info")
    all_clips, validation_issues = validate_all_clips(all_clips, output_dir)
    log(f"总计生成 {len(all_clips)} 个有效片段", "ok")

    # Compute collocation overlap scores for feed ranking
    compute_overlap_scores(all_clips)
    log("Collocation overlap scores 已计算", "ok")

    # Write new_clips.json
    data_path = os.path.join(output_dir, "new_clips.json")
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump({"clips": all_clips}, f, ensure_ascii=False, indent=2)
    log(f"新片段数据已写入: {data_path}", "ok")

    # Save incremental tracking
    if args.incremental:
        processed_episodes.update(newly_processed)
        save_processed_episodes(output_dir, processed_episodes)
        log(f"增量记录已更新: {len(processed_episodes)} 集", "ok")

    # Save CEFR cache
    save_cefr_cache()

    # Write processing log
    log_path = os.path.join(logs_dir, f"processing_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(LOG, f, ensure_ascii=False, indent=2)
    log(f"处理日志已写入: {log_path}", "ok")

    total_time = round(time.time() - main_start, 1)
    total_mins = int(total_time // 60)
    total_secs = int(total_time % 60)

    # Summary by tier
    tier_summary = {}
    for c in all_clips:
        t = c.get("source", {}).get("tier", "Other")
        tier_summary[t] = tier_summary.get(t, 0) + 1

    print(f"\n🎉 完成！生成了 {len(all_clips)} 个片段")
    print(f"   总耗时: {total_mins}分{total_secs}秒")
    print(f"   按类别: {', '.join(f'{k}:{v}' for k, v in sorted(tier_summary.items()))}")
    print(f"   new_clips.json: {data_path}")
    for c in all_clips:
        diff = c.get("difficulty", "?")
        print(f"   [{diff}] {c['audio']}: {c['title']}")

    log(f"=== 运行总结 ===", "step")
    log(f"总耗时: {total_time}s ({total_mins}分{total_secs}秒)", "info")
    log(f"有效片段: {len(all_clips)}/{len(all_clips) + len(validation_issues)} 通过校验", "info")
    log(f"按类别: {tier_summary}", "info")
    log(f"CEFR 词表: {len(CEFR_WORD_MAP)} 词", "info")
    error_count = sum(1 for e in LOG if e["level"] == "error")
    warn_count = sum(1 for e in LOG if e["level"] == "warn")
    if error_count or warn_count:
        log(f"错误: {error_count}, 警告: {warn_count}", "warn" if warn_count else "error")


if __name__ == "__main__":
    main()
