#!/usr/bin/env python3
"""Backfill missing translations, CEFR LLM fallback, and comprehension questions.

用途：CC1 跑完 audio+transcript 后 GPT API 失败，导致 zh / CEFR fallback /
      comprehension questions 缺失。此脚本读取已有 new_clips.json，
      逐条补齐缺失字段，每条完成后立刻 atomic write 回磁盘。

用法：
    python3 tools/backfill_translations_cefr_questions.py \
        --input output/new_clips_2026_04_15/new_clips.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from agent.config import ensure_env  # noqa: E402
from agent.utils import log  # noqa: E402
from agent.translate import translate_lines  # noqa: E402
from agent.cefr import init_cefr_map, batch_cefr_annotation, infer_difficulty  # noqa: E402
from agent.output import generate_comprehension_questions, validate_questions  # noqa: E402


def _atomic_write(path: Path, data: dict) -> None:
    """Write JSON atomically via temp file + rename."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        os.unlink(tmp)
        raise


def backfill_clip(clip: dict) -> dict:
    """Backfill a single clip's missing fields. Returns status summary dict."""
    cid = clip["id"]
    lines = clip.get("lines", [])
    status = {"id": cid, "translation": "skip", "cefr": "skip", "questions": "skip"}

    # ── 1. Translation ────────────────────────────────────────
    missing_zh = [l for l in lines if not l.get("zh")]
    if missing_zh:
        log(f"\n  clip_{cid}: 补翻译 ({len(missing_zh)}/{len(lines)} 句缺失)...", "step")
        translate_lines(missing_zh)
        still_missing = sum(1 for l in lines if not l.get("zh"))
        status["translation"] = "ok" if still_missing == 0 else f"partial({still_missing} missing)"
    else:
        status["translation"] = "already_complete"

    # ── 2. CEFR LLM fallback ─────────────────────────────────
    null_cefr_words = 0
    for l in lines:
        for w in l.get("words", []):
            if w.get("cefr") is None:
                import re
                clean = re.sub(r"[^a-zA-Z']", "", w["word"]).lower()
                if clean and len(clean) > 1:
                    null_cefr_words += 1

    if null_cefr_words > 0:
        log(f"  clip_{cid}: 补 CEFR ({null_cefr_words} 词待标注)...", "step")
        batch_cefr_annotation(lines)
        # Recount
        still_null = 0
        for l in lines:
            for w in l.get("words", []):
                if w.get("cefr") is None:
                    import re
                    clean = re.sub(r"[^a-zA-Z']", "", w["word"]).lower()
                    if clean and len(clean) > 1:
                        still_null += 1
        status["cefr"] = "ok" if still_null == 0 else f"partial({still_null} null)"
    else:
        status["cefr"] = "already_complete"

    # Re-infer difficulty after CEFR update
    clip["difficulty"] = infer_difficulty(lines)

    # ── 3. Comprehension questions ────────────────────────────
    if not clip.get("questions"):
        log(f"  clip_{cid}: 生成理解题...", "step")
        episode_info = clip.get("source", {})
        raw_q = generate_comprehension_questions(lines, episode_info)
        questions = validate_questions(raw_q, lines)
        clip["questions"] = questions
        status["questions"] = f"{len(questions)} qs"
    else:
        status["questions"] = f"already_{len(clip['questions'])} qs"

    return status


def main() -> None:
    ensure_env()

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, type=Path,
                    help="new_clips.json 路径")
    args = ap.parse_args()

    if not args.input.exists():
        raise SystemExit(f"❌ 找不到 {args.input}")

    # Init CEFR wordlist
    init_cefr_map(scripts_dir=str(ROOT / "scripts"))

    data = json.load(open(args.input))
    clips = data.get("clips", [])
    log(f"加载 {len(clips)} 条 clip，开始 backfill...", "info")

    summaries = []
    for clip in clips:
        status = backfill_clip(clip)
        summaries.append(status)
        # Atomic write after each clip
        _atomic_write(args.input, data)
        log(f"  clip_{status['id']}: 已写盘 ✅", "ok")

    # ── Summary ───────────────────────────────────────────────
    log("\n" + "=" * 60, "info")
    log("Backfill 汇总:", "info")
    log(f"{'ID':>5}  {'Translation':<20}  {'CEFR':<20}  {'Questions':<15}", "info")
    log("-" * 60, "info")
    for s in summaries:
        log(f"{s['id']:>5}  {s['translation']:<20}  {s['cefr']:<20}  {s['questions']:<15}", "info")
    log("=" * 60, "info")
    log(f"✅ 全部 {len(clips)} 条处理完毕，结果已写入 {args.input}", "ok")
    log("\n👉 下一步：跑 tools/flag_clips_for_review.py 自动标 ⚠️/✅", "info")


if __name__ == "__main__":
    main()
