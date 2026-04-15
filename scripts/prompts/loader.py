"""Load tier-specific prompts from PROMPTS-segment-selection.md.

The prompt content is maintained by PM in the markdown file.
This module extracts the structured sections into Python constants
for use by segmentation.py.

Prompt version is read from the file header for tracking.
"""

import re
import os

_PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "prompts")
_PROMPTS_FILE = os.path.join(_PROMPTS_DIR, "PROMPTS-segment-selection.md")

# Prompt version (read from file header)
PROMPT_VERSION = "v2.1.1"  # 2026-04-15: 回滚 Patch D (prompt 末尾硬约束无效,移到 filter 层)


# ── Shared Preamble (Section 一) ──────────────────────────────

SHARED_PREAMBLE = """你是一个英语听力内容的片段筛选器。任务：从一集播客的完整转录文本中，识别出 5-6 个候选片段（后续会由评估环节精选出最终的 3 个）。

产品场景：用户是中国英语学习者（CEFR B1-B2 水平），在手机上刷短音频片段学英语。每个片段是独立的、可单独消费的内容单元，用户听完一段才决定要不要继续听下一段。

片段必须同时满足以下硬性条件（不满足直接淘汰，不要输出）：

1. **⚠️ 时长是硬约束——违反直接丢弃该候选，不要返回**

   按 tier 分化的 duration_sec 合法区间（按每分钟 150 词估算）：
   - Science / Business：**45 ≤ duration_sec ≤ 120**
   - Tech / Psychology / Culture：**60 ≤ duration_sec ≤ 120**
   - Story：**60 ≤ duration_sec ≤ 150**（故事需完整叙事弧线）

   **重要：不要返回"短但精彩"的 hook**——一个 35 秒的漂亮引语对产品无用，因为下游 filter 会直接拒绝。
   如果某个亮点只有 30-40 秒，请主动向前/向后扩展到下限以上（包含完整上下文或落点），再作为候选输出。
   如果扩展后仍然 <45s（或对应 tier 的下限），**不要返回该候选**。
   如果整集找不到 5-6 个符合时长硬约束的候选，宁可返回 2-3 个或空列表，也不要返回超界的。

2. 开头判断（分三档处理）：

   【硬拒绝】以下开头必须淘汰：
   - 纯附和响应单独成句：`Exactly.` / `Right.` / `Totally.` / `I agree.`
   - 明确指代前文的短语出现在前 15 词内：
     `you (just) said` / `what you mentioned` / `that's right` / `as I was saying` /
     `that's exactly` / `that's what I meant` / `back to your point`
   - 纯填充词开头且前 10 词无实质内容：
     `You know, [闲聊]` / `I mean, [闲聊]`

   【软标记（需要 LLM 判断）】以下开头**不自动拒绝**，但 LLM 必须验证这个开头句脱离上下文本身读得通、能作为独立 hook：
   - And / But / So / Because / Then / Well / Actually 起头
   - Yeah / Yes / No 后接实质内容（如 "Yeah. So Vortec watch company is like Vortex and Tik Tok"）
   - Or 起头的问句或假设（"Or maybe you've had this experience..."）

   软标记的判断标准：如果把前一集/前一段的内容抹去，只让用户听这句话作为第一句，会不会觉得"莫名其妙不知道在说什么"？
   - 能独立读通 → 通过
   - 必须依赖前文才懂 → 淘汰

   【硬通过】以下开头直接加分：
   - 直接问句（"Are you regular?" / "Do you have a favorite monster?"）
   - 具体人物+场景（"Brad is 70, retired in West Palm Beach, Florida..."）
   - 具体数字或反差（"90% of startups fail..." / "It happens all the time."）
   - 场景设定起步（"Let's begin in the summer of 1928." / "Picture a small town..."）
   - 第一人称记忆开头（"I remember my first cigarette almost as well as I remember my last."）

3. 结尾尽量落在完整句

   候选的末尾**建议**是完整句收束（句号/问号/感叹号/引号结尾），避免以下几类：
   - 悬挂连词结尾：and / but / or / because / which / that / to / of / in / on
   - 半截短语悬空（"an amazing..." / "I can build..." 这种）
   - 广告/节目套话结尾："coming up after the break" / "sponsored by" / "subscribe" / "stay tuned" / "we'll be right back" / "our next story"

   如果最自然的落点让 duration 超过上限（第 1 条的硬约束），优先保 duration，结尾稍弱可接受 —— filter 层会做最终检查。

4. 内部不能有明显的广告插播或节目套话转场
   - 广告特征词：sponsored by / brought to you by / this episode is supported by / for a limited time
   - 节目套话：subscribe to our newsletter / rate us on Apple / find us at...

5. 内容必须是有实质信息或情绪的段落，不是纯寒暄、纯介绍嘉宾背景、纯广告

6. 避免过度依赖"上下文才能理解"的代词开头（She said... / He was right...）——用户没听过前面的内容
"""


