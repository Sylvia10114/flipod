#!/usr/bin/env python3
"""
Dry-run candidate eval agent.

输入：podcast_agent_v4 --dry-run 产出的 dry_run_candidates.json
输出：原文件 enriched，每个候选追加 agent_verdict / agent_confidence /
      agent_dimensions / agent_summary 字段。原文件先 backup。

评判标准（与 PM 对齐的版本，2026-04-14）：

红线（直接 reject）只有 2 条：
  1. 无聊：信息密度=1（嘉宾介绍 / 纯寒暄 / 纯感慨 / 广告口播）
  2. 砍断：开头或结尾是半截句（不含完整标点 / 悬挂连词 / 中途切断）

灰区（标 gray 让 PM 拍板）：
  - antecedent_phrase 出现但有内容补救
  - 软套路开头（So / Well / It's funny how / The thing about）
  - Tier 边界模糊
  - 任一维度 ≤2 但平均不低
  - 平均 3.0-3.5

通过（直接 pass）：
  - 平均 ≥3.5 且无任何维度 ≤2

用法：
  cd /path/to/listen\ demo
  python scripts/eval_candidates.py output/dry_run_2026_04_14/dry_run_candidates.json

  # 可选参数
  --batch-size 5        # 一次给 LLM 多少候选（默认 1，更稳，但慢）
  --skip-existing       # 跳过已有 agent_verdict 的候选（增量评估）
  --dry                 # 不调 LLM，只跑规则部分（红线检测）
"""

import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from agent.config import ensure_env
from agent import config as agent_config


# ── Anchor examples (few-shot for LLM) ────────────────────────────
# 9 个示例覆盖 PM 校准过的边界判断
ANCHORS = [
    # ── PASS ──
    {
        "tier": "Business",
        "opening": "How much would you pay for a watermelon?",
        "transcript_summary": "Tokyo 高端水果市场，单个甜瓜 $300，因为送礼文化",
        "ending": "They're paying for the relationship the gift will buy them.",
        "dimensions": {"opening": 5, "ending": 5, "info": 5, "standalone": 5, "tier_fit": 5},
        "verdict": "pass",
        "reason": "直接问句开头硬通过 + 反直觉商业洞察 + 完整收束"
    },
    {
        "tier": "Tech",
        "opening": "And here's what nobody in Silicon Valley wants to admit...",
        "transcript_summary": "AI 编码工具最受益的不是高级工程师，是中级开发者",
        "ending": "averaging across people who get 5x and people who get nothing.",
        "dimensions": {"opening": 4, "ending": 5, "info": 5, "standalone": 4, "tier_fit": 5},
        "verdict": "pass",
        "reason": "And 软标记起头但 hook 真，脱离上下文成立；非显而易见 Tech insight"
    },
    {
        "tier": "Story",
        "opening": "I remember the first time I lied to my mother.",
        "transcript_summary": "七岁打碎茶杯说谎，三十年后母亲临终承认一直知道",
        "ending": "It was that I'd learned, that day, that lying worked.",
        "dimensions": {"opening": 5, "ending": 5, "info": 5, "standalone": 5,
                       "tier_fit": 5, "narrative_arc": 5},
        "verdict": "pass",
        "reason": "第一人称记忆开头 + 完整铺垫-反转-落点弧线"
    },
    {
        "tier": "Psychology",
        "opening": "So the thing about anxiety is, it's not actually trying to hurt you.",
        "transcript_summary": "焦虑是误报的警报系统；技巧不是关警报，是学会判断",
        "ending": "you stop fighting the feeling and start asking it questions.",
        "dimensions": {"opening": 3, "ending": 4, "info": 4, "standalone": 4, "tier_fit": 4},
        "verdict": "pass",
        "reason": "软套路开头（So + the thing about）但内容稳，整体能听"
    },
    # ── GRAY ──
    {
        "tier": "Tech",
        "opening": "Yeah, but that's exactly what you just said about Apple — they don't really have a vision for AI...",
        "transcript_summary": "苹果没有 AI vision；微软同样困境；'being big means constraints'",
        "ending": "Which is what I think we were saying earlier about the whole AI race.",
        "dimensions": {"opening": 2, "ending": 2, "info": 3, "standalone": 2, "tier_fit": 4},
        "verdict": "gray",
        "reason": "antecedent_phrase 出现但有内容补救（立即复述苹果观点）；'being big means constraints' 是个有意思的判断；整体可听但不锐利，需 PM 拍板"
    },
    # ── REJECT ──
    {
        "tier": "Business",
        "opening": "Right, exactly. So today on the show we have John, who's the CEO of FinTech Pro.",
        "transcript_summary": "纯嘉宾介绍 + 让嘉宾自我介绍",
        "ending": "So take it away, John, the floor is yours.",
        "dimensions": {"opening": 1, "ending": 4, "info": 1, "standalone": 5, "tier_fit": 1},
        "verdict": "reject",
        "reason": "红线：信息密度=1（纯嘉宾介绍，零信息）"
    },
    {
        "tier": "Story",
        "opening": "is when I realized something was wrong.",
        "transcript_summary": "母亲在厨房沉默；说了一句话被切断",
        "ending": "She said, when you have",
        "dimensions": {"opening": 1, "ending": 1, "info": 3, "standalone": 1, "narrative_arc": 2},
        "verdict": "reject",
        "reason": "红线：开头和结尾都是半截句"
    },
    {
        "tier": "Science",
        "opening": "She told me about her research and the methodology was fascinating.",
        "transcript_summary": "称赞嘉宾研究有趣；铺垫但没有具体内容；最后接广告",
        "ending": "That's coming up right after a short break.",
        "dimensions": {"opening": 3, "ending": 1, "info": 2, "standalone": 3, "tier_fit": 2},
        "verdict": "reject",
        "reason": "红线：结尾=1（广告转场）"
    },
    {
        "tier": "Tech",
        "opening": "But so, you know, it's interesting what you just said.",
        "transcript_summary": "纯 meta 评论嘉宾刚才说的话；后续是闲聊没复述前文",
        "ending": "and that's why we keep talking about this stuff.",
        "dimensions": {"opening": 1, "ending": 2, "info": 1, "standalone": 1, "tier_fit": 1},
        "verdict": "reject",
        "reason": "红线：信息密度=1（纯 meta 闲聊无内容）+ antecedent 没补救"
    },
]


