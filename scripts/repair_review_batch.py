#!/usr/bin/env python3
"""Repair review clips in a batch by trimming broken boundaries and re-translating."""

import argparse
import copy
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from agent.config import ensure_env
from agent.audio_cut import cut_audio
from agent.output import repair_boundary_lines
from agent.translate import translate_lines


def mmss(seconds):
    total = max(0, int(round(float(seconds))))
    return f"{total // 60:02d}:{total % 60:02d}"


def normalize_times(lines, offset):
    for line in lines:
        line["start"] = round(line.get("start", 0) - offset, 2)
        line["end"] = round(line.get("end", 0) - offset, 2)
        for word in line.get("words", []) or []:
            word["start"] = round(word.get("start", 0) - offset, 2)
            word["end"] = round(word.get("end", 0) - offset, 2)


def trim_and_retranslate(clip, clip_audio_path):
    original_lines = copy.deepcopy(clip.get("lines", []) or [])
    repaired_lines = repair_boundary_lines(original_lines)
    if len(repaired_lines) < 3:
        return None

    new_start = repaired_lines[0].get("start", 0)
    new_end = repaired_lines[-1].get("end", clip.get("duration", 0))
    if new_end - new_start < 45:
        return None

    tmp_audio_path = clip_audio_path.with_suffix(".tmp.mp3")
    if not cut_audio(str(clip_audio_path), new_start, new_end, str(tmp_audio_path)):
        return None

    os.replace(tmp_audio_path, clip_audio_path)
    normalize_times(repaired_lines, new_start)
    for line in repaired_lines:
        line["zh"] = ""
    translate_lines(repaired_lines)

    clip_start_sec = float(clip.get("clip_start_sec") or 0) + float(new_start)
    clip_end_sec = clip_start_sec + float(new_end - new_start)
    clip["lines"] = repaired_lines
    clip["duration"] = round(new_end - new_start, 1)
    clip["clip_start_sec"] = round(clip_start_sec, 2)
    clip["clip_end_sec"] = round(clip_end_sec, 2)
    source = clip.get("source", {}) or {}
    source["timestamp_start"] = mmss(clip["clip_start_sec"])
    source["timestamp_end"] = mmss(clip["clip_end_sec"])
    clip["source"] = source
    return clip


def main():
    parser = argparse.ArgumentParser(description="Repair review clips in a generated batch")
    parser.add_argument("--input", required=True, help="Path to batch new_clips.json")
    parser.add_argument("--eval", required=True, help="Path to eval_results.json")
    parser.add_argument("--output", help="Path to repaired new_clips.json")
    args = parser.parse_args()
    ensure_env()

    input_path = Path(args.input).resolve()
    eval_path = Path(args.eval).resolve()
    output_path = Path(args.output).resolve() if args.output else input_path.parent / "new_clips.repaired.json"
    batch_dir = input_path.parent
    clips_dir = batch_dir / "clips"

    clips_payload = json.loads(input_path.read_text(encoding="utf-8"))
    clips = clips_payload.get("clips", [])
    eval_payload = json.loads(eval_path.read_text(encoding="utf-8"))
    eval_results = eval_payload.get("results", eval_payload)
    review_map = {
        item.get("clip_id") or item.get("id"): item
        for item in eval_results
        if item.get("verdict") == "review"
    }

    repaired = []
    for clip in clips:
        review = review_map.get(clip.get("id"))
        if not review:
            repaired.append(clip)
            continue

        print(f"repairing clip {clip.get('id')} {clip.get('title','')}", flush=True)
        clip_audio_path = clips_dir / Path(clip.get("audio", "")).name
        if not clip_audio_path.exists():
            repaired.append(clip)
            continue

        fixed = trim_and_retranslate(copy.deepcopy(clip), clip_audio_path)
        repaired.append(fixed or clip)

    output_path.write_text(json.dumps({"clips": repaired}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"repaired batch -> {output_path}")


if __name__ == "__main__":
    main()