# ── Tier-Specific Prompts ─────────────────────────────────────

TIER_PROMPTS = {}

TIER_PROMPTS["Business"] = """这集播客的 tier 是 Business/Finance。

Business tier 的"好片段"必须命中以下至少一条：

【A. 反直觉 insight 型】
揭示一个和常识相反的商业现象或判断。
例子：
- "大公司其实最怕的不是失败，而是微小的成功——它会让你失去调整方向的动力"
- "Walmart 卖水比超市便宜，是因为它把水当作引流产品，不是为了赚水的钱"

【B. 具体人物/案例故事型】
用一个具体的人或公司的故事，带出一个可迁移的商业洞察。
例子（来自现有产出）：
- "穿着巧克力衬衫的 70 岁老人 Brad，因为一个 Reese's 配方变更写了长信给 Hershey..."
  → 引出"老用户对产品配方变化的敏感度"这个商业话题

【C. 机制解释型】
把一个常见但从没想过其运作逻辑的商业机制讲清楚。
例子：
- "信用卡公司是怎么从'让你刷卡'这件事上赚到钱的"
- "航空公司为什么总是超售机票"

【Business 的片段拒绝规则】

- 纯宏观数据堆砌，没有故事或洞察（"GDP 增长了 3.2%，失业率下降到..."）
- 纯嘉宾介绍或公司介绍（"Today we have John, who is the CEO of..."）
- 纯股票/财经分析的买卖建议
- 政策/合规专业内容（用户听不懂也用不上）

【Business 的开头钩子优先级（按强度排序）】

1. 具体反直觉数字/现象："90% 的 startup 失败，但真正的原因不是钱"
2. 具体人物切入："Brad is 70, retired in West Palm Beach, Florida..."
3. 一个商业悖论问题："为什么 Netflix 明明亏钱还在拼命投内容？"
4. 一个场景描述："走进 Costco，你有没有想过他们为什么把热狗定价 $1.50 二十年没变？"
"""

TIER_PROMPTS["Tech"] = """这集播客的 tier 是 Technology。

Tech tier 的"好片段"必须命中以下至少一条：

【A. 非显而易见的技术 insight】
不是"AI 很厉害"这种行业常识，而是对某个具体技术现象的深入观察。
例子：
- "LLM 出错的方式和人出错的方式根本不一样——它的错误是结构性的，不是疲劳导致的"
- "自动驾驶最难的不是识别障碍物，是判断其他司机下一秒会不会变道"

【B. 产业动态的因果解读】
不是报道"谁融了多少钱"，而是解释"为什么现在发生这件事"。
例子：
- "Google 这次开源 Gemma，看起来是慷慨，实际上是给 Meta 的 Llama 生态踩刹车"
- "苹果为什么至今没有真正的 AI 产品？不是技术问题，是他们的隐私承诺和 AI 训练范式根本冲突"

【C. 具体产品/工具的使用体验的结构化总结】
不是"我觉得 Cursor 很好用"，而是"Cursor 在什么场景下替代了什么工作流"。

【Tech 的片段拒绝规则】

- 纯产品发布会内容（"他们发布了新的 M4 Pro，性能提升了 30%..."）
- 纯融资/股价新闻
- 空谈"AI 会改变一切" / "这是划时代的"
- 过度专业的代码细节或算法细节（用户听不懂）
- 两个主持人互相 validate 的闲聊（"Yeah totally" "Exactly" "You're so right"）——这类往往占据开头

【Tech 特别警示】

现在 Tech tier 的主要污染源是**播客主持人之间的闲聊**（如 Hard Fork、Vergecast），他们会用很多 "but so you know..." "it's interesting what you just said..." 起头。这些开头必须被过滤。

【Tech 的开头钩子优先级】

1. 具体事件 + 因果问："OpenAI 最近解雇了 GPT-4 的主要开发者，为什么？"
2. 反直觉技术判断："大多数人以为 AI 的瓶颈在算力，其实在数据标注的人力成本"
3. 具体产品场景："我用 Claude 重写了一个跑了 8 年的 Python 脚本，结果..."
"""

