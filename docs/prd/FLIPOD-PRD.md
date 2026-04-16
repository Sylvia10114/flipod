# Flipod 产品需求文档（统一版）

> 2026-04-16 · PM: Jamesvd · 本文档合并自 TEACHING-SYSTEM-SPEC v2/v2.1、TEACHING-RULES-v3、PENCIL-v3-flow、SCHEMA-EXTENSION、TEACHING-EXAMPLE-B1 等文件，是唯一的产品真理源。

---

## 一、产品定位

Flipod 是一个英语播客听力学习 App（iOS 风格）。用户在仿抖音的 Feed 流中上下滑动听不同的播客片段（clip），每段 30-90 秒。核心差异化：**在真实播客语料上做结构化听力教学**——DuoRadio 用 TTS 角色扮演模拟不出真人播客的语速变化和口音多样性，YouTube 听力频道有真实语料但缺少交互式练习，Flipod 站在两者的交叉点上。

音频通过 HTTPS 实时播放，不存本地。所有练习内容由 AI 生成（规避版权）。

---

## 二、产品结构总览

```
冷启动 OB
  ├─ 听 4 段 → 确认 CEFR 水平
  └─ 选兴趣标签 → 加载动画 → 进入主界面

主界面
  ┌────────────────────────────┐
  │  [ 纯听 ]  [ 学习 ]  ← Tab │
  ├────────────────────────────┤
  │                            │
  │        Feed 卡片            │
  │   (scroll-snap, 仿抖音)    │
  │                            │
  ├────────────────────────────┤
  │  ☰ 侧边菜单                │
  │    ├─ 📚 我的收藏（纯听）    │
  │    ├─ 🎧 听力练习（AI 生成） │
  │    ├─ 📝 生词本              │
  │    └─ ⚙️ 设置               │
  └────────────────────────────┘

纯听 Tab：Feed → Feed → Feed …（无教学）
学习 Tab：Feed → Phase 1-4 → Feed → Phase 1-4 → …
```

两条产品线共享用户画像（CEFR 估值 + 兴趣标签 + 生词本），但触发方式、内容来源、练习深度完全不同：

| 维度 | Feed 内嵌教学（学习 Tab） | 听力练习（侧边菜单） |
|---|---|---|
| 触发方式 | 每个 clip 播完自动展开 | 用户主动进入 |
| 内容来源 | 基于当前 clip 的真人播客 | AI 从零生成短文 + TTS |
| 练习深度 | 轻——词义连线配对 | 重——三轮递进听力训练 |
| 设计意图 | 听后即时巩固，不打断心流 | 深度训练，主动练习 |
| 音频 | 原播客音频 | TTS 生成音频 |

---

## 三、教学设计的理论基础

### 听力理解的双通道模型

学术界把听力理解分为两条平行通路，缺一不可：

**Bottom-up（自下而上）**：从声音信号出发 → 辨音 → 识词 → 解析语法 → 组装意义。瓶颈在于 connected speech（连读、弱读、省音、同化），这是中国学习者听力的头号杀手——学习者逐词读能懂，连续语流里就听不出来。

**Top-down（自上而下）**：从背景知识 + 语境预期出发 → 预测内容 → 验证猜测 → 填补漏洞。依赖 schema（图式）和对话题的熟悉度。

Flipod 的播客切片天然提供了丰富的 top-down 脚手架（话题熟悉、语境完整）。Feed 内嵌教学侧重 top-down 巩固（词汇 + 主旨理解），听力练习独立模块通过三轮递进补足 bottom-up 训练（精确解码）。

### Vandegrift 元认知教学循环（MPC）

Larry Vandegrift 的实验证明，经过元认知策略训练的学习者显著优于对照组。核心循环：**预测（Predict）→ 首听验证（Monitor）→ 二听修正（Problem-solve）→ 评估反思（Evaluate）**。

关键洞察：听力不是"听一遍懂不懂"的测试，而是"多轮逼近理解"的过程。Feed 内嵌教学的 Phase 1 Gist 题引入了"答错 → 聚焦提示 → 带着问题二听"的简化版循环。听力练习模块的三轮递进（全字幕 → 挖空 → 盲听）则是这个循环在独立模块中的完整实现。

### Dictation（听写）的研究支撑

听写强化听力精度和语法意识，是 YouTube 英语教学频道的主力方法。研究表明听写迫使学习者从声音信号精确解码到文字，是最直接的 bottom-up 训练手段。听写训练的核心价值在于"精确解码"这个认知过程，不依赖音源是否真人。AI 生成内容 + TTS 朗读完全能承载这个训练目标，同时规避版权问题。

### DuoRadio 的产品验证

