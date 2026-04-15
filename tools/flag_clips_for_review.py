#!/usr/bin/env python3
"""Flag clips that need PM manual review; the rest auto-pass per INTAKE-STANDARDS §8 阶段 1。

输入:一个或多个 new_clips.json(cut_from_candidates.py 产出)
输出:
  1. clips_review_summary.md —— 分两组(需人审 / 自动放行)的审阅清单
  2. (可选)needs_review.json + auto_pass.json —— 拆开两堆,方便 PM 手动操作

判 flag 规则(任一触发就标⚠️需审):
  - agent_dimensions 任一维度 score ≤ 2
  - hook_strength = "low"
  - completeness = "low"
  - risk_flags 非空
  - duration 越界 topic 区间 > 5s
  - agent_confidence < 0.5(若有此字段)
  - text 含敏感词(政治极端 / 色情等,可后续扩展)

用法:
  python3 tools/flag_clips_for_review.py \\
      --inputs output/new_clips_2026_04_15/new_clips.json \\
               output/new_clips_2026_04_14/new_clips.json \\
      --out-md output/clips_review_summary.md \\
      --split-jsons   # 可选,生成 needs_review.json + auto_pass.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 跟 scripts/agent/filter.py::DURATION_LIMITS 一致
DURATION_LIMITS = {
    "Science":    (45, 120),
    "Business":   (45, 120),
    "Tech":       (60, 120),
    "Psychology": (60, 120),
    "Culture":    (60, 120),
    "Story":      (60, 150),
}


def evaluate_clip(clip: dict) -> list[str]:
    """返回 flag 原因列表;空列表 = auto-pass。"""
    reasons: list[str] = []

    # 1) agent_dimensions 任一维度 ≤ 2
    dims = clip.get("agent_dimensions") or {}
    for name, dim in dims.items():
        score = dim.get("score") if isinstance(dim, dict) else dim
        if isinstance(score, (int, float)) and score <= 2:
            note = dim.get("note", "") if isinstance(dim, dict) else ""
            reasons.append(f"agent_dim['{name}'] = {score} ≤ 2 ({note[:30]})")

    # 2) hook_strength
    hook = (clip.get("hook_strength") or "").lower()
    if hook == "low":
        reasons.append("hook_strength = low")

    # 3) completeness
    comp = (clip.get("completeness") or "").lower()
    if comp == "low":
        reasons.append("completeness = low")

    # 4) risk_flags 非空
    risks = clip.get("risk_flags") or []
    if risks:
        reasons.append(f"risk_flags: {', '.join(risks[:3])}")

    # 5) duration 越界
    dur = clip.get("duration", 0)
    topic = clip.get("tag") or clip.get("topic")
    if topic and topic in DURATION_LIMITS and dur:
        lo, hi = DURATION_LIMITS[topic]
        if dur < lo - 5:
            reasons.append(f"duration {dur:.0f}s < {topic} 下限 {lo}s")
        elif dur > hi + 5:
            reasons.append(f"duration {dur:.0f}s > {topic} 上限 {hi}s")

    # 6) agent_confidence(若有)
    conf = clip.get("agent_confidence")
    if isinstance(conf, (int, float)) and conf < 0.5:
        reasons.append(f"agent_confidence = {conf:.2f} (低)")

    return reasons


def render_md(flagged: list[tuple[dict, list[str]]],
              autopass: list[dict],
              total: int) -> str:
    out: list[str] = []
    out.append("# Clip 审阅汇总(自动 flag)\n")
    out.append(f"- 总数: **{total}**")
    out.append(f"- ⚠️ 需 PM 重点审: **{len(flagged)}** ({len(flagged)/total*100:.0f}%)")
    out.append(f"- ✅ 自动放行(agent pass + 元数据无红旗): **{len(autopass)}** ({len(autopass)/total*100:.0f}%)\n")
    out.append("> 自动放行的 clip 按 INTAKE-STANDARDS §8 阶段 1 直接 merge,你只需抽 3-5 条听感校准。\n")
    out.append("---\n")

    if flagged:
        out.append("## ⚠️ 需要你审(按 flag 数量降序)\n")
        flagged.sort(key=lambda x: -len(x[1]))
        for clip, reasons in flagged:
            cid = clip.get("id", "?")
            title = clip.get("title", "?")
            audio = clip.get("audio", "")
            tag = clip.get("tag") or clip.get("topic", "?")
            podcast = clip.get("source", {}).get("podcast", "")
            episode = clip.get("source", {}).get("episode", "")
            dur = clip.get("duration", 0)
            ts_start = clip.get("source", {}).get("timestamp_start", "")
            ts_end = clip.get("source", {}).get("timestamp_end", "")
            # 第一行 EN/ZH 用作快速判官
            lines = clip.get("lines", [])
            first_en = lines[0].get("en", "")[:80] if lines else ""
            first_zh = lines[0].get("zh", "")[:50] if lines else ""

            out.append(f"### #{cid} [{tag}] {title}\n")
            out.append(f"- 音频: `{audio}` ({dur:.0f}s, {ts_start}-{ts_end})")
            out.append(f"- 来源: {podcast} / *{episode[:55]}*")
            if first_en:
                out.append(f"- 开头: `{first_en}…` / `{first_zh}…`")
            out.append(f"- ⚠️ Flag ({len(reasons)}):")
            for r in reasons:
                out.append(f"  - {r}")
            out.append("")

    out.append("## ✅ 自动放行清单(标题 + 短信息,只供扫一眼)\n")
    out.append("| ID | Topic | Title | Duration | Source Podcast |")
    out.append("|---:|---|---|---:|---|")
    for c in autopass:
        cid = c.get("id", "?")
        title = (c.get("title") or "")[:50]
        tag = c.get("tag") or c.get("topic", "?")
        dur = c.get("duration", 0)
        podcast = c.get("source", {}).get("podcast", "")[:25]
        out.append(f"| {cid} | {tag} | {title} | {dur:.0f}s | {podcast} |")

    out.append("\n---\n")
    out.append("## 操作建议\n")
    out.append("1. 上面 ⚠️ 列表逐条听音频 + 看开头,决定 pass / reject")
    out.append("2. ✅ 列表抽 3-5 条试听做校准;无明显异常就全部放行")
    out.append("3. 把 reject 的 clip 从对应 new_clips.json 删除(或用 --split-jsons 自动拆出 needs_review.json 单独编辑)")
    out.append("4. 跑 `scripts/merge_clips.py` 合并到 data.json")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--inputs", nargs="+", type=Path, required=True,
                    help="一个或多个 new_clips.json")
    ap.add_argument("--out-md", type=Path, default=Path("output/clips_review_summary.md"))
    ap.add_argument("--split-jsons", action="store_true",
                    help="额外产出 needs_review.json + auto_pass.json,放在 --out-md 同目录")
    args = ap.parse_args()

    all_clips: list[dict] = []
    for p in args.inputs:
        if not p.exists():
            print(f"⚠️ 跳过不存在的文件: {p}")
            continue
        d = json.load(open(p))
        clips = d.get("clips", d if isinstance(d, list) else [])
        for c in clips:
            c["_source_file"] = p.name
        all_clips.extend(clips)

    if not all_clips:
        raise SystemExit("❌ 没有读到任何 clip")

    flagged: list[tuple[dict, list[str]]] = []
    autopass: list[dict] = []
    for c in all_clips:
        reasons = evaluate_clip(c)
        if reasons:
            flagged.append((c, reasons))
        else:
            autopass.append(c)

    md = render_md(flagged, autopass, len(all_clips))
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(md, encoding="utf-8")

    print(f"✅ 报告: {args.out_md}")
    print(f"   总数 {len(all_clips)} | ⚠️ 需审 {len(flagged)} | ✅ 自动放行 {len(autopass)}")

    if args.split_jsons:
        out_dir = args.out_md.parent
        nr = [c for c, _ in flagged]
        ap_clips = autopass
        for c in nr + ap_clips:
            c.pop("_source_file", None)  # 清掉内部字段
        with open(out_dir / "needs_review.json", "w", encoding="utf-8") as f:
            json.dump({"clips": nr}, f, ensure_ascii=False, indent=2)
        with open(out_dir / "auto_pass.json", "w", encoding="utf-8") as f:
            json.dump({"clips": ap_clips}, f, ensure_ascii=False, indent=2)
        print(f"✅ 拆分:{out_dir}/needs_review.json ({len(nr)}) + auto_pass.json ({len(ap_clips)})")


if __name__ == "__main__":
    main()