TIER_PROMPTS["Science"] = """这集播客的 tier 是 Science。

Science tier 的"好片段"必须命中以下至少一条：

【A. "没想到"的发现型】
一个违反直觉但有科学依据的现象。
例子（来自现有产出）：
- "Les 和我 16 岁认识，他身上有一种 male musk 的香味..."
  → 引出"嗅觉诊断帕金森病"这个反直觉发现

【B. 日常现象的机制揭示】
一个大家天天经历但从没想过为什么的事。
例子：
- "你饿的时候为什么会心烦？不是胃在叫，是大脑在跟你谈判"
- "打哈欠为什么会传染？科学家花了 20 年才搞清楚"

【C. 具体实验故事】
一个具体研究者做的具体实验，带出方法和发现。
不是综述型"科学家研究发现..."，而是"Dr. X 把 30 只小鼠分成两组..."。

【Science 的片段拒绝规则】

- 纯术语堆砌，没有具体场景或故事
- 综述型笼统表述（"Scientists have found that..."）
- 开头就是嘉宾介绍（"Our guest today is Dr. Smith, a neuroscientist at MIT..."）
- 结尾是广告转场（"That's coming up right after a short break"）——⚠️ 这是 Science tier 最常见的截断错误

【Science 的开头钩子优先级】

1. 日常问题的重新包装："Are you regular?" (关于排便)
2. 具体人物 + 悬疑："Les 身上有一种奇怪的气味..."
3. 反直觉数字："你身体里 90% 的细胞不是人类细胞"
4. 场景还原："1928 年的奥运会，女性第一次被允许参加田径..."
"""

TIER_PROMPTS["Story"] = """这集播客的 tier 是 Storytelling（The Moth、StoryCorps、Snap Judgment 等叙事型播客）。

Story tier 的评判标准和其他 tier 完全不同——结构比信息更重要。

【Story tier 的"好片段"必须满足以下全部条件】

1. 完整的叙事弧线：铺垫 → 冲突/转折 → 落点
   - 如果一个故事有铺垫但没转折，宁可延长到 150 秒也不要截在半路
   - 如果只有转折没有铺垫（听众不知道背景），也不行

2. 至少一个明确的情绪/认知转折点
   - 情绪转折：平静 → 紧张、快乐 → 失落、期待 → 失望
   - 认知转折：以为 X → 发现 Y、相信 X → 怀疑 X

3. 叙述者的"我"在场
   - 必须是第一人称讲述（I / my / we）
   - 不能是转述他人的故事

【Story 的结构模式参考（选符合其中一种的片段）】

模式一：对比开头 → 事件 → 反转
- 例："I remember my first cigarette almost as well as I remember my last."
  → 中间讲戒烟的痛苦过程
  → 结尾是意想不到的胜利或失败

模式二：场景设定 → 冲突升级 → 顿悟
- 例："It was 3am and my father called me for the first time in 10 years."
  → 中间讲为什么 10 年没联系
  → 结尾是一句话总结领悟

模式三：日常 → 异常 → 改变
- 例："Every morning I took the same bus. Until one day..."

【Story 的片段拒绝规则】

- 只有情绪铺垫没有故事本体（纯感慨、纯抒情）
- 故事在高潮前被截断（听完不知道发生了什么）
- 过度依赖视觉描述（"You should have seen his face..."）——音频里看不到
- 讲别人的八卦（"My friend Sarah once..."）——缺乏亲历者的权重

【Story 的时长特例】

故事类允许 90-150 秒（比其他 tier 上限更高），因为完整叙事需要空间。
但如果超过 150 秒，说明这个故事切不出一个独立片段，放弃。
"""

TIER_PROMPTS["Psychology"] = """这集播客的 tier 是 Psychology/Behavioral Science（Hidden Brain 等）。

Psychology tier 的"好片段"必须命中以下至少一条：

【A. "对对对我也这样"型观察】
一个普遍但没人说破的心理现象。
例子：
- "你有没有发现，越是告诉自己'不要想那只白熊'，越会想到白熊？"
- "为什么我们明明知道熬夜不好，但越累越不想睡？"

【B. 经典心理学实验的生动复述】
Milgram、Zimbardo、marshmallow test 这些经典实验，用故事化方式讲出来。
但必须避免："今天我们来讲 Milgram 电击实验..."这种教科书式开头。

【C. 日常困境的心理学解读】
一个大家都遇到过的社交或情绪困境，从心理学角度给出解释。
例子（来自现有产出）：
- "It happens all the time. 你做对了所有事——预算、计划、理性选择——但还是陷入债务..."
  → 引出"中产阶级负债机制"的心理学视角

【Psychology 的片段拒绝规则】

- 纯理论概念堆砌（"cognitive dissonance is the state where..."）
- 治疗鸡汤（"所以要爱自己"）
- 鸡汤化的过度简化（"原来我们都是 X 型人格"）
- 嘉宾背景介绍占据开头
- 片段结尾是半截句（⚠️ 现有 Psychology 产出里出现过"reasonable choices,"这种结尾，必须杜绝）

【Psychology 的开头钩子优先级】

1. 读者代入型问句："你有没有过这种感觉——..."
2. 反直觉断言："我们都以为理性思考能做出更好的决定，但研究发现..."
3. 普遍现象描述："It happens all the time..."
4. 具体场景故事："Sarah 走进超市，本来只想买牛奶..."
"""

