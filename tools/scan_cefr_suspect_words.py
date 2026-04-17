#!/usr/bin/env python3
"""Scan all clip transcripts for high-frequency function words that CEFR-J
likely over-grades. Surfaces candidates for `cefr_overrides.json`.

Heuristic:
  - Aggregate raw word frequency across all clip lines (tokens normalised
    to lowercase clean form).
  - Filter to words whose CURRENT CEFR-J level is B2/C1/C2 AND that occur
    >= --min-freq times across the corpus.
  - Print sorted by frequency desc, with current level + override status.

The output is meant for a human to skim and pick which words deserve a
manual override entry. Nothing is written automatically.

Usage:
    python3 tools/scan_cefr_suspect_words.py
    python3 tools/scan_cefr_suspect_words.py --min-freq 3 --min-level B2
    python3 tools/scan_cefr_suspect_words.py --data data.json --top 200
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

VALID_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


def normalize(raw: str) -> str:
    return re.sub(r"[^a-zA-Z']", "", raw).lower()


def load_json(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"找不到 {path}")
    return json.load(open(path, encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=Path("data.json"))
    ap.add_argument("--wordlist", type=Path, default=Path("scripts/cefr_wordlist.json"))
    ap.add_argument("--overrides", type=Path, default=Path("cefr_overrides.json"))
    ap.add_argument("--min-freq", type=int, default=3, help="最小出现频次 (默认 3)")
    ap.add_argument("--min-level", choices=VALID_LEVELS, default="B2",
                    help="只看当前 CEFR 档位 ≥ 此 (默认 B2)")
    ap.add_argument("--top", type=int, default=100, help="输出条目数上限 (默认 100)")
    args = ap.parse_args()

    data = load_json(args.data)
    wordlist = load_json(args.wordlist)
    overrides_data = json.load(open(args.overrides)) if args.overrides.exists() else {}
    overrides = {normalize(k): v for k, v in (overrides_data.get("overrides", {}) or {}).items()}

    min_idx = VALID_LEVELS.index(args.min_level)
    clips = data.get("clips", data if isinstance(data, list) else [])

    freq: Counter = Counter()
    for clip in clips:
        for line in clip.get("lines", []):
            for w in line.get("words", []):
                clean = normalize(w.get("word", ""))
                if not clean or len(clean) < 2:
                    continue
                freq[clean] += 1

    candidates = []
    for word, count in freq.items():
        if count < args.min_freq:
            continue
        cur = wordlist.get(word)
        if not cur or cur not in VALID_LEVELS:
            continue
        if VALID_LEVELS.index(cur) < min_idx:
            continue
        ov = overrides.get(word, "-")
        candidates.append((count, word, cur, ov))

    candidates.sort(key=lambda t: (-t[0], t[1]))

    print(f"扫描结果: {len(candidates)} 个候选 "
          f"(corpus 总词种 {len(freq)}, min-freq {args.min_freq}, min-level {args.min_level})")
    print(f"{'#':>4}  {'freq':>5}  {'word':<24} {'CEFR-J':<8} {'override':<8}")
    print("  " + "-" * 56)
    for i, (count, word, cur, ov) in enumerate(candidates[: args.top], start=1):
        marker = "→" if ov == "-" else "✓"
        print(f"{i:>4}  {count:>5}  {word:<24} {cur:<8} {ov:<8} {marker}")
    if len(candidates) > args.top:
        print(f"  ... 另有 {len(candidates) - args.top} 个未列出")

    print(f"\n说明: ✓ = 已在 cefr_overrides.json 中, → = 候选，可人工 review 后追加")


if __name__ == "__main__":
    main()
