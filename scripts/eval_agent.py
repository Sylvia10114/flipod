#!/usr/bin/env python3
"""
Clip QA / Eval agent.

Reads processor output (`new_clips.json`) and produces:
- eval_results.json
- approved_clips.json

Default mode is rule-based so it can run immediately.
Optional LLM scoring can be enabled with `--use-llm`.
"""

import argparse
import json
import math
import os
import re
import subprocess
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path

from agent import config as agent_config
from agent.download import materialize_audio_window
from agent.utils import call_gpt, normalize_audio_url


STANDARD_TAGS = {
    "science",
    "business",
    "psychology",
    "story",
    "history",
    "culture",
    "tech",
    "society",
}

TAG_MAP = {
    "business": "business",
    "science": "science",
    "psychology": "psychology",
    "history": "history",
    "culture": "culture",
    "society": "society",
    "story": "story",
    "storytelling": "story",
    "tech": "tech",
    "technology": "tech",
    "pop culture": "culture",
    "social": "society",
}

REVIEW = "review"
PASS = "pass"
REJECT = "reject"


def normalize_tag(tag):
    clean = (tag or "").strip().lower()
    return TAG_MAP.get(clean, clean)


def load_clips(input_path: Path):
    with input_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "clips" in data:
        return data["clips"]
    if isinstance(data, list):
        return data
    raise ValueError(f"Unsupported input format: {input_path}")


def audio_path_for_clip(clip, input_path: Path, audio_dir: Path | None):
    """Legacy path resolution for batches that still include persisted clip audio."""
    audio_rel = clip.get("audio", "")
    if not audio_rel:
        return None
    if audio_dir:
        return audio_dir / Path(audio_rel).name
    return input_path.parent / audio_rel


def materialize_audio_for_clip(clip, input_path: Path, audio_dir: Path | None, temp_dir: Path):
    """Resolve or temporarily materialize audio for a clip.

    Returns (Path|None, should_cleanup: bool).
    """
    legacy_path = audio_path_for_clip(clip, input_path, audio_dir)
    if legacy_path is not None:
        return legacy_path, False

    source = clip.get("source", {}) or {}
    audio_url = source.get("audio_url", "")
    clip_start = clip.get("clip_start_sec")
    clip_end = clip.get("clip_end_sec")
    if not audio_url or clip_start is None or clip_end is None:
        return None, False

    output_path = temp_dir / f"clip_{clip.get('id', 'unknown')}.mp3"
    ok = materialize_audio_window(audio_url, clip_start, clip_end, str(output_path), timeout=180)
    if not ok:
        return output_path, False
    return output_path, True