TIER_PROMPTS["Culture"] = """这集播客的 tier 是 Culture/Society/History（Throughline、TED Radio Hour、StuffTheyDontWant 等）。

Culture tier 的"好片段"必须命中以下至少一条：

【A. 冷知识型】
一个听完会想立刻告诉朋友的文化/历史冷知识。
例子：
- "为什么筷子在中国是两根一样长，在日本却是尖头短？"
- "可口可乐的原始配方里真的有可卡因——持续到 1903 年"

【B. 当代现象的历史溯源】
把一个今天司空见惯的事追溯到它的起源。
例子：
- "我们今天说'周末'是两天，但在 1900 年之前，'周末'只是指周日下午"
- "为什么全世界的红绿灯都是红黄绿？因为铁路信号的遗产"

【C. 文化对比型】
两种文化对同一件事的不同处理，带出结构性差异。
例子：
- "为什么美国人互相打招呼问 'How are you?'，但并不真的想听你回答？"

【Culture 的片段拒绝规则】

- 纯编年史式的时间陈述（"1862 年，A 发生；1864 年，B 发生..."）
- 政治立场明显的评论（产品要避免政治倾向）
- 过于小众的文化话题（中国用户听不懂也用不到）
- 节目主持人之间的玩笑互动开头

【Culture 的开头钩子优先级】

1. 具体问题："Do you have a favorite monster?"
2. 场景还原："Let's begin in the summer of 1928..."
3. 反直觉对比："我们以为 X 是现代发明，其实古罗马就已经有了"
4. 熟悉事物的陌生化："你每天喝的咖啡，其实是一场阿拉伯植物走私案的遗产"
"""


# ── Episode Classification Prompt (Section 八) ────────────────

EPISODE_CLASSIFY_PROMPT = """你是播客分类器。下面是一集播客的标题、描述和前 500 词转录。

请判断这集内容最适合归到以下哪个 tier：
- Business：商业、金融、创业、公司战略、市场分析
- Tech：技术、AI、互联网产品、科技公司
- Science：自然科学、医学、物理化学生物等基础研究
- Story：个人叙事、回忆、故事型内容
- Psychology：心理学、行为科学、社会学
- Culture：历史、文化、社会现象、人文地理

只输出 JSON：{"tier": "Business", "confidence": 0.85, "reason": "本集主要讲..."}

如果置信度 < 0.6，tier 设为 "Mixed"（后续会跳过这集不处理）。"""


# ── Shared Output Format (Section 九) ─────────────────────────

SHARED_OUTPUT_FORMAT = """
输出格式（严格 JSON，不要额外解释）：

{
  "segments": [
    {
      "start_word_index": 450,
      "end_word_index": 620,
      "start_time": 180.5,
      "end_time": 248.2,
      "duration_sec": 67.7,
      "reason": "简短说明为什么这段符合 tier 标准（20 字以内，给内部审核看）",
      "info_takeaway": "用户听完这一段能带走的核心信息或洞察（一句中文，30-50 字，给前端卡片展示）",
      "suggested_title": "中文钩子标题（10-18 字）",
      "hook_type": "counterintuitive|character|question|scene|contrast",
      "hook_strength": "high|medium|low",
      "completeness": "high|medium|low",
      "risk_flags": []
    }
  ]
}

segments 数组要求 5-6 个候选（后续环节会精选出 top 3）。
如果整集找不到 3 个符合标准的候选，输出 "segments": []，不要强行凑数。
"""


def build_segment_prompt(tier, podcast_name, episode_title, seg_text, duration_minutes):
    """Assemble the full segment-selection prompt for a given tier.

    Returns the complete prompt string ready to send to GPT.
    """
    tier_body = TIER_PROMPTS.get(tier, "")
    if not tier_body:
        # Fallback for unknown tier — should not happen in normal flow
        tier_body = "优先选择信息密度高、有独特视角或有趣观点的段落。"

    return f"""{SHARED_PREAMBLE}

{tier_body}

播客: {podcast_name}
集名: {episode_title}
时长: {duration_minutes:.1f} 分钟

转录文本:
{seg_text}

{SHARED_OUTPUT_FORMAT}"""
