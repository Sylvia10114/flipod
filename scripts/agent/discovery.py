"""Step 0: Discover podcasts via iTunes Search API.

Input: list of search keywords
Output: list of feed dicts [{url, name}]
"""

import json
import urllib.parse

from .utils import fetch_url, log


def discover_podcasts(keywords, feeds_per_keyword=5):
    """Search iTunes for English podcast feeds matching keywords.

    Returns list of dicts with 'url' and 'name' keys.
    """
    feeds = []
    for kw in keywords:
        log(f"Step 0: 搜索关键词 '{kw}'...", "step")
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(kw)}&media=podcast&limit=20&lang=en_us"
        raw = fetch_url(url, timeout=15)
        if not raw:
            log("iTunes 搜索失败", "error")
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
            if lang and lang not in ("en", ""):
                log(f"  跳过（非英语 lang={lang}）: {name}", "info")
                continue
            feeds.append({"url": feed_url, "name": name})
            log(f"  发现: {name}", "ok")
            count += 1

    log(f"共发现 {len(feeds)} 个播客 feed", "info")
    return feeds
