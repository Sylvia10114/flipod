"""Shared utilities: logging, step timer, curl-based HTTP fetch, GPT caller."""

import hashlib
import json
import re
import subprocess
import time
from datetime import datetime
from urllib.parse import urlsplit, urlunsplit

from . import config

# ── Logging ────────────────────────────────────────────────────

LOG = []
STEP_TIMERS = {}


def log(msg, level="info"):
    """Append a log entry and print to stdout."""
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


# ── HTTP helpers ───────────────────────────────────────────────

def fetch_url(url, timeout=20):
    """Fetch URL using curl (bypasses Python 3.9 SSL issues).

    Returns bytes on success, None on failure.
    """
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


def normalize_audio_url(url):
    """Normalize a source audio URL for dedup/cache keys."""
    if not url:
        return ""
    try:
        parts = urlsplit(url.strip())
        path = parts.path.rstrip("/")
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "", ""))
    except Exception:
        return url.strip().split("?", 1)[0].rstrip("/").lower()


def hash_key(text):
    """Stable short hash helper for cache keys and temp artifact names."""
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()


def call_gpt(messages, temperature=0.3, max_tokens=4000):
    """Call Azure GPT via curl. Returns response text or None.

    Uses config.GPT_* for endpoint/key/deployment.
    """
    url = (f"{config.GPT_ENDPOINT}/openai/deployments/{config.GPT_DEPLOYMENT}"
           f"/chat/completions?api-version={config.GPT_API_VERSION}")

    payload = json.dumps({
        "messages": messages,
        "temperature": temperature,
        "max_completion_tokens": max_tokens,
    })

    for attempt in range(3):
        try:
            result = subprocess.run([
                "curl", "-s", "-X", "POST", url,
                "-H", f"api-key: {config.GPT_API_KEY}",
                "-H", "Content-Type: application/json",
                "-d", payload,
                "--connect-timeout", "15",
                "--max-time", "90",
            ], capture_output=True, text=True, timeout=100)

            if result.returncode != 0:
                log(f"  GPT curl 失败 (尝试 {attempt+1}/3): {result.stderr[:200]}", "error")
                if attempt < 2:
                    time.sleep(5)
                continue

            data = json.loads(result.stdout)
            if "error" in data:
                log(f"  GPT API 错误 (尝试 {attempt+1}/3): {data['error'].get('message', '')[:200]}", "error")
                if attempt < 2:
                    time.sleep(5)
                continue

            return data["choices"][0]["message"]["content"]
        except Exception as e:
            log(f"  GPT 调用失败 (尝试 {attempt+1}/3): {e}", "error")
            if attempt < 2:
                time.sleep(5)
    return None


def strip_markdown_fences(text):
    """Remove ```json ... ``` wrappers from LLM output."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text
