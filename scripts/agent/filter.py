"""Candidate filter layer: rule-based + ffmpeg checks between Step 4 and Step 5.

Input: list of LLM-selected candidates, full audio path, tier
Output: filtered and ranked list of candidates
"""

import re
import subprocess

from .config import FFMPEG
from .utils import log

# ── Constants ──────────────────────────────────────────────────

# ── Three-tier start check (硬拒绝 / 软标记 / 硬通过) ──

# Hard reject: pure echo response as standalone sentence
HARD_REJECT_RESPONSES = re.compile(
    r"^(exactly|right|totally|i agree|absolutely|correct|yeah[,.]|yes[,.]|no[,.])\s*[.!?]",
    re.IGNORECASE,
)

# Hard reject: explicit reference to prior context in first 15 words
ANTECEDENT_PHRASES = re.compile(
    r"\b(you (just )?said|what you (just )?mentioned|that'?s (right|exactly|what i meant)|"
    r"as i was saying|back to your point|to your point|that'?s a (great|good) (example|point)|"
    r"following up on what)\b",
    re.IGNORECASE,
)

# Hard reject: pure filler opening with no substance
EMPTY_FILLER_OPEN = re.compile(
    r"^(you know|i mean|like|um|uh)[, ]+.{0,50}[.!?]$",
    re.IGNORECASE,
)

# Soft flag: connective first words (not auto-rejected, flagged for LLM)
SOFT_CONNECTIVE_WORDS = frozenset({
    "and", "but", "so", "because", "then", "well",
    "actually", "or", "yeah", "yes", "no",
})

END_BLACKLIST = frozenset({
    "and", "but", "or", "because", "which", "that",
    "to", "of", "in", "on",
})

AD_PATTERN = re.compile(
    r"sponsored by|brought to you by|this episode is supported|"
    r"coming up after the break|subscribe to our|rate us on|"
    r"follow us on|stay tuned|we'll be right back|"
    r"for a limited time",
    re.IGNORECASE,
)

HOOK_STRENGTH_ORDER = {"high": 0, "medium": 1, "low": 2}

# Per-tier duration bounds (seconds).
# v2 spec: Science/Business 放宽到 45s 下限（短而锐利的 hook 比 60s 强行凑足更值）；
# Tech/Culture/Psychology 保持 60s 下限（更需要展开）；
# Story 上限 150s（完整叙事弧线需要空间）。
DURATION_LIMITS = {
    "Science":    (45, 120),
    "Business":   (45, 120),
    "Tech":       (60, 120),
    "Psychology": (60, 120),
    "Culture":    (60, 120),
    "Story":      (60, 150),
}
DEFAULT_DURATION_LIMIT = (60, 120)  # Fallback for unknown tier


# ── Individual checks ──────────────────────────────────────────

def _check_duration(candidate, tier):
    """Check 1: Duration within tier-specific bounds (v2: per-tier)."""
    duration = candidate.get("duration_sec", 0)
    if duration <= 0:
        # Compute from times
        duration = candidate.get("end_time", 0) - candidate.get("start_time", 0)

    lo, hi = DURATION_LIMITS.get(tier, DEFAULT_DURATION_LIMIT)
    if duration < lo or duration > hi:
        return f"duration_out_of_range_{duration:.0f}s_{tier.lower() or 'unknown'}_({lo}-{hi})"
    return None


def _get_candidate_text(candidate):
    """Extract full text from candidate (may be in different fields)."""
    # New prompt output has start_word_index/end_word_index but we need text
    # It might be stored in 'text', 'text_preview', or we reconstruct later
    text = candidate.get("text", "") or candidate.get("text_preview", "")
    return text


def _get_words(text):
    """Tokenize text into lowercase words."""
    return [w.lower() for w in re.findall(r"[a-zA-Z']+", text)]


def _check_start(candidate):
    """Check 2: Three-tier start check (hard reject / soft flag / pass).

    Returns:
        - rejection string if hard-rejected
        - None if passed (soft flags are attached to candidate['soft_flags'])
    """
    text = _get_candidate_text(candidate)
    if not text:
        return None

    # Hard reject: pure echo response as standalone first sentence
    if HARD_REJECT_RESPONSES.match(text):
        return f"hard_reject_echo_response"

    # Hard reject: antecedent reference in first 15 words
    words = text.split()
    first_15 = " ".join(words[:15])
    if ANTECEDENT_PHRASES.search(first_15):
        return f"hard_reject_antecedent_reference"

    # Hard reject: empty filler opening
    # Check first sentence only
    first_sentence = re.split(r'[.!?]', text)[0] + "." if text else ""
    first_sentence_words = first_sentence.split()
    if len(first_sentence_words) <= 10 and EMPTY_FILLER_OPEN.match(first_sentence):
        return f"hard_reject_empty_filler"

    # Soft flag: connective first word (not rejected, just flagged)
    lower_words = _get_words(text)
    if lower_words and lower_words[0] in SOFT_CONNECTIVE_WORDS:
        flags = candidate.get("soft_flags", [])
        flags.append("soft_open_connective")
        candidate["soft_flags"] = flags

    return None


