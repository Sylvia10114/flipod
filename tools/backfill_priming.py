#!/usr/bin/env python3
"""Task G · Backfill `priming` field on every clip in data.json.

Used for migrations + prompt iteration. The core selection/translation logic
lives in scripts/agent/priming.py and is shared with the live podcast_agent
pipeline so daily new clips are primed at ingestion time.

This orchestrator's job: load data.json + CEFR map, iterate clips, invoke
generate_priming(), backup + write back. It exists separately from the
pipeline so we can re-run after CEFR overrides change or prompt tweaks
without re-processing audio/transcription.

CLAUDE.md compliance is inherited from scripts/agent/priming.py
(translation goes through call_gpt → curl subprocess, max_completion_tokens).

Usage:
    AZURE_OPENAI_API_KEY=... python3 tools/backfill_priming.py
    python3 tools/backfill_priming.py --dry-run            # selection preview
    python3 tools/backfill_priming.py --force              # overwrite existing
    python3 tools/backfill_priming.py --limit 10           # debug subset
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

# Add scripts/ to path so we can import the shared priming module.
_HERE = Path(__file__).resolve().parent
_PROJECT_ROOT = _HERE.parent
_SCRIPTS_DIR = _PROJECT_ROOT / "scripts"
sys.path.insert(0, str(_SCRIPTS_DIR.parent))

from scripts.agent.priming import (   # noqa: E402
    PRIMING_VERSION,
    PRIMING_MAX_WORDS,
    generate_priming,
    load_cefr_map,
)
from scripts.agent.config import ensure_gpt_env  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=Path("data.json"))
    ap.add_argument("--wordlist", type=Path, default=Path("scripts/cefr_wordlist.json"))
    ap.add_argument("--overrides", type=Path, default=Path("cefr_overrides.json"))
    ap.add_argument("--dry-run", action="store_true",
                    help="跳过 Azure 翻译；用占位中译，看选词不烧 token")
    ap.add_argument("--force", action="store_true",
                    help="对已有 priming 字段的 clip 也重跑")
    ap.add_argument("--max-words", type=int, default=PRIMING_MAX_WORDS)
    ap.add_argument("--limit", type=int, default=0,
                    help="只处理前 N 条（调试用）")
    args = ap.parse_args()

    if not args.data.exists():
        raise SystemExit(f"找不到 {args.data}")
    if not args.wordlist.exists():
        raise SystemExit(f"找不到 {args.wordlist}")

    if not args.dry_run:
        ensure_gpt_env()  # populate scripts.agent.config.GPT_* used by call_gpt

    cefr_map = load_cefr_map(str(args.wordlist), str(args.overrides))
    print(f"CEFR 词表: {len(cefr_map)} 词 (含 overrides)")
    print(f"priming 版本: {PRIMING_VERSION}")

    data = json.load(open(args.data))
    clips = data.get("clips", data if isinstance(data, list) else [])
    print(f"data.json: {len(clips)} clip")

    if not args.dry_run:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = Path("output/backups")
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"{args.data.stem}.priming-bak-{ts}{args.data.suffix}"
        shutil.copy2(args.data, backup)
        print(f"备份: {backup}")

    processed = 0
    skipped_existing = 0
    written = 0
    no_priming = 0

    for i, clip in enumerate(clips):
        if args.limit and processed >= args.limit:
            break
        if not args.force and isinstance(clip.get("priming"), dict):
            skipped_existing += 1
            continue
        title = (clip.get("title") or "")[:24]
        print(f"  [{i+1}/{len(clips)}] {title} ...", flush=True)
        try:
            priming = generate_priming(
                clip.get("lines", []),
                cefr_map,
                max_words=args.max_words,
                dry_run=args.dry_run,
            )
        except RuntimeError as e:
            print(f"      ❌ {e}")
            sys.exit(1)
        processed += 1
        if priming is None:
            clip["priming"] = None
            no_priming += 1
            print(f"      → no priming (insufficient B2+ content words)")
        else:
            clip["priming"] = priming
            written += 1
            preview = "  ".join(
                f"{w['word']}({w['cefr']})={w['zh'] or '?'}" for w in priming["words"]
            )
            print(f"      → {preview}")

    print()
    print(f"处理: {processed}  写入 priming: {written}  无 priming: {no_priming}  跳过(已存在): {skipped_existing}")

    if not args.dry_run:
        with open(args.data, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"已写回 {args.data}")
    else:
        print("dry-run 模式 — 未写回文件")


if __name__ == "__main__":
    main()
