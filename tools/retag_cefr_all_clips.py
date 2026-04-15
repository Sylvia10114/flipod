#!/usr/bin/env python3
"""Re-tag CEFR levels on all existing clips in data.json after wordlist upgrade.

用法:
    # 默认:就地重打 data.json,自动备份为 data.json.backup-<timestamp>
    python3 tools/retag_cefr_all_clips.py

    # 或指定路径
    python3 tools/retag_cefr_all_clips.py \\
        --data data.json \\
        --wordlist scripts/cefr_wordlist.json

产出:
    1. 原地更新 data.json,每个 word 的 `cefr` 字段根据新词表查
       - 词表命中 → 用新词表值
       - 词表未命中 → `cefr` 设为 null(留给 LLM fallback 后续补)
    2. 备份原 data.json 到 data.json.backup-YYYYMMDD_HHMMSS
    3. 打印 diff summary:多少词级别变了,多少从有值变 null,多少从 null 变有值

**不调用 LLM,零成本**。LLM fallback 的词留 null,由 Claude Code 后续单独补一轮(或等下次切片流水线自然补齐)。
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path

VALID_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}


def normalize_word(raw: str) -> str:
    """跟 scripts/agent/cefr.py::get_cefr 一致的归一化。"""
    return re.sub(r"[^a-zA-Z']", "", raw).lower()


def lookup(word: str, wordlist: dict[str, str]) -> str | None:
    clean = normalize_word(word)
    if not clean:
        return None
    return wordlist.get(clean)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=Path("data.json"))
    ap.add_argument("--wordlist", type=Path, default=Path("scripts/cefr_wordlist.json"))
    ap.add_argument("--dry-run", action="store_true", help="只打印 diff,不改 data.json")
    args = ap.parse_args()

    if not args.data.exists():
        raise SystemExit(f"❌ 找不到 {args.data}")
    if not args.wordlist.exists():
        raise SystemExit(f"❌ 找不到 {args.wordlist}")

    wordlist = json.load(open(args.wordlist))
    print(f"✅ 词表加载: {len(wordlist)} 词")

    data = json.load(open(args.data))
    clips = data.get("clips", data if isinstance(data, list) else [])
    print(f"✅ data.json 加载: {len(clips)} 条 clip")

    # 统计
    total_words = 0
    changed = Counter()           # (old_level, new_level) -> count
    became_null = 0
    became_leveled = 0
    unchanged = 0

    for clip in clips:
        for line in clip.get("lines", []):
            for w in line.get("words", []):
                total_words += 1
                old_level = w.get("cefr")
                new_level = lookup(w.get("word", ""), wordlist)

                # 规范化 null 表示
                if old_level not in VALID_LEVELS:
                    old_level = None
                if new_level not in VALID_LEVELS:
                    new_level = None

                if old_level == new_level:
                    unchanged += 1
                else:
                    if old_level is None and new_level is not None:
                        became_leveled += 1
                    elif old_level is not None and new_level is None:
                        became_null += 1
                    else:
                        changed[(old_level, new_level)] += 1

                if not args.dry_run:
                    if new_level is not None:
                        w["cefr"] = new_level
                    else:
                        # 未命中词:设为 null(前端见 null 不渲染高光)
                        w["cefr"] = None

    # Summary
    total_changed = sum(changed.values()) + became_null + became_leveled
    print(f"\n📊 Retag 结果({'预览' if args.dry_run else '已应用'}):")
    print(f"  - 总词数: {total_words}")
    print(f"  - 未变动: {unchanged}")
    print(f"  - 改级别: {sum(changed.values())}")
    print(f"  - 从 null 变有值: {became_leveled}")
    print(f"  - 从有值变 null(新词表未收录): {became_null}")
    print(f"  - 净变动: {total_changed} ({total_changed / total_words * 100:.1f}%)")

    if changed:
        print(f"\n📊 级别迁移 Top 10:")
        for (old, new), count in changed.most_common(10):
            print(f"  {old} → {new}: {count}")

    if not args.dry_run:
        # 备份 + 写回
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = args.data.parent / f"{args.data.stem}.backup-{ts}{args.data.suffix}"
        shutil.copy2(args.data, backup)
        print(f"\n✅ 原文件已备份: {backup}")

        with open(args.data, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✅ data.json 已更新")
    else:
        print(f"\n⚠️ dry-run 模式,未写回 data.json。去掉 --dry-run 后正式执行。")


if __name__ == "__main__":
    main()
