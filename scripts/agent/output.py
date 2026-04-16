"""Step 9: Validation and output assembly.

Input: list of clip dicts
Output: validated clips, new_clips.json, processing log
"""

import json
import os
import re

from .utils import log, LOG, normalize_audio_url
from datetime import datetime


# ── Word extraction helpers ────────────────────────────────────

def llm_add_punctuation(raw_text):
    """Add punctuation to raw transcript text via LLM.

    Only called when a segment has >25 words without sentence-ending punctuation.
    """
    from .utils import call_gpt
    prompt = (
        "Below is an English podcast transcript that is missing punctuation. "
        "Add proper punctuation (periods, commas, question marks, exclamation marks) "
        "and capitalize the first letter of each sentence. "
        "Do NOT change, add, or remove any words — only add punctuation and fix capitalization.\n\n"
        f"Text: {raw_text}\n\n"
        "Output the corrected text only, nothing else."
    )
    result = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=2000)
    if result and result.strip():
        return result.strip()
    return raw_text


def split_long_sentence(text, max_words=25):
    """Split a sentence exceeding max_words at clause boundaries."""
    words = text.split()
    if len(words) <= max_words:
        return [text]

    parts = re.split(r';\s*', text)
    if len(parts) > 1:
        return [p.strip() for p in parts if p.strip()]

    parts = re.split(r'\s*[—–]\s*|\s+--\s+', text)
    if len(parts) > 1:
        return [p.strip() for p in parts if p.strip()]

    parts = re.split(r',\s*(?=and |but |or |so |because |although |when |while |if )', text)
    if len(parts) > 1:
        return [p.strip() for p in parts if p.strip()]

    return [text]


def extract_clip_words(transcript, start_time, end_time):
    """Extract word-level timestamps for a clip, using segment text for sentence splitting.

    Returns list of line dicts [{start, end, en, zh, words}].
    """
    from .cefr import get_cefr

    words = transcript["words"]
    segments = transcript.get("segments", [])

    clip_words = []
    for w in words:
        ws = w.get("start", 0)
        we = w.get("end", 0)
        if ws >= start_time - 0.05 and we <= end_time + 0.05:
            clip_words.append({
                "word": w.get("word", "").strip(),
                "start": round(max(0, ws - start_time), 2),
                "end": round(max(0, we - start_time), 2),
            })

    if not clip_words:
        return []

    # Collect segment texts overlapping clip range
    sentences = []
    for seg in segments:
        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", 0)
        if seg_end <= start_time - 0.5 or seg_start >= end_time + 0.5:
            continue
        text = seg.get("text", "").strip()
        if not text:
            continue

        parts = re.split(r'(?<=[.!?])\s+', text)
        parts = [p.strip() for p in parts if p.strip()]

        needs_llm = any(len(p.split()) > 25 for p in parts)
        if needs_llm:
            log(f"    Tier 2: LLM 补标点 (segment 有 {len(text.split())} 词无标点)", "info")
            punctuated = llm_add_punctuation(text)
            parts = re.split(r'(?<=[.!?])\s+', punctuated)
            parts = [p.strip() for p in parts if p.strip()]

        final_parts = []
        for p in parts:
            if len(p.split()) > 25:
                final_parts.extend(split_long_sentence(p))
            else:
                final_parts.append(p)

        sentences.extend(final_parts)

    if not sentences:
        en_text = " ".join(w["word"] for w in clip_words)
        for w in clip_words:
            w["cefr"] = get_cefr(w["word"])
        return [{
            "start": clip_words[0]["start"],
            "end": clip_words[-1]["end"],
            "en": en_text,
            "zh": "",
            "words": clip_words,
        }]

    # Map words to sentences by greedy alignment
    lines = []
    word_idx = 0

    for sent in sentences:
        sent_tokens = re.findall(r"[a-zA-Z']+|\d+", sent)
        if not sent_tokens:
            continue

        matched_words = []
        scan_idx = word_idx

        for token in sent_tokens:
            found = False
            for j in range(scan_idx, min(scan_idx + 5, len(clip_words))):
                clean_word = re.sub(r"[^a-zA-Z'0-9]", "", clip_words[j]["word"])
                if clean_word.lower() == token.lower():
                    matched_words.append(clip_words[j])
                    scan_idx = j + 1
                    found = True
                    break

        if matched_words:
            for mw in matched_words:
                mw["cefr"] = get_cefr(mw["word"])

            lines.append({
                "start": matched_words[0]["start"],
                "end": matched_words[-1]["end"],
                "en": sent,
                "zh": "",
                "words": matched_words,
            })
            word_idx = scan_idx

    # Remaining unmatched words
    if word_idx < len(clip_words):
        remaining = clip_words[word_idx:]
        for rw in remaining:
            rw["cefr"] = get_cefr(rw["word"])
        en_text = " ".join(w["word"] for w in remaining)
        if len(remaining) >= 2:
            lines.append({
                "start": remaining[0]["start"],
                "end": remaining[-1]["end"],
                "en": en_text,
                "zh": "",
                "words": remaining,
            })

    # Trim incomplete boundary sentences
    if lines:
        first = lines[0]
        first_sent_word_count = len(re.findall(r"[a-zA-Z']+|\d+", first["en"]))
        first_matched = len(first.get("words", []))
        if first_sent_word_count > 0:
            match_ratio = first_matched / first_sent_word_count
            if match_ratio < 0.5:
                lines.pop(0)
            elif match_ratio < 1.0 and first["words"]:
                first["en"] = " ".join(w["word"] for w in first["words"])
                first["start"] = first["words"][0]["start"]

    if lines:
        last = lines[-1]
        last_sent_word_count = len(re.findall(r"[a-zA-Z']+|\d+", last["en"]))
        last_matched = len(last.get("words", []))
        if last_sent_word_count > 0:
            match_ratio = last_matched / last_sent_word_count
            if match_ratio < 0.5:
                lines.pop()
            elif match_ratio < 1.0 and last["words"]:
                last["en"] = " ".join(w["word"] for w in last["words"])
                last["end"] = last["words"][-1]["end"]

    return lines