def build_eval_prompt(candidate, anchors=None):
    """构造 LLM 评估 prompt。"""
    if anchors is None:
        anchors = ANCHORS

    text = candidate.get("text", "")
    tier = candidate.get("tier", "Unknown")
    duration = candidate.get("duration_sec", 0)
    title = candidate.get("suggested_title", "")
    info_takeaway = candidate.get("info_takeaway", "")
    soft_flags = candidate.get("soft_flags", [])
    filter_result = candidate.get("filter_result", "")

    anchors_text = ""
    for i, a in enumerate(anchors, 1):
        dims = " / ".join(f"{k}={v}" for k, v in a["dimensions"].items())
        anchors_text += (
            f"\n【案例 {i}】tier={a['tier']} verdict={a['verdict'].upper()}\n"
            f"  开头: {a['opening']}\n"
            f"  内容: {a['transcript_summary']}\n"
            f"  结尾: {a['ending']}\n"
            f"  评分: {dims}\n"
            f"  判断: {a['reason']}\n"
        )

    flags_str = (
        f"  filter 结果: {filter_result}\n" +
        (f"  软标记: {soft_flags}\n" if soft_flags else "")
    )

    prompt = f"""你是 Flipod 英语播客片段的质检 agent。任务：评估一个候选片段的质量，输出 5+1 维度评分 + 综合判断。

# 评判标准（必须严格遵守）

## 红线（任一触发 → 直接 reject）
1. **信息密度=1**：嘉宾介绍 / 纯寒暄 / 纯感慨 / 广告口播 / 节目套话
2. **开头=1 或结尾=1（半截句类）**：不含完整标点 / 悬挂连词（and/but/or/which 结尾）/ 句子中途被切断
   注意：开头是 antecedent_phrase（"you said" / "that's right" / "back to your point"）但**后续立即复述/还原前文内容**的，opening 给 2-3，不算红线，标 gray 让 PM 拍板

## 5 个核心维度（1-5 分）
- **opening** 开头质量：5=直接问句/具体人物/反差数字/第一人称记忆；4=软标记 And/But/So 起头但 hook 真；3=套路开头但内容能撑（"It's funny how" "The thing about X is"）；2=antecedent 但有补救 / 弱钩子；1=半截句（红线）
- **ending** 结尾完整：5=自然落点；4=完整句但语义略散；3=完整句但收得仓促；2=完整句但悬挂感强；1=半截句/悬挂连词/广告转场（红线）
- **info** 信息密度：5=明确洞察/反直觉/完整故事；4=有信息但不够锐利；3=普通；2=信息稀薄；1=纯寒暄/嘉宾介绍/广告（红线）
- **standalone** 独立可消费：5=完全独立；4=需要少量背景但能猜；3=部分依赖前文；2=多处依赖；1=严重依赖前文
- **tier_fit** Tier 匹配：5=完美命中该 tier 的"好片段"画像；4=典型；3=沾边；2=偏移；1=串台

## Tier 边界澄清
- **Science**：自然科学（物理化学生物）+ 人体 + 行为科学 + 神经科学 + 动物
- **Culture**：**集体**人类社会现象（历史 / 习俗 / 文化对比 / 社会现象）。个体生物学不算 Culture
- **Psychology**：心理学 / 行为科学 / 个体认知模式
- **Business**：商业 / 金融 / 创业 / 公司战略
- **Tech**：技术 / AI / 互联网产品 / 科技公司
- **Story**：第一人称叙事；额外评 narrative_arc 维度（5=完整铺垫-冲突-落点；3=有铺垫无落点；1=纯感慨没故事）

## 综合判断规则
- **reject**：触发任一红线
- **pass**：5 维度平均 ≥3.5 且无任何维度 ≤2
- **gray**：其他所有情况（包括 antecedent_with_recovery、软套路开头、tier 模糊、平均 3.0-3.5、单项=2 等）

# 参考案例（学习这些判断模式）
{anchors_text}

# 待评估候选
tier: {tier}
建议标题: {title}
LLM 给的 info_takeaway: {info_takeaway}
时长: {duration:.0f}s
{flags_str}

完整转录:
{text}

# 输出格式（严格 JSON，不要任何额外文字）

{{
  "dimensions": {{
    "opening": {{"score": 4, "note": "简短理由（10 字内）"}},
    "ending": {{"score": 5, "note": "..."}},
    "info": {{"score": 4, "note": "..."}},
    "standalone": {{"score": 4, "note": "..."}},
    "tier_fit": {{"score": 4, "note": "..."}}{', "narrative_arc": {"score": 4, "note": "..."}' if tier == "Story" else ''}
  }},
  "verdict": "pass" | "gray" | "reject",
  "summary": "一句话综合判断（30 字内）"
}}
"""
    return prompt


