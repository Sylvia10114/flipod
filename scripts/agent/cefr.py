"""Step 6: CEFR word-level annotation.

Input: clip lines with word timestamps
Output: lines with CEFR levels annotated on each word

Lookup priority: cefr_overrides.json (project-internal manual list, fixes
CEFR-J's over-grading of high-frequency function/discourse words) →
cefr_wordlist.json (CEFR-J + Octanove) → LLM fallback for unknown words.
"""

import json
import os
import re

from .utils import log, call_gpt, strip_markdown_fences

# ── Module-level word map ──────────────────────────────────────

CEFR_WORD_MAP = {}
CEFR_OVERRIDES = {}


def _load_overrides():
    """Load project-root cefr_overrides.json once. Idempotent."""
    global CEFR_OVERRIDES
    if CEFR_OVERRIDES:
        return CEFR_OVERRIDES
    # scripts/agent/cefr.py → project root is two parents up
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(project_root, "cefr_overrides.json")
    if not os.path.exists(path):
        return CEFR_OVERRIDES
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        raw = data.get("overrides", {}) or {}
        # normalise keys to lowercase clean form
        CEFR_OVERRIDES = {re.sub(r"[^a-zA-Z']", "", k).lower(): v for k, v in raw.items() if v}
        log(f"CEFR overrides 已加载: {len(CEFR_OVERRIDES)} 词", "ok")
    except Exception as e:
        log(f"CEFR overrides 加载失败: {e}", "error")
    return CEFR_OVERRIDES


def init_cefr_map(scripts_dir=None):
    """Initialize CEFR word map from cache file. Generate if needed.

    Args:
        scripts_dir: directory containing cefr_wordlist.json (default: scripts/)
    """
    global CEFR_WORD_MAP
    if scripts_dir is None:
        scripts_dir = os.path.dirname(os.path.dirname(__file__)) or "."
    cefr_cache_path = os.path.join(scripts_dir, "cefr_wordlist.json")

    if os.path.exists(cefr_cache_path):
        with open(cefr_cache_path, "r") as f:
            CEFR_WORD_MAP = json.load(f)
        log(f"CEFR 词表已加载: {len(CEFR_WORD_MAP)} 词", "ok")
        _load_overrides()
        if len(CEFR_WORD_MAP) >= 3000:
            return
        log("词表较小，将补充生成...", "info")

    log("生成 COCA-CEFR 基础词表（首次运行，约需 2 分钟）...", "step")
    coca_ranges = [
        ("A1", "1-200", 200),
        ("A2", "201-800", 600),
        ("B1", "801-2000", 1200),
        ("B2", "2001-4000", 2000),
        ("C1", "4001-7000", 3000),
        ("C2", "7001-10000", 3000),
    ]
    for level, rank_range, count in coca_ranges:
        existing_at_level = sum(1 for v in CEFR_WORD_MAP.values() if v == level)
        if existing_at_level > count * 0.5:
            continue
        prompt = (
            f"List the most common English words ranked approximately {rank_range} in COCA frequency.\n"
            f"Output exactly as a JSON array of lowercase strings, no explanations.\n"
            f"Give me {min(count, 500)} words. Only single words, no phrases."
        )
        response = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=4000)
        if not response:
            continue
        try:
            response = strip_markdown_fences(response)
            words = json.loads(response)
            for w in words:
                if isinstance(w, str) and w.lower() not in CEFR_WORD_MAP:
                    CEFR_WORD_MAP[w.lower()] = level
            log(f"  {level} ({rank_range}): +{len(words)} 词", "ok")
        except Exception as e:
            log(f"  {level} 生成失败: {e}", "error")

    with open(cefr_cache_path, "w") as f:
        json.dump(CEFR_WORD_MAP, f, ensure_ascii=False, indent=2)
    log(f"CEFR 基础词表已生成并缓存: {len(CEFR_WORD_MAP)} 词", "ok")


