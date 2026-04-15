"""Step 1: RSS feed parsing.

Input: feed URL + name
Output: list of episode dicts [{title, audio_url, description, podcast_name, ...}]
"""

import re
import xml.etree.ElementTree as ET
from datetime import datetime

from .utils import fetch_url, log


def parse_rss(feed_url, feed_name, episodes_per_feed=3, max_age_days=None):
    """Parse an RSS feed and return up to *episodes_per_feed* recent episodes.

    If *max_age_days* is set, only episodes published within that window are returned.
    """
    log(f"Step 1: 解析 RSS - {feed_name}" + (f" (最近{max_age_days}天)" if max_age_days else ""), "step")
    xml_data = fetch_url(feed_url)
    if not xml_data:
        log("  RSS 获取失败", "error")
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
                from email.utils import parsedate_to_datetime
                pub_date = parsedate_to_datetime(pub_date_str)
                age_days = (now - pub_date.replace(tzinfo=None)).days
                if age_days > max_age_days:
                    log(f"  跳过（{age_days}天前）: {title[:50]}", "info")
                    continue
            except Exception:
                pass

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
