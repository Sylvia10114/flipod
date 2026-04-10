#!/usr/bin/env python3
"""
Fix clips 1-5: re-transcribe from full raw audio, extend to 60-90s with
natural narrative endpoints, re-cut, translate, CEFR annotate.
Output to output/clip_fix/
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# ── Config (from podcast_agent.py) ──
AZURE_ENDPOINT = os.environ.get("AZURE_ENDPOINT", "https://us-east-02-gpt-01.openai.azure.com")
AZURE_API_KEY = os.environ["AZURE_API_KEY"]
WHISPER_DEPLOYMENT = "whisper0614"
WHISPER_API_VERSION = "2024-06-01"
GPT_DEPLOYMENT = "gpt-5.4-global-01"
GPT_API_VERSION = "2024-10-21"
FFMPEG = "/opt/homebrew/bin/ffmpeg"

BASE_DIR = Path(__file__).parent
RAW_DIR = BASE_DIR / "raw"
OUT_DIR = BASE_DIR / "output" / "clip_fix"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Clip definitions: map clip# to raw audio + approximate start in full audio ──
CLIP_MAP = {
    1: {
        "raw": "planet_money.mp3",
        "transcript_cache": "words_planet_money_v2.json",
        "anchor_text": "Brad is 70, retired in West Palm Beach",
        "title": "穿着巧克力衬衫的70岁老人",
        "source": {"podcast": "Planet Money", "episode": "NPR"},
        "tag": "business",
    },
    2: {
        "raw": "ted_full.mp3",
        "transcript_cache": None,  # needs transcription
        "anchor_text": "My cousin and I met when we were 16",
        "title": "她用鼻子诊断了一种病",
        "source": {"podcast": "TED Talks Daily", "episode": ""},
        "tag": "science",
    },
    3: {
        "raw": "moth_full_new.mp3",
        "transcript_cache": None,  # needs fresh transcription from full episode
        "anchor_text": "I remember my first cigarette",
        "title": "第一支烟和最后一支烟",
        "source": {"podcast": "The Moth", "episode": "Resolutions"},
        "tag": "story",
    },
    4: {
        "raw": "hidden_full.mp3",
        "transcript_cache": "words_hidden_full_v2.json",
        "anchor_text": "It happens all the time",
        "title": "被债务淹没的体面人生",
        "source": {"podcast": "Hidden Brain", "episode": ""},
        "tag": "psychology",
    },
    5: {
        "raw": "planet_money.mp3",
        "transcript_cache": "words_planet_money_v2.json",
        "anchor_text": "he heard that the Hershey",
        "title": "他咬了一口，吐了出来",
        "source": {"podcast": "Planet Money", "episode": "NPR"},
        "tag": "science",
    },
}

# ── CEFR word list ──
CEFR_CACHE_FILE = BASE_DIR / "cefr_wordlist.json"


def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


# ── Whisper transcription via curl ──
def whisper_transcribe(audio_path):
    """Transcribe audio with word+segment timestamps via Azure Whisper API (curl)."""
    url = (f"{AZURE_ENDPOINT}/openai/deployments/{WHISPER_DEPLOYMENT}"
           f"/audio/transcriptions?api-version={WHISPER_API_VERSION}")

    out_file = str(OUT_DIR / f"whisper_{Path(audio_path).stem}.json")

    cmd = [
        "curl", "-s", "-X", "POST", url,
        "-H", f"api-key: {AZURE_API_KEY}",
        "-F", f"file=@{audio_path}",
        "-F", "response_format=verbose_json",
        "-F", "timestamp_granularities[]=word",
        "-F", "timestamp_granularities[]=segment",
        "--max-time", "120",
    ]

    log(f"  Whisper transcribing {Path(audio_path).name}...")
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    elapsed = time.time() - t0

    if result.returncode != 0:
        log(f"  ERROR: Whisper curl failed: {result.stderr[:200]}")
        return None

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        log(f"  ERROR: Whisper returned invalid JSON: {result.stdout[:200]}")
        return None

    if "error" in data:
        log(f"  ERROR: Whisper API error: {data['error']}")
        return None

    word_count = len(data.get("words", []))
    seg_count = len(data.get("segments", []))
    log(f"  Whisper done in {elapsed:.1f}s: {word_count} words, {seg_count} segments")

    # Cache to file
    with open(out_file, "w") as f:
        json.dump(data, f, indent=2)

    return data


# ── GPT call via curl ──
def gpt_call(system_prompt, user_prompt, max_tokens=2000):
    """Call Azure GPT via curl subprocess."""
    url = (f"{AZURE_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
           f"/chat/completions?api-version={GPT_API_VERSION}")

    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_completion_tokens": max_tokens,  # GPT-5.4 uses this, not max_tokens
        "temperature": 0.3,
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


# ── Find optimal cut point using GPT ──
def find_cut_point(transcript_data, anchor_text, clip_num, full_audio_duration):
    """Given full transcript, find optimal start/end for a 60-90s clip."""
    segments = transcript_data.get("segments", [])
    words = transcript_data.get("words", [])

    # Find anchor segment
    full_text = " ".join(s["text"].strip() for s in segments)
    anchor_lower = anchor_text.lower()

    # Find which segment contains the anchor
    anchor_seg_idx = -1
    for i, seg in enumerate(segments):
        if anchor_lower in seg["text"].lower():
            anchor_seg_idx = i
            break

    if anchor_seg_idx == -1:
        # Try fuzzy: first few words
        anchor_words = anchor_lower.split()[:4]
        for i, seg in enumerate(segments):
            if all(w in seg["text"].lower() for w in anchor_words):
                anchor_seg_idx = i
                break

    if anchor_seg_idx == -1:
        log(f"  WARNING: Could not find anchor text in transcript, using start")
        anchor_seg_idx = 0

    anchor_start = segments[anchor_seg_idx]["start"]
    log(f"  Anchor found at segment {anchor_seg_idx}, time {anchor_start:.1f}s")

    # Collect text from anchor onwards (up to 120s worth)
    context_segs = []
    for seg in segments[anchor_seg_idx:]:
        if seg["start"] - anchor_start > 150:
            break
        context_segs.append(seg)

    context_text = "\n".join(
        f"[{s['start']:.1f}-{s['end']:.1f}] {s['text'].strip()}"
        for s in context_segs
    )

    prompt = f"""I have a podcast transcript segment. The clip currently starts at the line containing "{anchor_text}" (timestamp {anchor_start:.1f}s).