def _check_end_completeness(candidate):
    """Check 3: Last word ends with sentence-ending punctuation and not a dangling word.

    Patch B (2026-04-14): 在末尾 8 字符内扫描句末标点，而不是只看最后 1 字。
    动机：即使 text 来自 segment 级（带标点），Whisper 的 segment 边界与候选
    时间窗不一定精确对齐——候选末尾词可能比最近一个句号晚 1-2 个 token。
    只看最后 1 字会误杀明显完整的句子（实测 dry-run 里 25 个 end_no_punct 拒绝
    目测 ~17 个是完整句）。
    """
    text = _get_candidate_text(candidate)
    text = text.rstrip()
    if not text:
        return None

    # Scan the last 8 chars (or whole text if shorter) for a sentence-ending mark.
    tail = text[-8:]
    if not any(ch in '.!?"' or ch == "'" for ch in tail):
        return "end_no_punctuation"

    # Check last word isn't a dangling connector
    words = _get_words(text)
    if words and words[-1] in END_BLACKLIST:
        return f"end_dangling_{words[-1]}"

    return None


def _check_ad_pattern(candidate):
    """Check 4: No ad/promo patterns in text."""
    text = _get_candidate_text(candidate)
    match = AD_PATTERN.search(text)
    if match:
        return f"ad_detected_{match.group()[:30]}"
    return None


def _check_internal_silence(candidate, audio_path):
    """Check 5: No internal silence gaps > 3s (via ffmpeg silencedetect)."""
    start = candidate.get("start_time", 0)
    end = candidate.get("end_time", 0)
    duration = end - start
    if duration <= 0:
        return None

    try:
        cmd = [FFMPEG, "-hide_banner", "-ss", str(start), "-t", str(duration)]
        if str(audio_path).startswith(("http://", "https://")):
            cmd.extend([
                "-rw_timeout", "30000000",
                "-timeout", "30000000",
                "-reconnect", "1",
                "-reconnect_streamed", "1",
                "-reconnect_delay_max", "2",
                "-user_agent", "Mozilla/5.0",
            ])
        cmd.extend([
            "-i", audio_path,
            "-af", "silencedetect=noise=-35dB:d=3",
            "-f", "null", "-",
        ])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=45)

        if result.returncode not in (0, 255):
            return None  # Can't check, don't reject

        # Parse silence_start / silence_end pairs
        starts = [float(x) for x in re.findall(r"silence_start:\s*([0-9.]+)", result.stderr)]
        ends_raw = re.findall(
            r"silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)",
            result.stderr
        )

        for i, sil_start in enumerate(starts):
            # Internal = not at the very beginning or very end
            if sil_start <= 1.0:
                continue  # Near start, OK
            if i < len(ends_raw):
                sil_end = float(ends_raw[i][0])
                sil_dur = float(ends_raw[i][1])
                if sil_end >= duration - 1.0:
                    continue  # Near end, OK
                if sil_dur > 3.0:
                    return f"internal_silence_{sil_dur:.1f}s_at_{sil_start:.1f}s"

    except Exception:
        pass  # Don't reject on detection failure

    return None


def _check_repetition(candidate):
    """Check 6: Front 10% and back 10% word sets don't overlap > 50%."""
    text = _get_candidate_text(candidate)
    words = _get_words(text)
    if len(words) < 20:
        return None  # Too short to meaningfully check

    n = len(words)
    front_size = max(2, n // 10)
    back_size = max(2, n // 10)

    front_set = set(words[:front_size])
    back_set = set(words[-back_size:])

    if not front_set or not back_set:
        return None

    overlap = len(front_set & back_set)
    smaller = min(len(front_set), len(back_set))
    if smaller > 0 and overlap / smaller > 0.5:
        return f"repetition_overlap_{overlap}/{smaller}"

    return None


# ── Main filter function ───────────────────────────────────────

def filter_candidates(candidates, full_audio_path, tier="", clips_per_episode=3):
    """Filter candidate segments by rule-based checks and ffmpeg analysis.

    Args:
        candidates: list of segment dicts from LLM
        full_audio_path: path to the full episode audio
        tier: content tier (affects duration bounds for Story)
        clips_per_episode: how many to keep after filtering

    Returns:
        list of candidates that passed all checks, sorted by hook_strength,
        truncated to clips_per_episode.
        Each candidate gets a 'filter_result' field ('passed' or rejection reason).
    """
    passed = []

    for cand in candidates:
        checks = [
            ("duration", _check_duration(cand, tier)),
            ("start", _check_start(cand)),
            ("end", _check_end_completeness(cand)),
            ("ad", _check_ad_pattern(cand)),
            ("silence", _check_internal_silence(cand, full_audio_path)),
            ("repetition", _check_repetition(cand)),
        ]

        rejected = False
        for check_name, result in checks:
            if result:
                cand["filter_result"] = f"rejected_{result}"
                log(f"    候选 [{cand.get('start_time',0):.0f}s-{cand.get('end_time',0):.0f}s] "
                    f"淘汰: {result}", "info")
                rejected = True
                break

        if not rejected:
            cand["filter_result"] = "passed"
            passed.append(cand)

    # Sort by hook_strength (high > medium > low)
    passed.sort(key=lambda c: HOOK_STRENGTH_ORDER.get(c.get("hook_strength", "low"), 2))

    log(f"  过滤结果: {len(passed)}/{len(candidates)} 通过", "ok")

    return passed[:clips_per_episode]
