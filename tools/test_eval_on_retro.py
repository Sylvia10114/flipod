#!/usr/bin/env python3
"""
拿现有 37 个回溯 clip 测 eval_candidates.py 的真值率。

流程：
1. 从 data.json 取每个 clip 的全文（lines[].en 拼接）
2. 从 retrospective_labels_v2.json 取 PM 的 ground truth verdict
3. 改造成 dry_run_candidates.json 格式
4. subprocess 调 eval_candidates.py 跑评估
5. 对比 agent verdict vs PM verdict，输出 agreement 报告

用法（在项目根目录）：
    python tools/test_eval_on_retro.py

输出：
- output/eval_test/retro_candidates.json （转换后的"伪候选"，附 ground_truth_verdict）
- output/eval_test/retro_eval_report.md （agent vs PM 对比报告）

需要 .env 配好 Azure GPT key（脚本内部调 eval_candidates.py 会用）。
"""

import json
import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output" / "eval_test"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Tier 名字归一化：retro 用小写 + history，eval 用大写无 history
TAG_TO_TIER = {
    "business": "Business",
    "tech": "Tech",
    "science": "Science",
    "psychology": "Psychology",
    "culture": "Culture",
    "history": "Culture",   # CONTENT_TIERS 没有 History，归到 Culture
    "story": "Story",
    "society": "Culture",   # 同样并入
    "health": "Science",    # health 是 Science 子类
}


def reconstruct_text(clip):
    """从 data.json clip 的 lines 拼出英文全文。"""
    lines = clip.get("lines", [])
    if not lines:
        return ""
    return " ".join(ln.get("en", "").strip() for ln in lines if ln.get("en"))


def build_fake_candidates():
    """读 data.json + retrospective_labels_v2.json，输出伪候选 JSON。"""
    data_clips = json.loads((PROJECT_ROOT / "data.json").read_text())
    retro = json.loads((PROJECT_ROOT / "output" / "retrospective_labels_v2.json").read_text())
    retro_clips = retro.get("clips", [])

    # data.json 没有 clip_id，按出现顺序匹配 retro_clips（已知都是 1-37 顺序）
    if not isinstance(data_clips, list):
        data_clips = data_clips.get("clips", [])

    if len(data_clips) != len(retro_clips):
        print(f"⚠️  数据数不一致: data.json={len(data_clips)} vs retro={len(retro_clips)}")

    # 按 clip_id 顺序合并（retro 的 clip_id 是 1-N）
    paired = []
    for retro_c in retro_clips:
        cid = retro_c.get("clip_id")
        if cid is None or cid > len(data_clips):
            continue
        data_c = data_clips[cid - 1]
        paired.append((data_c, retro_c))

    # 按 episode 分组（按 podcast 名）
    from collections import defaultdict
    by_podcast = defaultdict(list)
    for data_c, retro_c in paired:
        podcast_name = (data_c.get("source", {}).get("podcast")
                        or retro_c.get("podcast", "Unknown"))
        by_podcast[podcast_name].append((data_c, retro_c))

    episodes = []
    for podcast, items in by_podcast.items():
        candidates = []
        for data_c, retro_c in items:
            tier_lower = retro_c.get("tier_normalized", "").lower()
            tier = TAG_TO_TIER.get(tier_lower, "Culture")
            text = reconstruct_text(data_c)
            duration = retro_c.get("duration_approx_s", 90)

            cand = {
                "start_time": 0.0,
                "end_time": float(duration),
                "duration_sec": float(duration),
                "text": text,
                "suggested_title": retro_c.get("title", ""),
                "info_takeaway": "",  # retro 没存这个
                "reason": f"retrospective clip {retro_c.get('clip_id')}",
                "hook_type": "",
                "hook_strength": "medium",
                "completeness": "high",
                "tier": tier,
                "soft_flags": [],
                "risk_flags": [],
                "filter_result": "passed",  # 都是上线过的
                # ── Ground truth (用于对比，eval 不读这个) ──
                "ground_truth_verdict": retro_c.get("verdict"),
                "ground_truth_issues": retro_c.get("issues", []),
                "retro_clip_id": retro_c.get("clip_id"),
            }
            candidates.append(cand)
        episodes.append({
            "podcast": podcast,
            "episode": "(retro合并)",
            "tier": candidates[0]["tier"] if candidates else "Unknown",
            "candidates": candidates,
        })

    fake_data = {
        "run_id": "retro_test_2026_04_14",
        "prompt_version": "v2.0-test-on-retro",
        "config": {"source": "retrospective_labels_v2 + data.json"},
        "episodes": episodes,
    }

    out_path = OUTPUT_DIR / "retro_candidates.json"
    out_path.write_text(json.dumps(fake_data, ensure_ascii=False, indent=2))
    total = sum(len(e["candidates"]) for e in episodes)
    print(f"✅ 构造完成: {len(episodes)} podcasts, {total} 候选 → {out_path.name}")
    return out_path, total


def run_eval(input_path):
    """调 eval_candidates.py 跑评估。"""
    print(f"\n🤖 运行 eval_candidates.py（每个候选约 5-10s GPT 调用）...")
    eval_script = PROJECT_ROOT / "scripts" / "eval_candidates.py"
    result = subprocess.run(
        [sys.executable, str(eval_script), str(input_path)],
        cwd=str(PROJECT_ROOT),
    )
    if result.returncode != 0:
        print(f"❌ eval 失败 (exit {result.returncode})")
        sys.exit(1)
    print("✅ eval 完成")