def get_cefr(word):
    """Get CEFR level for a single word. Returns A1-C2 or None.

    Lookup priority: overrides → CEFR-J wordlist → None (caller does LLM fallback).
    """
    clean = re.sub(r"[^a-zA-Z']", "", word).lower()
    if not clean:
        return None
    overrides = _load_overrides()
    if clean in overrides:
        return overrides[clean]
    return CEFR_WORD_MAP.get(clean)


def batch_cefr_annotation(lines):
    """Use LLM to annotate words missing CEFR levels.

    Modifies lines in-place, adding 'cefr' to each word dict.
    Returns the lines.
    """
    unknown_words = set()
    for line in lines:
        for w in line["words"]:
            if w.get("cefr") is None:
                clean = re.sub(r"[^a-zA-Z']", "", w["word"]).lower()
                if clean and len(clean) > 1:
                    unknown_words.add(clean)

    if not unknown_words:
        return lines

    log(f"Step 6b: LLM 标注 {len(unknown_words)} 个未知 CEFR 词...", "step")

    word_list = sorted(unknown_words)[:200]
    prompt = (
        f"为以下英文单词标注 CEFR 等级（A1/A2/B1/B2/C1/C2）。\n"
        f"专有名词（人名、地名、品牌名）标注 null。\n\n"
        f"返回纯 JSON 对象，key 是单词，value 是 CEFR 等级字符串或 null：\n"
        f"{json.dumps(word_list)}"
    )

    response = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=2000)
    if not response:
        return lines

    try:
        response = strip_markdown_fences(response)
        cefr_map = json.loads(response)

        for line in lines:
            for w in line["words"]:
                if w.get("cefr") is None:
                    clean = re.sub(r"[^a-zA-Z']", "", w["word"]).lower()
                    if clean in cefr_map:
                        w["cefr"] = cefr_map[clean]

        CEFR_WORD_MAP.update({k: v for k, v in cefr_map.items() if v is not None})
        log("  CEFR 标注完成", "ok")

    except Exception as e:
        log(f"  CEFR 标注解析失败: {e}", "error")

    return lines


def infer_difficulty(lines):
    """从 clip 的 CEFR 词分布反推整体难度（B1 / B1+ / B2 / B2+ / C1）。

    设计：基于"已知 CEFR 等级的单词"在 clip 中的占比来估，
    专有名词（cefr=None）和单字母词不计入分母。

    阈值是首版经验值，建议产出第一批 dry-run/补齐后回看校准。
    优先用"高难度词占比"做主信号，因为 B1-B2 的用户感知差异主要来自
    "突然冒出来的不认识的词"，而不是平均难度。

    Returns: 'B1' / 'B1+' / 'B2' / 'B2+' / 'C1'
    """
    counts = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}
    total = 0
    for line in lines:
        for w in line.get("words", []):
            level = w.get("cefr")
            if level in counts:
                counts[level] += 1
                total += 1
    if total == 0:
        return "B1+"  # 没有标注就回退默认值

    pct_b2 = counts["B2"] / total * 100
    pct_c1_plus = (counts["C1"] + counts["C2"]) / total * 100
    pct_advanced = (counts["B2"] + counts["C1"] + counts["C2"]) / total * 100

    # 阶梯式判断（从难到易）
    if pct_c1_plus >= 8:
        return "C1"
    if pct_c1_plus >= 4 or pct_b2 >= 30:
        return "B2+"
    if pct_c1_plus >= 2 or pct_b2 >= 20:
        return "B2"
    if pct_b2 >= 12 or pct_advanced >= 35:
        return "B1+"
    return "B1"


def save_cefr_cache(scripts_dir=None):
    """Persist accumulated CEFR word map to disk."""
    if not CEFR_WORD_MAP:
        return
    if scripts_dir is None:
        scripts_dir = os.path.dirname(os.path.dirname(__file__)) or "."
    cache_path = os.path.join(scripts_dir, "cefr_wordlist.json")
    with open(cache_path, "w") as f:
        json.dump(CEFR_WORD_MAP, f, ensure_ascii=False, indent=2)
    log(f"CEFR 词表缓存已保存: {len(CEFR_WORD_MAP)} 词", "ok")