I need to find the BEST END POINT for this clip so that:
1. Total duration is 60-90 seconds (end time should be between {anchor_start + 60:.1f}s and {anchor_start + 90:.1f}s)
2. The clip ends at a natural narrative conclusion — a completed thought, emotional beat, punchline, or revelation
3. Do NOT cut mid-sentence or mid-thought
4. If this is a story, include at least one narrative turning point

The full audio is {full_audio_duration:.0f}s long. Available text from anchor point:

{context_text}

Also determine the best START POINT. It should begin 0-5 seconds before the anchor text for context, but not include unrelated content (ads, host intros, etc.).

Respond in EXACTLY this JSON format:
{{"start": <float>, "end": <float>, "reason": "<brief explanation of why this is a good cut point>"}}"""

    response = gpt_call(
        "You are an expert podcast editor. Find optimal clip boundaries for engaging 60-90 second listening clips.",
        prompt,
        max_tokens=500,
    )

    if not response:
        # Fallback: just take anchor_start to anchor_start + 75s
        return anchor_start, min(anchor_start + 75, full_audio_duration)

    try:
        # Extract JSON from response
        json_match = re.search(r'\{[^{}]+\}', response)
        if json_match:
            cut = json.loads(json_match.group())
            start = float(cut["start"])
            end = float(cut["end"])
            reason = cut.get("reason", "")
            log(f"  GPT cut point: {start:.1f}-{end:.1f}s ({end-start:.1f}s) — {reason}")
            return start, end
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        log(f"  WARNING: Could not parse GPT response: {e}")

    return anchor_start, min(anchor_start + 75, full_audio_duration)


# ── Snap to word boundaries ──
def snap_to_word_boundary(words, target_time, direction="before"):
    """Find the nearest word boundary to target_time."""
    if not words:
        return target_time

    best = None
    best_diff = float("inf")

    for w in words:
        if direction == "before":
            t = w["start"]
            diff = abs(t - target_time)
            if t <= target_time + 0.1 and diff < best_diff:
                best = t
                best_diff = diff
        else:  # "after"
            t = w["end"]
            diff = abs(t - target_time)
            if t >= target_time - 0.1 and diff < best_diff:
                best = t
                best_diff = diff

    return best if best is not None else target_time


# ── Cut audio with ffmpeg ──
def cut_audio(input_path, output_path, start, end):
    """Cut audio segment with 0.3s fade in/out."""
    duration = end - start
    fade_out_start = max(0, duration - 0.3)

    cmd = [
        FFMPEG, "-y",
        "-ss", f"{start:.3f}",
        "-t", f"{duration:.3f}",
        "-i", str(input_path),
        "-af", f"afade=t=in:st=0:d=0.3,afade=t=out:st={fade_out_start:.3f}:d=0.3",
        "-c:a", "libmp3lame", "-q:a", "4",
        str(output_path),
    ]

    log(f"  Cutting audio: {start:.1f}-{end:.1f}s ({duration:.1f}s)")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        log(f"  ERROR: ffmpeg failed: {result.stderr[:200]}")
        return False
    return True


# ── Build sentence lines from segments + word timestamps ──
def build_lines(segments, words, clip_start, clip_end):
    """
    Build sentence-level lines with word timestamps.
    Uses segment text (has punctuation) for sentence splitting,
    then maps word timestamps via greedy alignment.
    """
    # Collect segments that have meaningful overlap with clip range
    # A segment must have at least 50% of its duration inside the clip range
    clip_segs = []
    for seg in segments:
        seg_start = max(seg["start"], clip_start)
        seg_end = min(seg["end"], clip_end)
        overlap = seg_end - seg_start
        seg_dur = seg["end"] - seg["start"]
        if overlap > 0 and (overlap / seg_dur > 0.3 or overlap > 2.0):
            clip_segs.append(seg)

    # Collect words within clip range (±0.1s boundary for tolerance)
    clip_words = []
    for w in words:
        if w["start"] >= clip_start - 0.1 and w["end"] <= clip_end + 0.1:
            clip_words.append(w)

    log(f"  build_lines: {len(clip_segs)} segments, {len(clip_words)} words in range")

    # Split segment text into sentences by punctuation
    full_text = " ".join(s["text"].strip() for s in clip_segs)
    # Split on sentence-ending punctuation
    raw_sentences = re.split(r'(?<=[.!?])\s+', full_text.strip())
    sentences = [s.strip() for s in raw_sentences if s.strip()]

    if not sentences:
        return []

    log(f"  Sentences: {len(sentences)}")

    # Greedy-map words to sentences
    lines = []
    word_ptr = 0

    for sent in sentences:
        # Normalize sentence words for matching
        sent_words_text = re.findall(r"[A-Za-z0-9']+", sent.lower())
        if not sent_words_text:
            continue

        matched_words = []
        temp_ptr = word_ptr

        for sw in sent_words_text:
            # Find this word in the word list starting from temp_ptr
            found = False
            # Search up to 30 words ahead (handles gaps from Whisper)
            search_end = min(temp_ptr + 30, len(clip_words))
            for j in range(temp_ptr, search_end):
                wt = re.sub(r'[^a-z0-9\']', '', clip_words[j]["word"].lower())
                if wt == sw or sw.startswith(wt) or wt.startswith(sw):
                    matched_words.append(clip_words[j])
                    temp_ptr = j + 1
                    found = True
                    break
            if not found:
                # Even broader fuzzy search
                for j in range(temp_ptr, min(temp_ptr + 50, len(clip_words))):
                    wt = re.sub(r'[^a-z0-9\']', '', clip_words[j]["word"].lower())
                    if wt == sw or sw in wt or wt in sw:
                        matched_words.append(clip_words[j])
                        temp_ptr = j + 1
                        found = True
                        break

        # Require at least 40% of sentence words to be matched
        match_ratio = len(matched_words) / len(sent_words_text) if sent_words_text else 0
        if matched_words and match_ratio >= 0.4:
            word_ptr = temp_ptr
            line_start = matched_words[0]["start"] - clip_start
            line_end = matched_words[-1]["end"] - clip_start

            word_data = []
            for mw in matched_words:
                word_data.append({
                    "word": mw["word"],
                    "start": round(mw["start"] - clip_start, 2),
                    "end": round(mw["end"] - clip_start, 2),
                })

            lines.append({
                "en": sent,
                "zh": "",  # filled later
                "start": round(max(0, line_start), 2),
                "end": round(line_end, 2),
                "words": word_data,
            })
        else:
            log(f"  SKIP sentence (matched {len(matched_words)}/{len(sent_words_text)}): {sent[:60]}...")

    return lines


# ── CEFR annotation ──
def load_cefr_wordlist():
    """Load cached CEFR word list."""
    if CEFR_CACHE_FILE.exists():
        with open(CEFR_CACHE_FILE) as f:
            return json.load(f)
    return {}


def annotate_cefr(lines, cefr_dict):
    """Add CEFR level to each word in lines."""
    unknown_words = set()

    for line in lines:
        for w in line.get("words", []):
            word_lower = re.sub(r'[^a-z\']', '', w["word"].lower())
            if word_lower in cefr_dict:
                w["cefr"] = cefr_dict[word_lower]
            elif len(word_lower) > 2:
                unknown_words.add(word_lower)

    # Batch-query unknown words via GPT
    if unknown_words:
        unknown_list = sorted(unknown_words)[:50]  # cap at 50
        prompt = f"""Assign CEFR levels (A1/A2/B1/B2/C1/C2) to these English words.