Duolingo 2025 年推出 DuoRadio，半年内日活从 50 万涨到 500 万，验证了"短音频 + 即时理解检测"模式的市场需求。Flipod 与 DuoRadio 的差异化在于：Flipod 用的是真人真实播客，不是 TTS 角色扮演。

### i+1 可理解输入假说

Krashen 的理论：学习者接收到的内容应该略高于当前水平（i+1）——太低无聊，太高放弃。Flipod 的所有难度决策都围绕这一条：永远比用户的实际水平高一点点，让他够一够能够到。

---

## 四、冷启动 OB 流程

### 屏 1：听力水平测试

用户第一次打开 App，听 4 段短音频（每段约 15 秒）来确认 CEFR 水平。每段听完选择理解程度：完全听懂了 / 听懂了大概意思 / 基本没听懂。4 个进度圆点指示当前进度。底部小字"你可以随时在设置中重新测试"。

### 屏 2：选兴趣标签

水平测试完成后选兴趣话题。标签网格（flex wrap），每个标签胶囊形，选中态紫色高亮。标签内容：商业、科学、故事、科技、社会、文化、历史、心理、音乐、体育、电影、美食。要求选 3 个以上。

### 屏 3：加载过渡

纯黑背景，中央 3 条跳动竖线音频波形 + "正在为你挑选内容…"。底部淡入"你的水平：B1 · 已选 4 个话题"。

---

## 五、纯听 / 学习 Tab

### UI 位置

Feed 卡片上方，两个文字 Tab，下划线指示当前模式。

### 切换行为

纯听 → 学习：如果当前 clip 还没播完，从当前 clip 开始启用教学；如果已播完，下一个 clip 开始。

学习 → 纯听：如果教学正在进行中，教学卡片淡出，恢复 auto-advance。

模式持久化到 `localStorage.flipodMode`。

### 纯听模式

Feed → Feed → Feed，无教学插件。所有 TeachingPlugin 的 hook 调用走空逻辑（`setMode('listen')` 后插件内部短路返回）。

---

## 六、Feed 内嵌教学（学习 Tab）

### 行为优先原则（贯穿所有 Phase）

用户在听 clip 的过程中点词查翻译、收藏生词——这些行为是用户亲手告诉系统"我不会这个"，比任何算法选词都准确。**用户行为是第一优先级，算法选词是兜底。**

听中行为采集（播放过程中实时记录）：用户点击了哪些词查看翻译（记录词 + 时间戳 + CEFR 等级）、用户将哪些词加入了生词本、用户在哪些位置回放了（可能是没听懂的区域）。

行为 → 教学内容的映射规则：Phase 2 词汇卡片优先展示用户点击/收藏过的词，剩余名额用 i+1 算法补齐；Phase 3 练习题优先用用户点击/收藏的词出题。用户会明确感知到"我刚才点的词，马上就出现在练习里了"——这个反馈闭环是产品体验的核心。

边界情况处理：用户点了 0 个词 → 完全回退到 i+1 算法选词（当前 CEFR 水平 +1 级的词）。用户点了 1-5 个词 → 全部进入词汇卡 + 练习，剩余名额用算法补齐。用户点了 6+ 个词 → 取最接近 i+1 等级的 3-5 个，其余存入生词本但不进入本次练习（一次教太多记不住）。用户只点了 A1 词 → 依然尊重用户判断，展示这些词，但额外补 1 个 i+1 词。

### Phase 1 — Gist 检测 + 二听循环

**触发**：clip 播放结束（学习 Tab 下）。

**规则**：clip 有 `questions[]` → 取 `questions[0]`，显示题目 + 4 选项。clip 没有 `questions[]` → 跳过 Phase 1，直接进 Phase 2。

**按 CEFR 水平调整**：

| 用户水平 | 题目语言 | 选项设计 | 答错后 |
|---|---|---|---|
| A2 | 中文出题 | 选项直白，对应 clip 中的明确信息 | 中文提示 + 引导重听 |
| B1 | 英文出题 | 选项需要归纳，不是原文照搬 | 英文提示 + 引导重听 |
| B2+ | 英文出题 | 推断题（态度/隐含意义/因果关系） | 仅提示重听位置 |

**答对**：显示 `explanation_zh` 反馈 → 1.5s 后进 Phase 2。可选展示关键线索反思（"这段的关键线索在 '...the real reason is...' 这句"），帮用户意识到自己是怎么听懂的。

**答错**：高亮正确选项 + 显示解释。给出聚焦提示（"再听一遍，注意 0:23 附近他怎么解释原因的"）+ 自动跳到相关片段重播。这是 Vandegrift 循环里的"带着问题二听"。允许手动继续。

**跳过**：右上角"跳过"灰字，直接进 Phase 2。Phase 1 旁边额外一个"跳过全部练习" → 直接 auto-advance 到下一个 clip。