# ── Collocations ───────────────────────────────────────────────

STOP_WORDS = frozenset([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "am", "i", "me",
    "my", "we", "our", "you", "your", "he", "she", "it", "its", "they",
    "them", "their", "this", "that", "these", "those", "of", "in", "to",
    "for", "with", "on", "at", "from", "by", "as", "or", "and", "but",
    "if", "not", "no", "so", "up", "out", "just", "than", "too", "very",
    "s", "t", "d", "ll", "re", "ve", "m", "don", "isn", "aren", "wasn",
    "weren", "doesn", "didn", "won", "wouldn", "shan", "shouldn", "about",
])


def extract_collocations(lines):
    """Extract meaningful 2-3 gram collocations from clip lines."""
    all_words = []
    for line in lines:
        tokens = re.findall(r"[a-zA-Z']+", line.get("en", ""))
        all_words.extend([t.lower() for t in tokens])

    seen = set()
    collocations = []

    def _has_content(ngram_words):
        return any(w not in STOP_WORDS for w in ngram_words)

    for i in range(len(all_words) - 1):
        bg = (all_words[i], all_words[i + 1])
        if _has_content(bg):
            phrase = " ".join(bg)
            if phrase not in seen:
                seen.add(phrase)
                collocations.append(phrase)

    for i in range(len(all_words) - 2):
        tg = (all_words[i], all_words[i + 1], all_words[i + 2])
        if _has_content(tg):
            phrase = " ".join(tg)
            if phrase not in seen:
                seen.add(phrase)
                collocations.append(phrase)

    return collocations


def compute_overlap_scores(all_clips):
    """Compute pairwise collocation overlap scores for ranking."""
    n = len(all_clips)
    if n <= 1:
        for clip in all_clips:
            clip["overlap_score"] = 0.0
        return

    coll_sets = [set(clip.get("collocations", [])) for clip in all_clips]

    for i in range(n):
        total_overlap = sum(
            len(coll_sets[i] & coll_sets[j])
            for j in range(n) if i != j
        )
        all_clips[i]["overlap_score"] = round(total_overlap / (n - 1), 2)


# ── Comprehension questions ────────────────────────────────────