Return JSON array: [{{"word":"...", "cefr":"..."}}]

Words: {json.dumps(unknown_list)}"""

        response = gpt_call(
            "You are a CEFR vocabulary expert. Assign accurate CEFR levels.",
            prompt,
            max_tokens=2000,
        )

        if response:
            try:
                json_match = re.search(r'\[.*\]', response, re.DOTALL)
                if json_match:
                    results = json.loads(json_match.group())
                    new_entries = {}
                    for r in results:
                        w = r.get("word", "").lower()
                        c = r.get("cefr", "B1").upper()
                        if w and c in ("A1", "A2", "B1", "B2", "C1", "C2"):
                            new_entries[w] = c

                    # Apply to lines
                    for line in lines:
                        for w in line.get("words", []):
                            word_lower = re.sub(r'[^a-z\']', '', w["word"].lower())
                            if "cefr" not in w and word_lower in new_entries:
                                w["cefr"] = new_entries[word_lower]

                    # Update cache
                    cefr_dict.update(new_entries)
                    with open(CEFR_CACHE_FILE, "w") as f:
                        json.dump(cefr_dict, f)
                    log(f"  CEFR: added {len(new_entries)} new words to cache")
            except Exception as e:
                log(f"  WARNING: CEFR batch failed: {e}")

    # Default remaining to B1
    for line in lines:
        for w in line.get("words", []):
            if "cefr" not in w:
                w["cefr"] = "B1"


# ── Translation ──
def translate_lines(lines):
    """Translate English lines to Chinese using JSON format in batches of 10."""
    batch_size = 10

    for i in range(0, len(lines), batch_size):
        batch = lines[i:i + batch_size]
        items = [{"idx": j, "en": line["en"]} for j, line in enumerate(batch)]

        prompt = f"""Translate these English sentences to natural Chinese.