**版权**：无（questions 是 pipeline 自行生成的内容）。

### Phase 2 — 词汇卡片

**触发**：Phase 1 结束。

**选词规则（最多 3 个）**：

```
优先级 1：用户收藏词（saved_words）→ 无条件选入
优先级 2：用户点击词（clicked_words）→ 过滤到用户等级 ±1 级
优先级 3：算法补齐 → 从 clip.words 中选 cefr = 用户等级+1 的词
           排除 PN、null、A1、flipodKnownWords 中的词
```

**按 CEFR 水平调整**：

| 用户水平 | 标注范围 | 数量 | 释义语言 |
|---|---|---|---|
| A2 | A2-B1 词 | 2-3 个 | 中文释义 + 英文例句 |
| B1 | B1-B2 词 | 3-5 个 | 中文释义 + clip 上下文 |
| B2+ | B2-C1 词 | 3-5 个 | 英文释义优先，中文辅助 |

**词卡 UI**（横滑卡片，每张占屏幕宽度 ~70%，露出下一张边缘暗示可滑动）：

每张词卡内容（全部 AI 可生成，不引用原文）：词（大号粗体）+ CEFR 等级标签（小胶囊）、行为标签（「你查过这个词」/「你收藏了这个词」）— 仅行为词有、中文释义、AI 生成例句（标注"AI 例句"，左侧紫色竖线，斜体）— 不用原文句子、「+ 加入生词本」按钮。

**0 个词被选中时**：跳过 Phase 2 和 3，直接进 Phase 4。

**版权**：无（词汇是单词级别不受版权保护，例句由 AI 生成）。

### Phase 3 — 词义连线配对

**触发**：Phase 2 点击「练习一下 →」CTA。

**设计意图**：用户刚听完一段真人播客，认知上已经疲了。Phase 3 需要的是一个轻量的、有游戏感的交互来巩固刚学的词，而不是再来一轮高认知负荷的听力训练。重的听力训练留给侧边菜单的听力练习模块。

**题型**：点词连线（英文词 ↔ 中文释义配对）。纯前端实现，无需 API 调用。

**布局**：左列 3 个英文词按钮（竖排），右列 3 个中文释义按钮（竖排，顺序与左列打乱），中间区域留给连线动画。

**交互流程**：用户点击左列一个英文词 → 该词高亮选中。点击左列英文词时 TTS 朗读该词（再练一遍听力）。再点击右列一个中文释义 → 判断是否匹配。配对正确 → 绿色连线 + 两端按钮变绿 ✓。配对错误 → 红色闪烁 + 取消选中，可重选。全部 3 对完成 → 进 Phase 4。

**数据来源**：Phase 2 选出的 3 个词 + 对应中文释义。

**版权**：无（单词 + 释义不涉及原文）。

### Phase 4 — 总结 + 难度反馈

**触发**：Phase 3 完成 / Phase 2 跳过。

**内容**：统计格（新词数 / Gist 结果 / 配对正确数）→ 生词本卡片（词列表 + "全部加入生词本"按钮）→ 难度反馈三选一（「太简单」/「正合适」/「有点难」）→「下一个 →」CTA。

**难度反馈影响**：太简单 → CEFR +0.3，有点难 → CEFR -0.3。

### 跳过机制

每个 Phase 都有「跳过」按钮（跳过当前 Phase，进入下一个）。Phase 1 旁边额外一个「跳过全部练习」→ 直接 auto-advance 到下一个 clip。连续 3 次跳过全部练习 → 后续 clip 折叠为 mini 入口「学一下？」。点 mini 入口 → 重置计数，展开完整教学。

### 教学降级机制

当一个 clip 对用户来说偏难（clip 难度 ≥ 用户水平 +2 级），教学侧自动降级：Phase 1 Gist 题降为二选一，答错直接给答案 + 解释而不是引导重听。Phase 2 词汇卡数量减到 1-2 个。Phase 3 不展示练习入口（这个 clip 拿来"泛听感受"就好）。降级时不做任何提示（不让用户感知到"这对你太难了"）。

### Feed 流体验变化

| 项目 | 纯听 Tab | 学习 Tab |
|---|---|---|
| clip 播完后 | 自动播下一个 | 展开教学区 → 跳过后播下一个 |
| autoplay | 无间断 | Gist 出现时暂停，跳过或答完后继续 |
| 卡片高度 | 固定 | 播完后向下展开教学区域 |

---

## 七、听力练习（侧边菜单独立模块）

### 定位

用户在 Feed 中听了播客、学了几个词，想要更深度的练习。但不能用原播客内容做练习（版权），所以 AI 根据用户画像生成一段全新的听力材料，配合 TTS 音频，做递进式听力训练。

