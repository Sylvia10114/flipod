#!/usr/bin/env python3
"""为 data.json 中的每个 clip 生成教学内容（difficulty + teaching）。

用法:
    python3 scripts/generate_teaching.py data.json
    python3 scripts/generate_teaching.py data.json --limit 3        # 只处理前 3 个
    python3 scripts/generate_teaching.py data.json --dry-run        # 只算 difficulty，不调 GPT
    python3 scripts/generate_teaching.py data.json --start 5        # 从第 5 个 clip 开始

输出:
    output/teaching_output.json — 带 difficulty + teaching 的完整 data.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

# ── Azure GPT 配置（与 podcast_agent.py 一致） ──
GPT_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT",
                               "https://sweden-central-gpt-01.openai.azure.com")
GPT_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY",
                              os.environ.get("AZURE_OPENAI_KEY", ""))
GPT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT",
                                 "gpt-5-chat-global-01")
GPT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION",
                                  "2025-01-01-preview")

VALID_CEFR = {"A1", "A2", "B1", "B2", "C1", "C2"}


def log(msg: str, level: str = "info") -> None:
    prefix = {"info": "  ", "step": ">>", "error": "!!", "ok": "OK"}
    print(f"[{prefix.get(level, '  ')}] {msg}", flush=True)


# ═══════════════════════════════════════════
#  Part 1: difficulty 计算（纯代码，不需要 LLM）
# ═══════════════════════════════════════════

def compute_difficulty(clip: dict) -> dict:
    """计算 clip 的 difficulty 字段。"""
    lines = clip.get("lines", [])
    if not lines:
        return {"level": "B1", "wpm": 0, "avg_sentence_length": 0,
                "cefr_distribution": {}, "proper_nouns": []}

    # 收集所有 words
    all_words = []
    for line in lines:
        all_words.extend(line.get("words", []))

    if not all_words:
        return {"level": "B1", "wpm": 0, "avg_sentence_length": 0,
                "cefr_distribution": {}, "proper_nouns": []}

    # wpm: 总词数 / (最后 word.end - 第一个 word.start) × 60
    first_start = all_words[0].get("start", 0)
    last_end = all_words[-1].get("end", 0)
    duration_sec = last_end - first_start
    total_word_count = len(all_words)
    wpm = round(total_word_count / duration_sec * 60, 1) if duration_sec > 0 else 0

    # avg_sentence_length
    avg_sentence_length = round(total_word_count / len(lines), 1)

    # proper_nouns: cefr == "PN" 的词（去重）
    proper_nouns = list(dict.fromkeys(
        w["word"] for w in all_words if w.get("cefr") == "PN"
    ))

    # cefr_distribution: 排除 PN 和 null
    cefr_words = [w for w in all_words if w.get("cefr") in VALID_CEFR]
    cefr_total = len(cefr_words)
    cefr_counts = Counter(w["cefr"] for w in cefr_words)
    cefr_distribution = {}
    for level in ["A1", "A2", "B1", "B2", "C1", "C2"]:
        if cefr_counts.get(level, 0) > 0:
            cefr_distribution[level] = round(cefr_counts[level] / cefr_total, 2)

    # level: 加权公式映射到五档
    # B2+占比 × 0.5 + wpm归一化 × 0.3 + 句长归一化 × 0.2
    b2_plus_ratio = sum(cefr_counts.get(l, 0) for l in ["B2", "C1", "C2"]) / cefr_total if cefr_total > 0 else 0

    # wpm 归一化: 100 wpm = 0, 200 wpm = 1
    wpm_norm = max(0, min(1, (wpm - 100) / 100))

    # 句长归一化: 5 词 = 0, 20 词 = 1
    sl_norm = max(0, min(1, (avg_sentence_length - 5) / 15))

    score = b2_plus_ratio * 0.5 + wpm_norm * 0.3 + sl_norm * 0.2

    if score < 0.15:
        level = "A2"
    elif score < 0.30:
        level = "B1"
    elif score < 0.45:
        level = "B1+"
    elif score < 0.60:
        level = "B2"
    else:
        level = "B2+"

    return {
        "level": level,
        "wpm": wpm,
        "avg_sentence_length": avg_sentence_length,
        "cefr_distribution": cefr_distribution,
        "proper_nouns": proper_nouns,
    }


# ═══════════════════════════════════════════
#  Part 2: GPT 调用生成 teaching 内容
# ═══════════════════════════════════════════

def call_gpt(messages: list[dict], temperature: float = 0.4,
             max_tokens: int = 4000, json_mode: bool = False) -> str | None:
    """通过 curl 调用 Azure GPT（绕过 Python 3.9 SSL 问题）。"""
    url = (f"{GPT_ENDPOINT}/openai/deployments/{GPT_DEPLOYMENT}"
           f"/chat/completions?api-version={GPT_API_VERSION}")

    body: dict = {
        "messages": messages,
        "temperature": temperature,
        "max_completion_tokens": max_tokens,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    payload = json.dumps(body)

    for attempt in range(3):
        try:
            result = subprocess.run([
                "curl", "-s", "-X", "POST", url,
                "-H", f"api-key: {GPT_API_KEY}",
                "-H", "Content-Type: application/json",
                "-d", payload,
                "--connect-timeout", "15",
                "--max-time", "120",
            ], capture_output=True, text=True, timeout=130)

            if result.returncode != 0:
                log(f"GPT curl 失败 (尝试 {attempt+1}/3): {result.stderr[:200]}", "error")
                if attempt < 2:
                    time.sleep(5)
                continue

            data = json.loads(result.stdout)
            if "error" in data:
                log(f"GPT API 错误 (尝试 {attempt+1}/3): {data['error'].get('message', '')[:200]}", "error")
                if attempt < 2:
                    time.sleep(5)
                continue

            return data["choices"][0]["message"]["content"]
        except Exception as e:
            log(f"GPT 调用异常 (尝试 {attempt+1}/3): {e}", "error")
            if attempt < 2:
                time.sleep(5)
    return None


def build_teaching_prompt(clip: dict, difficulty: dict) -> list[dict]:
    """构建生成 teaching 内容的 GPT prompt。"""
    lines = clip.get("lines", [])
    title = clip.get("title", "")
    tag = clip.get("tag", "")
    source = clip.get("source", {})

    # 构建 lines 数据供 GPT 参考（包含 en, zh, words 及其 cefr）
    lines_for_prompt = []
    for i, line in enumerate(lines):
        words_info = []
        for w in line.get("words", []):
            cefr = w.get("cefr")
            if cefr and cefr in VALID_CEFR:
                words_info.append(f"{w['word']}({cefr})")
        lines_for_prompt.append({
            "index": i,
            "en": line.get("en", ""),
            "zh": line.get("zh", ""),
            "start": line.get("start", 0),
            "end": line.get("end", 0),
            "words_with_cefr": " ".join(words_info) if words_info else None,
        })

    clip_context = json.dumps({
        "title": title,
        "source": source,
        "tag": tag,
        "difficulty": difficulty,
        "total_lines": len(lines),
        "lines": lines_for_prompt,
    }, ensure_ascii=False, indent=2)

    system_prompt = """You are an expert ESL teaching content designer for a podcast-based English learning app called Flipod. Your target users are Chinese learners at A2-B2+ level.