def call_llm(prompt, max_tokens=800):
    """调 Azure GPT，返回 raw 文本。复用 agent.utils.call_gpt。"""
    from agent.utils import call_gpt
    return call_gpt([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=max_tokens)


def parse_eval_response(raw_text):
    """解析 LLM 输出 JSON。失败返回 None。"""
    if not raw_text:
        return None
    text = raw_text.strip()
    # Strip markdown fences
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 尝试找第一个 { 到最后一个 }
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
    return None


def compute_verdict_and_confidence(eval_result):
    """从 dimensions 计算最终 verdict + confidence。

    verdict 优先用 LLM 给的，但用规则兜底校验：
    - 触发红线（info=1 或 ending=1 或 opening=1 且非 antecedent）→ 强制 reject
    - 平均 ≥3.5 且无 ≤2 → 强制 pass
    - 其他 → gray

    confidence = 1 - (维度评分标准差 / 2)，越一致越高。
    """
    dims = eval_result.get("dimensions", {})
    scores = []
    for key in ("opening", "ending", "info", "standalone", "tier_fit", "narrative_arc"):
        if key in dims:
            try:
                scores.append(int(dims[key].get("score", 0)))
            except (ValueError, TypeError):
                pass

    if not scores:
        return "gray", 0.0

    avg = sum(scores) / len(scores)
    min_score = min(scores)

    # 规则兜底
    info_score = dims.get("info", {}).get("score", 5)
    ending_score = dims.get("ending", {}).get("score", 5)
    opening_score = dims.get("opening", {}).get("score", 5)

    # 红线判定（不依赖 LLM 自报 verdict，规则兜底）
    if info_score == 1:
        rule_verdict = "reject"
    elif ending_score == 1:
        rule_verdict = "reject"
    elif opening_score == 1:
        # 开头=1 是红线，但要区分半截句（reject）vs antecedent（gray）
        # LLM 自己分类：如果 LLM 标 reject → 半截句；如果 LLM 标 gray → antecedent
        # 我们尊重 LLM 在这条上的判断
        rule_verdict = eval_result.get("verdict", "reject")
        if rule_verdict not in ("reject", "gray"):
            rule_verdict = "reject"
    elif avg >= 3.5 and min_score >= 3:
        rule_verdict = "pass"
    else:
        rule_verdict = "gray"

    # Confidence：维度标准差越小越自信
    if len(scores) >= 2:
        sd = statistics.stdev(scores)
        confidence = max(0.0, min(1.0, 1.0 - sd / 2.5))
    else:
        confidence = 0.5

    return rule_verdict, round(confidence, 2)


def evaluate_candidate(candidate, dry=False):
    """评估单个候选，返回 enriched candidate（不修改原 dict）。"""
    enriched = dict(candidate)

    if dry:
        # 只跑规则部分：按 filter_result 推断
        fr = candidate.get("filter_result", "")
        if fr.startswith("rejected"):
            verdict = "reject"
        else:
            verdict = "gray"
        enriched["agent_verdict"] = verdict
        enriched["agent_confidence"] = 0.5
        enriched["agent_dimensions"] = {}
        enriched["agent_summary"] = "(--dry mode, 仅基于 filter_result)"
        return enriched

    prompt = build_eval_prompt(candidate)
    raw = call_llm(prompt)
    if not raw:
        enriched["agent_verdict"] = "gray"
        enriched["agent_confidence"] = 0.0
        enriched["agent_dimensions"] = {}
        enriched["agent_summary"] = "LLM 调用失败，需要人工审"
        return enriched

    parsed = parse_eval_response(raw)
    if not parsed:
        enriched["agent_verdict"] = "gray"
        enriched["agent_confidence"] = 0.0
        enriched["agent_dimensions"] = {}
        enriched["agent_summary"] = f"LLM 输出解析失败: {raw[:80]}"
        return enriched

    verdict, confidence = compute_verdict_and_confidence(parsed)
    enriched["agent_verdict"] = verdict
    enriched["agent_confidence"] = confidence
    enriched["agent_dimensions"] = parsed.get("dimensions", {})
    enriched["agent_summary"] = parsed.get("summary", "")
    return enriched


def main():
    parser = argparse.ArgumentParser(description="Eval dry-run candidates")
    parser.add_argument("input_file", help="Path to dry_run_candidates.json")
    parser.add_argument("--skip-existing", action="store_true",
                        help="跳过已有 agent_verdict 的候选（增量评估）")
    parser.add_argument("--dry", action="store_true",
                        help="不调 LLM，只跑规则兜底")
    parser.add_argument("--limit", type=int, default=0,
                        help="只评估前 N 个候选（调试用）")
    args = parser.parse_args()

    input_path = Path(args.input_file).resolve()
    if not input_path.exists():
        print(f"❌ 文件不存在: {input_path}")
        sys.exit(1)

    if not args.dry:
        # 加载环境变量
        try:
            from dotenv import load_dotenv
            load_dotenv(PROJECT_ROOT / ".env")
        except ImportError:
            pass
        ensure_env()

    # Backup
    backup_path = input_path.with_suffix(".backup.json")
    if not backup_path.exists():
        shutil.copy(input_path, backup_path)
        print(f"✅ 备份到 {backup_path.name}")
    else:
        print(f"ℹ️  备份已存在: {backup_path.name}（不覆盖）")

    data = json.loads(input_path.read_text())
    episodes = data.get("episodes", [])
    total = sum(len(ep.get("candidates", [])) for ep in episodes)
    print(f"📊 共 {len(episodes)} episodes, {total} 候选\n")

    evaluated = 0
    skipped = 0
    failed = 0
    verdict_counts = {"pass": 0, "gray": 0, "reject": 0}

    start = time.time()
    for ep_idx, ep in enumerate(episodes):
        candidates = ep.get("candidates", [])
        for cand_idx, cand in enumerate(candidates):
            if args.limit and (evaluated + skipped) >= args.limit:
                break

            if args.skip_existing and "agent_verdict" in cand:
                skipped += 1
                continue

            try:
                enriched = evaluate_candidate(cand, dry=args.dry)
                candidates[cand_idx] = enriched
                v = enriched.get("agent_verdict", "?")
                conf = enriched.get("agent_confidence", 0)
                title = enriched.get("suggested_title", "(无标题)")[:30]
                summary = enriched.get("agent_summary", "")[:50]
                print(f"  [{ep_idx+1}.{cand_idx+1}] {v:6s} conf={conf:.2f} | {title} | {summary}")
                verdict_counts[v] = verdict_counts.get(v, 0) + 1
                evaluated += 1
            except Exception as e:
                print(f"  [{ep_idx+1}.{cand_idx+1}] ❌ 失败: {e}")
                failed += 1

        # 增量保存（每个 episode 之后）
        input_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))

        if args.limit and (evaluated + skipped) >= args.limit:
            break

    elapsed = round(time.time() - start, 1)
    print(f"\n🎉 完成！")
    print(f"  评估: {evaluated} | 跳过: {skipped} | 失败: {failed}")
    print(f"  Verdict 分布: pass={verdict_counts.get('pass',0)} "
          f"gray={verdict_counts.get('gray',0)} "
          f"reject={verdict_counts.get('reject',0)}")
    print(f"  耗时: {elapsed}s")
    print(f"  输出: {input_path}")


if __name__ == "__main__":
    main()