入口：侧边菜单 🎧"听力练习"，副标题"AI 根据你的生词本生成专属练习"，红点 badge 显示待练习数。

### 三层架构

```
┌─────────────────────────────────────────┐
│            用户画像输入                    │
│  CEFR 等级 + 兴趣 tags + 生词本          │
│  + 触发来源 clip 的 tag/difficulty        │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│          生成层 (Generation)              │
│                                         │
│  GPT API → 生成 100-150 词短文           │
│  输入：CEFR 等级、话题、必须嵌入的词汇    │
│  输出：                                  │
│  {                                      │
│    title, text, lines[{en, zh,          │
│    target_words}], vocabulary[{word,     │
│    definition_zh, cefr}]                │
│  }                                      │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│          音频层 (Audio)                   │
│                                         │
│  TTS API → 生成音频 + 词级时间戳          │
│  合并后输出标准 ClipData shape            │
│  → 可直接喂给前端字幕渲染                 │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│          练习层 (Exercise)                │
│  三轮递进（同一段材料）                    │
└─────────────────────────────────────────┘
```

### 练习层：三轮递进

**Round 1 — 全字幕听**：音频播放 + 完整英文字幕 + 中文翻译。目的是在有脚手架的情况下建立语境理解。听完后出一道主旨理解题（AI 自动生成）。

**Round 2 — 挖空听**：同一段音频重播，字幕中目标词变成空格（`_____`）。用户在听到目标词时实时填词（点击或输入）。听完显示正确率。训练的是"在语流中辨认特定词"的 bottom-up 能力。

**Round 3 — 盲听**：音频再播一遍，无字幕。完全靠前两轮建立的理解来听。听完后出完形填空（全文挖空多个词）+ 难度反馈 + 词汇回顾。

设计意图：同一材料的渐进脱手——从全辅助到半辅助到零辅助，三轮下来把"被动认识"逼成"主动识别"。

### 状态机

```
INIT → ROUND1_PLAY → ROUND1_QUIZ
     → ROUND2_PLAY → ROUND2_RESULT
     → ROUND3_PLAY → ROUND3_QUIZ
     → COMPLETE
```

状态转移（含 skip）：

```javascript
const transitions = {
  INIT:           { loaded: ROUND1_PLAY },
  ROUND1_PLAY:    { ended: ROUND1_QUIZ },
  ROUND1_QUIZ:    { done: ROUND2_PLAY, skip: ROUND2_PLAY },
  ROUND2_PLAY:    { ended: ROUND2_RESULT },
  ROUND2_RESULT:  { next: ROUND3_PLAY, skip: COMPLETE },
  ROUND3_PLAY:    { ended: ROUND3_QUIZ },
  ROUND3_QUIZ:    { done: COMPLETE },
  COMPLETE:       { restart: ROUND1_PLAY, exit: null }
};
```

### CEFR 适配

| 用户水平 | Round 2 挖空听 | Round 3 盲听 |
|---|---|---|
| A2 | TTS 慢速，只挖 1-2 个高频词，每句可重播 2 次 | 完形只挖 2-3 个词 |
| B1 | TTS Normal 速，挖 3 个词，可重播 1 次 | 完形挖 4-5 个词 |
| B2+ | TTS Natural 速（含连读弱读），挖 4-5 个词，仅 1 次播放 | 完形挖 6+ 个词 |

### 生成层 Prompt 模板

```
你是一个英语听力教材编写专家。

请根据以下条件生成一段 100-150 词的英文短文：

学习者水平：{cefr_level}（请确保语言难度匹配）
话题领域：{tag}（如 business / science / story）
必须自然嵌入的词汇：{words}（这些词必须在文中出现至少一次）

要求：
1. 内容有信息量，不是空洞的教科书语言
2. 语速和句式符合 {cefr_level} 的听力难度
3. 词汇嵌入要自然，不能为了塞词造硬句
4. 写完后逐句提供中文翻译
5. 标注每个目标词汇在哪一句中出现

输出 JSON 格式：
{
  "title": "短文标题",
  "text": "完整英文文本",
  "lines": [
    { "en": "第一句英文", "zh": "第一句中文", "target_words": ["debt"] }
  ],
  "vocabulary": [
    { "word": "debt", "definition_zh": "债务", "cefr": "B2" }
  ]
}
```

### 数据流

```
用户点击「听力练习」
  ├─ 从 flipodVocab 取最近收藏的 3-5 个词
  ├─ 从 flipodUserCEFR 取当前等级
  ├─ 从触发 clip 取 tag
  ▼
生成层：GPT → { title, text, lines[], vocabulary[] }
  ▼
音频层：TTS → { audio_blob, word_timestamps[] }
  ├─ 合并成标准 ClipData shape
  ├─ 缓存到 localStorage
  ▼
练习层：渲染 UI → 三轮递进 → 完成
  ├─ 写入 flipodPracticeLog
  ├─ 更新 flipodUserCEFR
  └─ 可选：生词本增量更新
```