You will receive a podcast clip with full transcript (English + Chinese + word-level CEFR tags). Generate teaching content following the exact JSON schema below.

CRITICAL RULES:
1. word_pool words MUST exist in the clip's lines[].words[] — do not invent words
2. line_index values MUST be valid indices (0 to total_lines-1)
3. fill_blank and dictation sentences must be AI-ORIGINAL (same topic, different wording from transcript)
4. All Chinese text must be natural, not machine-translated
5. Output valid JSON only, no markdown wrapping"""

    user_prompt = f"""Generate teaching content for this clip:

{clip_context}

Return a JSON object with this exact structure:
{{
  "gist": {{
    "question": "What is the main idea of this clip?",  // English, B1 difficulty
    "options": [
      {{"text": "...", "correct": false}},
      {{"text": "...", "correct": true}},
      {{"text": "...", "correct": false}}
    ],
    "focus_hint": {{
      "text": "Listen again around X:XX. Pay attention to...",  // English guidance for re-listening
      "timestamp": 0.0  // seconds, jump to this point
    }},
    "correct_insight": "关键线索在……",  // Chinese, explain the key signal
    "difficulty_variants": {{
      "A2": {{
        "question": "这段主要讲的是什么？",  // Chinese question
        "options": [
          {{"text": "...", "correct": false}},  // Chinese options, straightforward
          {{"text": "...", "correct": true}},
          {{"text": "...", "correct": false}}
        ],
        "focus_hint": {{
          "text": "再听一遍……附近，注意……",  // Chinese hint
          "timestamp": 0.0
        }}
      }},
      "B2+": {{
        "question": "What does the speaker imply about...?",  // English inference question
        "options": [
          {{"text": "...", "correct": true}},
          {{"text": "...", "correct": false}},
          {{"text": "...", "correct": false}}
        ],
        "focus_hint": {{
          "text": "Listen to the section starting at X:XX. What assumption does the speaker describe?",
          "timestamp": 0.0
        }}
      }}
    }}
  }},
  "word_pool": {{
    "B1": [  // 2-4 words for A2 users' i+1
      {{
        "word": "example",
        "cefr": "B1",
        "line_index": 0,  // index in lines[]
        "context_en": "the original sentence containing this word",
        "context_zh": "包含这个词的中文翻译",
        "definition_zh": "中文释义",
        "why_selected": "reason for teaching value"
      }}
    ],
    "B2": [  // 2-4 words for B1 users' i+1
      // same structure
    ],
    "C1": [  // 2-4 words for B2+ users' i+1
      // same structure
    ]
  }},
  "exercises": {{
    "fill_blank": {{
      "sets": [
        {{
          "target_words": ["word1", "word2", "word3"],  // from word_pool
          "word_bank": ["word1", "word2", "word3", "distractor1", "distractor2"],
          "items": [
            {{
              "sentence": "AI-original sentence with _______ blank.",
              "answer": "word1",
              "answer_index": 0  // index in word_bank
            }},
            // 4 items total
          ]
        }}
        // at least 2 sets with different target_words combinations
      ]
    }},
    "dictation": {{
      "sets": [
        {{
          "target_words": ["word1", "word2", "word3"],
          "sentences": [
            {{
              "text": "Full AI-original sentence for dictation.",
              "blanks": ["word1", "word2"],
              "given": "Full AI-original sentence with _______ for dictation."
            }}
            // 2-3 sentences per set
          ]
        }}
        // at least 2 sets
      ]
    }}
  }},
  "reflection": {{
    "options": [
      {{"label": "描述某段难听懂的部分（中文）", "time_range": [start_sec, end_sec]}},
      {{"label": "...", "time_range": [start_sec, end_sec]}},
      {{"label": "...", "time_range": [start_sec, end_sec]}}
    ]
  }}
}}

