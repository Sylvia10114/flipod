#!/usr/bin/env python3
"""Run a high-yield clip expansion batch with frequent partial checkpoints."""

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from agent.config import ensure_env
from agent.config import CURATED_FEEDS
from agent.rss import parse_rss
from agent.pipeline import process_episode
from agent.cefr import init_cefr_map, save_cefr_cache
from agent.output import validate_all_clips, compute_overlap_scores
from agent.utils import LOG, normalize_audio_url


HIGH_YIELD_FEEDS = [
    {
        "url": "https://feeds.publicradio.org/public_feeds/marketplace",
        "name": "Marketplace (APM)",
        "tier": "Business",
    },
    {
        "url": "https://feeds.simplecast.com/JGE3yC0V",
        "name": "Hard Fork (NYT)",
        "tier": "Tech",
    },
    {
        "url": "https://www.nasa.gov/feeds/podcasts/curious-universe",
        "name": "NASA Curious Universe",
        "tier": "Science",
    },
]


def parse_args():
    parser = argparse.ArgumentParser(description="Run a high-yield expansion batch.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--start-id", type=int, required=True)
    parser.add_argument("--target-clips", type=int, default=27)
    parser.add_argument("--episodes-per-feed", type=int, default=5)
    parser.add_argument("--clips-per-episode", type=int, default=3)
    parser.add_argument(
        "--skip-episodes",
        type=int,
        default=0,
        help="Skip the first N parsed episodes from each selected feed.",
    )
    parser.add_argument(
        "--feeds",
        default="",
        help="Comma-separated feed names to keep (default: all high-yield feeds).",
    )
    return parser.parse_args()


def write_partial(output_dir: Path, clips):
    payload = {
        "generated_at": datetime.now().isoformat(),
        "clips": clips,
    }
    (output_dir / "new_clips.partial.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main():
    args = parse_args()
    ensure_env()

    output_dir = Path(args.output_dir)
    tmp_dir = output_dir / "tmp"
    logs_dir = output_dir / "logs"
    cache_dir = output_dir / "cache" / "transcripts"
    for path in [output_dir, tmp_dir, logs_dir, cache_dir, output_dir / "clips"]:
        path.mkdir(parents=True, exist_ok=True)

    init_cefr_map()

    all_results = []
    clip_id = args.start_id
    seen_episodes = set()
    main_start = time.time()

    active_feeds = HIGH_YIELD_FEEDS
    if args.feeds.strip():
        wanted = {name.strip() for name in args.feeds.split(",") if name.strip()}
        active_feeds = [feed for feed in HIGH_YIELD_FEEDS if feed["name"] in wanted]
        known = {feed["name"] for feed in active_feeds}
        for curated in CURATED_FEEDS:
            if curated["name"] not in wanted or curated["name"] in known:
                continue
            active_feeds.append(
                {
                    "url": curated["url"],
                    "name": curated["name"],
                    "tier": curated["tier"],
                }
            )

    if not active_feeds:
        raise SystemExit("No matching feeds found for this batch.")

    for feed in active_feeds:
        if len(all_results) >= args.target_clips:
            break

        print(f"\n=== FEED {feed['name']} ===", flush=True)
        episodes = parse_rss(
            feed["url"],
            feed["name"],
            episodes_per_feed=args.episodes_per_feed,
            max_age_days=None,
        )
        if args.skip_episodes:
            episodes = episodes[args.skip_episodes:]

        for episode in episodes:
            if len(all_results) >= args.target_clips:
                break

            episode_key = normalize_audio_url(episode.get("audio_url", ""))
            if episode_key in seen_episodes:
                continue
            seen_episodes.add(episode_key)

            episode["tier"] = feed["tier"]
            print(
                f"\n--- EPISODE {episode['podcast_name']} :: {episode['title']} ---",
                flush=True,
            )
            result = process_episode(
                episode,
                str(tmp_dir),
                str(output_dir),
                clip_id,
                clips_per_episode=args.clips_per_episode,
                dry_run=False,
            )

            for clip in result:
                if len(all_results) >= args.target_clips:
                    break
                all_results.append(clip)
                clip_id += 1

            write_partial(output_dir, all_results)
            print(
                f"EPISODE_RESULT clips={len(result)} total={len(all_results)}",
                flush=True,
            )

    all_results, issues = validate_all_clips(all_results, str(output_dir))
    compute_overlap_scores(all_results)

    (output_dir / "new_clips.json").write_text(
        json.dumps({"clips": all_results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    save_cefr_cache()

    log_path = logs_dir / f"log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    log_path.write_text(json.dumps(LOG, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "done": True,
                "valid_clips": len(all_results),
                "issues": len(issues),
                "output_dir": str(output_dir),
                "elapsed_sec": round(time.time() - main_start, 1),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