### 缓存策略

每次生成的练习材料缓存 key = `practice_{cefr}_{tag}_{words_hash}`。同一组输入不重复生成。缓存保留最近 10 条，超出 LRU 淘汰。用户可以「换一篇」强制重新生成。

---

## 八、CEFR 难度适配体系

### 第一层：Clip 难度标签（pipeline 预计算）

每个 clip 在 pipeline 阶段就算好难度，不依赖运行时计算：

CEFR 词汇分布：B2+ 词汇占比。**注意：专有名词（人名、地名、品牌名）需单独处理——常见地名/人名标为 A1-A2，品牌名不计入难度统计。**

语速：从 Whisper word timestamps 算 WPM。

平均句长：从 segment 数据算。

三个指标加权出一个 clip 难度等级：A2 / B1 / B1+ / B2 / B2+（5 档）。写入 clip 元数据。

### 第二层：用户水平评估（三信号融合）

**信号 1：冷启动自评（OB 流程）**。"你平时听英语播客能听懂多少？"三选一 → 映射到初始 CEFR 估值 A2 / B1 / B2。这只是起点，会被后续信号快速修正。

**信号 2：前 5 个 clip 的教学表现**。Gist 题正确率 + 词汇卡中用户点击查看释义的词的 CEFR 分布。首次定级后 5 个 clip 内完成校准。

**信号 3：持续行为数据（被动采集，最高权重信号）**。听中点词翻译的频率和词级别（最强信号）、生词本收藏行为（比点词更强）、Gist 正确率（滚动最近 10 个 clip）、clip 内重播次数和位置、Phase 3 配对正确率、跳过率、Phase 4 难度反馈选择。

三个信号加权融合，输出一个用户当前 CEFR 估值（连续值，如 B1.3），持续滚动更新。

### 第三层：Feed 侧适配（轻挂钩）

Feed 不做严格的难度过滤（否则低水平用户内容池太浅），而是做排序权重倾斜：用户估值 B1 → 优先排 B1 和 B1+ 的 clip（i+1），A2 和 B2+ 的排后面但不隐藏。核心逻辑：每个 clip 只要存在适合用户学习的点就可以推。只有当一个 clip 对该用户完全没有教学下手点时才降权到底部。不做硬过滤，用户手动下滑永远能看到所有内容。

### 第四层：教学侧适配（严格挂钩 CEFR）

同一个 clip，不同水平的用户看到的教学内容完全不同。详见各 Phase 的 CEFR 适配表（Phase 1-4 各节）。

### i+1 的动态校准

用户 Gist 正确率持续 > 80%（最近 10 个 clip）：CEFR 估值上调 0.2，Feed 开始多推高一档的 clip。用户 Gist 正确率 < 40%：CEFR 估值下调 0.3（下调比上调快，避免用户在"太难"区间待太久）。Phase 3 正确率作为辅助校准信号。校准有上限和下限：估值不低于自评结果 -1 级，不高于自评 +2 级（防止行为数据抖动导致大跳）。

---

## 九、数据 Schema

### 教学插件标准接口（ClipData shape）

教学模块作为独立插件运行，不关心 clip 数据从哪来（本地 / CDN / 实时 API），只要传入的 clip 满足以下 shape 即可触发教学：

```typescript
interface ClipData {
  title: string;
  tag: string;
  source: { podcast: string };

  lines: Array<{
    en: string;
    zh: string;
    start: number;
    end: number;
    words: Array<{
      word: string;
      start: number;
      end: number;
      cefr: string | null;  // A1-C2 / PN / null
    }>;
  }>;

  // 可选：pipeline 预生成的理解题
  questions?: Array<{
    question: string;
    options: string[];
    answer: string;         // "A"/"B"/"C"/"D"
    explanation_zh: string;
  }>;

  // 可选
  info_takeaway?: string;
  collocations?: string[];
}
```

### data.json 新增字段

在现有 clip 数据结构上增量扩展，不改动已有字段。

#### `difficulty` — Clip 难度标签

```jsonc
{
  "difficulty": {
    "level": "B1+",                // A2 / B1 / B1+ / B2 / B2+ 五档
    "wpm": 145,                    // 语速
    "avg_sentence_length": 9.3,    // 平均句长
    "cefr_distribution": {         // 各等级词汇占比（修正专有名词后）
      "A1": 0.58, "A2": 0.12, "B1": 0.11,
      "B2": 0.10, "C1": 0.05, "C2": 0.04
    },
    "proper_nouns": ["Brad", "Florida"]
  }
}
```

