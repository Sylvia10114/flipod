#!/usr/bin/env python3
"""Selective repair + retranslation for existing clips in data.json.

This script is meant for legacy clips that already exist in the library.
It applies conservative line-boundary repair for awkward fragments, then
retranslates the full clip with the latest context-aware prompt from
scripts/agent/translate.py.

By default it writes to output/retranslated_clips.json instead of mutating
data.json in place.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from agent import config
from agent.output import repair_boundary_lines
from agent.translate import translate_lines
from agent.utils import call_gpt

DEFAULT_INPUT = ROOT / "data.json"
DEFAULT_OUTPUT = ROOT / "output" / "retranslated_clips.json"
DEFAULT_REPORT = ROOT / "output" / "retranslated_clips.report.json"


def log(msg: str) -> None:
    print(f"[retranslate] {msg}", flush=True)


def ensure_translate_env() -> None:
    """Only validate/load GPT env needed for translation.

    We intentionally do not require Whisper settings here because this script
    only repairs line objects and re-translates existing text.
    """
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(ROOT / ".env")
    except Exception:
        pass

    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT") or os.environ.get("AZURE_ENDPOINT")
    api_key = os.environ.get("AZURE_OPENAI_API_KEY") or os.environ.get("AZURE_API_KEY")
    if not endpoint:
        raise SystemExit("Missing AZURE_OPENAI_ENDPOINT / AZURE_ENDPOINT")
    if not api_key:
        raise SystemExit("Missing AZURE_OPENAI_API_KEY / AZURE_API_KEY")
    config.GPT_ENDPOINT = endpoint
    config.GPT_API_KEY = api_key
    config.GPT_DEPLOYMENT = (
        os.environ.get("AZURE_OPENAI_DEPLOYMENT")
        or os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME")
        or os.environ.get("GPT_DEPLOYMENT")
        or "gpt-5-chat-global-01"
    )
    config.GPT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")


def load_clips(path: Path) -> tuple[dict, list[dict]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "clips" in payload and isinstance(payload["clips"], list):
        return payload, payload["clips"]
    if isinstance(payload, list):
        return {"clips": payload}, payload
    raise ValueError(f"Unsupported clip payload at {path}")


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z']+|\d+", text or ""))


def has_terminal_punctuation(text: str) -> bool:
    return bool(re.search(r"[.!?…]$|['\"]$", (text or "").strip()))


def first_alpha(text: str) -> str | None:
    return next((ch for ch in (text or "") if ch.isalpha()), None)


def merge_lines(left: dict, right: dict) -> dict:
    merged_en = " ".join(
        part.strip().rstrip(",")
        for part in [left.get("en", ""), right.get("en", "")]
        if part and part.strip()
    ).strip()
    return {
        **left,
        "start": left.get("start", 0),
        "end": right.get("end", left.get("end", 0)),
        "en": merged_en,
        "zh": "",
        "words": list(left.get("words", []) or []) + list(right.get("words", []) or []),
    }


def should_merge_with_next(left: dict, right: dict) -> bool:
    left_en = (left.get("en") or "").strip()
    right_en = (right.get("en") or "").strip()
    if not left_en or not right_en:
        return False

    merged_wc = word_count(left_en) + word_count(right_en)
    if merged_wc > 30:
        return False

    if left_en.endswith((",", ";", ":", "—", "-")):
        return True

    left_wc = word_count(left_en)
    right_wc = word_count(right_en)
    right_first = first_alpha(right_en)

    if left_wc <= 2 or right_wc <= 2:
        return True

    if not has_terminal_punctuation(left_en) and right_first and right_first.islower():
        return True

    return False


def repair_mid_clip_fragments(lines: list[dict]) -> list[dict]:
    repaired = [copy.deepcopy(line) for line in lines]
    changed = True
    while changed and len(repaired) > 1:
        changed = False
        out: list[dict] = []
        i = 0
        while i < len(repaired):
            current = repaired[i]
            nxt = repaired[i + 1] if i + 1 < len(repaired) else None
            if nxt is not None and should_merge_with_next(current, nxt):
                out.append(merge_lines(current, nxt))
                i += 2
                changed = True
                continue
            out.append(current)
            i += 1
        repaired = out
    return repaired


def looks_sensitive(text: str) -> bool:
    lowered = (text or "").lower()
    keywords = [
        "vagina",
        "vaginal",
        "pregnan",
        "sperm",
        "sexual",
        "sex ",
        "sex-",
        "oral sex",
        "assault",
        "rape",
        "abortion",
        "fertility",
        "miscarriage",
        "genital",
    ]
    return any(token in lowered for token in keywords)


def translate_lines_simple(lines: list[dict], only_missing: bool = False) -> None:
    """Fallback translator with less contextual prompt and lower filter risk."""
    for line in lines:
        if only_missing and (line.get("zh") or "").strip():
            continue
        prompt = (
            "把下面这句英文自然地翻成简体中文。"
            "只输出中文，不要解释，不要保留英文原文。\n\n"
            f"{line.get('en', '').strip()}"
        )
        response = call_gpt(
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=200,
        )
        if response and response.strip():
            line["zh"] = response.strip()


@dataclass
class ClipCandidate:
    index: int
    title: str
    comma_period_count: int
    short_fragment_count: int
    continuation_pairs: int


def inspect_clip(index: int, clip: dict) -> ClipCandidate | None:
    lines = clip.get("lines") or []
    if not lines:
        return None
    comma_period_count = 0
    short_fragment_count = 0
    continuation_pairs = 0

    for i, line in enumerate(lines):
        en = (line.get("en") or "").strip()
        zh = (line.get("zh") or "").strip()
        if en.endswith(",") and zh.endswith("。"):
            comma_period_count += 1
        if word_count(en) <= 3:
            short_fragment_count += 1
        if i + 1 < len(lines) and should_merge_with_next(line, lines[i + 1]):
            continuation_pairs += 1

    if not (comma_period_count or short_fragment_count >= 2 or continuation_pairs):
        return None

    return ClipCandidate(
        index=index,
        title=clip.get("title", ""),
        comma_period_count=comma_period_count,
        short_fragment_count=short_fragment_count,
        continuation_pairs=continuation_pairs,
    )


def build_selector(
    clip_indexes: list[int],
    title_patterns: list[str],
    clip_ids: list[str],
    auto_candidates: set[int],
) -> callable:
    patterns = [re.compile(p, re.I) for p in title_patterns]
    id_set = set(clip_ids)
    index_set = set(clip_indexes)

    def _selected(index: int, clip: dict) -> bool:
        if index in index_set:
            return True
        if index in auto_candidates:
            return True
        if clip.get("id") in id_set:
            return True
        title = clip.get("title", "")
        return any(p.search(title) for p in patterns)

    return _selected


def retranslate_clip(clip: dict) -> tuple[dict, dict]:
    original_lines = copy.deepcopy(clip.get("lines") or [])
    repaired_lines = repair_boundary_lines(original_lines)
    repaired_lines = repair_mid_clip_fragments(repaired_lines)
    clip_text = "\n".join((line.get("en") or "") for line in repaired_lines)
    sensitive = looks_sensitive(clip.get("title", "")) or looks_sensitive(clip_text)
    for line in repaired_lines:
        line["zh"] = ""
    if sensitive:
        translate_lines_simple(repaired_lines)
    else:
        translate_lines(repaired_lines)
        if any(not (line.get("zh") or "").strip() for line in repaired_lines):
            translate_lines_simple(repaired_lines, only_missing=True)

    updated = copy.deepcopy(clip)
    updated["lines"] = repaired_lines
    report = {
        "title": clip.get("title", ""),
        "line_count_before": len(original_lines),
        "line_count_after": len(repaired_lines),
        "first_before": (original_lines[0].get("en") if original_lines else ""),
        "first_after": (repaired_lines[0].get("en") if repaired_lines else ""),
        "last_before": (original_lines[-1].get("en") if original_lines else ""),
        "last_after": (repaired_lines[-1].get("en") if repaired_lines else ""),
    }
    return updated, report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Selective repair + retranslate existing clips")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Path to source data.json")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Path to write updated clip payload")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="Path to write JSON report")
    parser.add_argument("--clip-index", type=int, action="append", default=[], help="Process a specific 0-based clip index")
    parser.add_argument("--title", action="append", default=[], help="Regex pattern to match titles to process")
    parser.add_argument("--clip-id", action="append", default=[], help="Specific clip id to process")
    parser.add_argument("--auto", action="store_true", help="Process clips that look suspicious by heuristic")
    parser.add_argument("--limit", type=int, default=0, help="Max clips to process after selection (0 = all)")
    parser.add_argument("--report-only", action="store_true", help="Only report suspicious clips, do not translate")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload, clips = load_clips(args.input.resolve())

    suspicious = [inspect_clip(i, clip) for i, clip in enumerate(clips)]
    suspicious = [item for item in suspicious if item is not None]
    suspicious_indices = {item.index for item in suspicious}

    if args.report_only:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps([item.__dict__ for item in suspicious], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        log(f"report-only: wrote {len(suspicious)} suspicious clips -> {args.report}")
        return

    selector = build_selector(
        clip_indexes=args.clip_index,
        title_patterns=args.title,
        clip_ids=args.clip_id,
        auto_candidates=suspicious_indices if args.auto else set(),
    )

    selected: list[int] = []
    for i, clip in enumerate(clips):
        if selector(i, clip):
            selected.append(i)

    if args.limit > 0:
        selected = selected[: args.limit]

    if not selected:
        raise SystemExit("No clips selected. Use --auto, --clip-index, --title, or --clip-id.")

    ensure_translate_env()

    updated_clips = copy.deepcopy(clips)
    report_rows: list[dict] = []
    for idx in selected:
        clip = clips[idx]
        log(f"processing clip[{idx}] {clip.get('title', '')}")
        updated, report = retranslate_clip(clip)
        updated_clips[idx] = updated
        report_rows.append({"index": idx, **report})

    output_payload = copy.deepcopy(payload)
    output_payload["clips"] = updated_clips
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report_rows, ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"wrote {len(selected)} updated clips -> {args.output}")
    log(f"wrote report -> {args.report}")


if __name__ == "__main__":
    main()
