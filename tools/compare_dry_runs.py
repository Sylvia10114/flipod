#!/usr/bin/env python3
"""Compare two dry-run candidate files (骨架 v0.1, 2026-04-15).

目的：v2.1 → v2.2 Patch D 有效性诊断。
不追求统计学级 A/B —— RSS 每次拉的 episode 列表会漂移，我们只要方向性结论。

用法:
    python tools/compare_dry_runs.py \\
        output/dry_run_2026_04_14/dry_run_candidates.json \\
        output/dry_run_2026_04_15/dry_run_candidates.json \\
        --out output/dry_run_2026_04_15/v21_vs_v22_diagnostic.md

输出三项核心指标（按 Cowork 在 problem 4 对齐的口径）：

    1) end_no_punct 绝对数 + 占拒绝比例
       → Patch D 有效性判定
         9 → 2-3：清楚有效
         9 → 6-7：边际有效（保留但下轮把末尾检测放 filter 层）
         9 → 8-9：无效（回滚 v2.1，末尾检测必须靠 filter）

    2) 候选平均 duration + 到下限距离
       → 判断 LLM 是否真的主动扩段

    3) A 档（filter_pass ∩ agent_pass）绝对数
       → 冷库补给量是否上升

附带说明：老 run 和新 run 的 episode 列表会在标题层重合度里列出，
避免把"样本不同"的差异误认为"prompt 改进"。
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

# Tier duration lower bounds —— 跟 scripts/agent/filter.py::DURATION_LIMITS 对齐
LOWER_BOUNDS = {
    "Science": 45, "Business": 45,
    "Tech": 60, "Psychology": 60, "Culture": 60, "Story": 60,
}

REJECT_REASONS = [
    "duration_out_of_range",
    "end_no_punctuation",
    "end_dangling_and",
    "end_dangling_but",
    "end_dangling_to",
    "end_dangling_of",
    "internal_silence",
]


def _reason_bucket(filter_result: str) -> str:
    """'rejected_end_no_punctuation' → 'end_no_punctuation'"""
    if not filter_result or filter_result == "passed":
        return "passed"
    r = filter_result.replace("rejected_", "")
    # duration_out_of_range_36s_story_(60-150) → duration_out_of_range
    for reason in REJECT_REASONS:
        if r.startswith(reason):
            return reason
    return r


def load_run(path: Path) -> dict:
    data = json.load(open(path))
    # 拍平候选，附带 episode 上下文
    flat = []
    ep_ids = set()
    for ep in data["episodes"]:
        ep_id = f"{ep['podcast']} / {ep['episode']}"
        ep_ids.add(ep_id)
        for c in ep["candidates"]:
            flat.append({
                "tier": c.get("tier") or ep.get("tier"),
                "duration": c.get("duration_sec", 0),
                "filter_result": c.get("filter_result"),
                "agent_verdict": c.get("agent_verdict"),
                "reason_bucket": _reason_bucket(c.get("filter_result", "")),
                "ep_id": ep_id,
            })
    return {
        "path": path,
        "prompt_version": data.get("prompt_version", "unknown"),
        "run_id": data.get("run_id", "unknown"),
        "episodes": ep_ids,
        "candidates": flat,
    }


def metrics(run: dict) -> dict:
    cands = run["candidates"]
    total = len(cands)
    passed_filter = sum(1 for c in cands if c["reason_bucket"] == "passed")
    rejected = total - passed_filter

    # 拒绝原因分布
    reason_counts = Counter(c["reason_bucket"] for c in cands if c["reason_bucket"] != "passed")

    # end_no_punct 核心指标
    end_no_punct = reason_counts.get("end_no_punctuation", 0)
    end_no_punct_pct_of_reject = (end_no_punct / rejected * 100) if rejected else 0

    # duration: 全部候选 vs 下限距离
    durations = [c["duration"] for c in cands if c["duration"] > 0]
    avg_dur = mean(durations) if durations else 0
    # 到下限的距离（每个 candidate 按自己 tier 的下限）
    distances = []
    for c in cands:
        lb = LOWER_BOUNDS.get(c["tier"], 60)
        if c["duration"] > 0:
            distances.append(c["duration"] - lb)
    avg_distance = mean(distances) if distances else 0

    # A 档：filter_pass ∩ agent_pass
    a_tier = sum(
        1 for c in cands
        if c["reason_bucket"] == "passed" and c["agent_verdict"] == "pass"
    )

    return {
        "total": total,
        "passed_filter": passed_filter,
        "rejected": rejected,
        "reason_counts": reason_counts,
        "end_no_punct": end_no_punct,
        "end_no_punct_pct_of_reject": end_no_punct_pct_of_reject,
        "avg_duration": avg_dur,
        "avg_distance_from_lower_bound": avg_distance,
        "a_tier": a_tier,
    }


def verdict(old_enp: int, new_enp: int) -> str:
    """Cowork 在 problem 3 预提交的判定规则。"""
    if new_enp <= 3:
        return "🟢 **清楚有效** — Patch D 的末尾硬约束起作用了，保留。"
    if new_enp <= 7:
        return "🟡 **边际有效** — 保留改动，但下一轮把末尾检测放到 filter 层（prompt 文字级压制力有限）。"
    return "🔴 **无效** — 回滚 v2.1，末尾完整性必须靠 code filter 实现，不再依赖 prompt 约束。"


def render_markdown(old: dict, new: dict, m_old: dict, m_new: dict) -> str:
    overlap = old["episodes"] & new["episodes"]
    only_old = old["episodes"] - new["episodes"]
    only_new = new["episodes"] - old["episodes"]

    def delta(a, b, unit=""):
        d = b - a
        sign = "+" if d > 0 else ""
        return f"{sign}{d:.1f}{unit}" if isinstance(d, float) else f"{sign}{d}{unit}"

    out = []
    out.append(f"# Dry-run 对比诊断：{old['prompt_version']} → {new['prompt_version']}\n")
    out.append(f"- 旧：`{old['path']}`  (run_id: {old['run_id']})")
    out.append(f"- 新：`{new['path']}`  (run_id: {new['run_id']})\n")

    out.append("## ⚠️ 样本重合度（非严格 A/B 提醒）\n")
    out.append(f"- 两次都跑的 episode：**{len(overlap)}**")
    out.append(f"- 只在旧 run 里：**{len(only_old)}**")
    out.append(f"- 只在新 run 里：**{len(only_new)}**")
    out.append(f"- 结论是**方向性**的，不是统计学级别。\n")

    out.append("## 三项核心指标\n")
    out.append("| 指标 | 旧 | 新 | Δ |")
    out.append("|---|---:|---:|---:|")
    out.append(f"| 候选总数 | {m_old['total']} | {m_new['total']} | {delta(m_old['total'], m_new['total'])} |")
    out.append(f"| Filter 通过（filter_pass） | {m_old['passed_filter']} | {m_new['passed_filter']} | {delta(m_old['passed_filter'], m_new['passed_filter'])} |")
    out.append(f"| A 档（filter ∩ agent pass） | **{m_old['a_tier']}** | **{m_new['a_tier']}** | {delta(m_old['a_tier'], m_new['a_tier'])} |")
    out.append(f"| end_no_punct 绝对数 | **{m_old['end_no_punct']}** | **{m_new['end_no_punct']}** | {delta(m_old['end_no_punct'], m_new['end_no_punct'])} |")
    out.append(f"| end_no_punct 占拒绝 % | {m_old['end_no_punct_pct_of_reject']:.1f}% | {m_new['end_no_punct_pct_of_reject']:.1f}% | {delta(m_old['end_no_punct_pct_of_reject'], m_new['end_no_punct_pct_of_reject'], '%')} |")
    out.append(f"| 候选平均 duration | {m_old['avg_duration']:.1f}s | {m_new['avg_duration']:.1f}s | {delta(m_old['avg_duration'], m_new['avg_duration'], 's')} |")
    out.append(f"| 到下限平均距离 | {m_old['avg_distance_from_lower_bound']:.1f}s | {m_new['avg_distance_from_lower_bound']:.1f}s | {delta(m_old['avg_distance_from_lower_bound'], m_new['avg_distance_from_lower_bound'], 's')} |")

    out.append("\n## Patch D 判定\n")
    out.append(verdict(m_old["end_no_punct"], m_new["end_no_punct"]))
    out.append("")

    out.append("## 拒绝原因分布\n")
    out.append("| 原因 | 旧 | 新 | Δ |")
    out.append("|---|---:|---:|---:|")
    all_reasons = set(m_old["reason_counts"]) | set(m_new["reason_counts"])
    for r in sorted(all_reasons):
        a, b = m_old["reason_counts"].get(r, 0), m_new["reason_counts"].get(r, 0)
        out.append(f"| {r} | {a} | {b} | {delta(a, b)} |")

    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("old", type=Path, help="旧 dry-run JSON (e.g. v2.1)")
    ap.add_argument("new", type=Path, help="新 dry-run JSON (e.g. v2.2)")
    ap.add_argument("--out", type=Path, help="输出 markdown 路径；默认 stdout")
    args = ap.parse_args()

    old = load_run(args.old)
    new = load_run(args.new)
    m_old = metrics(old)
    m_new = metrics(new)
    md = render_markdown(old, new, m_old, m_new)

    if args.out:
        args.out.write_text(md, encoding="utf-8")
        print(f"✅ diagnostic 已写入: {args.out}")
    else:
        print(md)


if __name__ == "__main__":
    main()