计算规则：`wpm` = 总词数 / (最后一个 word.end - 第一个 word.start) × 60。`level` = 加权公式：B2+占比 × 0.5 + wpm 归一化 × 0.3 + 句长归一化 × 0.2 → 映射到五档。

#### `teaching` — 教学内容（pipeline 预生成）

```jsonc
{
  "teaching": {
    "gist": {
      "question": "What is the main idea of this clip?",
      "options": [
        { "text": "...", "correct": false },
        { "text": "...", "correct": true },
        { "text": "...", "correct": false }
      ],
      "focus_hint": {
        "text": "Listen again around 1:21...",
        "timestamp": 84.16
      },
      "correct_insight": "关键线索在...",
      "difficulty_variants": {
        "A2": { "question": "这段主要讲的是什么？", "options": [...], "focus_hint": {...} },
        "B2+": { "question": "What does the speaker suggest about...?", "options": [...], "focus_hint": {...} }
      }
    },

    "word_pool": {
      "B1": [ { "word": "...", "cefr": "B1", "line_index": 1, "context_en": "...", "context_zh": "...", "definition_zh": "..." } ],
      "B2": [ ... ],
      "C1": [ ... ]
    },

    "exercises": {
      "fill_blank": {
        "sets": [
          {
            "target_words": ["debt", "reckless", "balance"],
            "word_bank": ["debt", "reckless", "balance", "income", "budget"],
            "items": [
              { "sentence": "After losing his job, his credit card _______ kept growing.", "answer": "balance", "answer_index": 2 }
            ]
          }
        ]
      },
      "dictation": {
        "sets": [
          {
            "target_words": ["debt", "reckless", "balance"],
            "sentences": [
              { "text": "Many people end up in debt not because they are reckless...", "blanks": ["debt", "reckless"], "given": "Many people end up in _______ not because..." }
            ]
          }
        ]
      }
    },

    "reflection": {
      "options": [
        { "label": "开头描述那对夫妻的长句", "time_range": [2.62, 12.92] }
      ]
    }
  }
}
```

### Schema 设计原则

**Pipeline 预生成 > 客户端实时生成**：Gist 题、词汇池、练习题全部在 pipeline 阶段用 GPT 生成好，写进 data.json。客户端只做选择和组装，不做生成。理由：不暴露 API key、不依赖网络、质量可控、首次加载不卡。

**预生成多套 → 运行时匹配**：练习题按目标词组合预生成多套（`sets[]`）。运行时根据 Phase 2 实际选出的词，匹配 `target_words` 最接近的一套。用户行为产生了预生成没覆盖的词组合 → fallback 到最接近的一套。

**难度变体内联**：Gist 题的 A2/B2+ 变体直接写在 `difficulty_variants` 里，客户端根据 `flipodLevel` 读取。

**word_pool 不替代行为优先**：`word_pool` 是算法兜底的词池。实际展示的词 = 用户听中行为点击/收藏的词（第一优先）+ word_pool 中对应等级的词（补齐）。

### localStorage Keys

```javascript
// 现有（不动）
flipodLevel      // 离散 CEFR 等级
flipodVocab      // 生词本
flipodSpeed      // 播放速度
flipodMode       // 纯听/学习模式

// 新增
flipodTeachingLog    // 每个 clip 的教学记录
flipodUserCEFR       // 持续校准的 CEFR 连续值（如 "B1.3"）
flipodClipBehavior   // 当前 clip 的听中行为缓冲区
flipodPracticeLog    // 听力练习模块的记录
```

---

## 十、版权策略

| 环节 | 策略 | 风险 |
|---|---|---|
| Feed 播放 | 原播客音频流 + 来源归属 + 完整节目外链 | 合理使用 |
| Phase 1 Gist 题 | 原创题目，基于 clip 内容出题但不复制原文 | 无 |
| Phase 2 词汇卡 | 展示单词 + 上下文短语（合理使用范围）+ AI 生成例句 | 极低 |
| Phase 3 连线配对 | 单词 + 释义，不涉及原文 | 无 |
| 听力练习模块 | 全部 AI 生成文本 + TTS 音频 | 无 |
| 原始音频切片/下载 | **不做** | 版权红线 |

---

## 十一、设计系统

### 基础参数

设备：iPhone 15 Pro（393×852pt）。风格：暗色系、极简、高端感，类似 Spotify 的克制设计。

### 颜色

```css
:root {
  --bg: #0C0C0E;
  --surface: rgba(255,255,255,.05);
  --surface-2: rgba(255,255,255,.08);
  --border: rgba(255,255,255,.08);
  --border-strong: rgba(255,255,255,.14);
  --text: rgba(255,255,255,.87);
  --text-2: rgba(255,255,255,.55);
  --text-3: rgba(255,255,255,.30);
  --text-4: rgba(255,255,255,.15);
  --accent: #8B9CF7;
  --accent-soft: rgba(139,156,247,.12);
  --accent-subtle: rgba(139,156,247,.05);
  --success: #4ade80;
  --success-soft: rgba(74,222,128,.12);
  --error: #f87171;
  --cefr-b1: #7AAFC4;
  --cefr-b2: #C4A96E;
  --cefr-c1: #C47A6E;
}
```

