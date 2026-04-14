"""Step 4: LLM-based segment identification with tier-specific prompts.

Input: transcript dict, episode info, tier
Output: list of candidate segment dicts
"""

import json

from .utils import log, call_gpt, strip_markdown_fences
from ..prompts.loader import (
    build_segment_prompt,
    EPISODE_CLASSIFY_PROMPT,
    PROMPT_VERSION,
)


def classify_episode(episode_info, transcript):
    """Classify an episode's tier using LLM when the feed has no explicit tier.

    Returns tier string ('Business', 'Tech', etc.) or 'Mixed' if confidence < 0.6.
    """
    title = episode_info.get("title", "")
    desc = episode_info.get("description", "")
    # First 500 words of transcript
    words = transcript.get("words", [])
    first_500 = " ".join(w.get("word", "") for w in words[:500])

    prompt = f"""{EPISODE_CLASSIFY_PROMPT}

标题: {title}
描述: {desc[:300]}
前 500 词转录: {first_500}"""

    response = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=200)
    if not response:
        log("  Episode 分类失败，返回 Mixed", "warn")
        return "Mixed"

    try:
        text = strip_markdown_fences(response)
        data = json.loads(text)
        tier = data.get("tier", "Mixed")
        confidence = data.get("confidence", 0)
        reason = data.get("reason", "")
        log(f"  Episode 分类: {tier} (confidence={confidence:.2f}) — {reason[:50]}", "info")
        if confidence < 0.6:
            return "Mixed"
        return tier
    except (json.JSONDecodeError, TypeError) as e:
        log(f"  Episode 分类解析失败: {e}", "warn")
        return "Mixed"


def select_segments(
    transcript,
    podcast_name,
    tier,
    duration_minutes,
    candidates_per_episode=6,
):
    """Step 4: Use tier-specific LLM prompt to identify candidate segments.

    Args:
        transcript: dict with 'words' and 'segments' from Whisper
        podcast_name: podcast name for context
        tier: 'Business'|'Tech'|'Science'|'Story'|'Psychology'|'Culture'
        duration_minutes: episode total duration in minutes
        candidates_per_episode: how many candidates to request (default 6)

    Returns:
        list of segment dicts with start_time, end_time, reason, hook_type, etc.
    """
    log(f"Step 4: LLM 识别优质片段 (tier={tier})...", "step")

    segments = transcript["segments"]
    seg_text = ""
    for seg in segments:
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        text = seg.get("text", "").strip()
        seg_text += f"[{start:.1f}s - {end:.1f}s] {text}\n"

    # Truncate to fit context window
    seg_text = seg_text[:12000]

    prompt = build_segment_prompt(tier, podcast_name, "", seg_text, duration_minutes)

    response = call_gpt([{"role": "user", "content": prompt}], max_tokens=6000)
    if not response:
        return []

    try:
        text = strip_markdown_fences(response)
        data = json.loads(text)
        result = data.get("segments", [])

        # Attach tier and prompt version metadata
        for seg in result:
            seg["tier"] = tier
            seg["prompt_version"] = PROMPT_VERSION

        log(f"  识别到 {len(result)} 个候选片段", "ok")
        return result
    except json.JSONDecodeError as e:
        log(f"  LLM 输出解析失败: {e}", "error")
        log(f"  原始输出: {response[:300]}", "error")
        return []
