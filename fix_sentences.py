#!/usr/bin/env python3
"""
fix_sentences.py — Fix sentence boundaries in data.json
Based on PRD-subtitle-presentation validation rules:
  R1: First letter uppercase
  R2: Ends with . ! ? "
  R3: Max 30 words
  R4: Min 3 words
  R5: zh non-empty
  R6: Timestamps continuous
"""

import json
import os
import subprocess
import re
import sys
import copy
from datetime import datetime

AZURE_ENDPOINT = os.environ.get("AZURE_ENDPOINT", "https://us-east-02-gpt-01.openai.azure.com")
AZURE_API_KEY = os.environ["AZURE_API_KEY"]
GPT_DEPLOYMENT = "gpt-5.4-global-01"
GPT_API_VERSION = "2025-04-01-preview"

DATA_FILE = "data.json"
BACKUP_FILE = f"data.json.bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def log(msg):
    print(f"[fix] {msg}")


# ── GPT call via curl (Python 3.9 SSL workaround) ──
def gpt_call(system_prompt, user_prompt, max_tokens=2000):
    url = (f"{AZURE_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
           f"/chat/completions?api-version={GPT_API_VERSION}")

    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_completion_tokens": max_tokens,
        "temperature": 0.2,
    }

    cmd = [
        "curl", "-s", "-X", "POST", url,
        "-H", f"api-key: {AZURE_API_KEY}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(payload),
        "--max-time", "60",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if result.returncode != 0:
        log(f"  ERROR: GPT curl failed: {result.stderr[:200]}")
        return None

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        log(f"  ERROR: GPT returned invalid JSON: {result.stdout[:200]}")
        return None

    if "error" in data:
        log(f"  ERROR: GPT API error: {data['error']}")
        return None

    return data["choices"][0]["message"]["content"]


# ── Validation ──
def check_line(line, prev_line=None):
    """Return list of violated rules for a line."""
    violations = []
    en = line.get("en", "").strip()
    zh = line.get("zh", "").strip()

    if not en:
        violations.append("R5-empty-en")
        return violations

    # R1: First letter uppercase
    first_alpha = next((c for c in en if c.isalpha()), None)
    if first_alpha and first_alpha.islower():
        violations.append("R1")

    # R2: Ends with sentence-ending punctuation
    if not re.search(r'[.!?"]$', en):
        violations.append("R2")

    # R3: Max 30 words
    word_count = len(en.split())
    if word_count > 30:
        violations.append("R3")

    # R4: Min 3 words
    if word_count < 3:
        violations.append("R4")

    # R5: zh non-empty
    if not zh:
        violations.append("R5")

    # R6: Timestamps continuous
    if prev_line and line.get("start", 0) < prev_line.get("start", 0):
        violations.append("R6")

    return violations


def classify_clip(clip_idx, lines):
    """Classify a clip's issue type."""
    if not lines:
        return "empty"

    total = len(lines)
    r2_count = 0
    r1_count = 0
    for i, line in enumerate(lines):
        prev = lines[i - 1] if i > 0 else None
        v = check_line(line, prev)
        if "R2" in v:
            r2_count += 1
        if "R1" in v:
            r1_count += 1

    if r2_count == total:
        return "raw"  # All lines broken — raw Whisper segments
    elif r2_count > 0 and r1_count > 0:
        # Check for split-sentence pattern: line N ends without punct, N+1 starts lowercase
        split_pairs = 0
        for i in range(len(lines) - 1):
            en_curr = lines[i].get("en", "").strip()
            en_next = lines[i + 1].get("en", "").strip()
            if en_curr and en_next:
                if not re.search(r'[.!?"]$', en_curr):
                    first_alpha = next((c for c in en_next if c.isalpha()), None)
                    if first_alpha and first_alpha.islower():
                        split_pairs += 1
        if split_pairs >= 2:
            return "split"  # Sentences split across lines

    # Check for minor issues only
    has_issues = False
    for i, line in enumerate(lines):
        prev = lines[i - 1] if i > 0 else None
        v = check_line(line, prev)
        if v:
            has_issues = True
            break

    return "minor" if has_issues else "clean"


# ── Fix strategies ──

def merge_words(lines_to_merge):
    """Merge word lists from multiple lines."""
    all_words = []
    for line in lines_to_merge:
        all_words.extend(line.get("words", []))
    return all_words


def fix_raw_clip(clip_idx, lines):
    """Fix clips with raw unsegmented Whisper output (no punctuation at all).
    Strategy: concatenate all text → LLM punctuation → re-split → re-align words → re-translate.
    """
    log(f"  Clip {clip_idx}: RAW fix — concatenating all text for LLM punctuation")

    # 1. Gather all text and all words
    all_text = " ".join(line.get("en", "").strip() for line in lines)
    all_words = merge_words(lines)
    clip_start = lines[0].get("start", 0)
    clip_end = lines[-1].get("end", 0)

    # Remove garbage text (e.g., "www un org")
    all_text = re.sub(r'\bwww\s+\w+\s+org\b', '', all_text).strip()
    all_text = re.sub(r'\s+', ' ', all_text)

    # 2. LLM: add punctuation
    punctuated = llm_add_punctuation(all_text)
    if not punctuated:
        log(f"  ERROR: LLM punctuation failed for clip {clip_idx}")
        return None

    # 3. Split into sentences
    sentences = split_by_punctuation(punctuated)

    # 4. Align words to sentences
    new_lines = align_words_to_sentences(sentences, all_words)
    if not new_lines:
        log(f"  ERROR: Word alignment failed for clip {clip_idx}")
        return None

    # 5. Split long sentences (>30 words)
    new_lines = split_long_lines(new_lines)

    # 6. Merge short lines (<3 words) with neighbors
    new_lines = merge_short_lines(new_lines)

    # 7. Translate
    new_lines = translate_lines(new_lines, clip_idx)

    log(f"  Clip {clip_idx}: {len(lines)} lines → {len(new_lines)} lines")
    return new_lines


def fix_split_clip(clip_idx, lines):
    """Fix clips with split-sentence pattern (sentence broken across two lines).
    Strategy: merge line pairs where line N has no ending punct and N+1 starts lowercase.
    """
    log(f"  Clip {clip_idx}: SPLIT fix — merging broken sentence pairs")

    new_lines = []
    i = 0
    while i < len(lines):
        line = copy.deepcopy(lines[i])

        # Check if this line needs merging with next
        if i + 1 < len(lines):
            en_curr = line.get("en", "").strip()
            en_next = lines[i + 1].get("en", "").strip()
            if en_curr and en_next and not re.search(r'[.!?"]$', en_curr):
                first_alpha = next((c for c in en_next if c.isalpha()), None)
                if first_alpha and first_alpha.islower():
                    # Merge with next line
                    merged_en = en_curr + " " + en_next
                    merged_words = line.get("words", []) + lines[i + 1].get("words", [])
                    line["en"] = merged_en
                    line["words"] = merged_words
                    line["end"] = lines[i + 1].get("end", line.get("end", 0))
                    line["zh"] = ""  # Will re-translate
                    i += 2
                    new_lines.append(line)
                    continue

        new_lines.append(line)
        i += 1

    # Split any that are now too long
    new_lines = split_long_lines(new_lines)

    # Merge short lines
    new_lines = merge_short_lines(new_lines)

    # Re-translate lines that were modified (empty zh)
    lines_to_translate = [j for j, l in enumerate(new_lines) if not l.get("zh", "").strip()]
    if lines_to_translate:
        new_lines = translate_lines_selective(new_lines, lines_to_translate, clip_idx)

    log(f"  Clip {clip_idx}: {len(lines)} lines → {len(new_lines)} lines")
    return new_lines


def fix_minor_clip(clip_idx, lines):
    """Fix minor issues: capitalize, split long, merge short, fix endings."""
    log(f"  Clip {clip_idx}: MINOR fix")
    new_lines = [copy.deepcopy(l) for l in lines]
    modified_indices = []

    # R1: Auto-capitalize
    for i, line in enumerate(new_lines):
        en = line.get("en", "")
        if en and en[0].islower():
            line["en"] = en[0].upper() + en[1:]
            # No need to re-translate for capitalize

    # R3: Split long sentences
    new_lines = split_long_lines(new_lines)

    # R4: Merge short lines (< 3 words)
    new_lines = merge_short_lines(new_lines)

    # R2: Fix endings — if a line still doesn't end with punctuation,
    # try LLM punctuation on just that line
    needs_punct = []
    for i, line in enumerate(new_lines):
        en = line.get("en", "").strip()
        if en and not re.search(r'[.!?"]$', en):
            needs_punct.append(i)

    if needs_punct:
        # For minor clips, these are usually just missing a period
        for i in needs_punct:
            en = new_lines[i]["en"].strip()
            # Simple fix: add period if it looks like a complete sentence
            if len(en.split()) >= 3:
                new_lines[i]["en"] = en + "."

    # Re-translate lines with empty zh
    empty_zh = [j for j, l in enumerate(new_lines) if not l.get("zh", "").strip()]
    if empty_zh:
        new_lines = translate_lines_selective(new_lines, empty_zh, clip_idx)

    log(f"  Clip {clip_idx}: {len(lines)} lines → {len(new_lines)} lines")
    return new_lines


# ── Helper functions ──

def llm_add_punctuation(text):
    """Use GPT to add punctuation to unpunctuated text."""
    system = "You are an English punctuation expert."
    user = f"""The following is a transcription of an English podcast. The text has no punctuation and no sentence boundaries.
Please add proper punctuation (periods, question marks, exclamation marks, commas) and capitalize the first letter of each sentence.
IMPORTANT: Do NOT change any words. Only add punctuation and fix capitalization.
Output ONLY the punctuated text, nothing else.

Text:
{text}"""

    result = gpt_call(system, user, max_tokens=3000)
    if not result:
        return None
    # Clean up: remove any markdown formatting
    result = result.strip()
    if result.startswith("```"):
        result = re.sub(r'^```\w*\n?', '', result)
        result = re.sub(r'\n?```$', '', result)
    return result.strip()


def split_by_punctuation(text):
    """Split text into sentences by terminal punctuation."""
    # Split on . ! ? followed by space and uppercase, or end of string
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
    # Also split on . ! ? at end
    result = []
    for s in sentences:
        s = s.strip()
        if s:
            result.append(s)
    return result


def align_words_to_sentences(sentences, all_words):
    """Align word-level timestamps to sentences using greedy matching."""
    if not all_words:
        # No word timestamps — create lines without words
        return [{"en": s, "words": [], "start": 0, "end": 0, "zh": ""} for s in sentences]

    new_lines = []
    word_idx = 0

    for sent in sentences:
        sent_words_text = sent.split()
        if not sent_words_text:
            continue

        # Find matching words in all_words starting from word_idx
        line_words = []
        sent_word_ptr = 0
        search_start = max(0, word_idx - 5)  # small lookback

        best_start = word_idx
        best_match = 0

        # Try to find the best starting position
        for try_start in range(search_start, min(len(all_words), word_idx + 50)):
            matches = 0
            ptr = try_start
            for sw in sent_words_text[:5]:  # Check first 5 words
                if ptr >= len(all_words):
                    break
                # Clean both for comparison
                w_clean = re.sub(r'[^a-zA-Z\']', '', all_words[ptr].get("word", "")).lower()
                s_clean = re.sub(r'[^a-zA-Z\']', '', sw).lower()
                if w_clean == s_clean:
                    matches += 1
                    ptr += 1
                elif matches > 0:
                    break
                else:
                    ptr += 1
            if matches > best_match:
                best_match = matches
                best_start = try_start

        # Now collect words for this sentence
        ptr = best_start
        collected = 0
        for sw in sent_words_text:
            if ptr >= len(all_words):
                break
            # Try to match
            w_clean = re.sub(r'[^a-zA-Z\']', '', all_words[ptr].get("word", "")).lower()
            s_clean = re.sub(r'[^a-zA-Z\']', '', sw).lower()
            if w_clean == s_clean:
                line_words.append(all_words[ptr])
                ptr += 1
                collected += 1
            else:
                # Skip ahead looking for match
                found = False
                for skip in range(1, 4):
                    if ptr + skip < len(all_words):
                        w2 = re.sub(r'[^a-zA-Z\']', '', all_words[ptr + skip].get("word", "")).lower()
                        if w2 == s_clean:
                            line_words.append(all_words[ptr + skip])
                            ptr = ptr + skip + 1
                            collected += 1
                            found = True
                            break
                if not found:
                    ptr += 1

        word_idx = ptr

        if line_words:
            new_lines.append({
                "en": sent,
                "words": line_words,
                "start": line_words[0]["start"],
                "end": line_words[-1]["end"],
                "zh": "",
            })
        else:
            # Fallback: use previous line's end as start
            prev_end = new_lines[-1]["end"] if new_lines else 0
            new_lines.append({
                "en": sent,
                "words": [],
                "start": prev_end,
                "end": prev_end + 3,  # rough estimate
                "zh": "",
            })

    return new_lines


def split_long_lines(lines):
    """Split lines with >30 words at clause boundaries."""
    result = []
    for line in lines:
        en = line.get("en", "")
        if len(en.split()) <= 30:
            result.append(line)
            continue

        # Try to split at clause boundaries
        sub_sentences = split_long_sentence(en)
        if len(sub_sentences) <= 1:
            result.append(line)
            continue

        # Distribute words among sub-sentences
        words = line.get("words", [])
        word_ptr = 0

        for sub in sub_sentences:
            sub_word_count = len(sub.split())
            sub_words = []

            # Grab the right number of words
            for _ in range(sub_word_count):
                if word_ptr < len(words):
                    sub_words.append(words[word_ptr])
                    word_ptr += 1

            sub_line = {
                "en": sub,
                "words": sub_words,
                "start": sub_words[0]["start"] if sub_words else line["start"],
                "end": sub_words[-1]["end"] if sub_words else line["end"],
                "zh": "",  # Will re-translate
            }
            result.append(sub_line)

    return result


def split_long_sentence(text):
    """Split a long sentence at clause boundaries."""
    words = text.split()
    if len(words) <= 30:
        return [text]

    # Try splitting at semicolons
    if ';' in text:
        parts = [p.strip() for p in text.split(';') if p.strip()]
        if all(len(p.split()) >= 3 for p in parts):
            return parts

    # Try splitting at em-dash
    if '—' in text or '--' in text:
        parts = re.split(r'\s*[—]\s*|\s*--\s*', text)
        parts = [p.strip() for p in parts if p.strip()]
        if all(len(p.split()) >= 3 for p in parts):
            return parts

    # Try splitting at comma + conjunction
    conjunctions = r'\b(?:and|but|or|so|because|although|when|while|if|which|where|who)\b'
    # Find best split point near the middle
    mid = len(words) // 2
    best_split = None
    best_dist = 999

    # Search for ", conjunction" patterns
    for m in re.finditer(r',\s+(' + conjunctions + r')', text):
        pos = len(text[:m.start()].split())
        dist = abs(pos - mid)
        if dist < best_dist and pos >= 5 and len(words) - pos >= 5:
            best_dist = dist
            best_split = m.start()

    if best_split is not None:
        part1 = text[:best_split + 1].strip()  # Keep the comma
        part2 = text[best_split + 1:].strip()
        # Capitalize part2
        if part2 and part2[0].islower():
            part2 = part2[0].upper() + part2[1:]
        return [part1, part2]

    # Last resort: split near middle at any comma
    for m in re.finditer(r',\s+', text):
        pos = len(text[:m.start()].split())
        dist = abs(pos - mid)
        if dist < best_dist and pos >= 5 and len(words) - pos >= 5:
            best_dist = dist
            best_split = m.start()

    if best_split is not None:
        part1 = text[:best_split + 1].strip()
        part2 = text[best_split + 1:].strip()
        if part2 and part2[0].islower():
            part2 = part2[0].upper() + part2[1:]
        return [part1, part2]

    return [text]  # Can't split


def merge_short_lines(lines):
    """Merge lines with < 3 words into adjacent lines."""
    if len(lines) <= 1:
        return lines

    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        en = line.get("en", "").strip()
        word_count = len(en.split()) if en else 0

        if word_count < 3 and len(lines) > 1:
            # Try to merge with previous line
            if result:
                prev = result[-1]
                prev["en"] = prev["en"].strip() + " " + en
                prev["words"] = prev.get("words", []) + line.get("words", [])
                prev["end"] = line.get("end", prev.get("end", 0))
                if prev.get("zh"):
                    prev["zh"] = ""  # Will re-translate merged line
                i += 1
                continue
            # Or merge with next line
            elif i + 1 < len(lines):
                next_line = copy.deepcopy(lines[i + 1])
                next_line["en"] = en + " " + next_line.get("en", "")
                next_line["words"] = line.get("words", []) + next_line.get("words", [])
                next_line["start"] = line.get("start", next_line.get("start", 0))
                next_line["zh"] = ""  # Will re-translate
                result.append(next_line)
                i += 2
                continue

        result.append(copy.deepcopy(line))
        i += 1

    return result


def translate_lines(lines, clip_idx):
    """Translate all lines in a clip using JSON format, 10 per batch."""
    log(f"  Translating {len(lines)} lines for clip {clip_idx}...")

    batch_size = 10
    for batch_start in range(0, len(lines), batch_size):
        batch_end = min(batch_start + batch_size, len(lines))
        batch = lines[batch_start:batch_end]

        items = [{"idx": i, "en": batch[i]["en"]} for i in range(len(batch))]

        system = "You are a professional English-to-Chinese translator for a podcast listening app."
        user = f"""Translate each English sentence to natural Chinese.
Output ONLY a JSON array: [{{"idx":0,"zh":"..."}},{{"idx":1,"zh":"..."}}...]
No extra text.

{json.dumps(items, ensure_ascii=False)}"""

        result = gpt_call(system, user, max_tokens=2000)
        if result:
            result = result.strip()
            # Extract JSON from possible markdown
            if result.startswith("```"):
                result = re.sub(r'^```\w*\n?', '', result)
                result = re.sub(r'\n?```$', '', result)

            try:
                translations = json.loads(result)
                for t in translations:
                    idx = t["idx"]
                    if 0 <= idx < len(batch):
                        batch[idx]["zh"] = t["zh"]
            except (json.JSONDecodeError, KeyError) as e:
                log(f"  WARNING: Batch translation parse failed: {e}")
                # Fallback: translate individually
                for j, line in enumerate(batch):
                    if not line.get("zh", "").strip():
                        zh = translate_single(line["en"])
                        if zh:
                            line["zh"] = zh

    return lines


def translate_lines_selective(lines, indices, clip_idx):
    """Translate only specific lines."""
    if not indices:
        return lines

    log(f"  Translating {len(indices)} modified lines for clip {clip_idx}...")

    # Batch the indices
    items = [{"idx": i, "en": lines[idx]["en"]} for i, idx in enumerate(indices)]

    system = "You are a professional English-to-Chinese translator for a podcast listening app."
    user = f"""Translate each English sentence to natural Chinese.
Output ONLY a JSON array: [{{"idx":0,"zh":"..."}},{{"idx":1,"zh":"..."}}...]
No extra text.

{json.dumps(items, ensure_ascii=False)}"""

    result = gpt_call(system, user, max_tokens=2000)
    if result:
        result = result.strip()
        if result.startswith("```"):
            result = re.sub(r'^```\w*\n?', '', result)
            result = re.sub(r'\n?```$', '', result)

        try:
            translations = json.loads(result)
            for t in translations:
                mapped_idx = indices[t["idx"]]
                lines[mapped_idx]["zh"] = t["zh"]
        except (json.JSONDecodeError, KeyError, IndexError) as e:
            log(f"  WARNING: Selective translation parse failed: {e}")
            for idx in indices:
                if not lines[idx].get("zh", "").strip():
                    zh = translate_single(lines[idx]["en"])
                    if zh:
                        lines[idx]["zh"] = zh

    return lines


def translate_single(en_text):
    """Translate a single line as fallback."""
    system = "Translate the following English sentence to natural Chinese. Output only the Chinese translation."
    result = gpt_call(system, en_text, max_tokens=500)
    return result.strip() if result else ""


# ── Validation report ──
def validate_clip(clip_idx, lines):
    """Run all validation rules and return report."""
    issues = []
    for i, line in enumerate(lines):
        prev = lines[i - 1] if i > 0 else None
        v = check_line(line, prev)
        if v:
            issues.append((i, v, line.get("en", "")[:80]))
    return issues


# ── Main ──
def main():
    # Load data.json
    with open(DATA_FILE, "r") as f:
        data = json.load(f)

    clips = data["clips"]
    log(f"Loaded {len(clips)} clips from {DATA_FILE}")

    # Backup
    with open(BACKUP_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log(f"Backup saved to {BACKUP_FILE}")

    # Analyze and fix each clip
    fixed_count = 0
    for idx, clip in enumerate(clips):
        lines = clip.get("lines", [])
        issue_type = classify_clip(idx, lines)

        if issue_type == "clean":
            log(f"Clip {idx} ({clip.get('title', '')}): CLEAN ✓")
            continue

        log(f"Clip {idx} ({clip.get('title', '')}): {issue_type.upper()}")

        new_lines = None
        if issue_type == "raw":
            new_lines = fix_raw_clip(idx, lines)
        elif issue_type == "split":
            new_lines = fix_split_clip(idx, lines)
        elif issue_type == "minor":
            new_lines = fix_minor_clip(idx, lines)

        if new_lines:
            clip["lines"] = new_lines
            fixed_count += 1

    # Final validation
    log("\n=== FINAL VALIDATION ===")
    all_pass = True
    for idx, clip in enumerate(clips):
        lines = clip.get("lines", [])
        issues = validate_clip(idx, lines)
        if issues:
            all_pass = False
            log(f"Clip {idx} ({clip.get('title', '')}): {len(issues)} issues remain")
            for line_idx, rules, text in issues[:5]:
                log(f"  Line {line_idx} [{','.join(rules)}]: {text}")
        else:
            log(f"Clip {idx}: PASS ✓")

    # Save
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log(f"\nSaved to {DATA_FILE} ({fixed_count} clips fixed)")

    if not all_pass:
        log("WARNING: Some clips still have issues. Review the output above.")


if __name__ == "__main__":
    main()
