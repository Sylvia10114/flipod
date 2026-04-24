#!/usr/bin/env python3
"""
Batch-backfill stage-tagged listening questions for existing clips.

Goal:
  Ensure every clip has 4 questions aligned to practice stages:
    - stage 0: preview / prediction
    - stage 1: gist
    - stage 2: decode
    - stage 3: deep listening / fade

Important:
  - Never writes back to data.json directly.
  - Writes a full merged dataset to an output file for later review / manual merge.
  - Uses curl subprocess for GPT calls (macOS Python SSL issues; see AGENTS.md).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "data.json"
DEFAULT_OUTPUT = ROOT / "output" / "question_backfill_data.json"


def log(message: str) -> None:
    print(message, flush=True)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def load_env_files(extra_path: Path | None = None) -> None:
    if extra_path is not None:
        load_env_file(extra_path)
    for path in (ROOT / ".env", ROOT / ".dev.vars"):
        load_env_file(path)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"❌ Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def call_gpt(messages: list[dict[str, str]], *, temperature: float = 0.3, max_completion_tokens: int = 2200) -> str | None:
    endpoint = require_env("AZURE_OPENAI_ENDPOINT")
    api_key = require_env("AZURE_OPENAI_API_KEY")
    deployment = (
        os.environ.get("AZURE_OPENAI_DEPLOYMENT")
        or os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME")
        or "gpt-5-chat-global-01"
    )
    api_version = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")

    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"
    payload = json.dumps(
        {
            "messages": messages,
            "temperature": temperature,
            "max_completion_tokens": max_completion_tokens,
        },
        ensure_ascii=False,
    )

    for attempt in range(3):
        try:
            result = subprocess.run(
                [
                    "curl",
                    "-s",
                    "-X",
                    "POST",
                    url,
                    "-H",
                    f"api-key: {api_key}",
                    "-H",
                    "Content-Type: application/json",
                    "-d",
                    payload,
                    "--connect-timeout",
                    "15",
                    "--max-time",
                    "180",
                ],
                capture_output=True,
                text=True,
                timeout=190,
            )
        except Exception as exc:
            log(f"  [warn] GPT request failed on attempt {attempt + 1}/3: {exc}")
            time.sleep(3)
            continue

        if result.returncode != 0:
            log(f"  [warn] curl failed on attempt {attempt + 1}/3: {result.stderr[:200]}")
            time.sleep(3)
            continue

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            log(f"  [warn] non-JSON response on attempt {attempt + 1}/3")
            time.sleep(3)
            continue

        if "error" in data:
            log(f"  [warn] API error on attempt {attempt + 1}/3: {data['error'].get('message', '')[:240]}")
            time.sleep(3)
            continue

        try:
            return data["choices"][0]["message"]["content"]
        except Exception:
            log(f"  [warn] malformed completion payload on attempt {attempt + 1}/3")
            time.sleep(3)
            continue

    return None


def strip_markdown_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def strip_trailing_commas(text: str) -> str:
    return re.sub(r",(\s*[\]}])", r"\1", text)


def parse_json_payload(text: str) -> Any:
    if not text:
        return None
    cleaned = strip_markdown_fences(text)
    for candidate in (cleaned, strip_trailing_commas(cleaned)):
        try:
            return json.loads(candidate)
        except Exception:
            pass

    match = re.search(r"\[[\s\S]*\]", cleaned)
    if match:
        chunk = match.group(0)
        for candidate in (chunk, strip_trailing_commas(chunk)):
            try:
                return json.loads(candidate)
            except Exception:
                pass
    return None


def normalize_answer(value: Any) -> str:
    text = str(value or "").strip().upper()
    if re.fullmatch(r"[A-D]", text):
        return text
    if re.fullmatch(r"[1-4]", text):
        return chr(ord("A") + int(text) - 1)
    return text


def normalize_question_item(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "stage": int(raw.get("stage", -1)),
        "question": str(raw.get("question", "")).strip(),
        "options": [str(option).strip() for option in (raw.get("options") or []) if str(option).strip()],
        "answer": normalize_answer(raw.get("answer")),
        "explanation_zh": str(raw.get("explanation_zh", "")).strip(),
    }


def existing_stage_map(clip: dict[str, Any]) -> dict[int, dict[str, Any]]:
    stage_map: dict[int, dict[str, Any]] = {}
    for question in clip.get("questions") or []:
        if isinstance(question, dict) and isinstance(question.get("stage"), int):
            stage_map[int(question["stage"])] = question
    return stage_map


def clip_has_full_stage_set(clip: dict[str, Any]) -> bool:
    stage_map = existing_stage_map(clip)
    return set(stage_map.keys()) >= {0, 1, 2, 3}


def infer_preview_keywords(clip: dict[str, Any], limit: int = 3) -> list[str]:
    words: list[str] = []

    priming = clip.get("priming") or {}
    for item in priming.get("words") or []:
        word = str(item.get("word", "")).strip()
        if word and word.lower() not in {w.lower() for w in words}:
            words.append(word)
        if len(words) >= limit:
            return words

    collocations = clip.get("collocations") or []
    for item in collocations:
        token = str(item).strip()
        if token and token.lower() not in {w.lower() for w in words}:
            words.append(token)
        if len(words) >= limit:
            return words

    for line in clip.get("lines") or []:
        for item in line.get("words") or []:
            token = str(item.get("word", "")).strip()
            cefr = str(item.get("cefr", "")).upper()
            if not token or token.lower() in {w.lower() for w in words}:
                continue
            if not re.search(r"[A-Za-z]", token):
                continue
            if cefr in {"B1", "B2", "C1", "C2"} or len(token) >= 7:
                words.append(token)
            if len(words) >= limit:
                return words

    return words[:limit]


def build_prompt(clip: dict[str, Any], clip_index: int) -> list[dict[str, str]]:
    title = str(clip.get("title", "")).strip()
    tag = str(clip.get("tag", "")).strip()
    takeaway = str(clip.get("info_takeaway", "")).strip()
    source = clip.get("source") or {}
    podcast = source.get("podcast", "") if isinstance(source, dict) else str(source)
    duration = clip.get("duration") or clip.get("duration_sec") or ""
    keywords = infer_preview_keywords(clip)
    transcript_en = "\n".join(f"[{idx}] {line.get('en', '').strip()}" for idx, line in enumerate(clip.get("lines") or []))
    transcript_zh = "\n".join(f"[{idx}] {line.get('zh', '').strip()}" for idx, line in enumerate(clip.get("lines") or []))

    system = """You are designing listening-comprehension questions for Flipod.

