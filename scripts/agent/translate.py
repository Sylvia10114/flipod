"""Step 7: Batch JSON translation (EN → ZH).

Input: list of line dicts with 'en' field
Output: same lines with 'zh' field populated
"""

import json
import re

from .utils import log, call_gpt, strip_markdown_fences

TRANSLATE_BATCH_SIZE = 10


def _translate_batch_json(batch_lines):
    """Translate a batch of lines using JSON format for reliable alignment.

    Returns True on success.
    """
    n = len(batch_lines)
    en_array = [{"idx": i, "en": l["en"]} for i, l in enumerate(batch_lines)]

    for attempt in range(2):
        prompt = (
            f"将以下 {n} 句英文翻译成中文。要求：口语化、简洁、不要翻译腔。\n\n"
            f"返回纯 JSON 数组，每个元素包含 idx 和 zh 字段，按原顺序：\n"
            f"{json.dumps(en_array, ensure_ascii=False)}\n\n"
            f"只返回 JSON 数组，不要 markdown 代码块。"
        )

        response = call_gpt([{"role": "user", "content": prompt}], temperature=0.2)
        if not response:
            break

        try:
            text = strip_markdown_fences(response)
            result = json.loads(text)

            if isinstance(result, list) and len(result) == n:
                for item in result:
                    idx = item.get("idx", -1)
                    zh = item.get("zh", "")
                    if 0 <= idx < n:
                        batch_lines[idx]["zh"] = zh
                return True
            else:
                log(f"    JSON 翻译数量不匹配: 期望 {n}, 得到 "
                    f"{len(result) if isinstance(result, list) else 'non-array'} "
                    f"(尝试 {attempt+1}/2)", "warn")
        except (json.JSONDecodeError, TypeError) as e:
            log(f"    JSON 翻译解析失败 (尝试 {attempt+1}/2): {e}", "warn")

    return False


def _translation_needs_touchup(en, zh):
    zh = (zh or "").strip()
    en = (en or "").strip()
    zh_cjk = len(re.findall(r"[\u4e00-\u9fff]", zh))
    zh_len = max(len(zh), 1)
    en_alpha = len(re.findall(r"[A-Za-z]", zh))
    if zh_cjk < 2:
        return True
    if en and (zh_len / max(len(en), 1)) > 2.8:
        return True
    if en_alpha > zh_cjk:
        return True
    return False


def _touch_up_line_translation(line):
    prompt = (
        "把这句英文翻成自然、简洁的简体中文。"
        "不要保留裸英文；人名、品牌名、机构名如果必须出现，请加中文译法或中文说明。"
        "只输出中文。\n\n"
        f"英文：{line['en']}"
    )
    response = call_gpt([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=200)
    if response and response.strip():
        line["zh"] = response.strip()


def translate_lines(lines):
    """Translate all lines from English to Chinese.

    Uses batch JSON translation with single-line fallback.
    Modifies lines in-place.
    """
    log(f"Step 7: 翻译 {len(lines)} 句...", "step")
    total = len(lines)

    for batch_start in range(0, total, TRANSLATE_BATCH_SIZE):
        batch_end = min(batch_start + TRANSLATE_BATCH_SIZE, total)
        batch = lines[batch_start:batch_end]

        success = _translate_batch_json(batch)

        if not success:
            log(f"    批次 {batch_start+1}-{batch_end} 退回逐句翻译...", "warn")
            for line in batch:
                if line.get("zh"):
                    continue
                prompt = f"将以下英文翻译成中文，口语化、简洁。只输出中文翻译。\n\n{line['en']}"
                response = call_gpt([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=200)
                line["zh"] = response.strip() if response else ""

    missing = sum(1 for l in lines if not l.get("zh"))
    if missing:
        log(f"  翻译完成，但有 {missing} 句缺失翻译", "warn")
    else:
        log("  翻译完成", "ok")

    touchup_count = 0
    for line in lines:
        if _translation_needs_touchup(line.get("en", ""), line.get("zh", "")):
            _touch_up_line_translation(line)
            touchup_count += 1

    if touchup_count:
        log(f"  翻译补救完成: {touchup_count} 句重译", "info")

    return lines
