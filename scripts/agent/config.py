"""Configuration: API keys, endpoints, content tiers, curated feeds.

All sensitive values are read from environment variables with NO fallback.
Use python-dotenv or export them before running.
"""

import os
import sys


def _require_env(name: str) -> str:
    """Read a required environment variable; abort if missing."""
    val = os.environ.get(name)
    if not val:
        print(f"❌ 必需环境变量缺失: {name}")
        print(f"   请在 .env 文件或 shell 中设置。参考 .env.example")
        sys.exit(1)
    return val


# ── API Endpoints ──────────────────────────────────────────────
# Lazy-loaded: call ensure_env() at startup to validate early.

FFMPEG = "/opt/homebrew/bin/ffmpeg"

# Will be populated by ensure_env()
WHISPER_ENDPOINT = ""
WHISPER_API_KEY = ""
WHISPER_DEPLOYMENT = ""
WHISPER_API_VERSION = ""
GPT_ENDPOINT = ""
GPT_API_KEY = ""
GPT_DEPLOYMENT = ""
GPT_API_VERSION = ""


def ensure_env():
    """Validate and load all required environment variables. Call once at startup."""
    global WHISPER_ENDPOINT, WHISPER_API_KEY, WHISPER_DEPLOYMENT, WHISPER_API_VERSION
    global GPT_ENDPOINT, GPT_API_KEY, GPT_DEPLOYMENT, GPT_API_VERSION

    WHISPER_ENDPOINT = _require_env("AZURE_WHISPER_OPENAI_ENDPOINT")
    WHISPER_API_KEY = _require_env("AZURE_WHISPER_OPENAI_API_KEY")
    WHISPER_DEPLOYMENT = os.environ.get("AZURE_WHISPER_OPENAI_DEPLOYMENT", "whisper0614")
    WHISPER_API_VERSION = os.environ.get("AZURE_WHISPER_OPENAI_API_VERSION", "2024-06-01")

    GPT_ENDPOINT = _require_env("AZURE_OPENAI_ENDPOINT")
    GPT_API_KEY = _require_env("AZURE_OPENAI_API_KEY")
    GPT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5-chat-global-01")
    GPT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")


def ensure_gpt_env():
    """Load only GPT env vars (skip Whisper). Used by tools that don't need
    transcription, e.g. tools/backfill_priming.py.
    """
    global GPT_ENDPOINT, GPT_API_KEY, GPT_DEPLOYMENT, GPT_API_VERSION
    GPT_ENDPOINT = _require_env("AZURE_OPENAI_ENDPOINT")
    GPT_API_KEY = _require_env("AZURE_OPENAI_API_KEY")
    GPT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5-chat-global-01")
    GPT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")


# ── Content Tiers ──────────────────────────────────────────────
# @PM review: 原 CURATED_FEEDS 里 tier="Storytelling"，prompt 文档用 "Story"。
# 这里统一为 "Story"，CURATED_FEEDS 条目已同步修改。
CONTENT_TIERS = {
    "Business":   {"max_age_days": 7,   "refresh": "weekly",    "priority": 1},
    "Tech":       {"max_age_days": 7,   "refresh": "weekly",    "priority": 1},
    "Science":    {"max_age_days": 30,  "refresh": "biweekly",  "priority": 2},
    "Psychology": {"max_age_days": 30,  "refresh": "monthly",   "priority": 3},
    "Culture":    {"max_age_days": 30,  "refresh": "monthly",   "priority": 3},
    "Story":      {"max_age_days": 365, "refresh": "evergreen", "priority": 4},
}

# Valid tier names for prompt dispatch
VALID_TIERS = set(CONTENT_TIERS.keys())

# ── Curated Feeds: Tier 1 ─────────────────────────────────────
CURATED_FEEDS = [
    # Business / Finance
    {"url": "https://feeds.npr.org/510318/podcast.xml", "name": "Up First (NPR)", "tier": "Business", "info_weight": 0.9},
    {"url": "https://feeds.publicradio.org/public_feeds/marketplace", "name": "Marketplace (APM)", "tier": "Business", "info_weight": 0.85},
    {"url": "https://feeds.npr.org/510289/podcast.xml", "name": "Planet Money", "tier": "Business", "info_weight": 0.8},
    {"url": "https://feeds.megaphone.fm/ROOSTER7199250968", "name": "How I Built This", "tier": "Business", "info_weight": 0.7},
    {"url": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/825d4e29-b616-46f4-afd7-ae2b0013005c/8b1dd624-a026-43e9-8b57-ae2b00130066/podcast.rss", "name": "Big Take (Bloomberg)", "tier": "Business", "info_weight": 0.9},
    # Tech
    {"url": "https://feeds.simplecast.com/JGE3yC0V", "name": "Hard Fork (NYT)", "tier": "Tech", "info_weight": 0.9},
    {"url": "https://lexfridman.com/feed/podcast/", "name": "Lex Fridman Podcast", "tier": "Tech", "info_weight": 0.75},
    {"url": "https://feeds.megaphone.fm/vergecast", "name": "The Vergecast", "tier": "Tech", "info_weight": 0.85},
    {"url": "https://feeds.megaphone.fm/ridehome", "name": "Tech Brew Ride Home", "tier": "Tech", "info_weight": 0.7},
    # Science
    {"url": "https://feeds.npr.org/510351/podcast.xml", "name": "Short Wave (NPR)", "tier": "Science", "info_weight": 0.75},
    {"url": "https://www.nasa.gov/feeds/podcasts/curious-universe", "name": "NASA Curious Universe", "tier": "Science", "info_weight": 0.65},
    {"url": "https://feeds.megaphone.fm/sciencevs", "name": "Science Vs", "tier": "Science", "info_weight": 0.75},
    # Psychology / Culture
    {"url": "https://feeds.simplecast.com/kwWc0lhf", "name": "Hidden Brain (NPR)", "tier": "Psychology", "info_weight": 0.7},
    {"url": "https://feeds.npr.org/510333/podcast.xml", "name": "Throughline (NPR)", "tier": "Culture", "info_weight": 0.75},
    {"url": "https://feeds.npr.org/510298/podcast.xml", "name": "TED Radio Hour", "tier": "Culture", "info_weight": 0.7},
    # Story (evergreen)
    {"url": "https://snap.feed.snapjudgment.org", "name": "Snap Judgment", "tier": "Story", "info_weight": 0.5},
    {"url": "https://feeds.npr.org/510200/podcast.xml", "name": "StoryCorps", "tier": "Story", "info_weight": 0.5},
]

# ── Tier 2 Discovery Keywords ─────────────────────────────────
TIER2_KEYWORDS = {
    "Business":   ["business news podcast", "startup podcast", "economy podcast english"],
    "Tech":       ["technology news podcast", "AI podcast", "silicon valley podcast"],
    "Science":    ["science podcast english", "physics podcast", "biology podcast"],
    "Psychology": ["psychology podcast", "behavioral science podcast"],
    "Culture":    ["culture podcast english", "society podcast"],
    "Story":      ["storytelling podcast", "true stories podcast english"],
}
