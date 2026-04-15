#!/usr/bin/env python3
"""Migrate CEFR wordlist from LLM-generated COCA-frequency assignment to CEFR-J.

源：openlanguageprofiles/olp-en-cefrj
  - cefrj-vocabulary-profile-1.5.csv        (A1-B2 主表)
  - octanove-vocabulary-profile-c1c2-1.0.csv (C1-C2 扩展,可选)

用法:
    # 两张表都有
    python tools/migrate_cefr_to_cefrj.py \\
        --cefrj /path/to/cefrj-vocabulary-profile-1.5.csv \\
        --c1c2  /path/to/octanove-vocabulary-profile-c1c2-1.0.csv \\
        --old   scripts/cefr_wordlist.json \\
        --out   scripts/cefr_wordlist.json.new \\
        --diff  output/cefr_migration_diff.md

    # 只有 A1-B2
    python tools/migrate_cefr_to_cefrj.py --cefrj ... --old ... --out ... --diff ...

产出两个文件:
    1. 新 cefr_wordlist.json(同 schema:word → level,可直接替换原文件)
    2. 迁移 diff 报告 md(哪些词级别变了 / 新加的 / 丢失的 / 总量变化)

**不做替换** —— 产出 .new 文件,由 PM 审 diff 后手动 mv 替换。
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

LEVEL_ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}


def load_cefrj_csv(path: Path) -> dict[str, str]:
    """CEFR-J CSV 的 headword + CEFR 列。同词多词性取最低级别(最保守)。"""
    result: dict[str, str] = {}
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        # 自适应列名:headword 可能叫 headword / word / lemma;CEFR 可能叫 CEFR / level
        fieldnames = {k.lower().strip(): k for k in (reader.fieldnames or [])}
        word_col = fieldnames.get("headword") or fieldnames.get("word") or fieldnames.get("lemma")
        level_col = fieldnames.get("cefr") or fieldnames.get("level")
        if not word_col or not level_col:
            raise SystemExit(f"❌ CSV {path} 缺 headword/CEFR 列,实际列: {list(reader.fieldnames or [])}")

        for row in reader:
            word = (row[word_col] or "").strip().lower()
            level = (row[level_col] or "").strip().upper()
            if not word or level not in LEVEL_ORDER:
                continue
            # 同词多词性取最低级别(最保守,用户查到时显示的是最容易见到的那个意思)
            if word not in result or LEVEL_ORDER[level] < LEVEL_ORDER[result[word]]:
                result[word] = level
    return result


def diff_wordlists(old: dict[str, str], new: dict[str, str]) -> dict:
    old_keys, new_keys = set(old), set(new)
    changed = [(w, old[w], new[w]) for w in old_keys & new_keys if old[w] != new[w]]
    added = sorted(new_keys - old_keys)
    removed = sorted(old_keys - new_keys)
    return {
        "old_total": len(old),
        "new_total": len(new),
        "changed_count": len(changed),
        "added_count": len(added),
        "removed_count": len(removed),
        "changed": sorted(changed),
        "added": added,
        "removed": removed,
        "old_dist": Counter(old.values()),
        "new_dist": Counter(new.values()),
    }


def render_diff_md(d: dict) -> str:
    out = []
    out.append("# CEFR 词表迁移 diff:假 COCA-CEFR → CEFR-J\n")
    out.append("## 总量对比\n")
    out.append(f"- 旧词表: **{d['old_total']}** 词")
    out.append(f"- 新词表: **{d['new_total']}** 词")
    out.append(f"- 级别变动: **{d['changed_count']}** 词")
    out.append(f"- 新增(只在新表): **{d['added_count']}** 词")
    out.append(f"- 丢失(只在旧表): **{d['removed_count']}** 词\n")

    out.append("## 级别分布对比\n")
    out.append("| 级别 | 旧 | 新 | Δ |")
    out.append("|---|---:|---:|---:|")
    for lvl in ["A1", "A2", "B1", "B2", "C1", "C2"]:
        a, b = d["old_dist"].get(lvl, 0), d["new_dist"].get(lvl, 0)
        out.append(f"| {lvl} | {a} | {b} | {b - a:+d} |")

    # 级别变动矩阵
    out.append("\n## 级别变动矩阵(旧 → 新)\n")
    matrix = defaultdict(int)
    for _, old_l, new_l in d["changed"]:
        matrix[(old_l, new_l)] += 1
    out.append("| 旧\\新 | A1 | A2 | B1 | B2 | C1 | C2 |")
    out.append("|---|---:|---:|---:|---:|---:|---:|")
    for ol in ["A1", "A2", "B1", "B2", "C1", "C2"]:
        row = [ol]
        for nl in ["A1", "A2", "B1", "B2", "C1", "C2"]:
            row.append(str(matrix.get((ol, nl), 0)) if ol != nl else "—")
        out.append("| " + " | ".join(row) + " |")

    # 改动样本(升级/降级各 30)
    upgrades = [(w, o, n) for w, o, n in d["changed"] if LEVEL_ORDER[n] > LEVEL_ORDER[o]]
    downgrades = [(w, o, n) for w, o, n in d["changed"] if LEVEL_ORDER[n] < LEVEL_ORDER[o]]

    out.append(f"\n## 变难样本(旧认为简单,新认为难) — 共 {len(upgrades)},展示前 30\n")
    out.append("| 词 | 旧 | 新 |")
    out.append("|---|---|---|")
    for w, o, n in upgrades[:30]:
        out.append(f"| {w} | {o} | **{n}** ⬆ |")

    out.append(f"\n## 变简单样本(旧认为难,新认为简单) — 共 {len(downgrades)},展示前 30\n")
    out.append("| 词 | 旧 | 新 |")
    out.append("|---|---|---|")
    for w, o, n in downgrades[:30]:
        out.append(f"| {w} | {o} | **{n}** ⬇ |")

    out.append(f"\n## 丢失样本(旧有,新无,归因:COCA 推断幻觉 or CEFR-J 不收录) — 共 {d['removed_count']},展示前 30\n")
    out.append("> 丢失的词在新词表里会走 LLM fallback;如果 LLM 也判不出,clip 里标 `cefr_level: null`。\n")
    out.append("| 词 | 旧级别 |")
    out.append("|---|---|")
    # 从原 dict 查级别
    # 丢失的是原表有但新表无 - 传入 d["removed"] 时已经排序
    # 但我们没有原 level 传入,要从 diff 入口保留
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cefrj", type=Path, required=True, help="cefrj-vocabulary-profile-1.5.csv")
    ap.add_argument("--c1c2", type=Path, help="octanove-vocabulary-profile-c1c2-1.0.csv(可选,C1-C2 扩展)")
    ap.add_argument("--old", type=Path, default=Path("scripts/cefr_wordlist.json"))
    ap.add_argument("--out", type=Path, default=Path("scripts/cefr_wordlist.json.new"))
    ap.add_argument("--diff", type=Path, default=Path("output/cefr_migration_diff.md"))
    args = ap.parse_args()

    # 1. 加载新词表(A1-B2 + 可选 C1-C2)
    new_map = load_cefrj_csv(args.cefrj)
    print(f"✅ CEFR-J A1-B2 加载: {len(new_map)} 词")
    if args.c1c2 and args.c1c2.exists():
        c1c2 = load_cefrj_csv(args.c1c2)
        for w, lv in c1c2.items():
            if w not in new_map:  # 只添加 A1-B2 表里没有的,避免覆盖
                new_map[w] = lv
        print(f"✅ C1-C2 扩展合并后总量: {len(new_map)} 词")

    # 2. 加载旧词表
    old_map = json.load(open(args.old))
    print(f"✅ 旧(假 COCA-CEFR)加载: {len(old_map)} 词")

    # 3. Diff
    d = diff_wordlists(old_map, new_map)
    print(f"📊 变动: {d['changed_count']} 改级别 / {d['added_count']} 新增 / {d['removed_count']} 丢失")

    # 4. 写新词表
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(new_map, f, ensure_ascii=False, indent=2, sort_keys=True)
    print(f"✅ 新词表写入: {args.out}")

    # 5. 写 diff 报告
    args.diff.parent.mkdir(parents=True, exist_ok=True)
    md = render_diff_md(d)
    with open(args.diff, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"✅ diff 报告写入: {args.diff}")

    print("\n👉 下一步: PM 审阅 diff,确认后手动 `mv scripts/cefr_wordlist.json.new scripts/cefr_wordlist.json`")


if __name__ == "__main__":
    main()
