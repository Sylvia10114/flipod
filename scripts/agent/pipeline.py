"""Episode processing pipeline: orchestrates Steps 2-9 for a single episode.

Input: episode dict, directories, config
Output: list of clip dicts (or candidate dicts in dry-run mode)
"""

import os
import time

from .config import VALID_TIERS
from .utils import log, step_start, step_end
from .download import download_audio, cleanup_episode_audio
from .transcribe import transcribe_audio
from .segmentation import select_segments, classify_episode
from .filter import filter_candidates
from .cefr import batch_cefr_annotation, infer_difficulty
from .translate import translate_lines
from .output import (
    extract_clip_words, extract_collocations,
    generate_comprehension_questions, validate_questions,
)
from prompts.loader import PROMPT_VERSION


def process_episode(episode, tmp_dir, output_dir, clip_id_start,
                    clip_duration_min=60, clip_duration_max=120,
                    clips_per_episode=3, dry_run=False):
    """Process a single episode: prepare source → transcribe → segment → filter → annotate.

    In dry_run mode, returns ALL candidates (with filter_result) without translation/questions.
    In normal mode, returns list of fully processed clip dicts.
    """
    clips = []
    ep_start = time.time()
    transcript_cache_dir = os.path.join(output_dir, "cache", "transcripts")

    try:
        step_start("download")
        if not download_audio(episode, tmp_dir):
            return clips
        dl_time = step_end("download")
        if dl_time:
            log(f"  ⏱ 源音频准备耗时: {dl_time}s", "info")

        step_start("transcribe")
        transcript = transcribe_audio(
            episode["audio_source"],
            tmp_dir=tmp_dir,
            cache_dir=transcript_cache_dir,
            duration_sec=episode.get("audio_duration_sec"),
        )
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
        segments = transcript.get("segments", [])
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

        # Attach text to candidates for filtering.
        # IMPORTANT: Whisper word-level output 没有标点，segment-level 有标点（CLAUDE.md 第 37 行）。
        # filter._check_end_completeness 检查句末标点，必须用 segment 级 text 才准确。
        # 做法：按候选的时间范围找 overlapping segments，取它们的 text 字段拼接。
        # 若本集 transcript 不带 segments（历史缓存），回退到 word-level 拼接。
        for cand in candidates:
            st, et = cand.get("start_time", 0), cand.get("end_time", 0)
            cand["duration_sec"] = cand.get("duration_sec", et - st)

            if segments:
                # 选中与候选区间有重叠的 segment：seg.start < et 且 seg.end > st
                cand_segs = [
                    s for s in segments
                    if s.get("start", 0) < et and s.get("end", 0) > st
                ]
                cand["text"] = " ".join(s.get("text", "").strip() for s in cand_segs).strip()
            else:
                cand_words = [w.get("word", "") for w in words
                              if w.get("start", 0) >= st - 0.1 and w.get("end", 0) <= et + 0.1]
                cand["text"] = " ".join(cand_words)

        step_start("filter")
        filtered = filter_candidates(candidates, episode["audio_source"], tier, clips_per_episode)
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

            actual_start = round(start_t + lines[0]["start"], 2)
            actual_end = round(start_t + lines[-1]["end"], 2)
            duration = round(actual_end - actual_start, 2)
            time_offset = lines[0]["start"]
            if time_offset > 0:
                for ln in lines:
                    ln["start"] = round(ln["start"] - time_offset, 2)
                    ln["end"] = round(ln["end"] - time_offset, 2)
                    for w in ln.get("words", []):
                        w["start"] = round(w["start"] - time_offset, 2)
                        w["end"] = round(w["end"] - time_offset, 2)

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
                "duration": round(duration, 1),
                "clip_start_sec": actual_start,
                "clip_end_sec": actual_end,
                # P1 修复：从 CEFR 词分布反推，不再硬编码 B1+
                "difficulty": infer_difficulty(lines),
                # P2 修复：info_takeaway 用 prompt 的同名字段（"用户能学到啥"），
                # 不再回退 reason（reason 是审核用的"为啥被选中"，语义不同）。
                "info_takeaway": seg.get("info_takeaway") or seg.get("reason", ""),
                "source": {
                    "podcast": episode.get("podcast_name", ""),
                    "episode": episode.get("title", ""),
                    "audio_url": episode.get("audio_url", ""),
                    "episode_url": episode.get("episode_url", ""),
                    "feed_url": episode.get("feed_url", ""),
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
    finally:
        cleanup_episode_audio(episode)
