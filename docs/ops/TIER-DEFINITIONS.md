# Flipod Tier 定义（对外交流版）

**作用**：Flipod 生产侧把音频分成 6 个 tier；本文档给跨团队对齐用（研发、设计、外部评审),不是给 LLM 用的 prompt 级定义。

**Owner**：PM（Jamesvd）+ Cowork 维护 / 修改必须回落到 `scripts/prompts/loader.py` 和 `scripts/agent/filter.py`

**源代码权威**：
- 完整 prompt 定义：`scripts/prompts/loader.py::TIER_PROMPTS`
- Duration 参数：`scripts/agent/filter.py::DURATION_LIMITS`
- 入库判断：`docs/ops/INTAKE-STANDARDS.md`

---

## 0. 为什么分 6 个 tier（而不是按主题分）

Tier **不是用户心智里的"我想听什么"**，而是**流水线选片段时的"这类音频用什么标准切"**。

不同 tier 的判断标准完全不同：
- **Story** 看叙事弧线（铺垫→冲突→落点），内容讲什么不重要
- **Business** 看有没有反直觉洞察或机制解释，纯宏观数据要丢
- **Culture** 看**集体**现象，个体生物学不算（反之归 Science）
- **Psychology** 看"对对对我也这样"的共鸣型观察，治疗鸡汤要丢

所以 tier 的分法是**按"选片段的判断逻辑"分**，不是按内容主题分。同一集 podcast 如果同时涉及多个 tier 的 topic，仍然只归一个 tier（分类时看主要内容，`EPISODE_CLASSIFY_PROMPT` 置信度 < 0.6 的归 Mixed 跳过）。

> 👉 **跟 topic（研发侧消费维度）的关系**：topic 是用户心智标签（8 个，研发定义），tier 是生产判断指令（6 个，PM 侧）。一个 clip 同时打 tier 和 topic。映射规则待会议讨论（见 `docs/DIVISION-OF-WORK.md` §3.2）。

---

## 1. 六个 Tier 速查表

| Tier | 核心判断 | Duration | 特有维度 | 典型来源 |
|---|---|---|---|---|
| **Business** | 反直觉洞察 / 机制解释 / 人物-公司故事 | 45-120s | — | Planet Money, Marketplace, Hard Fork(部分), Big Take |
| **Tech** | 技术 insight / 产业因果 / 产品体验结构化 | 60-120s | 主持人闲聊污染过滤 | Hard Fork, Vergecast, Tech Brew Ride Home |
| **Science** | 反直觉发现 / 日常机制揭示 / 具体实验故事 | 45-120s | — | Short Wave, Science Vs, Radiolab, NASA Curious Universe |
| **Psychology** | "对对对我也这样" / 经典实验复述 / 日常困境解读 | 60-120s | — | Hidden Brain, Invisibilia |
| **Culture** | 冷知识 / 当代现象的历史溯源 / 文化对比 | 60-120s | **集体**人类现象（非个体生物学） | Throughline, TED Radio Hour, StuffTheyDontWant |
| **Story** | 完整叙事弧线 + 第一人称 + 情绪/认知转折点 | 60-**150s** | `narrative_arc`（1-5 分） | The Moth, StoryCorps, Snap Judgment |

---

## 2. 每个 Tier 的定位和边界

### 2.1 Business

**装什么**：能让用户"懂了一个商业现象"的片段。三类命中即可:反直觉 insight(大公司最怕微小成功)、具体人物公司故事(Brad 写信给 Hershey 抱怨配方变化)、机制解释(信用卡怎么赚钱 / 航空为什么超售)。

**不是什么**：
- 纯宏观数据堆砌("GDP 增长 3.2%")
- 纯嘉宾公司介绍
- 股票买卖建议 / 政策合规专业内容

### 2.2 Tech

**装什么**：技术领域的非显而易见洞察。三类命中:技术 insight(LLM 出错方式和人不一样)、产业动态因果(Google 开源 Gemma 是给 Meta 踩刹车)、产品体验结构化(Cursor 在什么场景替代什么工作流)。

**不是什么**：
- 发布会报道("M4 Pro 性能提升 30%")
- 融资股价新闻
- 空谈"AI 会改变一切"
- 代码/算法细节
- 主持人之间互相 validate 的闲聊("Yeah totally" "Exactly")— **这是 Tech tier 最主要的污染源**

### 2.3 Science

**装什么**:有科学依据的"没想到"。三类命中:反直觉发现(嗅觉诊断帕金森)、日常机制揭示(打哈欠为什么传染)、具体实验故事(Dr. X 把 30 只小鼠分成两组)。

