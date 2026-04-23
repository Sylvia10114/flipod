"""Step 7: Batch JSON translation (EN → ZH).

Input: list of line dicts with 'en' field
Output: same lines with 'zh' field populated
"""

import json
import re

from .utils import log, call_gpt, strip_markdown_fences

TRANSLATE_BATCH_SIZE = 10


def _translate_batch_json(batch_lines, all_lines=None, batch_start=0):
    """Translate a batch of lines using JSON format for reliable alignment.

    Args:
        batch_lines: 当前批次要翻译的 line 列表
        all_lines: 该 clip 的完整 line 列表（上下文用）。若为 None，退回仅用 batch 本身做上下文
        batch_start: 当前 batch 在 all_lines 中的起始 index（全局编号）

    Returns True on success.
    """
    n = len(batch_lines)

    # 上下文 = 整条 clip 的英文 transcript（按全局 idx 编号）
    if all_lines is None:
        all_lines = batch_lines
        batch_start = 0
    ctx_lines = "\n".join(f"[{i}] {l.get('en','')}" for i, l in enumerate(all_lines))
    first_idx = batch_start
    last_idx = batch_start + n - 1

    for attempt in range(2):
        prompt = (
            f"以下是一条播客片段的完整英文字幕（按 idx 顺序）：\n"
            f"{ctx_lines}\n\n"
            f"请把其中第 [{first_idx}] 到第 [{last_idx}] 句（共 {n} 句）翻译成中文。要求：\n"
            f"1. 口语化、简洁、不要翻译腔\n"
            f"2. 结合前后文做自然翻译（必要时可调整语序）\n"
            f"3. **尊重英文原句的完整性**：如果某句英文以逗号结尾（意味着这句话还没讲完，"
            f"下一条接着讲），中文翻译也**不要加句号**、用逗号或让它"
            f"自然悬着；只有英文以 `.` / `?` / `!` 收尾，中文才能加对应的句号/问号/感叹号\n"
            f"4. 人物/地点/数字不能换\n\n"
            f"返回纯 JSON 数组，每个元素形如 `{{\"idx\": <全局 idx>, \"zh\": \"...\"}}`，"
            f"idx 取值范围 {first_idx}–{last_idx}，顺序与原文一致：\n"
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
                    g_idx = item.get("idx", -1)
                    zh = item.get("zh", "")
                    local = g_idx - batch_start
                    if 0 <= local < n:
                        batch_lines[local]["zh"] = zh
                # 校验：每条都填上了
                if all(l.get("zh") for l in batch_lines):
                    return True
                else:
                    log(f"    JSON 翻译部分缺失（尝试 {attempt+1}/2）", "warn")
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

        # 传整条 clip 的 lines 作为上下文 + 当前 batch 的全局起始 idx
        success = _translate_batch_json(batch, all_lines=lines, batch_start=batch_start)

        if not success:
            log(f"    批次 {batch_start+1}-{batch_end} 退回逐句翻译（带上下文）...", "warn")
            # 逐句兜底也带上下文：每次把全文 + 当前句全局 idx 丢进去
            ctx_lines = "\n".join(f"[{i}] {l.get('en','')}" for i, l in enumerate(lines))
            for local_idx, line in enumerate(batch):
                if line.get("zh"):
                    continue
                g_idx = batch_start + local_idx
                prompt = (
                    f"以下是一条播客片段的完整英文字幕：\n"
                    f"{ctx_lines}\n\n"
                    f"把第 [{g_idx}] 句翻译成中文，口语化、简洁、不要翻译腔。"
                    f"如果这句英文以逗号结尾，中文也**不要加句号**，用逗号收尾或让它悬着。"
                    f"只输出中文翻译（不要前缀、不要标号）。"
                )
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
