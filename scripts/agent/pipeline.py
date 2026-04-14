"""Episode processing pipeline: orchestrates Steps 2-9 for a single episode.

Input: episode dict, directories, config
Output: list of clip dicts (or candidate dicts in dry-run mode)
"""

import os
import time

from .config import VALID_TIERS
from .utils import log, step_start, step_end
from .download import download_audio
from .transcribe import transcribe_audio
from .segmentation import select_segments, classify_episode
from .filter import filter_candidates
from .audio_cut import cut_audio
from .cefr import batch_cefr_annotation
from .translate import translate_lines
from .output import (
    extract_clip_words, extract_collocations,
    generate_comprehension_questions, validate_questions,
)
from ..prompts.loader import PROMPT_VERSION


def process_episode(episode, tmp_dir, output_dir, clip_id_start,
                    clip_duration_min=60, clip_duration_max=120,
                    clips_per_episode=3, dry_run=False):
    """Process a single episode: download → transcribe → segment → filter → cut → annotate.

    In dry_run mode, returns ALL candidates (with filter_result) without cutting/translating.
    In normal mode, returns list of fully processed clip dicts.
    """
    clips = []
    ep_start = time.time()

    step_start("download")
    if not download_audio(episode, tmp_dir):
        return clips
    dl_time = step_end("download")
    if dl_time:
        log(f"  ⏱ 下载耗时: {dl_time}s", "info")

    step_start("transcribe")
    transcript = transcribe_audio(episode["local_audio"])
    if not transcript:
        return clips
    asr_time = step_end("transcribe")
    if asr_time:
        log(f"  ⏱ 转录耗时: {asr_time}s", "info")

    # Determine tier
    tier = episode.get("tier", "")
    if not tier or tier not in VALID_TIERS:
        tier = classify_episode(episode, transcript)
        episode["tier"] = tier
    if tier == "Mixed":
        log("  Episode 分类为 Mixed (低置信度)，跳过", "warn")
        return clips

    words = transcript.get("words", [])
    duration_minutes = (words[-1]["end"] / 60.0) if words else 0

    step_start("identify")
    candidates = select_segments(transcript, episode.get("podcast_name", ""),
                                 tier, duration_minutes, candidates_per_episode=6)
    if not candidates:
        log("  该集无合格候选", "warn")
        return clips
    id_time = step_end("identify")
    if id_time:
        log(f"  ⏱ 片段识别耗时: {id_time}s", "info")

    # Attach text to candidates for filtering
    for cand in candidates:
        st, et = cand.get("start_time", 0), cand.get("end_time", 0)
        cand_words = [w.get("word", "") for w in words
                      if w.get("start", 0) >= st - 0.1 and w.get("end", 0) <= et + 0.1]
        cand["text"] = " ".join(cand_words)
        cand["duration_sec"] = cand.get("duration_sec", et - st)

    step_start("filter")
    filtered = filter_candidates(candidates, episode["local_audio"], tier, clips_per_episode)
    step_end("filter")

    if dry_run:
        import re
        for cand in candidates:
            text = cand.get("text", "")
            words_list = text.split()
            head = " ".join(words_list[:30]) if len(words_list) > 30 else text
            tail = " ".join(words_list[-15:]) if len(words_list) > 45 else ""
            cand["text"] = head + ("\n\n..." + tail if tail else "")
        return candidates

    if not filtered:
        log("  过滤后无合格片段", "warn")
        return clips

    for seg in filtered:
        clip_id = clip_id_start + len(clips)
        start_t = seg.get("start_time", 0)
        end_t = seg.get("end_time", 0)

        step_start(f"cefr_{clip_id}")
        lines = extract_clip_words(transcript, start_t, end_t)
        if not lines:
            log("  片段无法提取字幕行，跳过", "warn")
            continue

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

        clip_filename = f"clips/clip_{clip_id:03d}.mp3"
        clip_path = os.path.join(output_dir, clip_filename)
        if not cut_audio(episode["local_audio"], actual_start, actual_end,
                         clip_path, segments=transcript.get("segments")):
            continue

        lines = batch_cefr_annotation(lines)
        step_end(f"cefr_{clip_id}")

        step_start(f"translate_{clip_id}")
        lines = translate_lines(lines)
        step_end(f"translate_{clip_id}")

        step_start(f"questions_{clip_id}")
        raw_questions = generate_comprehension_questions(lines, episode)
        questions = validate_questions(raw_questions, lines)
        step_end(f"questions_{clip_id}")

        collocations = extract_collocations(lines)
        start_mm_ss = f"{int(actual_start)//60:02d}:{int(actual_start)%60:02d}"
        end_mm_ss = f"{int(actual_end)//60:02d}:{int(actual_end)%60:02d}"

        clip_data = {
            "id": clip_id,
            "title": seg.get("suggested_title", f"片段 {clip_id}"),
            "tag": tier,
            "audio": clip_filename,
            "duration": round(duration, 1),
            "difficulty": "B1+",
            "info_takeaway": seg.get("reason", ""),
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
        }
        clips.append(clip_data)
        log(f"  ✨ 片段 {clip_id} 完成: {clip_data['title']}", "ok")

    ep_elapsed = round(time.time() - ep_start, 1)
    log(f"  ⏱ 本集总耗时: {ep_elapsed}s, 产出 {len(clips)} 个片段", "info")
    return clips
