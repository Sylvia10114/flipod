#!/usr/bin/env python3
"""Analyze dry-run filter rejections.

输入: output/dry_run_2026_04_14/dry_run_candidates.json
输出: output/dry_run_2026_04_14/filter_diagnostics.md

目的：
    1) duration 直方图（定位是 LLM 选得太短还是太长）
    2) tier × duration 拆分（找出问题 tier）
    3) end_no_punctuation 拒绝的末尾 50 字符 dump（人工判断真半截 vs 漏标点）
    4) 按 podcast 分组的拒绝率
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRY_RUN_DIR = ROOT / "output" / "dry_run_2026_04_14"
CAND_FILE = DRY_RUN_DIR / "dry_run_candidates.json"
OUT_FILE = DRY_RUN_DIR / "filter_diagnostics.md"

# Duration bins (seconds)
BINS = [
    ("<30",       lambda s: s < 30),
    ("30-45",     lambda s: 30 <= s < 45),
    ("45-60",     lambda s: 45 <= s < 60),
    ("60-90",     lambda s: 60 <= s < 90),
    ("90-120",    lambda s: 90 <= s < 120),
    ("120-150",   lambda s: 120 <= s < 150),
    (">=150",     lambda s: s >= 150),
]


def classify_reject_reason(fr: str) -> str:
    """Normalize filter_result to a reject bucket label."""
    if not fr or fr.startswith("pass"):
        return "passed"
    # rejected_duration_out_of_range_36s_business_(45-120)
    if "duration_out_of_range" in fr:
        return "duration_out_of_range"
    # rejected_end_no_punctuation / rejected_end_... variants
    if "end_no_punctuation" in fr:
        return "end_no_punctuation"
    if "antecedent_phrase" in fr:
        return "antecedent_phrase"
    if "empty_filler" in fr or "filler" in fr:
        return "empty_filler"
    if "pure_agreement" in fr:
        return "pure_agreement"
    if "ad_pattern" in fr or "ad_" in fr:
        return "ad_pattern"
    if "trailing_comma" in fr:
        return "trailing_comma"
    # fallback: keep the short reason
    m = re.match(r"rejected_([a-z_]+)", fr)
    return m.group(1) if m else "other"


def duration_bucket(sec: float) -> str:
    for label, fn in BINS:
        if fn(sec):
            return label
    return "?"


def parse_duration_range(fr: str) -> str:
    """Extract the '(45-120)' range from the filter_result string if present."""
    m = re.search(r"\(([0-9]+-[0-9]+)\)", fr or "")
    return m.group(1) if m else ""


def main() -> None:
    with CAND_FILE.open() as f:
        data = json.load(f)

    episodes = data.get("episodes", [])
    total = 0
    # flat list of (candidate, episode meta)
    flat: list[tuple[dict, dict]] = []
    for ep in episodes:
        for c in ep.get("candidates", []):
            flat.append((c, ep))
            total += 1

    # ---- 1) duration histogram ----
    dur_hist = Counter()
    pass_dur_hist = Counter()
    rej_dur_hist = Counter()
    for c, _ in flat:
        b = duration_bucket(c.get("duration_sec", 0.0))
        dur_hist[b] += 1
        fr = c.get("filter_result", "")
        if fr.startswith("pass"):
            pass_dur_hist[b] += 1
        else:
            rej_dur_hist[b] += 1

    # ---- 2) tier × duration ----
    tier_dur: dict[str, Counter] = defaultdict(Counter)
    tier_reject: dict[str, Counter] = defaultdict(Counter)  # tier -> reason -> count
    tier_total: Counter = Counter()
    tier_pass: Counter = Counter()
    for c, _ in flat:
        t = (c.get("tier") or "").lower() or "?"
        b = duration_bucket(c.get("duration_sec", 0.0))
        tier_dur[t][b] += 1
        tier_total[t] += 1
        fr = c.get("filter_result", "")
        if fr.startswith("pass"):
            tier_pass[t] += 1
        else:
            tier_reject[t][classify_reject_reason(fr)] += 1

    # ---- 3) reject reason tally ----
    reason_tally = Counter()
    duration_out_bucket = Counter()  # for duration_out_of_range, what bucket
    duration_out_vs_limit = Counter()  # below / above / unknown
    for c, _ in flat:
        fr = c.get("filter_result", "")
        r = classify_reject_reason(fr)
        if r == "passed":
            continue
        reason_tally[r] += 1
        if r == "duration_out_of_range":
            dur = c.get("duration_sec", 0.0)
            duration_out_bucket[duration_bucket(dur)] += 1
            rng = parse_duration_range(fr)
            if rng:
                lo, hi = [float(x) for x in rng.split("-")]
                if dur < lo:
                    duration_out_vs_limit["below_lower"] += 1
                elif dur > hi:
                    duration_out_vs_limit["above_upper"] += 1
                else:
                    duration_out_vs_limit["within_but_flagged"] += 1
            else:
                duration_out_vs_limit["unknown"] += 1

    # ---- 4) end_no_punctuation dump: last 50 chars ----
    end_dump: list[dict] = []
    for c, ep in flat:
        if classify_reject_reason(c.get("filter_result", "")) != "end_no_punctuation":
            continue
        text = c.get("text", "") or ""
        tail = text[-50:].replace("\n", " ⏎ ")
        end_dump.append({
            "podcast": ep.get("podcast"),
            "episode": ep.get("episode"),
            "tier": c.get("tier"),
            "duration": round(c.get("duration_sec", 0.0), 1),
            "tail": tail,
            "hook_strength": c.get("hook_strength"),
            "agent_verdict": c.get("agent_verdict"),
        })

    # ---- 5) per-podcast reject rate ----
    per_pod_total: Counter = Counter()
    per_pod_pass: Counter = Counter()
    for c, ep in flat:
        pod = ep.get("podcast", "?")
        per_pod_total[pod] += 1
        if c.get("filter_result", "").startswith("pass"):
            per_pod_pass[pod] += 1

    # ==== write markdown ====
    lines: list[str] = []
    lines.append("# Filter Rejection Diagnostics")
    lines.append("")
    lines.append(f"- 数据：`{CAND_FILE.relative_to(ROOT)}`")
    lines.append(f"- 候选总数：**{total}**")
    n_pass = sum(1 for c, _ in flat if c.get("filter_result", "").startswith("pass"))
    lines.append(f"- Filter 通过：**{n_pass}** ({n_pass/total*100:.1f}%)")
    lines.append(f"- Filter 拒绝：**{total - n_pass}** ({(total-n_pass)/total*100:.1f}%)")
    lines.append("")

    # reject reason tally
    lines.append("## 拒绝原因分布")
    lines.append("")
    lines.append("| 原因 | 数量 | 占拒绝 % |")
    lines.append("|---|---:|---:|")
    denom = max(total - n_pass, 1)
    for r, n in reason_tally.most_common():
        lines.append(f"| {r} | {n} | {n/denom*100:.1f}% |")
    lines.append("")

    # duration_out_of_range split
    if reason_tally.get("duration_out_of_range"):
        lines.append("### duration_out_of_range 分布")
        lines.append("")
        lines.append("**偏离方向：**")
        lines.append("")
        lines.append("| 方向 | 数量 |")
        lines.append("|---|---:|")
        for k, v in duration_out_vs_limit.most_common():
            lines.append(f"| {k} | {v} |")
        lines.append("")
        lines.append("**落在哪个时长桶：**")
        lines.append("")
        lines.append("| 桶 | 数量 |")
        lines.append("|---|---:|")
        for label, _ in BINS:
            n = duration_out_bucket.get(label, 0)
            if n:
                lines.append(f"| {label} | {n} |")
        lines.append("")

    # 1) duration histogram
    lines.append("## 1) Duration 直方图（全部候选）")
    lines.append("")
    lines.append("| 桶 (秒) | 全部 | 通过 | 拒绝 |")
    lines.append("|---|---:|---:|---:|")
    for label, _ in BINS:
        lines.append(f"| {label} | {dur_hist.get(label,0)} | {pass_dur_hist.get(label,0)} | {rej_dur_hist.get(label,0)} |")
    lines.append("")

    # 2) tier × duration
    lines.append("## 2) Tier × Duration 拆分")
    lines.append("")
    header = "| Tier | 总数 | 通过 | 通过率 | " + " | ".join(label for label, _ in BINS) + " |"
    sep = "|---|---:|---:|---:|" + "|".join(["---:"] * len(BINS)) + "|"
    lines.append(header)
    lines.append(sep)
    for t in sorted(tier_total):
        row = [t, str(tier_total[t]), str(tier_pass[t]),
               f"{tier_pass[t]/tier_total[t]*100:.0f}%"]
        for label, _ in BINS:
            row.append(str(tier_dur[t].get(label, 0)))
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")

    # tier 拒绝原因拆分
    lines.append("### Tier × 拒绝原因")
    lines.append("")
    all_reasons = sorted({r for d in tier_reject.values() for r in d})
    head = "| Tier | " + " | ".join(all_reasons) + " |"
    sep = "|---|" + "|".join(["---:"] * len(all_reasons)) + "|"
    lines.append(head)
    lines.append(sep)
    for t in sorted(tier_reject):
        row = [t] + [str(tier_reject[t].get(r, 0)) for r in all_reasons]
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")

    # 3) end_no_punctuation dump
    lines.append(f"## 3) end_no_punctuation 末尾 50 字符 dump（{len(end_dump)} 条）")
    lines.append("")
    lines.append("> 判断依据：如果末尾看起来是完整句但词级输出没标点 → 真正是 bug（pipeline 用 word-level 拼 text 丢了标点）；")
    lines.append("> 如果明显是半截（逗号、连词、名词短语悬空）→ 真问题。")
    lines.append("")
    lines.append("| # | Podcast | Tier | Dur | Hook | Agent | 末尾50字符 |")
    lines.append("|---:|---|---|---:|---|---|---|")
    for i, d in enumerate(end_dump, 1):
        tail = d["tail"].replace("|", "\\|")
        pod = (d["podcast"] or "")[:30]
        lines.append(f"| {i} | {pod} | {d['tier']} | {d['duration']} | {d['hook_strength']} | {d['agent_verdict']} | …{tail} |")
    lines.append("")

    # 4) per-podcast
    lines.append("## 4) 按 Podcast 分组的通过率")
    lines.append("")
    lines.append("| Podcast | 候选 | 通过 | 通过率 |")
    lines.append("|---|---:|---:|---:|")
    for pod, n in per_pod_total.most_common():
        p = per_pod_pass.get(pod, 0)
        lines.append(f"| {pod} | {n} | {p} | {p/n*100:.0f}% |")
    lines.append("")

    # tail hint
    lines.append("---")
    lines.append("")
    lines.append("**下一步决策锚点：**")
    lines.append("")
    lines.append("- 如果 `below_lower` 远多于 `above_upper` → LLM 倾向选短 hook，改 prompt 加硬约束 ≥ 下限 更治本")
    lines.append("- 如果 `above_upper` 远多于 `below_lower` → LLM 贪心选大段，改 prompt 加硬约束 ≤ 上限")
    lines.append("- 两头都有 → 改 prompt 比放宽 filter 更治本")
    lines.append("- `end_no_punctuation` 末尾看起来像完整句 → 修 pipeline.py text 拼接改用 segment 级（带标点）")

    OUT_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_FILE.relative_to(ROOT)}")
    print(f"  candidates: {total}, pass: {n_pass}, reject: {total-n_pass}")
    print(f"  reject reasons: {dict(reason_tally.most_common())}")


if __name__ == "__main__":
    main()