def ffprobe_duration(audio_path: Path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe failed")
    return float(result.stdout.strip() or 0)


def detect_tail_silence(audio_path: Path, min_silence_duration=8.0, max_silence_ratio=0.35):
    """Return issue string if suspicious tail silence is found."""
    try:
        duration = ffprobe_duration(audio_path)
    except Exception:
        return None

    if duration <= 0:
        return None

    result = subprocess.run(
        [
            "/opt/homebrew/bin/ffmpeg",
            "-hide_banner",
            "-i",
            str(audio_path),
            "-af",
            "silencedetect=noise=-35dB:d=2",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode not in (0, 255):
        return None

    starts = [float(x) for x in re.findall(r"silence_start:\s*([0-9.]+)", result.stderr)]
    ends = [
        (float(end), float(silence_duration))
        for end, silence_duration in re.findall(
            r"silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)",
            result.stderr,
        )
    ]
    if starts and len(ends) < len(starts):
        ends.append((duration, duration - starts[-1]))

    for idx, start in enumerate(starts):
        silence_end, silence_duration = ends[idx]
        if silence_duration < min_silence_duration:
            continue
        tail_position = start / duration
        silence_ratio = silence_duration / duration
        if tail_position >= 0.45 and silence_ratio >= max_silence_ratio:
            return (
                f"long_tail_silence start={start:.1f}s end={silence_end:.1f}s "
                f"duration={silence_duration:.1f}s ratio={silence_ratio:.2f}"
            )
    return None


def structure_checks(clip, audio_path: Path | None):
    issues = []
    lines = clip.get("lines", [])
    clip_id = clip.get("id", "?")
    source = clip.get("source", {}) or {}
    audio_url = source.get("audio_url", "")
    clip_start = clip.get("clip_start_sec")
    clip_end = clip.get("clip_end_sec")

    if clip.get("audio"):
        if audio_path is None or not audio_path.exists():
            issues.append(("critical", f"clip {clip_id}: audio_missing"))
        elif audio_path.stat().st_size < 5000:
            issues.append(("critical", f"clip {clip_id}: audio_too_small"))
    else:
        if not isinstance(audio_url, str) or not audio_url.startswith(("http://", "https://")):
            issues.append(("critical", f"clip {clip_id}: source_audio_missing"))
        if clip_start is None or clip_end is None:
            issues.append(("critical", f"clip {clip_id}: clip_window_missing"))
        else:
            try:
                clip_start = float(clip_start)
                clip_end = float(clip_end)
                if clip_end <= clip_start:
                    issues.append(("critical", f"clip {clip_id}: clip_window_invalid"))
                declared_duration = clip.get("duration")
                if declared_duration is not None and abs(float(declared_duration) - (clip_end - clip_start)) > 1.5:
                    issues.append(("warn", f"clip {clip_id}: clip_duration_mismatch"))
            except (TypeError, ValueError):
                issues.append(("critical", f"clip {clip_id}: clip_window_invalid"))

        if audio_path is None or not audio_path.exists():
            issues.append(("critical", f"clip {clip_id}: audio_missing"))
        elif audio_path.stat().st_size < 5000:
            issues.append(("critical", f"clip {clip_id}: audio_too_small"))

    if len(lines) < 3:
        issues.append(("critical", f"clip {clip_id}: too_few_lines"))
        return issues

    prev_line_end = -1.0
    total_words = 0
    words_with_cefr = 0
    for idx, line in enumerate(lines):
        en = (line.get("en") or "").strip()
        zh = (line.get("zh") or "").strip()
        start = line.get("start")
        end = line.get("end")
        words = line.get("words", [])

        if not en or not zh:
            issues.append(("critical", f"clip {clip_id} line {idx}: missing_en_or_zh"))
        if start is None or end is None:
            issues.append(("critical", f"clip {clip_id} line {idx}: invalid_line_timing"))
        elif end < start:
            issues.append(("critical", f"clip {clip_id} line {idx}: invalid_line_timing"))
        elif end == start:
            issues.append(("warn", f"clip {clip_id} line {idx}: zero_duration_line"))
        if clip.get("duration") and (start < -0.05 or end > float(clip.get("duration")) + 0.2):
            issues.append(("warn", f"clip {clip_id} line {idx}: line_out_of_window"))
        if prev_line_end >= 0 and start is not None:
            if start < prev_line_end - 0.1:
                overlap = prev_line_end - start
                severity = "critical" if overlap > 1.0 else "warn"
                issues.append((severity, f"clip {clip_id} line {idx}: line_overlap"))
            elif start - prev_line_end > 2.0:
                issues.append(("warn", f"clip {clip_id} line {idx}: large_gap_{start - prev_line_end:.1f}s"))
        prev_line_end = end if end is not None else prev_line_end

        if not words:
            issues.append(("critical", f"clip {clip_id} line {idx}: missing_word_timestamps"))
            continue

        prev_word_start = -1.0
        for word_idx, word in enumerate(words):
            w = (word.get("word") or "").strip()
            w_start = word.get("start")
            w_end = word.get("end")
            if not w:
                issues.append(("critical", f"clip {clip_id} line {idx} word {word_idx}: empty_word"))
            if w_start is None or w_end is None or w_end < w_start:
                issues.append(("critical", f"clip {clip_id} line {idx} word {word_idx}: invalid_word_timing"))
            if prev_word_start >= 0 and w_start is not None and w_start < prev_word_start - 0.05:
                issues.append(("critical", f"clip {clip_id} line {idx} word {word_idx}: word_order_error"))
            if clip.get("duration") and w_start is not None and w_end is not None:
                if w_start < -0.05 or w_end > float(clip.get("duration")) + 0.2:
                    issues.append(("warn", f"clip {clip_id} line {idx} word {word_idx}: word_out_of_window"))
            prev_word_start = w_start if w_start is not None else prev_word_start

            clean_word = re.sub(r"[^a-zA-Z']", "", w)
            if clean_word:
                total_words += 1
                if word.get("cefr"):
                    words_with_cefr += 1

    if not clip.get("title"):
        issues.append(("critical", f"clip {clip_id}: missing_title"))
    normalized_tag = normalize_tag(clip.get("tag"))
    if normalized_tag not in STANDARD_TAGS:
        issues.append(("warn", f"clip {clip_id}: non_standard_tag_{clip.get('tag')}"))

    if total_words > 0:
        coverage = words_with_cefr / total_words
        if coverage < 0.8:
            issues.append(("warn", f"clip {clip_id}: low_cefr_coverage_{coverage:.2f}"))

    return issues


def score_narrative_rule_based(clip):
    lines = clip.get("lines", [])
    full_en = " ".join((line.get("en") or "").strip() for line in lines).strip()
    if not full_en:
        return 1, "英文内容为空", ["missing_content"]

    first = (lines[0].get("en") or "").strip() if lines else ""
    last = (lines[-1].get("en") or "").strip() if lines else ""
    flags = []
    score = 8
    reasons = []

    if len(lines) < 4:
        score -= 2
        reasons.append("行数偏少")
    if re.match(r"^(and|but|so|because|then|well|yeah|yes|no|or)\b", first.lower()):
        score -= 2
        flags.append("cold_open_mid_thought")
        reasons.append("开头像承接中段")
    if not re.search(r"[.!?…]$|['\"]$", last):
        score -= 2
        flags.append("weak_ending")
        reasons.append("结尾不像自然收束")
    if re.search(r"\b(sponsored by|brought to you by|subscribe|follow us)\b", full_en.lower()):
        score -= 3
        flags.append("promo_or_housekeeping")
        reasons.append("疑似广告/节目套话")

    score = max(1, min(10, score))
    if not reasons:
        reasons.append("开头结尾基本自然")
    return score, "；".join(reasons), flags


def score_translation_rule_based(clip):
    lines = clip.get("lines", [])
    missing = 0
    unnatural = 0
    reasons = []
    flags = []

    for line in lines:
        en = (line.get("en") or "").strip()
        zh = (line.get("zh") or "").strip()
        if not zh:
            missing += 1
            continue

        zh_cjk = len(re.findall(r"[\u4e00-\u9fff]", zh))
        zh_len = max(len(zh), 1)
        en_alpha = len(re.findall(r"[A-Za-z]", zh))
        if zh_cjk < 2:
            unnatural += 1
        if en and (zh_len / max(len(en), 1)) > 2.8:
            unnatural += 1
        if en_alpha > zh_cjk:
            unnatural += 1

    score = 9
    if missing:
        score -= min(6, missing * 2)
        flags.append("missing_translation")
        reasons.append(f"{missing} 行缺中文")
    if unnatural:
        score -= min(4, math.ceil(unnatural / 2))
        flags.append("translation_needs_review")
        reasons.append(f"{unnatural} 行翻译可疑")

    score = max(1, min(10, score))
    if not reasons:
        reasons.append("翻译完整且表面上自然")
    return score, "；".join(reasons), flags


def whisper_verify_clip(audio_path: Path):
    """Re-transcribe clip audio via Whisper to get ground-truth text. Returns plain text or None."""
    if not audio_path.exists():
        return None
    url = (f"{agent_config.WHISPER_ENDPOINT}/openai/deployments/{agent_config.WHISPER_DEPLOYMENT}"
           f"/audio/transcriptions?api-version={agent_config.WHISPER_API_VERSION}")
    try:
        result = subprocess.run([
            "curl", "-s", "-X", "POST", url,
            "-H", f"api-key: {agent_config.WHISPER_API_KEY}",
            "-F", f"file=@{audio_path};type=audio/mpeg",
            "-F", "response_format=json",
            "-F", "language=en",
            "--connect-timeout", "15",
            "--max-time", "120",
        ], capture_output=True, text=True, timeout=130)
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        if "error" in data:
            return None
        return (data.get("text") or "").strip()
    except Exception:
        return None


def text_similarity(text_a: str, text_b: str) -> float:
    """Word-set Jaccard similarity. Returns 0.0-1.0."""
    def tokenize(text):
        return set(re.sub(r"[^a-zA-Z0-9' ]", " ", text.lower()).split())
    a = tokenize(text_a)
    b = tokenize(text_b)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def score_audio_text_sync(clip, audio_path: Path):
    """Verify clip audio matches subtitle text via Whisper re-transcription.
    Returns (score_adjustment, reason, flags).
    """
    whisper_text = whisper_verify_clip(audio_path)
    if whisper_text is None:
        return 0, "Whisper 验证跳过（转录失败）", ["whisper_verify_skipped"]

    subtitle_text = " ".join((line.get("en") or "").strip() for line in clip.get("lines", []))
    sim = text_similarity(whisper_text, subtitle_text)

    if sim < 0.4:
        return -5, f"音话严重不匹配 (相似度={sim:.2f})", ["audio_text_mismatch"]
    elif sim < 0.7:
        return -2, f"音话匹配度偏低 (相似度={sim:.2f})", ["audio_text_weak_match"]
    else:
        return 0, f"音话匹配正常 (相似度={sim:.2f})", []


def score_audio_rule_based(clip, audio_path: Path):
    flags = []
    reasons = []
    score = 9

    try:
        duration = ffprobe_duration(audio_path)
    except Exception as exc:
        return 1, f"无法读取音频时长: {exc}", ["audio_probe_failed"]

    if duration < 45:
        score -= 5
        flags.append("too_short")
        reasons.append(f"时长过短 {duration:.1f}s")
    elif duration > 135:
        score -= 4
        flags.append("too_long")
        reasons.append(f"时长过长 {duration:.1f}s")

    silence_issue = detect_tail_silence(audio_path)
    if silence_issue:
        score -= 6
        flags.append("tail_silence")
        reasons.append("后半段异常静音")

    declared_duration = clip.get("duration")
    if declared_duration and abs(float(declared_duration) - duration) > 2.5:
        score -= 1
        flags.append("duration_mismatch")
        reasons.append(f"clip.duration 与音频时长偏差 {abs(float(declared_duration) - duration):.1f}s")

    # Subtitle last-line end vs audio duration drift
    lines = clip.get("lines", [])
    if lines and duration > 0:
        last_end = max((l.get("end") or 0) for l in lines)
        drift = abs(last_end - duration)
        if drift > 10:
            score -= 3
            flags.append("subtitle_duration_drift")
            reasons.append(f"字幕结束与音频时长偏差 {drift:.1f}s")
        elif drift > 5:
            score -= 1
            flags.append("subtitle_duration_drift")
            reasons.append(f"字幕结束与音频时长偏差 {drift:.1f}s")

        # Subtitle coverage ratio
        subtitle_span = sum(max(0, (l.get("end") or 0) - (l.get("start") or 0)) for l in lines)
        coverage = subtitle_span / duration
        if coverage < 0.5:
            score -= 2
            flags.append("low_subtitle_coverage")
            reasons.append(f"字幕覆盖率低 {coverage:.2f}")

    score = max(1, min(10, score))
    if not reasons:
        reasons.append("音频时长和听感指标正常")
    return score, "；".join(reasons), flags


def maybe_llm_scores(clip):
    prompt = {
        "role": "user",
        "content": (
            "你是播客听力产品的 clip QA 评估器。"
            "请只返回 JSON，格式为 "
            '{"narrative":{"score":1-10,"reason":"..."},'
            '"translation":{"score":1-10,"reason":"..."}}。\n\n'
            f"标题: {clip.get('title','')}\n"
            f"标签: {clip.get('tag','')}\n"
            "字幕:\n"
            + "\n".join(
                f"- EN: {(line.get('en') or '').strip()}\n  ZH: {(line.get('zh') or '').strip()}"
                for line in clip.get("lines", [])
            )[:12000]
        ),
    }
    raw = call_gpt([prompt], temperature=0.1, max_tokens=1200)
    if not raw:
        return None, "LLM 返回为空"
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```\w*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```$", "", cleaned)
        return json.loads(cleaned), None
    except Exception as exc:
        return None, f"LLM JSON 解析失败: {exc}"


def verdict_for(scores, flags, has_critical_issue=False):
    narrative = scores["narrative_completeness"]["score"]
    translation = scores["translation_accuracy"]["score"]
    audio = scores["audio_quality"]["score"]

    overall = round(narrative * 0.4 + translation * 0.3 + audio * 0.3, 1)

    if has_critical_issue:
        return REJECT, overall
    if any(flag in flags for flag in ("audio_missing", "audio_too_small", "missing_content", "too_short", "tail_silence", "audio_text_mismatch")):
        return REJECT, overall
    if narrative <= 4 or translation <= 4 or audio <= 4:
        return REJECT, overall
    if any(flag in flags for flag in ("missing_translation", "translation_needs_review", "weak_ending", "cold_open_mid_thought", "zero_duration_line", "line_overlap", "audio_text_weak_match", "subtitle_duration_drift", "low_subtitle_coverage")):
        return REVIEW, overall
    if overall >= 6.5:
        return PASS, overall
    return REVIEW, overall


def evaluate_clip(clip, input_path: Path, audio_dir: Path | None, use_llm: bool, whisper_verify: bool = True):
    clip_id = clip.get("id")
    with tempfile.TemporaryDirectory(prefix="flipod_eval_") as tmp:
        temp_dir = Path(tmp)
        audio_path, should_cleanup = materialize_audio_for_clip(clip, input_path, audio_dir, temp_dir)
        try:
            issues = structure_checks(clip, audio_path)
            flags = []
            has_critical_issue = any(severity == "critical" for severity, _ in issues)

            for severity, issue in issues:
                normalized = issue.split(": ", 1)[-1]
                flags.append(normalized)

            narrative_score, narrative_reason, narrative_flags = score_narrative_rule_based(clip)
            translation_score, translation_reason, translation_flags = score_translation_rule_based(clip)
            if audio_path is None or not audio_path.exists():
                audio_score, audio_reason, audio_flags = 1, "无法获取 clip 音频窗口", ["audio_missing"]
            else:
                audio_score, audio_reason, audio_flags = score_audio_rule_based(clip, audio_path)
            flags.extend(narrative_flags + translation_flags + audio_flags)

            # Audio-text sync verification via Whisper re-transcription
            sync_reason = ""
            if whisper_verify and audio_path is not None and audio_path.exists():
                print(f"  clip {clip_id}: Whisper 音话同步验证中...")
                sync_delta, sync_reason, sync_flags = score_audio_text_sync(clip, audio_path)
                audio_score = max(1, min(10, audio_score + sync_delta))
                flags.extend(sync_flags)
                if sync_reason:
                    audio_reason = f"{audio_reason}；{sync_reason}"

            if use_llm:
                llm_scores, llm_error = maybe_llm_scores(clip)
                if llm_scores:
                    narrative_score = round((narrative_score + int(llm_scores["narrative"]["score"])) / 2)
                    translation_score = round((translation_score + int(llm_scores["translation"]["score"])) / 2)
                    narrative_reason = f"{narrative_reason}；LLM: {llm_scores['narrative']['reason']}"
                    translation_reason = f"{translation_reason}；LLM: {llm_scores['translation']['reason']}"
                elif llm_error:
                    flags.append("llm_eval_failed")

            scores = {
                "narrative_completeness": {"score": narrative_score, "reason": narrative_reason},
                "translation_accuracy": {"score": translation_score, "reason": translation_reason},
                "audio_quality": {"score": audio_score, "reason": audio_reason},
            }
            verdict, overall = verdict_for(scores, flags, has_critical_issue=has_critical_issue)

            return {
                "clip_id": clip_id,
                "verdict": verdict,
                "scores": scores,
                "overall_score": overall,
                "flags": sorted(set(flags)),
                "audio_path": str(audio_path) if audio_path is not None else "",
                "audio_source": normalize_audio_url((clip.get("source", {}) or {}).get("audio_url", "")),
            }
        finally:
            if should_cleanup and audio_path is not None:
                try:
                    audio_path.unlink(missing_ok=True)
                except OSError:
                    pass


def main():
    parser = argparse.ArgumentParser(description="Evaluate processor clips and emit pass/review/reject.")
    parser.add_argument("--input", required=True, help="Path to new_clips.json")
    parser.add_argument("--audio-dir", help="Directory containing clip mp3 files")
    parser.add_argument("--output", help="Path to eval_results.json")
    parser.add_argument("--approved-output", help="Path to approved_clips.json")
    parser.add_argument("--use-llm", action="store_true", help="Use Azure GPT to assist narrative/translation scoring")
    parser.add_argument("--skip-whisper-verify", action="store_true", help="Skip Whisper re-transcription audio-text sync check")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    audio_dir = Path(args.audio_dir).resolve() if args.audio_dir else None
    output_path = Path(args.output).resolve() if args.output else input_path.parent / "eval_results.json"
    approved_output_path = (
        Path(args.approved_output).resolve() if args.approved_output else input_path.parent / "approved_clips.json"
    )
    whisper_verify = not args.skip_whisper_verify
    if whisper_verify or args.use_llm:
        agent_config.ensure_env()

    clips = load_clips(input_path)
    results = [evaluate_clip(clip, input_path, audio_dir, args.use_llm, whisper_verify=whisper_verify) for clip in clips]

    counts = Counter(r["verdict"] for r in results)
    approved_ids = {r["clip_id"] for r in results if r["verdict"] == PASS}
    approved_clips = [clip for clip in clips if clip.get("id") in approved_ids]

    payload = {
        "eval_run_id": datetime.now().strftime("%Y-%m-%d_%H%M%S"),
        "input": str(input_path),
        "total_clips": len(clips),
        "passed": counts[PASS],
        "review": counts[REVIEW],
        "rejected": counts[REJECT],
        "results": results,
    }

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    with approved_output_path.open("w", encoding="utf-8") as f:
        json.dump({"clips": approved_clips}, f, ensure_ascii=False, indent=2)

    print(f"eval_results.json -> {output_path}")
    print(f"approved_clips.json -> {approved_output_path}")
    print(f"pass={counts[PASS]} review={counts[REVIEW]} reject={counts[REJECT]}")


if __name__ == "__main__":
    main()