Return EXACTLY 4 stage-tagged multiple-choice questions for ONE podcast clip.

Stages:
- stage 0 = preview / prediction question shown before listening
- stage 1 = gist question shown after the first full listen
- stage 2 = decode question shown after the English-transcript step
- stage 3 = deep listening question shown after the fade step

Rules:
1. Return exactly 4 JSON objects in an array, one for each stage 0, 1, 2, 3.
2. Each question must have:
   - stage (0/1/2/3)
   - question
   - options (exactly 4 items, prefixed A./B./C./D.)
   - answer (A/B/C/D)
   - explanation_zh (brief Chinese explanation of why the answer is correct)
3. Questions and options must be in English.
4. explanation_zh must be in Simplified Chinese.
5. All questions must be answerable from the clip content. Do not require outside knowledge.
6. Stage 0 should feel like a prediction prompt based on title/topic/keywords, but the correct answer must still match the real clip.
7. Stage 1 must test overall gist / main point.
8. Stage 2 must test an important detail, relationship, cause, comparison, or attitude that becomes clearer after careful decoding.
9. Stage 3 must test a deeper detail or inference suitable for the fade/deep-listening step.
10. Keep distractors plausible and close to the clip, but wrong.
11. Do not output markdown. Output JSON only.
"""

    user = f"""Clip #{clip_index + 1}
Title: {title}
Podcast: {podcast}
Tag: {tag}
Duration: {duration}
Info takeaway: {takeaway}
Preview keywords: {", ".join(keywords) if keywords else "(none)"}

Transcript (English):
{transcript_en}

