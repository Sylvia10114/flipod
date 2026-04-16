#!/usr/bin/env python3
"""将 generate_teaching.py 的输出合并到 data.json。

用法:
    python3 scripts/merge_teaching.py
    python3 scripts/merge_teaching.py --data data.json --teaching output/teaching_output.json
    python3 scripts/merge_teaching.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def validate_teaching(clip: dict, idx: int) -> list[str]:
    """校验单个 clip 的 teaching 字段，返回问题列表。"""
    errors = []
    t = clip.get("teaching")
    if not t:
        return errors

    label = clip.get("id") or clip.get("title", f"clip_{idx}")

    # gist: options 有且仅有 1 个 correct
    gist = t.get("gist", {})
    opts = gist.get("options", [])
    correct = sum(1 for o in opts if o.get("correct"))
    if correct != 1:
        errors.append(f"[{idx}] {label}: gist.options 正确选项 {correct} 个（应为 1）")

    # word_pool 每层至少 1 个词
    wp = t.get("word_pool", {})
    for level in ["B1", "B2", "C1"]:
        pool = wp.get(level, [])
        if len(pool) < 1:
            errors.append(f"[{idx}] {label}: word_pool.{level} 为空")

    # fill_blank.sets 至少 1 套
    fb_sets = t.get("exercises", {}).get("fill_blank", {}).get("sets", [])
    if len(fb_sets) < 1:
        errors.append(f"[{idx}] {label}: fill_blank.sets 为空")

    return errors


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("data.json"))
    ap.add_argument("--teaching", type=Path, default=Path("output/teaching_output.json"))
    ap.add_argument("--dry-run", action="store_true", help="只打印匹配结果，不写文件")
    args = ap.parse_args()

    for p in [args.data, args.teaching]:
        if not p.exists():
            raise SystemExit(f"找不到 {p}")

    data = json.load(open(args.data, encoding="utf-8"))
    teaching_data = json.load(open(args.teaching, encoding="utf-8"))

    clips = data.get("clips", [])
    t_clips = teaching_data.get("clips", [])
    print(f"data.json: {len(clips)} clips")
    print(f"teaching_output.json: {len(t_clips)} clips")

    # 建立 teaching 源的索引：优先按 id 匹配，fallback 按索引
    t_by_id: dict[str, dict] = {}
    for tc in t_clips:
        cid = tc.get("id")
        if cid:
            t_by_id[cid] = tc

    merged = 0
    skipped = 0

    for i, clip in enumerate(clips):
        # 查找匹配的 teaching 源
        source = None
        cid = clip.get("id")
        if cid and cid in t_by_id:
            source = t_by_id[cid]
        elif i < len(t_clips):
            source = t_clips[i]

        if not source:
            continue

        difficulty = source.get("difficulty")
        teaching = source.get("teaching")

        if not difficulty and not teaching:
            skipped += 1
            continue

        if difficulty:
            clip["difficulty"] = difficulty
        if teaching:
            clip["teaching"] = teaching
        merged += 1

    print(f"\n合并: {merged} 个 clip")
    if skipped:
        print(f"跳过（无 teaching/difficulty）: {skipped} 个")

    # 校验
    all_errors = []
    teaching_count = 0
    for i, clip in enumerate(clips):
        if clip.get("teaching"):
            teaching_count += 1
            all_errors.extend(validate_teaching(clip, i))

    print(f"\n校验报告:")
    print(f"  有 teaching 的 clip: {teaching_count}")
    if all_errors:
        print(f"  问题 ({len(all_errors)}):")
        for e in all_errors:
            print(f"    - {e}")
    else:
        print(f"  全部通过")

    if args.dry_run:
        print(f"\ndry-run 模式，未写入文件")
        return

    # 备份 + 写入
    backup = args.data.with_suffix(".json.bak")
    shutil.copy2(args.data, backup)
    print(f"\n已备份: {backup}")

    with open(args.data, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"已更新: {args.data}")


if __name__ == "__main__":
    main()
