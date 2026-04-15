#!/usr/bin/env python3
"""
轻量测试脚本 — 只测抓取层，不调 Whisper/GPT，不花钱。
用法: python3 test_feeds.py [--tier Business,Tech] [--verbose]
"""

import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime

# 从 podcast_agent.py 导入配置
sys.path.insert(0, os.path.dirname(__file__))
from podcast_agent import CURATED_FEEDS, CONTENT_TIERS, TIER2_KEYWORDS

def fetch_url(url, timeout=15):
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


def test_feed(feed, max_age_days=None, verbose=False):
    """Test a single RSS feed. Returns dict with results."""
    result = {
        "name": feed["name"],
        "tier": feed.get("tier", "?"),
        "url": feed["url"],
        "reachable": False,
        "parseable": False,
        "total_episodes": 0,
        "episodes_in_window": 0,
        "has_audio": 0,
        "latest_date": None,
        "sample_titles": [],
        "errors": [],
    }

    # 1. Fetch
    xml_data = fetch_url(feed["url"])
    if not xml_data:
        result["errors"].append("RSS 获取失败（超时或无响应）")
        return result
    result["reachable"] = True

    # 2. Parse
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError as e:
        result["errors"].append(f"XML 解析失败: {e}")
        return result
    result["parseable"] = True

    channel = root.find("channel")
    if channel is None:
        result["errors"].append("无 <channel> 节点")
        return result

    # 3. Check episodes
    now = datetime.now()
    for item in channel.findall("item"):
        result["total_episodes"] += 1
        title = item.findtext("title", "Untitled")

        # Check audio
        enclosure = item.find("enclosure")
        has_audio = False
        if enclosure is not None:
            audio_url = enclosure.get("url", "")
            audio_type = enclosure.get("type", "")
            if audio_url and "audio" in audio_type:
                has_audio = True
        if has_audio:
            result["has_audio"] += 1

        # Check date
        pub_date_str = item.findtext("pubDate", "")
        age_days = None
        if pub_date_str:
            try:
                pub_date = parsedate_to_datetime(pub_date_str)
                age_days = (now - pub_date.replace(tzinfo=None)).days
                if result["latest_date"] is None or age_days < result["latest_date"]:
                    result["latest_date"] = age_days
            except Exception:
                pass

        # Time window check
        in_window = True
        if max_age_days and age_days is not None and age_days > max_age_days:
            in_window = False

        if in_window and has_audio:
            result["episodes_in_window"] += 1
            if len(result["sample_titles"]) < 3:
                age_str = f" ({age_days}天前)" if age_days is not None else ""
                result["sample_titles"].append(f"{title[:60]}{age_str}")

    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description="测试 Curated Feeds 抓取效果")
    parser.add_argument("--tier", type=str, default=None, help="只测指定 tier（逗号分隔）")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--test-tier2", action="store_true", help="同时测试 Tier 2 iTunes 搜索")
    args = parser.parse_args()

    active_tiers = None
    if args.tier:
        active_tiers = [t.strip() for t in args.tier.split(",")]

    print("=" * 60)
    print("🔍 Flipod Feed 抓取测试")
    print("=" * 60)

    # ── Test Tier 1: Curated Feeds ──
    print(f"\n📡 Tier 1: 精选源 ({len(CURATED_FEEDS)} 个)")
    print("-" * 60)

    tier_stats = {}  # tier -> {reachable, in_window, total_feeds}
    all_results = []

    for feed in CURATED_FEEDS:
        if active_tiers and feed["tier"] not in active_tiers:
            continue

        tier = feed["tier"]
        max_age = CONTENT_TIERS.get(tier, {}).get("max_age_days")

        result = test_feed(feed, max_age_days=max_age, verbose=args.verbose)
        all_results.append(result)

        # Accumulate stats
        if tier not in tier_stats:
            tier_stats[tier] = {"reachable": 0, "in_window": 0, "total_feeds": 0, "errors": 0}
        tier_stats[tier]["total_feeds"] += 1
        if result["reachable"]:
            tier_stats[tier]["reachable"] += 1
        tier_stats[tier]["in_window"] += result["episodes_in_window"]
        if result["errors"]:
            tier_stats[tier]["errors"] += 1

        # Print per-feed result
        status = "✅" if result["reachable"] and result["episodes_in_window"] > 0 else "⚠️" if result["reachable"] else "❌"
        window_str = f"最近{max_age}天" if max_age else "全部"
        print(f"  {status} [{tier}] {result['name']}")
        print(f"     总集数: {result['total_episodes']} | 有音频: {result['has_audio']} | 窗口内({window_str}): {result['episodes_in_window']}")
        if result["latest_date"] is not None:
            print(f"     最新: {result['latest_date']}天前")
        if result["errors"]:
            for e in result["errors"]:
                print(f"     ❌ {e}")
        if args.verbose and result["sample_titles"]:
            for t in result["sample_titles"]:
                print(f"     📎 {t}")

    # ── Summary ──
    print("\n" + "=" * 60)
    print("📊 汇总")
    print("=" * 60)

    total_in_window = 0
    for tier, stats in sorted(tier_stats.items()):
        max_age = CONTENT_TIERS.get(tier, {}).get("max_age_days", "∞")
        print(f"  [{tier}] Feed: {stats['reachable']}/{stats['total_feeds']} 可达 | "
              f"窗口内集数: {stats['in_window']} (最近{max_age}天) | "
              f"错误: {stats['errors']}")
        total_in_window += stats["in_window"]

    # Estimate clips (assuming ~2 clips per episode)
    estimated_clips = total_in_window * 2
    print(f"\n  📦 窗口内总集数: {total_in_window}")
    print(f"  📦 预估可产出 clips: ~{estimated_clips} (按每集2个)")

    if estimated_clips < 20:
        print(f"  ⚠️  内容偏少！建议启用 --mode mixed 或增加 Tier 2 补充")
    elif estimated_clips < 50:
        print(f"  ℹ️  内容尚可，mixed 模式可以补充到 50+")
    else:
        print(f"  ✅ 内容充足")

    # ── Unreachable feeds ──
    unreachable = [r for r in all_results if not r["reachable"]]
    if unreachable:
        print(f"\n  ⚠️  不可达的 feed ({len(unreachable)} 个):")
        for r in unreachable:
            print(f"     ❌ {r['name']}: {r['url'][:60]}...")
            for e in r["errors"]:
                print(f"        {e}")

    # ── Empty window feeds ──
    empty_window = [r for r in all_results if r["reachable"] and r["episodes_in_window"] == 0]
    if empty_window:
        print(f"\n  ⚠️  窗口内无内容的 feed ({len(empty_window)} 个):")
        for r in empty_window:
            max_age = CONTENT_TIERS.get(r["tier"], {}).get("max_age_days", "?")
            print(f"     ⏰ {r['name']}: 最新{r['latest_date']}天前, 窗口{max_age}天")

    # ── Optional: Test Tier 2 ──
    if args.test_tier2:
        print(f"\n{'=' * 60}")
        print("🔎 Tier 2: iTunes 搜索测试")
        print("-" * 60)
        from podcast_agent import discover_podcasts
        for tier, keywords in TIER2_KEYWORDS.items():
            if active_tiers and tier not in active_tiers:
                continue
            kw = keywords[0] if keywords else None
            if not kw:
                continue
            print(f"\n  [{tier}] 搜索: '{kw}'")
            feeds = discover_podcasts([kw], 3)
            print(f"  发现 {len(feeds)} 个 feed")
            for f in feeds[:3]:
                print(f"     📡 {f['name']}")

    print(f"\n{'=' * 60}")
    print("完成！")


if __name__ == "__main__":
    main()