**不是什么**:
- 综述型笼统表述("Scientists have found that...")
- 嘉宾学术背景介绍开头
- **广告转场结尾** — Science tier 最常见的截断错误

### 2.4 Psychology

**装什么**:关于个体认知和行为的共鸣型内容。三类命中:"对对对我也这样"观察(白熊效应)、经典实验生动复述(Milgram、marshmallow test,但要避开教科书式开头)、日常困境的心理学解读(预算理性但还是负债)。

**不是什么**:
- 纯理论概念堆砌("cognitive dissonance is...")
- 治疗鸡汤("所以要爱自己")
- 人格分类简化("原来我们都是 X 型")
- 半截句结尾(历史上出现过"reasonable choices," 这种残缺)

### 2.5 Culture

**装什么**:**集体**人类社会现象。三类命中:冷知识(中日筷子为何不同)、当代现象的历史溯源(红绿灯为何红黄绿)、文化对比("How are you"为何不是真的想听回答)。

**不是什么**:
- 个体生物学(那是 Science)
- 编年史式时间陈述("1862 年发生 A,1864 年发生 B")
- 有政治立场的评论
- 过于小众中国用户够不到的话题

### 2.6 Story

**装什么**:第一人称完整叙事。**三个条件必须全满足**:
1. 完整叙事弧线:铺垫 → 冲突/转折 → 落点
2. 至少一个情绪/认知转折点
3. 叙述者的"我"在场(I / my / we,不是转述)

**不是什么**:
- 只有铺垫没转折(宁可延长到 150s 也不截在半路)
- 只有情绪铺垫没故事本体(纯感慨抒情)
- 过度依赖视觉描述("You should have seen his face")—— 音频看不到
- 转述他人八卦

**特殊**:
- Duration 上限是 **150s**(其他 tier 120s),因为叙事需要空间
- eval agent 除 5 个通用维度外**加评 `narrative_arc`** 维度(1-5 分),见 INTAKE-STANDARDS §4

---

## 3. 对齐研发会议要用的讨论锚点

面对"tier 和 topic 要不要合并"这个问题,用这 5 个检查项判断:

### 3.1 映射重合度
研发的 8 个 topic 能不能基本一一对应到 6 个 tier?
- 如果 80%+ 是 1:1 对应 → 合并可能是对的(双层抽象收益低)
- 如果 topic 是另一个维度(比如按"信息型/情绪型/叙事型"分) → 必须分开

### 3.2 变化频率
研发预期 8 个 topic 会变吗(加/删/改名)?
- 会变 → 必须分开。topic 每变一次 = 所有 clip 重打标,但 tier 的 prompt 不用动
- 永远不变 → 合并成本低

### 3.3 生产逻辑
Story tier 的"完整叙事弧线"这个要求,如果合并到 topic,归哪个 topic?
- 如果 topic 里有"故事"这个标签,Story tier 合并到它之后,这个 topic 在生产时仍然要保留 `narrative_arc` 维度和 150s 时长特例 — 也就是**生产逻辑照样跟别的 topic 不一样**,只是换了名字
- 如果没有"故事"topic,Story tier 的 clip 要按内容打到"心理""商业"之类的 topic,但生产时仍然按 Story 的规则选 — 也就是**tier 不能真的消失,只是"隐藏"** 

### 3.4 Tech 污染源过滤
Tech tier 有个特别规则:过滤主持人互相 validate 的开头("Yeah totally")。如果合并到 topic,这条规则挂在哪?topic 不承载生产逻辑。

### 3.5 Culture vs Science 的边界
"个体生物学归 Science,集体社会现象归 Culture"这条边界,对 LLM 选片段很关键(比如"人类嗅觉"归 Science,"不同文化如何打招呼"归 Culture)。如果合并,这条边界靠什么承载?

**PM 倾向(会前预案)**:
- 如果 3.1 的映射重合度高 + 3.2 的 topic 稳定 → 可以合并,但实际上研发不可能承诺"topic 永不变",所以现实中几乎必分开
- 分开的额外成本是**打双标**(一步 LLM 调用或映射表),单轮成本 ~$0.5,可接受
- 倾向保留双层,在 schema 里同时存 `tier` 和 `topic`

---

## 4. 变更日志

| 日期 | 版本 | 改动 | Owner |
|---|---|---|---|
| 2026-04-15 | v1.0 | 首次整合,从 loader.py + filter.py + INTAKE-STANDARDS §6 抽取对外交流版 | Cowork |

**变更流程**:修改 tier 定位 = PM 对齐 → 更新本文档 → 同步 `scripts/prompts/loader.py::TIER_PROMPTS` 和 INTAKE-STANDARDS §6。