IMPORTANT CONSTRAINTS:
- word_pool: pick words that ACTUALLY APPEAR in the clip's words[] list. Check the words_with_cefr field.
- For B1 pool: pick words tagged B1 in the transcript
- For B2 pool: pick words tagged B2
- For C1 pool: pick words tagged C1 (or C2 if not enough C1)
- If a CEFR level has fewer than 2 qualifying words in the clip, include what's available (minimum 1, or empty array if truly none)
- fill_blank sentences: same topic as clip but AI-original, not copied from transcript
- dictation sentences: same style/topic as clip but AI-original
- reflection time_ranges must fall within the clip's actual time range
- All timestamps must be realistic (within the clip duration)
- focus_hint timestamps should point to the most relevant part of the clip for that question"""

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


# ═══════════════════════════════════════════
#  Part 3: 校验 GPT 输出
# ═══════════════════════════════════════════

def get_clip_words_set(clip: dict) -> set[str]:
    """获取 clip 中所有出现的词（小写）。"""
    words = set()
    for line in clip.get("lines", []):
        for w in line.get("words", []):
            words.add(w.get("word", "").lower())
    return words


def validate_teaching(teaching: dict, clip: dict) -> list[str]:
    """校验 GPT 输出，返回错误列表。空列表 = 通过。"""
    errors = []
    lines = clip.get("lines", [])
    num_lines = len(lines)
    clip_words = get_clip_words_set(clip)

    # 获取 clip 时间范围
    all_words = []
    for line in lines:
        all_words.extend(line.get("words", []))
    clip_end = all_words[-1].get("end", 0) if all_words else 0

    # 1. 校验 gist
    gist = teaching.get("gist")
    if not gist:
        errors.append("缺少 gist")
    else:
        opts = gist.get("options", [])
        if len(opts) != 3:
            errors.append(f"gist.options 应有 3 个，实际 {len(opts)}")
        correct_count = sum(1 for o in opts if o.get("correct"))
        if correct_count != 1:
            errors.append(f"gist.options 应有 1 个正确，实际 {correct_count}")

        # 检查 difficulty_variants
        variants = gist.get("difficulty_variants", {})
        for vk in ["A2", "B2+"]:
            v = variants.get(vk)
            if not v:
                errors.append(f"缺少 gist.difficulty_variants.{vk}")
            else:
                vopts = v.get("options", [])
                if len(vopts) != 3:
                    errors.append(f"gist.difficulty_variants.{vk}.options 应有 3 个")

    # 2. 校验 word_pool
    word_pool = teaching.get("word_pool", {})
    for level in ["B1", "B2", "C1"]:
        pool = word_pool.get(level, [])
        for wi, wp in enumerate(pool):
            word = wp.get("word", "")
            if word.lower() not in clip_words:
                errors.append(f"word_pool.{level}[{wi}] '{word}' 不在 clip 词表中")
            li = wp.get("line_index")
            if li is not None and (li < 0 or li >= num_lines):
                errors.append(f"word_pool.{level}[{wi}] line_index={li} 超出范围 [0, {num_lines-1}]")

    # 3. 校验 exercises
    exercises = teaching.get("exercises", {})
    fb_sets = exercises.get("fill_blank", {}).get("sets", [])
    if len(fb_sets) < 2:
        errors.append(f"fill_blank.sets 应至少 2 套，实际 {len(fb_sets)}")
    for si, s in enumerate(fb_sets):
        items = s.get("items", [])
        if len(items) < 4:
            errors.append(f"fill_blank.sets[{si}].items 应至少 4 道，实际 {len(items)}")

    dict_sets = exercises.get("dictation", {}).get("sets", [])
    if len(dict_sets) < 2:
        errors.append(f"dictation.sets 应至少 2 套，实际 {len(dict_sets)}")

    # 4. 校验 reflection
    reflection = teaching.get("reflection", {})
    opts = reflection.get("options", [])
    if len(opts) != 3:
        errors.append(f"reflection.options 应有 3 个，实际 {len(opts)}")
    for oi, opt in enumerate(opts):
        tr = opt.get("time_range", [])
        if len(tr) != 2:
            errors.append(f"reflection.options[{oi}] time_range 应有 2 个值")
        elif tr[0] < 0 or tr[1] > clip_end + 5:  # 允许 5 秒容差
            errors.append(f"reflection.options[{oi}] time_range {tr} 超出 clip 范围")

    return errors


# ═══════════════════════════════════════════
#  Part 4: 主流程
# ═══════════════════════════════════════════

def process_clip(clip: dict, index: int, dry_run: bool = False) -> tuple[str, dict | None, dict | None]:
    """处理单个 clip，返回 (status, difficulty, teaching)。
    status: 'ok' | 'skipped' | 'failed'
    """
    title = clip.get("title", f"clip_{index}")
    lines = clip.get("lines", [])
    log(f"[{index}] {title} ({len(lines)} lines)", "step")

    if not lines:
        log("无 lines 数据，跳过", "error")
        return "skipped", None, None

    # 1. 计算 difficulty
    difficulty = compute_difficulty(clip)
    log(f"difficulty: level={difficulty['level']} wpm={difficulty['wpm']} "
        f"avg_sl={difficulty['avg_sentence_length']} "
        f"PN={len(difficulty['proper_nouns'])} 个")

    if dry_run:
        log("dry-run 模式，跳过 GPT 调用")
        return "ok", difficulty, None

    # 2. 调 GPT 生成 teaching
    messages = build_teaching_prompt(clip, difficulty)
    raw = call_gpt(messages, temperature=0.4, max_tokens=6000, json_mode=True)

    if raw is None:
        log("GPT 调用失败（3 次重试均失败）", "error")
        return "failed", difficulty, None

    # 解析 JSON
    try:
        teaching = json.loads(raw)
    except json.JSONDecodeError as e:
        log(f"GPT 输出 JSON 解析失败: {e}", "error")
        log(f"原始输出前 500 字: {raw[:500]}", "error")
        return "failed", difficulty, None

    # 3. 校验
    validation_errors = validate_teaching(teaching, clip)
    if validation_errors:
        log(f"校验发现 {len(validation_errors)} 个问题:", "error")
        for err in validation_errors[:5]:
            log(f"  - {err}", "error")
        # 非致命错误（word 不存在等）→ 尝试修复
        # 致命错误（缺少 gist 等）→ 跳过
        fatal = any("缺少 gist" in e for e in validation_errors)
        if fatal:
            log("存在致命错误，跳过此 clip", "error")
            return "skipped", difficulty, None
        else:
            log("非致命错误，保留结果但记录警告")

    log(f"teaching 生成完成", "ok")
    return "ok", difficulty, teaching


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data", type=Path, help="data.json 路径")
    ap.add_argument("--output", type=Path, default=Path("output/teaching_output.json"),
                    help="输出路径 (默认 output/teaching_output.json)")
    ap.add_argument("--dry-run", action="store_true",
                    help="只计算 difficulty，不调 GPT")
    ap.add_argument("--limit", type=int, default=0,
                    help="只处理前 N 个 clip")
    ap.add_argument("--start", type=int, default=0,
                    help="从第 N 个 clip 开始（0-indexed）")
    args = ap.parse_args()

    if not args.data.exists():
        raise SystemExit(f"找不到 {args.data}")

    if not args.dry_run and not GPT_API_KEY:
        raise SystemExit("需要设置环境变量 AZURE_OPENAI_API_KEY（或 AZURE_OPENAI_KEY）")

    # 加载数据
    data = json.load(open(args.data, encoding="utf-8"))
    clips = data.get("clips", [])
    print(f"加载 {len(clips)} 个 clip")

    # 确定处理范围
    end = len(clips) if args.limit == 0 else min(args.start + args.limit, len(clips))
    process_range = range(args.start, end)
    print(f"处理范围: clip {args.start} ~ {end - 1} (共 {len(process_range)} 个)")
    if args.dry_run:
        print("模式: dry-run（只算 difficulty，不调 GPT）")
    print()

    # 处理
    stats = Counter()
    for i in process_range:
        clip = clips[i]
        status, difficulty, teaching = process_clip(clip, i, dry_run=args.dry_run)
        stats[status] += 1

        if difficulty:
            clip["difficulty"] = difficulty
        if teaching:
            clip["teaching"] = teaching

        print()

    # 输出
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"已写入: {args.output}")

    # 汇总
    print(f"\n{'='*40}")
    print(f"处理完成:")
    print(f"  成功: {stats['ok']}")
    print(f"  失败: {stats['failed']}")
    print(f"  跳过: {stats['skipped']}")
    print(f"{'='*40}")


if __name__ == "__main__":
    main()
