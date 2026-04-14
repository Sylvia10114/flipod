#!/usr/bin/env python3
"""
Podcast Clip Processor Agent v4
Modular, tier-aware, with candidate filtering and boundary snap.
Entry point: CLI argparse + main pipeline orchestration.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime

# Load .env if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from agent.config import (
    ensure_env, CONTENT_TIERS, CURATED_FEEDS, TIER2_KEYWORDS,
)
from agent.utils import log, LOG
from agent.discovery import discover_podcasts
from agent.rss import parse_rss
from agent.cefr import init_cefr_map, save_cefr_cache
from agent.output import (
    compute_overlap_scores, validate_all_clips,
    load_processed_episodes, save_processed_episodes, get_next_clip_id,
)
from agent.pipeline import process_episode
from prompts.loader import PROMPT_VERSION


def main():
    parser = argparse.ArgumentParser(description="Podcast Clip Processor Agent v4")
    parser.add_argument("--mode", default="curated", choices=["curated", "discover", "mixed"])
    parser.add_argument("--keywords", type=str)
    parser.add_argument("--feeds", type=str)
    parser.add_argument("--tiers", default="Business,Tech,Science,Psychology,Culture,Story")
    parser.add_argument("--feeds-per-keyword", type=int, default=3)
    parser.add_argument("--episodes-per-feed", type=int, default=3)
    parser.add_argument("--clips-per-episode", type=int, default=3)
    parser.add_argument("--clip-duration-min", type=int, default=60)
    parser.add_argument("--clip-duration-max", type=int, default=120)
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--target-clips", type=int, default=20)
    parser.add_argument("--start-id", type=int, default=None)
    parser.add_argument("--incremental", action="store_true")
    parser.add_argument("--dry-run", action="store_true",
                        help="Only Steps 0-4: discover/download/transcribe/segment/filter")
    args = parser.parse_args()

    ensure_env()

    output_dir = os.path.abspath(args.output_dir)
    tmp_dir = os.path.join(output_dir, "tmp")
    logs_dir = os.path.join(output_dir, "logs")
    for d in [tmp_dir, os.path.join(output_dir, "clips"), logs_dir]:
        os.makedirs(d, exist_ok=True)

    main_start = time.time()
    log("=== Podcast Clip Processor Agent v4 ===", "step")
    log(f"模式: {args.mode} | dry_run: {args.dry_run} | 输出: {output_dir}", "info")

    if not args.dry_run:
        init_cefr_map()

    processed_episodes = (load_processed_episodes(output_dir)
                          if args.incremental else set())
    clip_id = (args.start_id if args.start_id is not None
               else get_next_clip_id(output_dir))

    # ── Collect feeds ──────────────────────────────────────────
    feeds = []
    active_tiers = [t.strip() for t in args.tiers.split(",")]

    if args.mode in ("curated", "mixed"):
        for cf in CURATED_FEEDS:
            if cf["tier"] not in active_tiers:
                continue
            tc = CONTENT_TIERS.get(cf["tier"], {})
            feeds.append({"url": cf["url"], "name": cf["name"], "tier": cf["tier"],
                          "max_age_days": tc.get("max_age_days"), "priority": tc.get("priority", 5)})
        feeds.sort(key=lambda f: f.get("priority", 5))

    if args.mode in ("discover", "mixed"):
        kws = ([k.strip() for k in args.keywords.split(",")] if args.keywords
               else [TIER2_KEYWORDS.get(t, [""])[0] for t in active_tiers if TIER2_KEYWORDS.get(t)])
        if kws:
            for d in discover_podcasts(kws, args.feeds_per_keyword):
                d.update({"tier": "", "max_age_days": None, "priority": 10})
                feeds.append(d)

    if args.feeds:
        for url in args.feeds.split(","):
            url = url.strip()
            if url:
                feeds.append({"url": url, "name": "Manual", "tier": "", "max_age_days": None, "priority": 0})

    # Dedup
    seen = set()
    feeds = [f for f in feeds if not (f["url"].split("?")[0].rstrip("/").lower() in seen
             or seen.add(f["url"].split("?")[0].rstrip("/").lower()))]

    if not feeds:
        log("没有可处理的 feed，退出", "error")
        sys.exit(1)

    # ── Process episodes ───────────────────────────────────────
    all_results, dry_run_episodes, newly_processed = [], [], set()

    for feed in feeds:
        if not args.dry_run and len(all_results) >= args.target_clips:
            break
        episodes = parse_rss(feed["url"], feed["name"], args.episodes_per_feed, feed.get("max_age_days"))
        for ep in episodes:
            if not args.dry_run and len(all_results) >= args.target_clips:
                break
            ep_key = ep["audio_url"].split("?")[0].rstrip("/").lower()
            if ep_key in processed_episodes or ep_key in newly_processed:
                continue
            newly_processed.add(ep_key)
            ep["tier"] = feed.get("tier", "")

            result = process_episode(ep, tmp_dir, output_dir, clip_id,
                                     args.clip_duration_min, args.clip_duration_max,
                                     args.clips_per_episode, dry_run=args.dry_run)
            if args.dry_run:
                dry_run_episodes.append({"podcast": ep.get("podcast_name", ""),
                                         "episode": ep.get("title", ""),
                                         "tier": ep.get("tier", ""),
                                         "candidates": result})
            else:
                for c in result:
                    if len(all_results) >= args.target_clips:
                        break
                    all_results.append(c)
                    clip_id += 1

    # ── Output ─────────────────────────────────────────────────
    if args.dry_run:
        path = os.path.join(output_dir, "dry_run_candidates.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"run_id": datetime.now().strftime("%Y-%m-%d_%H%M"),
                        "config": {"mode": args.mode, "tiers": active_tiers},
                        "prompt_version": PROMPT_VERSION,
                        "episodes": dry_run_episodes}, f, ensure_ascii=False, indent=2)
        log(f"Dry-run 输出: {path}", "ok")
    else:
        all_results, _ = validate_all_clips(all_results, output_dir)
        compute_overlap_scores(all_results)
        path = os.path.join(output_dir, "new_clips.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"clips": all_results}, f, ensure_ascii=False, indent=2)
        if args.incremental:
            processed_episodes.update(newly_processed)
            save_processed_episodes(output_dir, processed_episodes)
        save_cefr_cache()

    log_path = os.path.join(logs_dir, f"log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(LOG, f, ensure_ascii=False, indent=2)

    total = round(time.time() - main_start, 1)
    n = len(dry_run_episodes) if args.dry_run else len(all_results)
    print(f"\n🎉 完成！{n} 个{'候选集' if args.dry_run else '片段'} | {int(total//60)}分{int(total%60)}秒")


if __name__ == "__main__":
    main()
