#!/usr/bin/env python3
"""Cut clips from pre-selected dry-run candidates (bypass Step 4 LLM segmentation).

用途:对已经跑过 dry-run + eval 的候选(产生了 dry_run_candidates.json),
      直接从里面挑出 filter_pass ∩ agent_pass 的 A 档候选,
      跑 Step 8-12:cut_audio → CEFR → translate → comprehension questions。
      不重新 LLM 选段,不再烧 segmentation 的 $。

用法:
    python3 tools/cut_from_candidates.py \\
        --candidates output/dry_run_2026_04_15/dry_run_candidates.json \\
        --output-dir output/new_clips_2026_04_15 \\
        --data-json data.json

默认筛选:filter_result=passed 且 agent_verdict=pass(A 档)
默认 tmp-dir:<candidates 同级>/tmp/(那里有下载好的 mp3 和 transcript 缓存)

产出:
    1. output/new_clips_2026_04_15/new_clips.json(待人审的候选入库数据)
    2. output/clips/clip_XXX.mp3(编号从 data.json 的 max id + 1 开始)

**不写 data.json,不 commit,不 merge** —— 后续由 PM 审完再跑 scripts/merge_clips.py。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

# 流水线内部函数(复用 scripts/agent/ 下现成实现)
from agent.utils import log  # noqa: E402
from agent.audio_cut import cut_audio  # noqa: E402
from agent.cefr import init_cefr_map, batch_cefr_annotation, infer_difficulty  # noqa: E402
from agent.translate import translate_lines  # noqa: E402
from agent.transcribe import transcribe_audio  # noqa: E402
from agent.output import (  # noqa: E402
    extract_clip_words,
    extract_collocations,
    generate_comprehension_questions,
    validate_questions,
)
from prompts.loader import PROMPT_VERSION  # noqa: E402


# ── Helpers ────────────────────────────────────────────────────

def title_to_safe_filename(title: str) -> str:
    """跟 scripts/agent/download.py 里下载时的命名一致。"""
    return re.sub(r"[^\w\-]", "_", title)[:40]


def find_audio_path(tmp_dir: Path, episode_title: str) -> Path | None:
    safe = title_to_safe_filename(episode_title)
    path = tmp_dir / f"{safe}.mp3"
    return path if path.exists() else None


def get_next_clip_id(data_json_path: Path) -> int:
    """Find next clip_id > max existing in data.json."""
    if not data_json_path.exists():
        return 1
    data = json.load(open(data_json_path))
    clips = data.get("clips", data if isinstance(data, list) else [])
    ids = [c.get("id", 0) for c in clips]
    return max(ids) + 1 if ids else 1


def _load_overlap_refs(ref_paths: list[Path]) -> dict[str, list[dict]]:
    """加载去重参考,返回 {episode_title: [{'start': float, 'end': float}, ...]}。

    支持两种 JSON:
    1. dry_run_candidates.json:episodes[].candidates[] (带 start_time/end_time)
       只收 filter_pass + agent_pass(A 档),因为只有 A 档才会被切片
    2. new_clips.json:clips[] (带 source.episode 和 timestamp_start/end 或 source.timestamp_*)
       同样的时间区间口径,用于去重已切片的批次
    """
    refs: dict[str, list[dict]] = {}
    for path in ref_paths:
        if not path.exists():
            log(f"⚠️ 去重参考不存在,跳过: {path}", "warn")
            continue
        data = json.load(open(path))

        if "episodes" in data:
            # dry_run_candidates.json 结构
            for ep in data["episodes"]:
                title = ep.get("episode", "")
                for c in ep.get("candidates", []):
                    if c.get("filter_result") == "passed" and c.get("agent_verdict") == "pass":
                        refs.setdefault(title, []).append({
                            "start": c.get("start_time", 0.0),
                            "end": c.get("end_time", 0.0),
                        })
        elif "clips" in data or (isinstance(data, list) and data and "source" in data[0]):
            # new_clips.json 结构(或直接 list of clips)
            clips = data.get("clips", data if isinstance(data, list) else [])
            for c in clips:
                src = c.get("source", {})
                title = src.get("episode", "")
                # timestamp_start / timestamp_end 是 "MM:SS" 字符串,转回秒
                start_s = _mmss_to_sec(src.get("timestamp_start"))
                end_s = _mmss_to_sec(src.get("timestamp_end"))
                if start_s is None or end_s is None:
                    continue
                refs.setdefault(title, []).append({"start": start_s, "end": end_s})
    return refs


def _mmss_to_sec(s: str | None) -> float | None:
    if not s or ":" not in s:
        return None
    try:
        mm, ss = s.split(":")
        return int(mm) * 60 + int(ss)
    except Exception:
        return None


def _find_overlap(cand: dict, ref_segs: list[dict], threshold: float) -> dict | None:
    """如果 cand 与任何 ref_seg 时间重叠比例 > threshold,返回重叠信息;否则 None。

    比例分母用两段中较短那段的 duration —— 这样子集关系(v2.1 长段包住 v2.2 短段)
    也能算出 ~100% 重叠。
    """
    c_start, c_end = cand.get("start_time", 0.0), cand.get("end_time", 0.0)
    c_dur = max(c_end - c_start, 0.01)
    for r in ref_segs:
        r_start, r_end = r["start"], r["end"]
        r_dur = max(r_end - r_start, 0.01)
        ov_start = max(c_start, r_start)
        ov_end = min(c_end, r_end)
        if ov_end <= ov_start:
            continue
        ov = ov_end - ov_start
        ratio = ov / min(c_dur, r_dur)
        if ratio >= threshold:
            return {"ratio": ratio, "ref_start": r_start, "ref_end": r_end}
    return None


# ── Core: cut one candidate ────────────────────────────────────

def cut_one_candidate(cand: dict, episode: dict, transcript: dict,
                      clip_id: int, mp3_output_root: Path) -> dict | None:
    """Process one candidate into a clip_data dict, writing mp3 to disk.

    mp3 写入 mp3_output_root / "clips" / "clip_NNN.mp3"(staging 区域,
    避免多个并行 batch 互相覆盖)。merge_clips.py 时通过 --audio-src 指
    向这个 staging clips/ 目录,自动重命名拷贝到最终 clips/ 下。

    Returns clip_data dict on success, None on failure.
    Mirrors the post-filter portion of scripts/agent/pipeline.py::process_episode.
    """
    tier = episode["tier"]
    seg = cand
    start_t = seg.get("start_time", 0)
    end_t = seg.get("end_time", 0)

    # Step 9: extract sentence-level lines with word timestamps
    lines = extract_clip_words(transcript, start_t, end_t)
    if not lines:
        log(f"  ⚠️ clip_{clip_id} 无字幕行,跳过", "warn")
        return None

    # Adjust timeline to 0-based (first line starts at 0)
    actual_start = start_t + lines[0]["start"]
    actual_end = start_t + lines[-1]["end"]
    duration = actual_end - actual_start
    time_offset = lines[0]["start"]
    if time_offset > 0:
        for ln in lines:
            ln["start"] = round(ln["start"] - time_offset, 2)
            ln["end"] = round(ln["end"] - time_offset, 2)
            for w in ln.get("words", []):
                w["start"] = round(w["start"] - time_offset, 2)
                w["end"] = round(w["end"] - time_offset, 2)

    # Step 9b: cut mp3 到 staging 区(<output_dir>/clips/),不写项目根
    # 这样多个 batch 并行不会互相覆盖
    clip_filename = f"clips/clip_{clip_id:03d}.mp3"
    clip_path = mp3_output_root / clip_filename
    clip_path.parent.mkdir(parents=True, exist_ok=True)

    if not cut_audio(episode["local_audio"], actual_start, actual_end, str(clip_path)):
        log(f"  ⚠️ clip_{clip_id} 切片失败", "warn")
        return None

    # Step 10: CEFR annotation (uses global CEFR_WORD_MAP initialized in main)
    lines = batch_cefr_annotation(lines)

    # Step 11: translation (GPT 批量)
    lines = translate_lines(lines)

    # Step 12: comprehension questions
    raw_q = generate_comprehension_questions(lines, episode)
    questions = validate_questions(raw_q, lines)

    collocations = extract_collocations(lines)

    start_mm_ss = f"{int(actual_start)//60:02d}:{int(actual_start)%60:02d}"
    end_mm_ss = f"{int(actual_end)//60:02d}:{int(actual_end)%60:02d}"

    clip_data = {
        "id": clip_id,
        "title": seg.get("suggested_title", f"片段 {clip_id}"),
        "tag": tier,
        "audio": clip_filename,
        "duration": round(duration, 1),
        "difficulty": infer_difficulty(lines),
        "info_takeaway": seg.get("info_takeaway") or seg.get("reason", ""),
        "source": {
            "podcast": episode.get("podcast_name", ""),
            "episode": episode.get("title", ""),
            "episode_url": episode.get("episode_url", ""),
            "timestamp_start": start_mm_ss,
            "timestamp_end": end_mm_ss,
            "pub_date": episode.get("pub_date", ""),
            "tier": tier,
        },
        "lines": lines,
        "collocations": collocations,
        "questions": questions,
        "prompt_version": PROMPT_VERSION,
        # 附加 audit trail(SCHEMA-v1.md 里的 agent_verdict / agent_dimensions)
        "agent_verdict": cand.get("agent_verdict"),
        "agent_dimensions": cand.get("agent_dimensions"),
        "hook_strength": cand.get("hook_strength"),
        "completeness": cand.get("completeness"),
    }
    log(f"  ✨ clip_{clip_id}: {clip_data['title']}", "ok")
    return clip_data


# ── Main ───────────────────────────────────────────────────────

def main() -> None:
    from agent.config import ensure_env
    ensure_env()

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--candidates", required=True, type=Path,
                    help="dry_run_candidates.json 路径")
    ap.add_argument("--output-dir", required=True, type=Path,
                    help="新 clips 的 new_clips.json 输出目录")
    ap.add_argument("--tmp-dir", type=Path,
                    help="mp3 + transcript 缓存目录(默认 <candidates 同级>/tmp)")
    ap.add_argument("--data-json", type=Path, default=ROOT / "data.json",
                    help="用于确定下一个 clip_id(默认 data.json)")
    ap.add_argument("--filter", default="agent_pass",
                    choices=["agent_pass", "filter_pass"],
                    help="筛选策略:agent_pass = filter ∩ agent pass(A档);filter_pass = 只要 filter 通过")
    ap.add_argument("--start-id", type=int, default=None,
                    help="起始 clip_id;不传则从 data.json 最大 id+1 开始。"
                         "并行跑两个 batch 时建议显式指定不同起始(如 100/200),避免 staging 文件名/编号混淆。"
                         "merge_clips.py 会重新分配最终 ID,这里仅是 staging 标签。")
    ap.add_argument("--skip-overlap-with", type=Path, action="append", default=[],
                    help="另一份 dry_run_candidates.json(或已切片的 new_clips.json)。"
                         "同集且时间重叠 >50%% 的候选会被跳过,避免双切重复片段。"
                         "可多次传入。")
    ap.add_argument("--overlap-threshold", type=float, default=0.5,
                    help="同集时间重叠比例阈值(默认 0.5 即 50%%),超过则判定为重复")
    args = ap.parse_args()

    if args.tmp_dir is None:
        args.tmp_dir = args.candidates.parent / "tmp"

    if not args.candidates.exists():
        raise SystemExit(f"❌ 找不到 {args.candidates}")
    if not args.tmp_dir.exists():
        raise SystemExit(f"❌ 找不到 tmp 目录 {args.tmp_dir}")

    # Init CEFR(会加载 scripts/cefr_wordlist.json —— 已是 CEFR-J 新版)
    init_cefr_map(scripts_dir=str(ROOT / "scripts"))

    cand_data = json.load(open(args.candidates))
    next_id = args.start_id if args.start_id is not None else get_next_clip_id(args.data_json)
    log(f"起始 clip_id: {next_id} (staging 编号,merge 时重分配最终 ID)", "info")
    log(f"prompt_version(回滚后): {PROMPT_VERSION}", "info")
    log(f"mp3 staging 输出: {args.output_dir}/clips/clip_NNN.mp3", "info")

    # 加载去重参考(来自其他已切或将切的候选)
    overlap_refs = _load_overlap_refs(args.skip_overlap_with)
    if overlap_refs:
        total_ref_segs = sum(len(v) for v in overlap_refs.values())
        log(f"去重参考加载: {len(overlap_refs)} 集 / {total_ref_segs} 个已知片段区间", "info")

    start_time = time.time()
    all_clips = []
    skipped_audio = 0
    skipped_transcript = 0
    skipped_overlap = 0

    for ep in cand_data["episodes"]:
        # 筛选候选
        accepted = []
        for c in ep["candidates"]:
            if args.filter == "agent_pass":
                if c.get("filter_result") == "passed" and c.get("agent_verdict") == "pass":
                    accepted.append(c)
            else:
                if c.get("filter_result") == "passed":
                    accepted.append(c)

        # 去重:跟 overlap_refs 里相同集的片段按时间重叠比例判
        ep_title = ep["episode"]
        ref_segs = overlap_refs.get(ep_title, [])
        if ref_segs and accepted:
            filtered = []
            for c in accepted:
                dup_info = _find_overlap(c, ref_segs, args.overlap_threshold)
                if dup_info is not None:
                    skipped_overlap += 1
                    log(f"  ⏭️ 跳过(与参考重叠 {dup_info['ratio']:.0%}): "
                        f"[{ep['podcast']}] {ep_title[:40]} "
                        f"{c['start_time']:.1f}-{c['end_time']:.1f} "
                        f"↔ {dup_info['ref_start']:.1f}-{dup_info['ref_end']:.1f}", "info")
                else:
                    filtered.append(c)
            accepted = filtered

        if not accepted:
            continue

        audio_path = find_audio_path(args.tmp_dir, ep["episode"])
        if not audio_path:
            log(f"⚠️ 音频缺失: {ep['podcast']} / {ep['episode'][:40]}", "warn")
            skipped_audio += len(accepted)
            continue

        transcript = transcribe_audio(str(audio_path), use_cache=True)
        if not transcript or not transcript.get("words"):
            log(f"⚠️ transcript 缺失: {ep['podcast']} / {ep['episode'][:40]}", "warn")
            skipped_transcript += len(accepted)
            continue

        episode = {
            "podcast_name": ep["podcast"],
            "title": ep["episode"],
            "tier": ep["tier"],
            "local_audio": str(audio_path),
            "episode_url": "",  # dry_run_candidates.json 不带
            "pub_date": "",
        }

        log(f"\n📀 处理 {ep['podcast']} / {ep['episode'][:50]} ({len(accepted)} 条 A 档)", "step")
        for cand in accepted:
            clip = cut_one_candidate(cand, episode, transcript, next_id, args.output_dir)
            if clip:
                all_clips.append(clip)
                next_id += 1

    # Write output
    args.output_dir.mkdir(parents=True, exist_ok=True)
    out_file = args.output_dir / "new_clips.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({"clips": all_clips}, f, ensure_ascii=False, indent=2)

    elapsed = round(time.time() - start_time, 1)
    log(f"\n🎉 完成 {len(all_clips)} 条 clip, 耗时 {elapsed}s", "ok")
    if skipped_audio:
        log(f"  ⚠️ 跳过 {skipped_audio} 条(音频缺失)", "warn")
    if skipped_transcript:
        log(f"  ⚠️ 跳过 {skipped_transcript} 条(transcript 缺失)", "warn")
    if skipped_overlap:
        log(f"  ⏭️ 跳过 {skipped_overlap} 条(与参考重叠)", "info")
    log(f"✅ 写入: {out_file}", "ok")
    if all_clips:
        log(f"✅ mp3 位于: {args.output_dir}/clips/clip_{next_id - len(all_clips):03d}.mp3 .. clip_{next_id - 1:03d}.mp3", "ok")
    log("\n👉 下一步:跑 tools/flag_clips_for_review.py 自动标 ⚠️/✅", "info")
    log("   merge 时:python3 scripts/merge_clips.py --source <new_clips.json> --audio-src <output_dir>/clips --audio-dst clips --target data.json", "info")


if __name__ == "__main__":
    main()