def generate_comprehension_questions(lines, episode_info):
    """Generate 2 comprehension questions from clip content via GPT."""
    from .utils import call_gpt
    full_text = " ".join(line.get("en", "") for line in lines)
    if not full_text.strip():
        return []

    prompt = (
        "You are a podcast listening comprehension designer. Based ONLY on the following English passage, "
        "create exactly 2 multiple-choice questions.\n\n"
        "Rules:\n"
        "- Question 1 MUST test the MAIN IDEA or GIST: what is this passage mainly about? "
        "What is the speaker's core point? Do NOT ask about specific details, numbers, or names.\n"
        "- Question 2 MUST test the SPEAKER'S ATTITUDE, OPINION, or KEY TAKEAWAY: "
        "what does the speaker think/feel/conclude about the topic? What's the implication?\n"
        "- Both questions should be answerable by someone who understood the general meaning, "
        "even if they missed some specific words or details.\n"
        "- Each question has exactly 4 options (A, B, C, D), with 1 correct and 3 plausible distractors.\n"
        "- Questions are in English; keep them short and conversational (not academic).\n"
        "- explanation_zh is a brief Chinese explanation of why the answer is correct.\n"
        "- Return ONLY a JSON array, no other text.\n\n"
        "Format:\n"
        '[{"question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], '
        '"answer": "A", "explanation_zh": "..."}]\n\n'
        f"Passage:\n{full_text}"
    )

    from .utils import strip_markdown_fences
    response = call_gpt([{"role": "user", "content": prompt}], temperature=0.4, max_tokens=1500)
    if not response:
        return []

    text = strip_markdown_fences(response)
    try:
        questions = json.loads(text)
        if not isinstance(questions, list):
            log("  理解题生成: 返回格式不是数组", "warn")
            return []
        return questions
    except json.JSONDecodeError as e:
        log(f"  理解题生成: JSON 解析失败 — {e}", "warn")
        return []


def validate_questions(questions, lines):
    """Validate each question via a second GPT call."""
    if not questions:
        return []

    from .utils import call_gpt
    full_text = " ".join(line.get("en", "") for line in lines)
    validated = []

    for q in questions:
        prompt = (
            "You are a strict validator. Given the passage and a multiple-choice question, "
            "determine whether the question can be answered SOLELY from the passage content.\n\n"
            "Additional rule: if the question asks about a SPECIFIC DETAIL such as a specific name, "
            "number, date, or statistic, answer \"no\" — we only want gist/attitude questions.\n\n"
            "Reply with ONLY \"yes\" or \"no\".\n\n"
            f"Passage:\n{full_text}\n\n"
            f"Question: {q.get('question', '')}\n"
            f"Options: {', '.join(q.get('options', []))}\n"
            f"Stated answer: {q.get('answer', '')}"
        )

        response = call_gpt([{"role": "user", "content": prompt}], temperature=0.0, max_tokens=10)
        if response and response.strip().lower().startswith("yes"):
            validated.append(q)
        else:
            log(f"  理解题校验不通过，丢弃: {q.get('question', '')[:50]}", "warn")

    return validated


# ── Validation ─────────────────────────────────────────────────

def validate_clip(clip, output_dir):
    """Validate a single clip. Returns list of issues (empty = valid)."""
    issues = []
    cid = clip.get("id", "?")
    source = clip.get("source", {}) or {}
    audio_url = source.get("audio_url", "")
    clip_start = clip.get("clip_start_sec")
    clip_end = clip.get("clip_end_sec")

    if not isinstance(audio_url, str) or not audio_url.startswith(("http://", "https://")):
        issues.append(f"clip {cid}: source.audio_url 缺失或非法")
    if clip_start is None or clip_end is None:
        issues.append(f"clip {cid}: clip_start_sec/clip_end_sec 缺失")
    else:
        try:
            clip_start = float(clip_start)
            clip_end = float(clip_end)
            if clip_end <= clip_start:
                issues.append(f"clip {cid}: clip 时间窗非法 ({clip_start}-{clip_end})")
            declared = clip.get("duration")
            if declared is not None and abs(float(declared) - (clip_end - clip_start)) > 1.5:
                issues.append(f"clip {cid}: duration 与 clip 时间窗不一致")
        except (TypeError, ValueError):
            issues.append(f"clip {cid}: clip 时间窗格式非法")

    lines = clip.get("lines", [])
    if not lines:
        issues.append(f"clip {cid}: 无字幕行")
        return issues

    prev_end = -1
    clip_duration = float(clip.get("duration") or 0)
    for i, line in enumerate(lines):
        if line["start"] < prev_end - 0.1:
            issues.append(f"clip {cid} line {i}: 时间戳重叠")
        if prev_end >= 0 and line["start"] - prev_end > 2.0:
            issues.append(f"clip {cid} line {i}: 时间戳间隙过大 ({line['start'] - prev_end:.1f}s)")
        prev_end = line["end"]
        if line["start"] < -0.05 or (clip_duration and line["end"] > clip_duration + 0.2):
            issues.append(f"clip {cid} line {i}: 超出 clip 时间窗")

        if not line.get("zh"):
            issues.append(f"clip {cid} line {i}: 缺少中文翻译")

        words = line.get("words", [])
        if not words:
            issues.append(f"clip {cid} line {i}: 缺少词级时间戳")
        else:
            prev_word_end = -1
            no_cefr = sum(1 for w in words if w.get("cefr") is None and re.sub(r"[^a-zA-Z']", "", w["word"]))
            if no_cefr > len(words) * 0.3:
                issues.append(f"clip {cid} line {i}: CEFR 标注覆盖率低 ({no_cefr}/{len(words)})")
            for j, word in enumerate(words):
                w_start = word.get("start")
                w_end = word.get("end")
                if w_start is None or w_end is None or w_end < w_start:
                    issues.append(f"clip {cid} line {i} word {j}: 词级时间戳非法")
                    continue
                if w_start < -0.05 or (clip_duration and w_end > clip_duration + 0.2):
                    issues.append(f"clip {cid} line {i} word {j}: 词级时间超出 clip 时间窗")
                if prev_word_end >= 0 and w_start < prev_word_end - 0.05:
                    issues.append(f"clip {cid} line {i} word {j}: 词级时间倒序")
                prev_word_end = w_end

    if not clip.get("title"):
        issues.append(f"clip {cid}: 缺少标题")
    if not clip.get("tag"):
        issues.append(f"clip {cid}: 缺少标签")

    return issues