### 字体与字号

字体：Inter，无衬线。字号阶梯：22px/700 总结数字、18px/600 页面标题、16px/700 词汇大号词、15px/700 CTA 按钮、14px/500-600 选项正文、13px/500 副文本、12px/500 辅助文本、11px/500 胶囊小文本、10px/500-700 badge。

### 圆角与间距

圆角：卡片 14-16px、按钮 11-12px、胶囊 20-24px、统计格 12px。间距：页面水平 padding 20px、卡片内 padding 14-16px、section 间 gap 12-16px。

### 动画

```css
* { transition-timing-function: cubic-bezier(.2, .8, .2, 1); }
/* 点击反馈 .15s / 展开折叠 .25s / 页面转场 .35s */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
}
```

---

## 十二、教学面板 Phase 状态机

状态通过 `.teaching-panel` 的 `data-phase` 属性驱动：

```
idle        → clip 还在播放，面板不显示
1-question  → Phase 1：Gist 主旨题
1-correct   → Phase 1：选中正确选项 + 反馈条
2-vocab     → Phase 2：Phase 1 折叠 + 词汇横滑卡片
3-match     → Phase 3：Phase 1/2 折叠 + 连线配对
4-summary   → Phase 4：全部折叠 + 统计 + 难度反馈
```

进入后续 Phase 时，前面的 Phase 折叠成 `.phase-done` 小条。

### 教学插件公开 API

```javascript
TeachingPlugin.init(config)
TeachingPlugin.setMode('learn' | 'listen')
TeachingPlugin.onWordTap(word, cefr, lineIndex, time)
TeachingPlugin.onWordSave(word, cefr, lineIndex)
TeachingPlugin.onClipEnd(clip, idx)   // clip 播完 → 触发 Phase 1-4
TeachingPlugin.isActive()
```

当 `mode === 'listen'` 时，`onClipEnd` 直接返回，不做任何事。

---

## 十三、侧边菜单

用户点击左上角 ☰ 展开侧边菜单（300px 宽度，从左侧滑入，右侧 Feed 暗化）。

菜单内容：用户区（头像 + CEFR 等级 + 兴趣标签 + 统计）→ 分割线 → 菜单列表（📚 我的收藏、🎧 听力练习 + badge、📝 生词本、⚙️ 设置）→ 底部学习模式 toggle。

ESC / 点背景关闭菜单。

---

## 十四、竞品对比

| 维度 | DuoRadio | YouTube 听力频道 | Flipod |
|---|---|---|---|
| 音频来源 | AI TTS 角色扮演 | 教师自录/新闻 | 真实播客 |
| 音频真实度 | TTS 模拟 | 教师自录 | 真人自然语流 |
| 互动模式 | 选择题 | 无（视频观看） | 多模式（Gist/词汇/配对/听写） |
| 内容控制 | 完全可控 | 完全可控 | 依赖外部，但量级远超自产 |
| 用户路径 | 线性课程 | 无结构 | Feed 流 + 内嵌教学 |

---

## 十五、优先级

### P0（V1 必须交付）

1. Clip 难度标签（pipeline 预计算，写入元数据）
2. 用户冷启动自评（三选一 → 初始 CEFR 估值）
3. 纯听/学习 Tab 切换 + mode 持久化
4. Phase 1 Gist 题（按用户水平调整出题语言和选项难度）
5. Phase 2 词汇卡片（行为优先 + i+1 算法补齐）
6. 教学降级机制（clip 难度 ≥ 用户 +2 时自动简化教学）
7. 跳过/展开机制 + autoplay 暂停逻辑
8. AI 内容标识 + 来源归属
9. 教学交互数据埋点

### P1（快速跟进）

1. 用户水平持续校准（三信号融合 → 动态 CEFR 估值）
2. Feed 排序难度倾斜
3. Phase 3 词义连线配对
4. Phase 1 聚焦提示 + 片段跳转（答错时引导二听）
5. Phase 4 总结卡片 + 难度反馈 + 生词本
6. 连续跳过自适应折叠
7. 教学数据持久化

### P2（设计预留）

1. 听力练习独立模块（TTS 集成 + 三轮递进 UI + 缓存）
2. 间隔复习（遗忘曲线推送生词本词汇）
3. i+1 校准精调（上调/下调速率优化，防抖动逻辑）
4. OB 冷启动完整流程（4 段定级 + 兴趣选择）
5. 收藏系统 → 双入口（我的收藏 / 听力练习）

