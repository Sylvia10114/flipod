#!/usr/bin/env python3
"""Pipeline 输出校验：验证 data.json 中 teaching/difficulty 字段的完整性和正确性。

用法:
    python3 scripts/tests/test_teaching_output.py
    python3 scripts/tests/test_teaching_output.py --data output/teaching_output.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


VALID_LEVELS = {"A2", "B1", "B1+", "B2", "B2+"}
VALID_CEFR = {"A1", "A2", "B1", "B2", "C1", "C2"}
POOL_LEVELS = ["B1", "B2", "C1"]


def get_clip_words(clip: dict) -> set[str]:
    words = set()
    for line in clip.get("lines", []):
        for w in line.get("words", []):
            words.add(w.get("word", "").lower())
    return words


def check_clip(clip: dict, idx: int) -> list[str]:
    errors = []
    label = clip.get("title", f"clip_{idx}")[:40]

    difficulty = clip.get("difficulty")
    teaching = clip.get("teaching")

    if not difficulty and not teaching:
        return []  # no teaching data, skip

    # ── difficulty ──
    if difficulty and not isinstance(difficulty, dict):
        # Legacy format: difficulty is a plain string level — skip detailed checks
        if difficulty not in VALID_LEVELS:
            errors.append(f"[{idx}] {label}: legacy difficulty='{difficulty}' 不在五档中")
        difficulty = None  # skip dict-based checks below

    if difficulty:
        wpm = difficulty.get("wpm", 0)
        if not (80 <= wpm <= 220):
            errors.append(f"[{idx}] {label}: wpm={wpm} 超出 80-220 范围")

        level = difficulty.get("level")
        if level not in VALID_LEVELS:
            errors.append(f"[{idx}] {label}: level='{level}' 不在五档中")

        dist = difficulty.get("cefr_distribution", {})
        if dist:
            total = sum(dist.values())
            if abs(total - 1.0) > 0.05:
                errors.append(f"[{idx}] {label}: cefr_distribution 之和={total:.3f}，偏离 1.0 超过 0.05")
            for k in dist:
                if k not in VALID_CEFR:
                    errors.append(f"[{idx}] {label}: cefr_distribution 含无效等级 '{k}'")

    if not teaching:
        return errors

    lines = clip.get("lines", [])
    num_lines = len(lines)
    clip_words = get_clip_words(clip)

    # ── gist ──
    gist = teaching.get("gist", {})
    opts = gist.get("options", [])
    correct_count = sum(1 for o in opts if o.get("correct"))
    if correct_count != 1:
        errors.append(f"[{idx}] {label}: gist.options 正确选项 {correct_count} 个（应为 1）")

    for vk, variant in gist.get("difficulty_variants", {}).items():
        vopts = variant.get("options", [])
        vc = sum(1 for o in vopts if o.get("correct"))
        if vc != 1:
            errors.append(f"[{idx}] {label}: gist.difficulty_variants.{vk} 正确选项 {vc} 个（应为 1）")

    # ── word_pool ──
    wp = teaching.get("word_pool", {})
    for level in POOL_LEVELS:
        pool = wp.get(level, [])
        for wi, entry in enumerate(pool):
            word = entry.get("word", "")
            if word.lower() not in clip_words:
                errors.append(f"[{idx}] {label}: word_pool.{level}[{wi}] '{word}' 不在 clip 词表中")
            li = entry.get("line_index")
            if li is not None and (li < 0 or li >= num_lines):
                errors.append(f"[{idx}] {label}: word_pool.{level}[{wi}] line_index={li} 超出 [0,{num_lines-1}]")

    # ── exercises.fill_blank ──
    fb_sets = teaching.get("exercises", {}).get("fill_blank", {}).get("sets", [])
    for si, s in enumerate(fb_sets):
        bank = s.get("word_bank", [])
        bank_lower = [w.lower() for w in bank]
        for ii, item in enumerate(s.get("items", [])):
            answer = item.get("answer", "")
            if answer.lower() not in bank_lower:
                errors.append(
                    f"[{idx}] {label}: fill_blank.sets[{si}].items[{ii}] "
                    f"answer '{answer}' 不在 word_bank {bank} 中"
                )

    return errors


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("data.json"))
    args = ap.parse_args()

    if not args.data.exists():
        print(f"找不到 {args.data}")
        sys.exit(1)

    data = json.load(open(args.data, encoding="utf-8"))
    clips = data.get("clips", [])

    total = 0
    with_teaching = 0
    all_errors: list[str] = []

    for i, clip in enumerate(clips):
        total += 1
        if clip.get("teaching") or clip.get("difficulty"):
            with_teaching += 1
        errs = check_clip(clip, i)
        all_errors.extend(errs)

    print(f"总 clip: {total}")
    print(f"有 teaching/difficulty: {with_teaching}")
    print()

    if all_errors:
        print(f"发现 {len(all_errors)} 个问题:")
        for e in all_errors:
            print(f"  FAIL  {e}")
        print()
        print(f"结果: FAIL ({len(all_errors)} errors)")
        sys.exit(1)
    else:
        print("结果: ALL PASS")
        sys.exit(0)


if __name__ == "__main__":
    main()