def analyze_results(input_path):
    """对比 agent verdict vs ground truth，写报告。"""
    data = json.loads(input_path.read_text())
    rows = []
    for ep in data.get("episodes", []):
        for cand in ep.get("candidates", []):
            rows.append({
                "id": cand.get("retro_clip_id"),
                "title": cand.get("suggested_title", "")[:35],
                "tier": cand.get("tier", ""),
                "podcast": ep.get("podcast", ""),
                "ground_truth": cand.get("ground_truth_verdict", "?"),
                "agent": cand.get("agent_verdict", "?"),
                "conf": cand.get("agent_confidence", 0),
                "summary": cand.get("agent_summary", ""),
                "dimensions": cand.get("agent_dimensions", {}),
                "issues": cand.get("ground_truth_issues", []),
            })

    # Confusion matrix
    verdicts = ["pass", "gray", "reject"]
    matrix = {gt: {ag: 0 for ag in verdicts} for gt in verdicts}
    for r in rows:
        gt, ag = r["ground_truth"], r["agent"]
        if gt in matrix and ag in matrix[gt]:
            matrix[gt][ag] += 1

    total = len(rows)
    agreed = sum(1 for r in rows if r["ground_truth"] == r["agent"])
    agreement_rate = agreed / total * 100 if total else 0

    # Per-tier agreement
    by_tier = {}
    for r in rows:
        t = r["tier"]
        by_tier.setdefault(t, {"total": 0, "agreed": 0})
        by_tier[t]["total"] += 1
        if r["ground_truth"] == r["agent"]:
            by_tier[t]["agreed"] += 1

    # Disagreements
    disagreements = [r for r in rows if r["ground_truth"] != r["agent"]]
    disagreements.sort(key=lambda r: (r["ground_truth"], r["agent"]))

    # Build report
    lines = []
    lines.append("# Eval Agent on Retrospective Ground Truth")
    lines.append("")
    lines.append(f"**测试集**: 37 个回溯 clip（PM 标注的 ground truth）")
    lines.append(f"**总体一致率**: {agreed}/{total} = **{agreement_rate:.1f}%**")
    lines.append("")
    lines.append("## Confusion Matrix")
    lines.append("")
    lines.append("行=Ground Truth (PM)，列=Agent 判断")
    lines.append("")
    lines.append("| | agent→pass | agent→gray | agent→reject |")
    lines.append("|---|---|---|---|")
    for gt in verdicts:
        row = f"| **PM={gt}** |"
        for ag in verdicts:
            n = matrix[gt][ag]
            mark = " ✓" if gt == ag else ("" if n == 0 else " ⚠")
            row += f" {n}{mark} |"
        lines.append(row)
    lines.append("")

    lines.append("## Per-Tier 一致率")
    lines.append("")
    lines.append("| Tier | 一致率 |")
    lines.append("|---|---|")
    for t, s in sorted(by_tier.items()):
        rate = s["agreed"] / s["total"] * 100
        lines.append(f"| {t} | {s['agreed']}/{s['total']} = {rate:.0f}% |")
    lines.append("")

    if disagreements:
        lines.append(f"## 分歧详情（共 {len(disagreements)} 条）")
        lines.append("")
        # 按"严重程度"排序：pass↔reject 最严重，pass↔gray 次之
        severity = {("pass", "reject"): 3, ("reject", "pass"): 3,
                    ("pass", "gray"): 2, ("gray", "pass"): 2,
                    ("gray", "reject"): 1, ("reject", "gray"): 1}
        disagreements.sort(key=lambda r: -severity.get((r["ground_truth"], r["agent"]), 0))

        for r in disagreements:
            sev = severity.get((r["ground_truth"], r["agent"]), 0)
            sev_label = ["🟢", "🟡", "🟠", "🔴"][sev]
            lines.append(f"### {sev_label} [{r['id']}] PM={r['ground_truth']} ↔ Agent={r['agent']} (conf {r['conf']:.2f})")
            lines.append(f"- **{r['title']}** ({r['tier']} · {r['podcast']})")
            lines.append(f"- PM 标的 issues: {r['issues']}")
            lines.append(f"- Agent summary: {r['summary']}")
            dims = r["dimensions"]
            if dims:
                dim_str = " · ".join(f"{k}={v.get('score','?')}" for k, v in dims.items())
                lines.append(f"- Agent 维度: {dim_str}")
            lines.append("")

    lines.append("## 判断")
    lines.append("")
    if agreement_rate >= 85:
        lines.append("✅ **Agent 校准良好**（≥85%）。可直接用于真 dry-run 数据，PM 重点审 agent gray。")
    elif agreement_rate >= 70:
        lines.append("🟡 **Agent 大致可用**（70-85%）。建议先看分歧详情，调整 anchor 或 prompt 措辞，再上真 dry-run。")
    else:
        lines.append("🔴 **Agent 偏差较大**（<70%）。必须先修 prompt 才能信任 agent 判断。")

    report_path = OUTPUT_DIR / "retro_eval_report.md"
    report_path.write_text("\n".join(lines))
    print(f"\n📄 报告写入: {report_path}")

    # Print short summary to console
    print(f"\n=== 总结 ===")
    print(f"一致率: {agreement_rate:.1f}% ({agreed}/{total})")
    print(f"分歧: {len(disagreements)} 条，详见 {report_path.name}")


def main():
    print("=== Eval Agent 真值率测试（用 37 回溯 clip）===\n")
    fake_path, total = build_fake_candidates()
    print(f"\n预计 GPT 调用成本: ~${total * 0.005:.2f} ({total} 候选 × ~$0.005)")
    print(f"预计耗时: {total * 8 // 60} 分钟")

    proceed = input("\n继续？[Y/n] ").strip().lower()
    if proceed and proceed != "y":
        print("已取消。可以手动跑：")
        print(f"  python scripts/eval_candidates.py {fake_path}")
        return

    run_eval(fake_path)
    analyze_results(fake_path)


if __name__ == "__main__":
    main()