---

## 十六、不做的事

- 不做单句级播客原文教学（版权风险）
- 不做语音录制/评分/跟读（Flipod 是听力垂类，不开口语的口）
- 不做考试模拟
- 不在教学中暴露有限内容量（没有"第 n/22"）
- 不做语法专项讲解（教学锚定在"听"上）
- 不做原始音频切片/下载用于教学（版权红线）
- 不做 connected speech 专项训练（TTS 目前做不到自然连读，留待技术成熟后考虑）

---

## 十七、埋点

| 事件名 | 触发 | 属性 |
|---|---|---|
| `teaching.gist.answered` | Phase 1 选项点击 | `correct, option, clip_id` |
| `teaching.vocab.viewed` | Phase 2 词卡被看到 | `word, cefr, source(behavior/algorithm)` |
| `teaching.vocab.pinned` | Phase 2 加入生词本 | `word, cefr` |
| `teaching.match.completed` | Phase 3 全部配对完 | `attempts, duration_ms` |
| `teaching.difficulty.submitted` | Phase 4 难度反馈 | `value: easy/right/hard` |
| `teaching.next_clicked` | Phase 4 CTA | `clip_id, phases_skipped[]` |
| `teaching.skipped_all` | 跳过全部练习 | `clip_id, consecutive_skips` |
| `clip.word_tapped` | 听中点词 | `word, cefr, timestamp` |
| `clip.word_saved` | 听中收藏词 | `word, cefr` |
| `clip.replay` | 回拉重听 | `from, to, clip_id` |
| `menu.opened` | 侧边菜单打开 | `from_phase` |
| `menu.practice.clicked` | 听力练习入口 | `pending_count` |
| `practice.round_completed` | 听力练习某轮完成 | `round(1/2/3), score` |

---

## 附录 A：B1 用户教学流实例

> 用 clip 4「被债务淹没的体面人生」（Hidden Brain, B1+）走一遍完整教学流。

### 用户听中行为

| 时间 | 行为 | 词 | CEFR |
|---|---|---|---|
| 0:06 | 点词查翻译 | gainful | C2 |
| 0:09 | 点词查翻译 | drowning | B1 |
| 0:13 | 点词 + 收藏 | debt | B2 |
| 0:33 | 点词查翻译 | compounding | C1 |
| 0:41 | 点词查翻译 | delinquent | C1 |
| 0:59 | 点词查翻译 | chipping | B2 |
| 1:23 | 点词 + 收藏 | reckless | B2 |

### Phase 2 选词过程

第 1 步——收藏词直接入选：debt (B2, ⭐)、reckless (B2, ⭐)。第 2 步——剩余点击词按 i+1 过滤：gainful (C2) ✗ 超出太远、drowning (B1) ✗ 等于当前水平、compounding (C1) ✗ 超出一级暂不选、chipping (B2) ✓ i+1 命中。第 3 步——已选 3 个，不用算法补齐。

**如果用户一个词都没点**，算法兜底会选：debt（出现 4 次，核心概念）、reckless（情感色彩强）、balance（多义词教学价值高）。但用户点了词，算法结果被覆盖——chipping 替代了 balance，因为用户亲手标记了"我不认识 chipping"。

### 有行为 vs 无行为对比

| | 用户点了词 | 用户没点任何词 |
|---|---|---|
| 词汇卡来源 | debt, reckless, chipping（用户行为） | debt, reckless, balance（算法 i+1） |
| 用户感知 | "它知道我不会什么" | "它推荐了一些词给我" |
| 情感连接 | 强——"这个 app 懂我" | 弱——"又一个推荐算法" |

---

## 附录 B：参考文献

- Vandegrift, L. (2003). Orchestrating strategy use: Toward a model of the skilled second language listener. *Language Learning*, 53(3).
- Vandegrift, L. & Tafaghodtari, M. (2010). Teaching L2 learners how to listen does make a difference. *Language Learning*, 60(2).
- Gianfranco Conti (2025). Shadowing for Fluency, Prosody, and Listening Comprehension. *The Language Gym*.
- Gianfranco Conti (2025). Teaching Listening Strategies – When It Actually Works. *The Language Gym*.
- Duolingo Blog (2025). DuoRadio is Duolingo's New Tool for Practicing Listening Skills.
- Duolingo Blog (2025). Using generative AI to scale DuoRadio 10x faster.
- Nature (2025). The impact of AI-driven speech recognition on EFL listening comprehension.
- ScienceDirect (2024). Enhancing language proficiency through mobile extensive listening and podcasting.
- ScienceDirect (2024). Optimising listening skills: effectiveness of a blended model with a top-down approach through cognitive load theory.
