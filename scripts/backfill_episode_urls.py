#!/usr/bin/env python3
"""Backfill missing source.episode_url values for legacy clips.

Strategy:
1. Propagate existing episode_url within the same (podcast, episode) group.
2. Resolve a podcast's RSS feed via curated aliases, explicit overrides, or iTunes Search.
3. Parse RSS item links and high-confidence match by episode title.

Only high-confidence matches are written back. Ambiguous or weak matches are kept in
the report for manual review.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

from agent.config import CURATED_FEEDS


DEFAULT_DATA_FILES = [
    Path("/Users/nathanshan/Desktop/flipod_jp_sync/data.json"),
    Path("/Users/nathanshan/Desktop/flipod_jp_sync/new_clips.json"),
    Path("/Users/nathanshan/Desktop/flipod_jp_sync/mobile/src/demo-data.json"),
]

DEFAULT_REPORT = Path("/Users/nathanshan/Desktop/flipod_jp_sync/output/episode_url_backfill_report.json")


EXTRA_FEEDS = {
    "this american life": "https://www.thisamericanlife.org/podcast/rss.xml",
    "the moth": "https://feeds.megaphone.fm/themoth",
    "ted talks daily": "https://feeds.megaphone.fm/tedtalksdaily",
    "startup stories mixergy": "https://feeds.megaphone.fm/mixergy-startup-stories",
    "startup stories - mixergy": "https://feeds.megaphone.fm/mixergy-startup-stories",
    "history that doesnt suck": "https://feeds.megaphone.fm/historythatdoesntsuck",
    "history that doesn't suck": "https://feeds.megaphone.fm/historythatdoesntsuck",
    "the business storytelling podcast": "https://feeds.captivate.fm/business-storytelling-podcast/",
    "freakonomics radio": "https://feeds.simplecast.com/Y8lFbOT4",
}

GENERIC_EPISODE_TITLES = {
    "",
    "npr",
    "apm",
    "marketplace",
}


def fetch_url(url: str, timeout: int = 20) -> bytes | None:
    """Fetch a URL with curl to avoid the macOS Python 3.9 SSL issue."""
    try:
        result = subprocess.run(
            [
                "curl",
                "-s",
                "-L",
                "--connect-timeout",
                "10",
                "--max-time",
                str(timeout),
                "-A",
                "Mozilla/5.0",
                url,
            ],
            capture_output=True,
            timeout=timeout + 5,
        )
    except Exception:
        return None
    if result.returncode == 0 and result.stdout:
        return result.stdout
    return None


def normalize_text(value: str) -> str:
    text = (value or "").strip().lower()
    text = text.replace("&amp;", "and")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = text.replace("’", "'")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\b(the|a|an|podcast|episode|show)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_podcast_name(value: str) -> str:
    text = normalize_text(value)
    text = re.sub(r"\bnpr\b", "", text)
    text = re.sub(r"\bapm\b", "", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_url(url: str) -> str:
    value = (url or "").strip()
    if value.startswith("http://"):
        return "https://" + value[len("http://"):]
    return value


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def iter_clips(payload: dict) -> list[dict]:
    if isinstance(payload, dict) and isinstance(payload.get("clips"), list):
        return payload["clips"]
    if isinstance(payload, list):
        return payload
    raise ValueError("Unsupported clip payload shape")


def canonical_group_key(clip: dict) -> tuple[str, str]:
    source = clip.get("source") or {}
    return (
        normalize_podcast_name(source.get("podcast", "")),
        normalize_text(source.get("episode", "")),
    )


def build_curated_feed_map() -> dict[str, str]:
    feed_map: dict[str, str] = {}
    for item in CURATED_FEEDS:
        name = item.get("name") or ""
        url = item.get("url") or ""
        if not url:
            continue
        feed_map[normalize_podcast_name(name)] = url
    for alias, url in EXTRA_FEEDS.items():
        feed_map[normalize_podcast_name(alias)] = url
    return feed_map


def search_itunes_feeds(podcast_name: str, limit: int = 5) -> list[dict]:
    url = (
        "https://itunes.apple.com/search"
        f"?term={quote(podcast_name)}&media=podcast&entity=podcast&limit={limit}&lang=en_us"
    )
    raw = fetch_url(url, timeout=15)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return []
    feeds = []
    target = normalize_podcast_name(podcast_name)
    for item in data.get("results", []):
        feed_url = item.get("feedUrl")
        name = item.get("collectionName", "")
        if not feed_url or not name:
            continue
        similarity = SequenceMatcher(None, target, normalize_podcast_name(name)).ratio()
        feeds.append({"name": name, "url": feed_url, "similarity": similarity, "source": "itunes"})
    feeds.sort(key=lambda item: item["similarity"], reverse=True)
    return feeds


def text_from_element(item: ET.Element, tag: str) -> str:
    for child in item:
        if child.tag.split("}", 1)[-1] == tag:
            return (child.text or "").strip()
    return ""


def parse_feed_items(feed_url: str) -> list[dict]:
    raw = fetch_url(feed_url, timeout=25)
    if not raw:
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []

    channel = None
    if root.tag.endswith("rss") or root.tag == "rss":
        channel = root.find("channel")
    if channel is None and root.tag.endswith("feed"):
        channel = root
    if channel is None:
        return []

    items = []
    for item in channel:
        tag = item.tag.split("}", 1)[-1]
        if tag not in {"item", "entry"}:
            continue

        title = text_from_element(item, "title")
        link = text_from_element(item, "link")
        if not link:
            for child in item:
                child_tag = child.tag.split("}", 1)[-1]
                if child_tag == "link":
                    href = child.attrib.get("href", "").strip()
                    rel = child.attrib.get("rel", "").strip()
                    if href and rel in {"", "alternate"}:
                        link = href
                        break
        guid = text_from_element(item, "guid")
        description = text_from_element(item, "description") or text_from_element(item, "summary")
        description = re.sub(r"<[^>]+>", " ", description)
        if not link and guid.startswith("http"):
            link = guid
        if title and link.startswith("http"):
            items.append(
                {
                    "title": title.strip(),
                    "link": normalize_url(link.strip()),
                    "description": re.sub(r"\s+", " ", description).strip(),
                }
            )
    return items


@dataclass
class MatchResult:
    url: str
    confidence: float
    reason: str
    feed_url: str
    feed_name: str
    item_title: str


def title_score(query_title: str, item_title: str) -> tuple[float, str]:
    query_norm = normalize_text(query_title)
    item_norm = normalize_text(item_title)
    if not query_norm or query_norm in GENERIC_EPISODE_TITLES:
        return 0.0, "generic_or_empty_query"
    if query_norm == item_norm:
        return 1.0, "exact_title_match"
    if len(query_norm) >= 10 and item_norm.startswith(query_norm):
        return 0.985, "query_prefix_match"
    if len(item_norm) >= 10 and query_norm.startswith(item_norm):
        return 0.97, "item_prefix_match"
    if len(query_norm) >= 10 and query_norm in item_norm:
        return 0.955, "query_contained_in_item"
    if len(item_norm) >= 10 and item_norm in query_norm:
        return 0.945, "item_contained_in_query"

    # Numeric anchors like "Show 859" or "#2302".
    query_nums = set(re.findall(r"\d+", query_title))
    item_nums = set(re.findall(r"\d+", item_title))
    if query_nums and query_nums == item_nums and len(query_nums) == 1:
        ratio = SequenceMatcher(None, query_norm, item_norm).ratio()
        if ratio >= 0.55:
            return 0.94 + min(0.03, ratio * 0.03), "shared_episode_number"

    ratio = SequenceMatcher(None, query_norm, item_norm).ratio()
    if ratio >= 0.94:
        return ratio, "very_high_similarity"
    if ratio >= 0.9:
        return ratio, "high_similarity"
    return ratio, "low_similarity"


def snippet_score(snippet: str, item: dict) -> tuple[float, str]:
    snippet_norm = normalize_text(snippet)
    if not snippet_norm:
        return 0.0, "empty_snippet"
    tokens = [token for token in snippet_norm.split() if len(token) >= 5]
    if len(tokens) < 4:
        return 0.0, "weak_snippet"
    haystack = normalize_text(f"{item.get('title', '')} {item.get('description', '')}")
    overlaps = sum(1 for token in tokens if token in haystack)
    ratio = overlaps / max(len(tokens), 1)
    if overlaps >= 4 and ratio >= 0.6:
        return 0.88 + min(0.08, ratio * 0.08), "snippet_overlap"
    return ratio * 0.7, "snippet_low_overlap"


def best_match_for_group(group: dict, feed_candidates: list[dict], feed_cache: dict[str, list[dict]]) -> MatchResult | None:
    query_title = group["episode"]
    snippet = group["snippet"]
    best: MatchResult | None = None
    for candidate in feed_candidates:
        feed_url = candidate["url"]
        items = feed_cache.get(feed_url)
        if items is None:
            items = parse_feed_items(feed_url)
            feed_cache[feed_url] = items
        for item in items:
            title_conf, title_reason = title_score(query_title, item["title"])
            score = title_conf
            reason = title_reason
            if score < 0.9 and snippet:
                snippet_conf, snippet_reason = snippet_score(snippet, item)
                if snippet_conf > score:
                    score = snippet_conf
                    reason = snippet_reason
            if score < 0.9:
                continue
            match = MatchResult(
                url=item["link"],
                confidence=round(score, 3),
                reason=reason,
                feed_url=feed_url,
                feed_name=candidate["name"],
                item_title=item["title"],
            )
            if best is None or match.confidence > best.confidence:
                best = match
    return best


def collect_groups(clips: Iterable[dict]) -> dict[tuple[str, str], dict]:
    groups: dict[tuple[str, str], dict] = {}
    for clip in clips:
        source = clip.get("source") or {}
        key = canonical_group_key(clip)
        group = groups.setdefault(
            key,
            {
                "podcast": source.get("podcast", ""),
                "episode": source.get("episode", ""),
                "snippet": ((clip.get("lines") or [{}])[0].get("en", "") or "")[:180],
                "clip_ids": [],
                "existing_urls": set(),
            },
        )
        group["clip_ids"].append(clip.get("id"))
        existing = normalize_url(source.get("episode_url", ""))
        if existing:
            group["existing_urls"].add(existing)
    return groups


def apply_url_to_group(clips: Iterable[dict], key: tuple[str, str], url: str) -> int:
    count = 0
    for clip in clips:
        if canonical_group_key(clip) != key:
            continue
        source = clip.setdefault("source", {})
        if not normalize_url(source.get("episode_url", "")):
            source["episode_url"] = url
            count += 1
    return count


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Backfill missing episode_url values in legacy clip data.")
    parser.add_argument(
        "--data-file",
        action="append",
        dest="data_files",
        default=[],
        help="JSON file to update. May be passed multiple times.",
    )
    parser.add_argument("--report", default=str(DEFAULT_REPORT), help="Where to write the JSON report.")
    parser.add_argument("--write", action="store_true", help="Persist changes to the data files.")
    args = parser.parse_args(argv)

    data_files = [Path(path) for path in (args.data_files or [])] or list(DEFAULT_DATA_FILES)
    payloads = {path: load_json(path) for path in data_files}
    primary_clips = iter_clips(next(iter(payloads.values())))
    groups = collect_groups(primary_clips)
    curated_feed_map = build_curated_feed_map()
    feed_cache: dict[str, list[dict]] = {}

    report = {
        "summary": {
            "total_clips": len(primary_clips),
            "missing_before": 0,
            "filled_via_existing_group": 0,
            "filled_via_feed_match": 0,
            "missing_after": 0,
        },
        "matched": [],
        "unmatched": [],
    }

    missing_before = 0
    for clip in primary_clips:
        source = clip.get("source") or {}
        if not normalize_url(source.get("episode_url", "")):
            missing_before += 1
    report["summary"]["missing_before"] = missing_before

    # Pass 1: propagate already-known URLs within the same podcast/episode group.
    for key, group in groups.items():
        if len(group["existing_urls"]) != 1:
            continue
        url = next(iter(group["existing_urls"]))
        for path, payload in payloads.items():
            report["summary"]["filled_via_existing_group"] += apply_url_to_group(iter_clips(payload), key, url)

    # Refresh primary state after propagation.
    primary_clips = iter_clips(next(iter(payloads.values())))
    groups = collect_groups(primary_clips)

    # Pass 2: query RSS feeds for missing groups.
    for key, group in sorted(groups.items(), key=lambda item: (item[1]["podcast"].lower(), item[1]["episode"].lower())):
        if group["existing_urls"]:
            continue

        podcast_name = group["podcast"]
        if not podcast_name:
            report["unmatched"].append(
                {
                    "podcast": podcast_name,
                    "episode": group["episode"],
                    "reason": "missing_podcast_name",
                    "clip_ids": group["clip_ids"],
                }
            )
            continue

        feed_candidates = []
        curated = curated_feed_map.get(normalize_podcast_name(podcast_name))
        if curated:
            feed_candidates.append({"name": podcast_name, "url": curated, "similarity": 1.0, "source": "curated"})
        for candidate in search_itunes_feeds(podcast_name, limit=5):
            if candidate["url"] not in {item["url"] for item in feed_candidates}:
                feed_candidates.append(candidate)

        if not feed_candidates:
            report["unmatched"].append(
                {
                    "podcast": podcast_name,
                    "episode": group["episode"],
                    "reason": "feed_not_found",
                    "clip_ids": group["clip_ids"],
                }
            )
            continue

        match = best_match_for_group(group, feed_candidates, feed_cache)
        if not match:
            report["unmatched"].append(
                {
                    "podcast": podcast_name,
                    "episode": group["episode"],
                    "reason": "no_high_confidence_item_match",
                    "snippet": group["snippet"],
                    "clip_ids": group["clip_ids"],
                    "feed_candidates": [item["url"] for item in feed_candidates[:3]],
                }
            )
            continue

        for path, payload in payloads.items():
            report["summary"]["filled_via_feed_match"] += apply_url_to_group(iter_clips(payload), key, match.url)
        report["matched"].append(
            {
                "podcast": podcast_name,
                "episode": group["episode"],
                "url": match.url,
                "confidence": match.confidence,
                "reason": match.reason,
                "feed_url": match.feed_url,
                "feed_name": match.feed_name,
                "item_title": match.item_title,
                "clip_ids": group["clip_ids"],
            }
        )

    primary_clips = iter_clips(next(iter(payloads.values())))
    missing_after = 0
    for clip in primary_clips:
        source = clip.get("source") or {}
        if not normalize_url(source.get("episode_url", "")):
            missing_after += 1
    report["summary"]["missing_after"] = missing_after

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(report_path, report)

    if args.write:
        for path, payload in payloads.items():
            write_json(path, payload)

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"report: {report_path}")
    if args.write:
        print("updated:")
        for path in data_files:
            print(f"  - {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
