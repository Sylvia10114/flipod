#!/usr/bin/env python3
"""Refilter candidates from a past dry-run without rerunning LLM selection.

用途：验证 filter.py / pipeline text 拼接的修改效果，**不**重新跑 Whisper 和
候选选择 LLM（最贵的两步），只在已有候选上重套 filter → 对比 before/after。

前置条件：
    每集的 mp3 旁边要有 `<basename>.transcript.json`（transcribe.py 2026-04-14
    版本开始会自动写）。缺失的集会打印 skip 并计入统计，不会报错。

    如果想一次性为缺失集补跑 Whisper，传 `--fill-missing`（会烧钱，~$0.30/集）。

输入：
    output/dry_run_2026_04_14/dry_run_candidates.json
    output/dry_run_2026_04_14/tmp/*.mp3
    output/dry_run_2026_04_14/tmp/*.transcript.json  （可选，缺失时 skip 或 fill）

输出：
    output/dry_run_2026_04_14/refilter_result.json
    output/dry_run_2026_04_14/refilter_summary.md

用法：
    python tools/refilter_candidates.py                    # 只用已有缓存
    python tools/refilter_candidates.py --fill-missing 5   # 最多给 5 集补跑 Whisper
    python tools/refilter_candidates.py --fill-missing all # 给所有缺失集补跑
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from agent.filter import (  # noqa: E402
    _check_duration,
    _check_start,
    _check_end_completeness,
    _check_ad_pattern,
    _check_repetition,
)
from agent.transcribe import transcribe_audio, _transcript_cache_path  # noqa: E402

DRY_RUN_DIR = ROOT / "output" / "dry_run_2026_04_14"
CAND_FILE = DRY_RUN_DIR / "dry_run_candidates.json"
TMP_DIR = DRY_RUN_DIR / "tmp"
OUT_JSON = DRY_RUN_DIR / "refilter_result.json"
OUT_MD = DRY_RUN_DIR / "refilter_summary.md"


def episode_title_to_basename(title: str) -> str:
    """Mirror download.py 的落盘命名：非字母数字→_，前 40 字符。

    dry-run 缓存里的 mp3 都是这个格式。
    """
    safe = re.sub(r"[^\w\-]+", "_", title, flags=re.UNICODE)
    return safe[:40]


def find_audio_for_episode(ep_title: str) -> Path | None:
    """在 TMP_DIR 里找对应这一集的 mp3。"""
    # 优先精确前缀匹配
    base = episode_title_to_basename(ep_title)
    exact = TMP_DIR / f"{base}.mp3"
    if exact.exists():
        return exact
    # 退回模糊前缀匹配
    for p in TMP_DIR.glob("*.mp3"):
        if p.stem.startswith(base[:20]):
            return p
    return None


def refilter_candidate(cand: dict, tier: str, segments: list, words_fallback: list) -> dict:
    """重新运行 filter 检查（不含 _check_internal_silence，省 ffmpeg 成本）。

    返回 {filter_result, new_text, old_text}
    """
    st = cand.get("start_time", 0)
    et = cand.get("end_time", 0)

    # === Patch A: 优先用 segment 级拼 text ===
    if segments:
        overlap_segs = [
            s for s in segments if s.get("start", 0) < et and s.get("end", 0) > st
        ]
        new_text = " ".join(s.get("text", "").strip() for s in overlap_segs).strip()
    else:
        # 只有 word-level 时回退
        ws = [w.get("word", "") for w in words_fallback
              if w.get("start", 0) >= st - 0.1 and w.get("end", 0) <= et + 0.1]
        new_text = " ".join(ws)

    # 复制候选，只替换 text，再喂给 filter
    cand_local = dict(cand)
    cand_local["text"] = new_text

    checks = [
        ("duration", _check_duration(cand_local, tier)),
        ("start",    _check_start(cand_local)),
        ("end",      _check_end_completeness(cand_local)),
        ("ad",       _check_ad_pattern(cand_local)),
        ("repetition", _check_repetition(cand_local)),
        # 跳过 _check_internal_silence：依赖 ffmpeg + 原音频，这里不是主要问题
    ]

    filter_result = "passed"
    for name, result in checks:
        if result:
            filter_result = f"rejected_{result}"
            break

    return {
        "filter_result": filter_result,
        "new_text": new_text,
        "old_text": cand.get("text", ""),
    }


def classify_reason(fr: str) -> str:
    if not fr or fr.startswith("pass"):
        return "passed"
    if "duration_out_of_range" in fr:
        return "duration_out_of_range"
    if "end_no_punctuation" in fr:
        return "end_no_punctuation"
    if "end_dangling" in fr:
        return "end_dangling"
    if "antecedent" in fr:
        return "antecedent_phrase"
    if "empty_filler" in fr:
        return "empty_filler"
    if "echo_response" in fr:
        return "echo_response"
    if "ad_detected" in fr:
        return "ad_pattern"
    if "repetition" in fr:
        return "repetition"
    m = re.match(r"rejected_([a-z_]+)", fr)
    return m.group(1) if m else "other"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--fill-missing",
        metavar="N",
        default="0",
        help="补跑 Whisper 的最大集数（数字或 'all'），默认 0 表示只用已有缓存",
    )
    args = ap.parse_args()

    fill_limit: int | None
    if args.fill_missing == "all":
        fill_limit = None  # no cap
    else:
        fill_limit = int(args.fill_missing)

    with CAND_FILE.open() as f:
        data = json.load(f)

    episodes = data.get("episodes", [])

    filled = 0
    results_by_ep: list[dict] = []
    skipped_episodes: list[str] = []

    for ep in episodes:
        title = ep.get("episode") or ""
        pod = ep.get("podcast") or ""
        tier = ep.get("tier") or ""
        cands = ep.get("candidates", [])

        audio = find_audio_for_episode(title)
        transcript = None
        segments: list = []
        words: list = []

        if audio:
            cache_path = Path(_transcript_cache_path(str(audio)))
            if cache_path.exists():
                with cache_path.open(encoding="utf-8") as f:
                    transcript = json.load(f)
            elif fill_limit is None or filled < fill_limit:
                print(f"[fill] {pod} / {title[:60]!r} → running Whisper ...")
                transcript = transcribe_audio(str(audio), use_cache=True)
                if transcript is not None:
                    filled += 1
            else:
                pass  # over budget; skip transcription

        if transcript:
            segments = transcript.get("segments", []) or []
            words = transcript.get("words", []) or []
        else:
            skipped_episodes.append(f"{pod} / {title[:50]}")

        ep_refiltered = []
        for cand in cands:
            rf = refilter_candidate(cand, tier, segments, words)
            merged = dict(cand)
            merged["refilter_text"] = rf["new_text"]
            merged["refilter_result"] = rf["filter_result"]
            merged["original_filter_result"] = cand.get("filter_result", "")
            ep_refiltered.append(merged)

        results_by_ep.append({
            "podcast": pod,
            "episode": title,
            "tier": tier,
            "had_transcript": transcript is not None,
            "candidates": ep_refiltered,
        })

    # ==== stats ====
    n_total = sum(len(ep["candidates"]) for ep in results_by_ep)
    n_eps_with_transcript = sum(1 for ep in results_by_ep if ep["had_transcript"])
    n_eps_without = len(results_by_ep) - n_eps_with_transcript

    # Only count stats on episodes that actually had a transcript (apples-to-apples
    # for validating Patch A). Episodes without transcript keep old text and old
    # filter result — mixing them hides the effect.
    actionable = [
        c for ep in results_by_ep if ep["had_transcript"] for c in ep["candidates"]
    ]
    n_actionable = len(actionable)

    before_pass = sum(1 for c in actionable if (c.get("original_filter_result") or "").startswith("pass"))
    after_pass = sum(1 for c in actionable if c["refilter_result"].startswith("pass"))

    before_reasons = Counter(classify_reason(c.get("original_filter_result") or "") for c in actionable)
    after_reasons = Counter(classify_reason(c["refilter_result"]) for c in actionable)

    # Per-tier table
    before_pass_tier: Counter = Counter()
    after_pass_tier: Counter = Counter()
    total_tier: Counter = Counter()
    for c in actionable:
        t = (c.get("tier") or "").lower() or "?"
        total_tier[t] += 1
        if (c.get("original_filter_result") or "").startswith("pass"):
            before_pass_tier[t] += 1
        if c["refilter_result"].startswith("pass"):
            after_pass_tier[t] += 1

    # Flips: originally rejected but now passed (and vice versa)
    flips_rej_to_pass = [
        c for c in actionable
        if not (c.get("original_filter_result") or "").startswith("pass")
        and c["refilter_result"].startswith("pass")
    ]
    flips_pass_to_rej = [
        c for c in actionable
        if (c.get("original_filter_result") or "").startswith("pass")
        and not c["refilter_result"].startswith("pass")
    ]

    # ==== write JSON result ====
    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump({
            "source": str(CAND_FILE.relative_to(ROOT)),
            "episodes_with_transcript": n_eps_with_transcript,
            "episodes_without_transcript": n_eps_without,
            "n_candidates_total": n_total,
            "n_candidates_actionable": n_actionable,
            "filled_this_run": filled,
            "results": results_by_ep,
        }, f, ensure_ascii=False, indent=2)

    # ==== write markdown summary ====
    lines: list[str] = []
    lines.append("# Refilter Summary (Patch A+B)")
    lines.append("")
    lines.append(f"- 源：`{CAND_FILE.relative_to(ROOT)}`")
    lines.append(f"- 集数：**{len(results_by_ep)}**（有 transcript: {n_eps_with_transcript} / 无: {n_eps_without}）")
    lines.append(f"- 候选总数：**{n_total}**，可对比（transcript 命中）：**{n_actionable}**")
    if filled:
        lines.append(f"- 本次补跑 Whisper：{filled} 集")
    lines.append("")

    if n_actionable == 0:
        lines.append("> ⚠️ **没有可对比的候选**——所有集都缺 transcript 缓存。")
        lines.append("> 用 `--fill-missing 5` 先给几集补跑 Whisper 再试。")
    else:
        lines.append("## 通过率对比")
        lines.append("")
        lines.append("| | 前 (原 dry-run filter) | 后 (Patch A+B) | Δ |")
        lines.append("|---|---:|---:|---:|")
        lines.append(f"| 通过 | {before_pass} ({before_pass/n_actionable*100:.1f}%) | "
                     f"{after_pass} ({after_pass/n_actionable*100:.1f}%) | "
                     f"{after_pass - before_pass:+d} |")
        lines.append("")

        lines.append("## 拒绝原因变化")
        lines.append("")
        lines.append("| 原因 | 前 | 后 |")
        lines.append("|---|---:|---:|")
        all_reasons = sorted(set(before_reasons) | set(after_reasons))
        for r in all_reasons:
            lines.append(f"| {r} | {before_reasons.get(r,0)} | {after_reasons.get(r,0)} |")
        lines.append("")

        lines.append("## Tier 拆分")
        lines.append("")
        lines.append("| Tier | 总 | 前通过 | 后通过 |")
        lines.append("|---|---:|---:|---:|")
        for t in sorted(total_tier):
            lines.append(f"| {t} | {total_tier[t]} | {before_pass_tier[t]} | {after_pass_tier[t]} |")
        lines.append("")

        lines.append(f"## 翻牌：rejected → passed（{len(flips_rej_to_pass)} 条）")
        lines.append("")
        if flips_rej_to_pass:
            lines.append("| Podcast | Tier | 原拒绝 | 末 50 字符（新 text） |")
            lines.append("|---|---|---|---|")
            for c in flips_rej_to_pass[:40]:
                tail = (c["refilter_text"] or "")[-50:].replace("|", "\\|").replace("\n", " ")
                lines.append(f"| {c.get('podcast','') or ''} | {c.get('tier','')} | "
                             f"{classify_reason(c.get('original_filter_result') or '')} | …{tail} |")
        lines.append("")

        lines.append(f"## 反向翻牌：passed → rejected（{len(flips_pass_to_rej)} 条，预期应为 0）")
        lines.append("")
        for c in flips_pass_to_rej[:20]:
            lines.append(f"- **{c.get('podcast','')}** / {c.get('tier','')} "
                         f"→ 新拒绝：{classify_reason(c['refilter_result'])}")

    if skipped_episodes:
        lines.append("")
        lines.append("## 缺 transcript 缓存（跳过的集）")
        lines.append("")
        for s in skipped_episodes[:20]:
            lines.append(f"- {s}")
        if len(skipped_episodes) > 20:
            lines.append(f"- ... 共 {len(skipped_episodes)} 集")

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"  actionable candidates: {n_actionable}")
    if n_actionable:
        print(f"  pass: {before_pass} → {after_pass}  ({(after_pass-before_pass):+d})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