Transcript (Chinese):
{transcript_zh}
"""

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def validate_generated_questions(raw_questions: Any) -> tuple[list[dict[str, Any]] | None, list[str]]:
    errors: list[str] = []
    if not isinstance(raw_questions, list):
        return None, ["response is not a JSON array"]

    normalized = [normalize_question_item(item) for item in raw_questions if isinstance(item, dict)]
    if len(normalized) != 4:
        errors.append(f"expected 4 questions, got {len(normalized)}")
        return None, errors

    stage_set = {item["stage"] for item in normalized}
    if stage_set != {0, 1, 2, 3}:
        errors.append(f"expected stages {{0,1,2,3}}, got {sorted(stage_set)}")

    seen_stages: set[int] = set()
    for item in normalized:
        stage = item["stage"]
        if stage in seen_stages:
            errors.append(f"duplicate stage {stage}")
        seen_stages.add(stage)
        if not item["question"]:
            errors.append(f"stage {stage}: missing question")
        if len(item["options"]) != 4:
            errors.append(f"stage {stage}: expected 4 options, got {len(item['options'])}")
        if item["answer"] not in {"A", "B", "C", "D"}:
            errors.append(f"stage {stage}: invalid answer {item['answer']!r}")
        if not item["explanation_zh"]:
            errors.append(f"stage {stage}: missing explanation_zh")

    normalized.sort(key=lambda item: item["stage"])
    return (normalized if not errors else None), errors


def generate_stage_questions(clip: dict[str, Any], clip_index: int) -> list[dict[str, Any]]:
    last_errors: list[str] = []
    last_raw = None
    for attempt in range(3):
        messages = build_prompt(clip, clip_index)
        if attempt and last_errors:
            messages.append(
                {
                    "role": "user",
                    "content": "Fix the previous output. Problems:\n- " + "\n- ".join(last_errors),
                }
            )
        response = call_gpt(messages, temperature=0.35, max_completion_tokens=2600)
        if not response:
            last_errors = ["empty response"]
            continue
        parsed = parse_json_payload(response)
        last_raw = parsed
        normalized, errors = validate_generated_questions(parsed)
        if normalized is not None:
            return normalized
        last_errors = errors

    raise RuntimeError(f"question generation failed after retries: {last_errors}; raw={last_raw!r}")


def build_clip_key(clip: dict[str, Any], index: int) -> str:
    source = clip.get("source") or {}
    podcast = source.get("podcast", "") if isinstance(source, dict) else str(source)
    episode = source.get("episode", "") if isinstance(source, dict) else ""
    return "|".join(
        [
            str(clip.get("id", index)),
            podcast,
            episode,
            str(clip.get("title", "")).strip(),
        ]
    )


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def load_dataset(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def summarize_dataset(clips: list[dict[str, Any]]) -> str:
    total = len(clips)
    complete = sum(1 for clip in clips if clip_has_full_stage_set(clip))
    return f"{complete}/{total} clips already have stage 0-3 questions"


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill stage 0-3 questions for existing clips.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--env-file", type=Path, default=None, help="Optional env file with Azure GPT settings.")
    parser.add_argument("--limit", type=int, default=0, help="Process at most N clips that need backfill (0 = all).")
    parser.add_argument("--offset", type=int, default=0, help="Skip the first N clips before processing.")
    parser.add_argument("--only", type=str, default="", help="Comma-separated 0-based clip indexes to process.")
    parser.add_argument("--overwrite-complete", action="store_true", help="Regenerate even if a clip already has stage 0-3 questions.")
    parser.add_argument("--resume", action="store_true", help="Resume from output file if it already exists.")
    parser.add_argument("--report-only", action="store_true", help="Only report how many clips need backfill.")
    args = parser.parse_args()

    load_env_files(args.env_file)

    source_path = args.output if args.resume and args.output.exists() else args.input
    data = load_dataset(source_path)
    clips = list(data.get("clips") or [])

    log(f"Loaded {len(clips)} clips from {source_path}")
    log(summarize_dataset(clips))

    if args.report_only:
        return

    if args.only:
        only_indexes = {int(item.strip()) for item in args.only.split(",") if item.strip()}
    else:
        only_indexes = None

    processed = 0
    skipped = 0
    failures: list[str] = []

    for clip_index, clip in enumerate(clips):
        if clip_index < args.offset:
            continue
        if only_indexes is not None and clip_index not in only_indexes:
            continue
        if not args.overwrite_complete and clip_has_full_stage_set(clip):
            skipped += 1
            continue

        log(f"\n== clip {clip_index + 1}/{len(clips)} == {clip.get('title', '')}")
        try:
            clip["questions"] = generate_stage_questions(clip, clip_index)
            processed += 1
            log(f"  ✅ generated stages {[q['stage'] for q in clip['questions']]}")
        except Exception as exc:
            failures.append(f"clip {clip_index}: {exc}")
            log(f"  ❌ failed: {exc}")

        if args.limit and processed >= args.limit:
            break

        ensure_parent(args.output)
        args.output.write_text(json.dumps({**data, "clips": clips}, ensure_ascii=False, indent=2))

    ensure_parent(args.output)
    args.output.write_text(json.dumps({**data, "clips": clips}, ensure_ascii=False, indent=2))
    log(f"\nWrote merged dataset to {args.output}")
    log(f"Processed: {processed}")
    log(f"Skipped (already complete): {skipped}")
    if failures:
        log(f"Failures: {len(failures)}")
        for item in failures[:20]:
            log(f"  - {item}")


if __name__ == "__main__":
    main()