def validate_all_clips(clips, output_dir):
    """Validate all clips. Returns (valid_clips, all_issues)."""
    all_issues = []
    valid_clips = []
    for clip in clips:
        issues = validate_clip(clip, output_dir)
        if issues:
            for issue in issues:
                log(f"  校验问题: {issue}", "warn")
            critical = any(
                "source.audio_url 缺失或非法" in i
                or "clip_start_sec/clip_end_sec 缺失" in i
                or "clip 时间窗非法" in i
                or "无字幕行" in i
                for i in issues
            )
            if not critical:
                valid_clips.append(clip)
            else:
                log(f"  clip {clip.get('id', '?')} 因严重问题被剔除", "error")
        else:
            valid_clips.append(clip)
        all_issues.extend(issues)

    log(f"Step 9: 校验完成 - {len(valid_clips)}/{len(clips)} 通过", "ok" if not all_issues else "warn")
    return valid_clips, all_issues


# ── Processed episodes tracking ────────────────────────────────

def load_processed_episodes(output_dir):
    """Load set of already-processed source audio URLs for incremental mode."""
    processed = set()
    new_clips_path = os.path.join(output_dir, "new_clips.json")
    if os.path.exists(new_clips_path):
        try:
            with open(new_clips_path, "r") as f:
                data = json.load(f)
            for clip in data.get("clips", []):
                audio_url = clip.get("source", {}).get("audio_url", "")
                if audio_url:
                    processed.add(normalize_audio_url(audio_url))
        except Exception:
            pass
    tracking_path = os.path.join(output_dir, "processed_episodes.json")
    if os.path.exists(tracking_path):
        try:
            with open(tracking_path, "r") as f:
                processed.update(normalize_audio_url(u) for u in json.load(f))
        except Exception:
            pass
    return processed


def save_processed_episodes(output_dir, processed_set):
    """Save processed source audio URLs for incremental dedup."""
    tracking_path = os.path.join(output_dir, "processed_episodes.json")
    try:
        with open(tracking_path, "w") as f:
            json.dump(sorted(normalize_audio_url(u) for u in processed_set if u), f, indent=2)
    except Exception as e:
        log(f"保存处理记录失败: {e}", "warn")


def get_next_clip_id(output_dir):
    ids = []
    new_clips_path = os.path.join(output_dir, "new_clips.json")
    if os.path.exists(new_clips_path):
        try:
            with open(new_clips_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for clip in data.get("clips", []):
                cid = clip.get("id")
                if isinstance(cid, int):
                    ids.append(cid)
        except Exception:
            pass

    clips_dir = os.path.join(output_dir, "clips")
    if os.path.exists(clips_dir):
        existing = [f for f in os.listdir(clips_dir) if f.startswith("clip_") and f.endswith(".mp3")]
        for f in existing:
            match = re.match(r"clip_(\d+)\.mp3", f)
            if match:
                ids.append(int(match.group(1)))
    return max(ids) + 1 if ids else 1