Return JSON array: [{{"idx": 0, "zh": "..."}}]

{json.dumps(items, ensure_ascii=False)}"""

        response = gpt_call(
            "You are a professional English-Chinese translator. Translate naturally, not word-by-word.",
            prompt,
            max_tokens=2000,
        )

        if response:
            try:
                json_match = re.search(r'\[.*\]', response, re.DOTALL)
                if json_match:
                    results = json.loads(json_match.group())
                    result_map = {r["idx"]: r["zh"] for r in results}
                    for j, line in enumerate(batch):
                        if j in result_map:
                            line["zh"] = result_map[j]
                        else:
                            log(f"  WARNING: Missing translation for idx {j}")
                            # Fallback: translate individually
                            _translate_single(line)
                    continue
            except Exception as e:
                log(f"  WARNING: Batch translation failed: {e}, falling back to per-sentence")

        # Fallback: translate each sentence individually
        for line in batch:
            _translate_single(line)


def _translate_single(line):
    """Fallback: translate a single line."""
    response = gpt_call(
        "Translate this English sentence to natural Chinese. Return ONLY the Chinese text.",
        line["en"],
        max_tokens=200,
    )
    if response:
        line["zh"] = response.strip()
    else:
        line["zh"] = "[翻译失败]"


# ── Main processing ──
def process_clip(clip_num, clip_info):
    """Process a single clip: transcribe, find cut point, cut audio, build lines, translate."""
    log(f"\n{'='*60}")
    log(f"Processing Clip {clip_num}: {clip_info['title']}")
    log(f"{'='*60}")

    raw_path = RAW_DIR / clip_info["raw"]
    if not raw_path.exists():
        log(f"  ERROR: Raw audio not found: {raw_path}")
        return None

    # Get full audio duration
    dur_cmd = [FFMPEG, "-i", str(raw_path), "-hide_banner"]
    dur_result = subprocess.run(dur_cmd, capture_output=True, text=True)
    dur_match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", dur_result.stderr)
    if dur_match:
        h, m, s = dur_match.groups()
        full_duration = int(h) * 3600 + int(m) * 60 + float(s)
    else:
        full_duration = 120
    log(f"  Raw audio duration: {full_duration:.1f}s")

    # Step 1: Get transcript with word+segment timestamps
    transcript = None
    if clip_info["transcript_cache"]:
        cache_path = RAW_DIR / clip_info["transcript_cache"]
        if cache_path.exists():
            with open(cache_path) as f:
                transcript = json.load(f)
            log(f"  Using cached transcript: {clip_info['transcript_cache']}")

    if not transcript:
        transcript = whisper_transcribe(str(raw_path))
        if not transcript:
            log(f"  FATAL: Transcription failed for clip {clip_num}")
            return None
        # Save as cache
        cache_name = f"words_{Path(clip_info['raw']).stem}_v2.json"
        with open(RAW_DIR / cache_name, "w") as f:
            json.dump(transcript, f, indent=2)
        log(f"  Saved transcript cache: {cache_name}")

    words = transcript.get("words", [])
    segments = transcript.get("segments", [])

    if not words:
        log(f"  ERROR: No word-level timestamps in transcript")
        return None

    log(f"  Transcript: {len(words)} words, {len(segments)} segments")

    # Step 2: Find optimal cut point
    start, end = find_cut_point(
        transcript, clip_info["anchor_text"], clip_num, full_duration
    )

    # Snap to word boundaries
    start = snap_to_word_boundary(words, start, "before")
    end = snap_to_word_boundary(words, end, "after")
    duration = end - start

    log(f"  Final cut: {start:.2f}-{end:.2f}s ({duration:.1f}s)")

    if duration < 50:
        log(f"  WARNING: Duration {duration:.1f}s is below 60s minimum")
    if duration > 95:
        log(f"  WARNING: Duration {duration:.1f}s exceeds 90s target, capping to ~90s")
        end = start + 90
        end = snap_to_word_boundary(words, end, "after")
        duration = end - start

    # Step 3: Cut audio
    out_audio = OUT_DIR / f"clip{clip_num}.mp3"
    if not cut_audio(raw_path, out_audio, start, end):
        return None

    # Step 4: Build sentence lines with word timestamps
    lines = build_lines(segments, words, start, end)
    log(f"  Built {len(lines)} lines")

    if not lines:
        log(f"  ERROR: No lines generated")
        return None

    # Step 5: Translate
    log(f"  Translating {len(lines)} lines...")
    translate_lines(lines)
    translated = sum(1 for l in lines if l["zh"] and l["zh"] != "[翻译失败]")
    log(f"  Translated: {translated}/{len(lines)}")

    # Step 6: CEFR annotation
    log(f"  Annotating CEFR levels...")
    cefr_dict = load_cefr_wordlist()
    annotate_cefr(lines, cefr_dict)

    # Build clip data
    clip_data = {
        "title": clip_info["title"],
        "source": clip_info["source"],
        "tag": clip_info["tag"],
        "audio": f"clip{clip_num}.mp3",
        "lines": lines,
    }

    # Validation
    total_words = sum(len(l.get("words", [])) for l in lines)
    cefr_covered = sum(1 for l in lines for w in l.get("words", []) if "cefr" in w)
    log(f"  Validation: {len(lines)} lines, {total_words} words, {cefr_covered}/{total_words} CEFR")
    log(f"  Duration: {lines[-1]['end']:.1f}s, translated: {translated}/{len(lines)}")

    return clip_data


def main():
    log("=" * 60)
    log("Clip Quality Fix: clips 1-5")
    log("=" * 60)

    t_start = time.time()
    results = {}

    for clip_num in [1, 2, 3, 4, 5]:
        clip_info = CLIP_MAP[clip_num]
        result = process_clip(clip_num, clip_info)
        if result:
            results[clip_num] = result
        else:
            log(f"  FAILED: Clip {clip_num}")

    # Save results — merge with existing
    output_file = OUT_DIR / "fixed_clips.json"
    existing = {}
    if output_file.exists():
        with open(output_file) as f:
            existing = json.load(f).get("clips", {})
    existing.update({str(k): v for k, v in results.items()})
    with open(output_file, "w") as f:
        json.dump({"clips": existing}, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - t_start
    log(f"\n{'='*60}")
    log(f"Done in {elapsed:.0f}s. Fixed {len(results)}/5 clips.")
    log(f"Output: {output_file}")
    log(f"Audio: {OUT_DIR}/clip*.mp3")
    log(f"{'='*60}")

    # Summary
    for n, d in results.items():
        lines = d["lines"]
        dur = lines[-1]["end"] if lines else 0
        log(f"  clip{n}: {dur:.1f}s, {len(lines)} lines — {d['title']}")


if __name__ == "__main__":
    main()
