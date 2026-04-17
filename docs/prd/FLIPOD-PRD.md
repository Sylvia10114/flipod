# Flipod 产品需求文档（v3.0 · 漏斗重构）

> 2026-04-17 · PM: Jamesvd · v3 起 Flipod 收敛为听力垂类训练产品。Feed 不再承载教学职责，转为发现层；练习 Tab 升格为产品主线，承载 AI 生成短文 + 四遍渐进脱手训练。本文档是唯一产品真理源。

> **v3 重构动机**：v2 把 Feed 内嵌教学（Phase 1-4）和侧边菜单的听力练习并列为"双轨"，导致两件事——(1) 产品定位摇摆，既像播客 App 又像练习工具，垂类感弱；(2) Feed 教学的"循环测验"打断听的心流，与"沉浸式听力训练"的核心价值冲突。v3 的判断：**Feed 是发现与素材积累的场，练习 Tab 是真正的训练场**。两者构成漏斗——Feed 让用户在真实播客里找感兴趣的内容、收藏不会的词；练习 Tab 用这些词和兴趣 tag 反向生成针对性的训练材料。

---

## 一、产品定位

Flipod 是一个英语听力垂类训练 App（iOS 风格）。用户在仿抖音的 Feed 流中上下滑动听不同的播客片段（clip），每段 30-90 秒——这是**发现层**：用真实播客语料让用户接触自然语流、找到感兴趣的话题、收藏不会的词。当生词本积累到一定量，用户进入**训练层**（练习 Tab）：系统基于用户的生词本 + 兴趣 + 当前水平，AI 生成专属听力短文，配 TTS 音频，做四遍渐进脱手训练。

核心差异化：**真实播客发现 + AI 个性化训练的漏斗**。DuoRadio 用 TTS 角色扮演模拟不出真人播客的语速变化和口音多样性；YouTube 听力频道有真实语料但缺少结构化训练；其他 AI 英语 App 训练材料和用户兴趣脱节。Flipod 让真实播客负责"激发想学的欲望和提供生词来源"，让 AI 生成内容负责"做用户真正想练的内容的针对性训练"。

音频通过 HTTPS 实时播放，不存本地。所有训练内容由 AI 生成（规避版权 + 实现个性化）。

---

## 二、产品结构总览

```
冷启动 OB
  ├─ 听 4 段 → 确认 CEFR 水平
  └─ 选兴趣标签 → 加载动画 → 进入主界面

主界面
  ┌────────────────────────────┐
  │  [ 纯听 ]  [ 练习 ]  ← Tab │
  │   (默认)                    │
  ├────────────────────────────┤
  │                            │
  │   纯听：Feed 卡片           │
  │     (scroll-snap, 仿抖音)   │
  │                            │
  │   练习：练习中心            │
  │     - 未解锁 → 进度卡片      │
  │     - 已解锁 → 待练 + 已完成 │
  │     - 点击进入 → 四遍训练    │
  │                            │
  ├────────────────────────────┤
  │  ☰ 侧边菜单                │
  │    ├─ 📚 我的收藏           │
  │    ├─ 📝 生词本             │
  │    └─ ⚙️ 设置              │
  └────────────────────────────┘
```

**漏斗心智**：纯听 Tab 是发现层，练习 Tab 是训练层，两者构成漏斗而非并列双轨。两个 Tab 共享同一份用户画像（CEFR 估值 + 兴趣标签 + 生词本），数据流是单向的——纯听积累 → 练习消费：

| 维度 | 纯听 Tab（发现层） | 练习 Tab（训练层） |
|---|---|---|
| 心智角色 | 探索 / 接触 / 收藏 | 训练 / 巩固 / 检测 |
| 内容来源 | 真实播客 clip 流 | AI 基于用户画像生成的短文 + TTS |
| 用户行为 | 听 + 点词查翻译 + 收藏生词 | 跟着四遍训练逐步脱手 + Review |
| 时长 | 单次 30–90s/clip，无固定长度 | 单次 ~3–5 分钟一篇练习 |
| 是否打断 | 无任何主动打断（不做内嵌教学） | 全屏覆盖，主动进入心智 |
| 入口 | App 启动默认 Tab | Tab 切换或被生词触发引导 |

**关键判断**：v3 不再在纯听 Tab 内嵌任何 Phase 1-4 教学。纯听就是纯听——播放 + 点词查翻译 + 收藏生词。所有"练"的责任都集中到练习 Tab。这样做的代价是失去 Feed 流的即时巩固机会，收益是练习 Tab 拿到了真正的产品主线位置、用户心智不再被两条产品线分割。

---

## 三、训练设计的理论基础

### 听力理解的双通道模型

学术界把听力理解分为两条平行通路，缺一不可：

**Bottom-up（自下而上）**：从声音信号出发 → 辨音 → 识词 → 解析语法 → 组装意义。瓶颈在于 connected speech（连读、弱读、省音、同化），这是中国学习者听力的头号杀手——学习者逐词读能懂，连续语流里就听不出来。

**Top-down（自上而下）**：从背景知识 + 语境预期出发 → 预测内容 → 验证猜测 → 填补漏洞。依赖 schema（图式）和对话题的熟悉度。

Flipod 的漏斗结构同时喂两条通路：**纯听 Tab 是自然 top-down 场景**（用户在真实播客里借助话题熟悉度建立理解），**练习 Tab 是 bottom-up 精修场景**（用户带着已收藏的词进入四遍渐进脱手训练，逼自己从声音信号精确解码到文字）。

### 渐进脱手：v3 的核心训练哲学

v3 练习层的核心设计是**同一材料的四遍渐进脱手**——保留听的连续性，把所有测验集中到 Review 收尾。理由：

**不打断听的连续性**。每遍听之间不插测验、不要求作答，注意力全部在"听"上。用户一旦中段被"答错→红字"挫败，后续几遍的心理状态就污染了。

**脚手架单向抽离**。从全中文翻译（语义扶手） → 全英文字幕（文本扶手） → 渐隐字幕（仅保留目标词） → 无字幕（纯耳朵）。每一遍比上一遍少一层辅助，用户感受到的是"好像我每遍都听懂得更多"，而不是"又要答题了"。

**测验前置脱手到最后**。主旨题 + 可点开的中文回看 + 词汇卡 + 难度反馈全部放在 Review 一站完成。用户到 Review 时已经听过四遍，主旨题不再是"考试"，而是"确认我确实听懂了"。

### Vandegrift 元认知教学循环（MPC）

Larry Vandegrift 的实验证明，经过元认知策略训练的学习者显著优于对照组。核心循环：**预测（Predict）→ 首听验证（Monitor）→ 二听修正（Problem-solve）→ 评估反思（Evaluate）**。

v3 的四遍渐进脱手是该循环的变体实现：Pass 1（中文字幕）= 预测框架建立；Pass 2（英文字幕）= 首听验证；Pass 3（渐隐字幕）= 问题解决，注意力从眼睛移回耳朵；Pass 4（无字幕）= 裸听评估。Review 的难度反馈对应 Evaluate。

### Dictation（听写）的研究支撑

听写强化听力精度和语法意识，是 YouTube 英语教学频道的主力方法。研究表明听写迫使学习者从声音信号精确解码到文字，是最直接的 bottom-up 训练手段。听写训练的核心价值在于"精确解码"这个认知过程，不依赖音源是否真人。AI 生成内容 + TTS 朗读完全能承载这个训练目标，同时规避版权问题。v3 的 Pass 3（渐隐字幕）和 Pass 4（无字幕）承载听写的认知功能，但用"识别 + 填补"代替"手写抄写"，降低操作负荷。

### DuoRadio 的产品验证

Duolingo 2025 年推出 DuoRadio，半年内日活从 50 万涨到 500 万，验证了"短音频 + 即时理解检测"模式的市场需求。Flipod 与 DuoRadio 的差异化在于：Flipod 的**发现层**（纯听 Tab）用真人真实播客解决 motivation 问题，**训练层**（练习 Tab）用 AI 生成内容 + 个性化词表解决针对性问题。DuoRadio 两头都是 TTS，Flipod 两头按"真实 vs 个性化"的优先级分开做。

### i+1 可理解输入假说

Krashen 的理论：学习者接收到的内容应该略高于当前水平（i+1）——太低无聊，太高放弃。Flipod 的所有难度决策都围绕这一条：永远比用户的实际水平高一点点，让他够一够能够到。v3 在练习生成侧通过"目标词取用户生词本中略高于当前等级的词"实现 i+1，在训练侧通过 CEFR 适配表（第八章）调节 TTS 速率 / 目标词数 / 渐隐密度。

---

## 四、冷启动 OB 流程

### 屏 1：听力水平测试

用户第一次打开 App，听 4 段短音频（每段约 15 秒）来确认 CEFR 水平。每段听完选择理解程度：完全听懂了 / 听懂了大概意思 / 基本没听懂。4 个进度圆点指示当前进度。底部小字"你可以随时在设置中重新测试"。

### 屏 2：选兴趣标签

水平测试完成后选兴趣话题。标签网格（flex wrap），每个标签胶囊形，选中态紫色高亮。标签内容：商业、科学、故事、科技、社会、文化、历史、心理、音乐、体育、电影、美食。要求选 3 个以上。

### 屏 3：加载过渡

纯黑背景，中央 3 条跳动竖线音频波形 + "正在为你挑选内容…"。底部淡入"你的水平：B1 · 已选 4 个话题"。

---

## 五、纯听 / 练习 Tab

### UI 位置

屏幕顶部两个文字 Tab，下划线指示当前模式。**默认 Tab 为"纯听"**——App 启动、冷启动 OB 完成、侧边菜单关闭后回到主界面，默认都落在纯听。

### 切换行为

- **纯听 → 练习**：当前播放的 clip 会在切 Tab 时暂停（不继续后台播放）。进入练习 Tab 后呈现练习中心（见第七章）。
- **练习 → 纯听**：如果练习正在进行（四遍中的任意一遍），弹出确认"退出当前练习？"——选"是"丢弃本次进度关闭练习，选"否"留在练习中。确认退出后回到 Feed，从上次暂停处继续播放。

模式持久化到 `localStorage.flipodMode`，记录用户上次所在的 Tab。但冷启动首次默认仍是纯听（而非上次状态），理由是纯听是发现入口，用户首次打开就该看到内容流而不是训练界面。

### 纯听模式（原"学习 Tab"已移除）

v3 不再存在"学习 Tab"这个概念。原学习 Tab 承载的 Phase 1-4 内嵌教学全部下线。纯听 Tab 只做以下三件事：

- Feed 流上下滑动播放 clip
- 点词查翻译（触发轻提示浮层，不中断播放）
- 收藏生词到 `flipodVocab`（侧边菜单"生词本"可查看）

纯听 Tab 内不触发任何测验、不展开任何练习面板、不暂停 auto-advance（除非用户主动点暂停）。所有"练"的动作都在练习 Tab 完成。

### 从纯听 → 练习的引导时机

当用户在纯听 Tab 收藏生词时，如果当前 `flipodVocab.length` 刚好达到解锁阈值（= 5）或每新增 3 个词（REFRESH_DELTA），在 Feed 卡片底部浮起一个非阻塞 toast："新增 3 个词，练习已更新"或"已解锁听力练习 →"。点 toast 跳转到练习 Tab，不点它 2.5s 后自动消失。这是漏斗的主要转化触点。

---

## 六、纯听 Tab 的运行规则

> v3 起，原"Feed 内嵌教学"（Phase 1-4 + 教学降级 + 跳过机制）整体下线。纯听 Tab 不再承载任何测验、词汇卡、练习面板。Feed 教学的旧规则归档在 `docs/archive/v2-feed-teaching/`，作为决策记录保留，不再生效。

### 设计意图

纯听 Tab 是漏斗的发现层。它的唯一职责是：让用户在一个低门槛、无打断的环境里接触真实播客内容、找到自己感兴趣的话题、收藏不会的词。所有"练"的动作都集中到练习 Tab，让用户在心智上对"听"和"练"有清晰边界。

### 听中行为：点词查翻译（轻提示）

用户在播放过程中可以点击字幕里的任意词。点击后：

- 弹出小型浮层（150ms 淡入），显示词 + CEFR 等级标签 + 中文释义 + "+ 加入生词本"按钮
- 浮层不暂停音频（不打断听的连续性）
- 点击浮层之外区域 / 浮层 1.5s 内无操作 → 自动消失
- "+ 加入生词本"点一下变成"已加入 ✓"，词进入 `flipodVocab`

释义来源：clip 数据里 `lines[].words[].definition_zh`（pipeline 预生成）。无释义时不允许点击。

### 听中行为：回拉重听

用户从进度条往左拖动重听某段。这是一个**信号**而不是被打断的动作——记录到 `flipodClipBehavior`，作为该用户对该词/该段难度的隐性投票，喂给 CEFR 校准（第八章）和练习生成（第七章）。

### 行为采集（不可见，但驱动一切）

纯听 Tab 实时采集以下行为，写入 localStorage：

| 行为 | 写入 key | 用途 |
|---|---|---|
| 点词查翻译 | `flipodClipBehavior.tapped[]` | CEFR 校准信号；轻提示弹出过的词进入"候选生词" |
| 收藏到生词本 | `flipodVocab[]` + `flipodClipBehavior.saved[]` | 练习生成的核心输入；驱动解锁/补给逻辑 |
| 回拉重听 | `flipodClipBehavior.replayed[]` | CEFR 校准信号 |
| clip 完整听完 | `flipodListenLog[]` | 推荐系统输入；统计用户兴趣强度 |

**关键规则**：行为采集是被动的，对用户完全不可见。不做"今天听了 30 分钟"这类虚荣指标。所有采集出来的数据只服务于一件事——让练习 Tab 的内容生成得更准。

### autoplay 与 clip 切换

- clip 播完后自动播下一个，不打断、不弹卡片
- 用户上下滑动手动切换，新 clip 自动从 0 播放
- 切到下一个 clip 时把上一个 clip 的 `flipodClipBehavior` flush 到 `flipodListenLog` 并清空缓冲区

### 引导用户去练习的时机

仅在两种时机弹非阻塞 toast 引导用户去练习 Tab（详见第五章末段）：

1. 生词本首次达到 5 个词（解锁阈值）→ "已解锁听力练习 →"
2. 自上次生成后新增 ≥ 3 个词（REFRESH_DELTA）→ "新增 3 个词，练习已更新 →"

不主动弹其他类型的引导 / 学习提醒 / 学习目标卡片。纯听 Tab 的纯粹性是产品定位的一部分。

---

## 七、练习 Tab（产品训练主线）

### 定位

练习 Tab 是 Flipod v3 的产品主线。它把纯听 Tab 沉淀下来的用户画像（生词本 + 兴趣 + CEFR 估值）反向输入到 AI 生成层，产出针对该用户的听力短文，配 TTS 音频，做四遍渐进脱手的听力训练。

和 v2 "侧边菜单独立模块"的关键差异：

- **入口从菜单升到一级 Tab**。用户不需要主动找入口，切 Tab 就到。
- **练习层从"三轮测验"改成"四遍渐进脱手"**。同一段材料听四遍，每遍减少一层字幕辅助；所有测验集中到 Review 收尾。
- **供给侧从"用户主动生成"变成"后台自动补给"**。生词积累到阈值自动生成；之后每新增若干个词自动补一批；用户进入练习 Tab 看到的是"待练习列表"而非空页。

### 入口与解锁

练习 Tab 永远存在（顶部导航可见），点击后根据生词本状态呈现三种不同的中心页：

| 生词本状态 | 中心页呈现 |
|---|---|
| `flipodVocab.length < 5`（未解锁） | 解锁引导卡片：进度条 + "再学 X 个新词就能解锁" + "去听播客 →"按钮（切回纯听 Tab） |
| 首次达到 5 个词且 `pendingPractices.length === 0` | 生成中过渡态：加载动画 + "正在为你生成专属练习…" + 底部"基于你最近收藏的 5 个词"说明 |
| 已有 `pendingPractices.length > 0` | 已解锁列表页：待练习卡片 + 已完成卡片 + "生成新的练习"按钮 |

**解锁阈值** = `UNLOCK_COUNT = 5`。不以登录时长、听歌时长等虚荣指标作为解锁依据——只用"生词本规模"，因为那是用户真实的学习信号。

**不允许强制解锁/跳过解锁**。解锁卡片只提供"去听播客"一个出口，没有"体验一下"按钮。理由：练习 Tab 的价值 100% 建立在用户画像的真实性上，没有自己的词就没有个性化，硬塞 demo 内容会稀释产品定位。

### 练习中心页（已解锁）

```
┌──────────────────────────────┐
│  🎧 听力练习                  │
│                              │
│  [ 生成新的练习 ]              │
│                              │
│  已为你准备 3 篇练习 · 新增 4 个词 │
│                              │
│  ┌────────────────────────┐  │
│  │ The Startup That       │  │
│  │ Chased a Better        │  │
│  │ Benchmark              │  │
│  │ Business · B2 · 45s    │  │
│  │ benchmark recession    │  │
│  │ inflation              │  │
│  │         [开始练习 →]    │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ ... (第二篇)            │  │
│  └────────────────────────┘  │
│                              │
│  ── 已完成 ──                 │
│  The First Impression        │
│  That Would Not Leave         │
│  Psychology · B1 · 已完成     │
└──────────────────────────────┘
```

卡片显示：标题 · 话题 tag · CEFR 等级 · 预估时长 · 三个目标词胶囊 · "开始练习 →" CTA。

底部小字："首次解锁自动生成 2 篇；之后可手动生成。若自上次生成后新增至少 3 个词，下次进入会自动补一批。"

### 练习层：四遍渐进脱手

用户点击"开始练习 →"后，全屏覆盖式进入练习面板。顶部：关闭按钮 + 当前遍数标签 + 4 个进度圆点（已完成 `done` / 当前 `active` / 未进行）。

#### Pass 1 · 全中文字幕

- 中央大播放按钮 + 提示文案："先理解内容大意，降低进入门槛。"
- 字幕区：每句只显示中文翻译，英文原文不显示
- 按句级时间戳同步高亮当前句
- TTS 播放速率 = 用户 CEFR 对应速率（见第八章适配表）
- 播放完成 → 底部滑入"继续下一遍 →"按钮，可手动进入 Pass 2

设计意图：把语义负担先拿掉。用户带着已知的故事框架听英文，Pass 2 才不会崩溃。

#### Pass 2 · 全英文字幕

- 字幕区切换为完整英文，目标词用 accent 色 (`--accent`) 高亮
- 同句级时间戳高亮
- 播放完成 → "继续下一遍 →"

设计意图：声音 ↔ 英文文本建立一一对应。已有语义框架在 Pass 1 打好，这遍是在"对齐音和字"。

#### Pass 3 · 渐隐字幕

- 字幕区保留目标词高亮，其他非目标词按适配表的"渐隐密度"规则遮蔽为 `····`
- 被遮蔽的词完全不显示，用户靠耳朵把它们"填回来"
- 句级时间戳同步

设计意图：注意力从眼睛抽回耳朵。目标词作为锚点保证用户不会完全迷路，周围词靠听辨。

遮蔽规则（遵守 CEFR 适配表）：

| 用户 CEFR | 遮蔽密度 |
|---|---|
| A2 | 每 5 个非目标词遮 1 个 |
| B1 | 每 3 个非目标词遮 1 个 |
| B2 | 每 2 个非目标词遮 1 个 |
| C1+ | 每 2 个非目标词遮 1 个，偶尔遮目标词的相邻词 |

#### Pass 4 · 无字幕纯听

- 字幕区隐藏，只保留：波形动画 + 大播放按钮 + 提示文案"最后一遍不看字幕，只用耳朵确认自己是否真的听懂。"
- 某些等级允许重听（见 CEFR 适配表），A2/B1 提供重听按钮，B2+ 不提供
- 播放完成 → "进入回看与检测 →"

设计意图：脱手到底。这是本次训练的最后一遍听，也是用户评估自己"真的听懂了多少"的唯一时刻。

### Review 层（回看与检测）

四遍听完后进入 Review。所有测验与反馈集中在这里。单屏滚动布局：

**1. 理解检测**（主旨题）

- 3 选 1，AI 生成
- 用户点选后：正确选项变绿、错选变红、其他选项淡化
- 下方渐入中文解释 `explanation_zh`

**2. 回看文本**

- 逐句显示英文原文
- 点击任意一句 → 展开该句中文翻译
- 用户可以对照自己在 Pass 4 的理解，定位哪些句没听懂

**3. 本次练习词汇**

- 3 个目标词卡片：词 · CEFR 等级胶囊 · 中文释义
- 这些词默认已在用户的 `flipodVocab` 里（因为是从生词本反向生成的）

**4. 难度反馈**

- 三选一：[ 太简单 ] [ 正合适 ] [ 有点难 ]
- 选择影响 `flipodUserCEFR` 校准：太简单 +0.3、有点难 -0.3（正合适不动）

**5. 返回列表**

- 关闭练习面板，本次 practice 从 `pendingPractices` 移到 `completedPractices`，回到练习中心页

### 状态机

```
init → pass1 → pass2 → pass3 → pass4 → review → (关闭)
```

```javascript
const transitions = {
  init:   { loaded: 'pass1' },
  pass1:  { next: 'pass2' },
  pass2:  { next: 'pass3' },
  pass3:  { next: 'pass4' },
  pass4:  { next: 'review' },
  review: { exit: null }
};
```

**设计决策**：

- 不提供 restart（回到 pass1 重听整套）。用户想再练就回列表开新的一篇。
- 不提供 skip 跳过某一遍。四遍是设计成完整序列的，跳过会破坏脚手架递减的节奏。用户想中途退出，关闭按钮直接关（本次进度不保存，下次从该 practice 的 pass1 重来）。
- review 是终态，点"返回列表"触发 `finish` → 关闭 + 归档。

### 供给与调度

练习的"供给"是一个后台自动运转的系统，用户不需要理解它——但规则必须在 PRD 里定清楚，指导实现。

| 常量 | 值 | 含义 |
|---|---|---|
| `UNLOCK_COUNT` | 5 | 生词本达到此值解锁练习 Tab |
| `BATCH_SIZE` | 2 | 每次生成一批产出 2 篇练习 |
| `REFRESH_DELTA` | 3 | 自上次生成后生词本每新增 3 个词，下次进入自动补一批 |
| `MAX_PENDING` | 6 | 待练队列最多堆 6 篇；超出时不再自动生成 |

**首次解锁流程**：用户生词本首次达到 5 → 下次打开练习 Tab → 自动调用 `generateBatch(count=2)` → 展示生成中过渡态 → 完成后展示列表页。

**后续补给流程**：每次进入练习 Tab 时检查 `vocab.length - state.lastVocabCountAtGeneration >= 3 && pendingPractices.length < MAX_PENDING`，满足则后台静默补一批（不打扰用户）。

**手动生成**：列表页顶部"生成新的练习"按钮，点击立即生成一批（仍受 MAX_PENDING 限制）。

**已完成淘汰**：`completedPractices` 按完成时间排序，队列长度不受 MAX_PENDING 限制，但超过 20 条时淘汰最旧的。

### 生成层：选词评分

每篇练习选 **3 个目标词**（由 CEFR 适配表决定，A2 为 2，B2 为 4，C1+ 为 5）。候选池来自 `flipodVocab`，按以下规则过滤和评分：

**第一步：过滤掉不合适的候选词**
- 过滤掉最近 3 篇已完成练习用过的词（避免短期重复）
- 过滤掉当前 pendingPractices 里已用的词（避免队列内撞车）

**第二步：按 tag 分组**，每一篇的 3 个词来自同一个 tag（让短文主题聚焦）。tag 优先级：
- +100 分：tag 在用户 `flipodInterests` 中
- + N 分：该 tag 组内候选词数量（分组大小，鼓励多词组）

选分数最高的 tag，从该组取前 3 个词（按 `addedAt` 倒序，即最新收藏的优先）。

**第三步：CEFR 反推**：3 个词的 CEFR 等级数值平均 → 向最近档对齐 → 该篇练习的目标 CEFR。例如 3 个词是 B2/B2/C1 → 平均 4.33 → 对齐到 B2。这个 CEFR 同时决定生成层 prompt 里的难度指令和训练侧 TTS 速率等参数。

### 生成层：Prompt 模板

```
你是一个英语听力教材编写专家。

请根据以下条件生成一段 100-150 词的英文短文：

学习者水平：{cefr_level}
话题领域：{tag}
必须自然嵌入的词汇：{words}

要求：
1. 内容要有信息量与故事弧线，避免教科书语言
2. 语速和句式符合 {cefr_level} 的听力难度
3. 词汇嵌入自然，不能为塞词造硬句
4. 逐句提供中文翻译
5. 标注每个目标词出现在哪一句

同时生成一道主旨理解题（3 选 1），考察用户是否抓住了文章的核心观点，
正确选项应该是对文章主要论点的准确概括，错误选项应该是"听到了局部但没抓到主题"的常见误判。

输出 JSON 格式：
{
  "title": "短文标题",
  "text": "完整英文文本",
  "lines": [
    { "en": "第一句英文", "zh": "第一句中文", "target_words": ["debt"] }
  ],
  "vocabulary": [
    { "word": "debt", "definition_zh": "债务", "cefr": "B2" }
  ],
  "gist": {
    "question": "What is the main point of this passage?",
    "options": [
      { "text": "...", "correct": true },
      { "text": "...", "correct": false },
      { "text": "...", "correct": false }
    ],
    "explanation_zh": "这段的核心观点是..."
  }
}
```

**Demo 阶段的 Mock 实现**：`listening-practice.js` 当前使用 `TEMPLATE_BANK`（按 tag 分类的模板库，每 tag 1–N 个模板），目标词 slot-fill 进模板，避免 demo 期烧 API。生产接入真实 GPT 时，替换 `buildPractice()` 中的 `pickTemplate()` + `template.lines(words)` 调用为 GPT API 调用，输出 shape 保持一致。

### 音频层

- **TTS 端点**：`POST /api/tts`，body `{ text: string }`，响应 `audio/mpeg` blob
- **缓存**：前端按文本哈希缓存 `Blob → URL.createObjectURL(blob)`，同一段文本不重复请求
- **播放控制**：原生 `<audio>` 元素，`playbackRate` 受 CEFR 适配表控制
- **句级高亮调度**：180ms 轮询 `audio.currentTime`，把实际播放时间按 `audio.duration / plannedTotal` 线性映射到 `lines[].start/end`，定位当前高亮句。TTS 实际时长可能和模型 plannedTotal 不一致，线性映射防止高亮飘

### 数据流

```
用户在纯听 Tab 收藏词 → flipodVocab += word
         │
         ├─(vocab.length == 5 且首次) ─→ 显示 toast "已解锁听力练习 →"
         ├─(vocab.length - lastGen >= 3) ─→ 显示 toast "新增 N 个词，练习已更新 →"
         ▼
用户切到练习 Tab
         │
         ├─(vocab < 5)  ─→ 解锁引导卡片
         ├─(pending == 0 且首次) ─→ 生成中过渡态 → generateBatch(2)
         ├─(pending > 0 且 delta >= 3) ─→ 静默补给 generateBatch(2)
         └─ 展示练习中心页（pending + completed）
         ▼
用户点"开始练习" → 进入四遍训练面板
         │
         ▼
pass1 → pass2 → pass3 → pass4 → review
         │
         ▼
用户点"返回列表"
         ├─ practice 从 pendingPractices 移到 completedPractices
         ├─ 难度反馈影响 flipodUserCEFR
         └─ 回到练习中心页
```

### 数据持久化

本模块使用单一 localStorage key：`flipodPracticeState`。Schema 见第九章。

每次状态变化（生成、开始、完成、难度反馈）都 flush 到 localStorage。崩溃/刷新后恢复为"停在列表页"状态——进行中的 pass 不保存中间态（见"不提供 restart"的设计决策）。

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

**信号 2：纯听 Tab 行为**。听中点词翻译的频率和被点词的 CEFR 分布（用户在 B2 区间高频点词 → 估值偏向 B1）；收藏生词的频率和等级；clip 内回拉重听的次数和位置。被动采集，权重高。

**信号 3：练习 Tab 的 Review 反馈**。每篇练习 Review 末尾的"难度反馈"是最强校准信号（用户主动评估），权重最高。

三个信号加权融合，输出一个用户当前 CEFR 估值（连续值，如 B1.3），持续滚动更新到 `flipodUserCEFR`。

### 第三层：Feed 侧适配（轻挂钩）

Feed 不做严格的难度过滤（否则低水平用户内容池太浅），而是做排序权重倾斜：用户估值 B1 → 优先排 B1 和 B1+ 的 clip（i+1），A2 和 B2+ 的排后面但不隐藏。核心逻辑：每个 clip 只要存在适合用户学习的点就可以推。只有当一个 clip 对该用户完全没有教学下手点时才降权到底部。不做硬过滤，用户手动下滑永远能看到所有内容。

### 第四层：练习侧适配（严格挂钩 CEFR · 真正生效的规则表）

同一组目标词，不同水平用户拿到的 TTS 速率、目标词数量、渐隐密度、是否允许重听完全不同。下表是 v3 的硬性参数表，必须在 `listening-practice.js` 里按此实现：

| 用户 CEFR | TTS 速率 | 单篇目标词数 | Pass 3 渐隐密度 | Pass 4 是否允许重听 |
|---|---|---|---|---|
| A2 | 0.85 | 2 | 每 5 个非目标词遮 1 个 | 允许 2 次 |
| B1 | 0.94 | 3 | 每 3 个非目标词遮 1 个 | 允许 1 次 |
| B2 | 1.00 | 4 | 每 2 个非目标词遮 1 个 | 不允许 |
| C1+ | 1.05 | 5 | 每 2 个遮 1 个 + 偶尔遮目标词的相邻词 | 不允许 |

**生效路径**：`clampLevel(localStorage.getItem('flipodUserCEFR'))` → 查上表 → 注入到 `buildPractice()` 的 `count`、`speakText()` 的 `rate`、`buildCaptionHtml('en-fade')` 的遮蔽密度、Pass 4 的重听按钮渲染条件。所有这些参数当前在代码里是硬编码常量（速率固定 0.94、目标词数固定 3、密度固定 1/3），**v3 必须改为查表**。

**适配的边界**：用户 CEFR 估值 < A2 时按 A2 处理；> C2 时按 C1+ 处理。等级是连续值（如 B1.3）时，按四舍五入取整再查表。

### i+1 的动态校准

练习 Review 中的难度反馈是最强校准信号：

- **太简单** → CEFR +0.3
- **正合适** → CEFR 不变
- **有点难** → CEFR -0.3

辅助校准信号（来自纯听 Tab 行为）：

- 同一 CEFR 等级区间内，点词翻译频率 > 5 次/clip → CEFR -0.1（暗示当前内容偏难）
- 连续 5 个 clip 几乎不点词、不回拉 → CEFR +0.1（暗示当前内容偏简单）

校准有上限和下限：估值不低于自评结果 -1 级，不高于自评 +2 级（防止行为数据抖动导致大跳）。下调比上调快（-0.3 vs +0.3），避免用户在"太难"区间待太久。

---

## 九、数据 Schema

### Clip 数据标准接口（ClipData shape）

纯听 Tab 消费的 clip 数据 shape。v3 相比 v2 精简：删除 `teaching`、`word_pool`、`exercises`、`reflection` 等预生成教学字段（这些字段在 v2 用于 Feed 内嵌教学，v3 已不再使用）。

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
      cefr: string | null;      // A1-C2 / PN / null
      definition_zh?: string;   // 点词查翻译用
    }>;
  }>;

  difficulty?: ClipDifficulty;  // 见下文

  // 可选
  info_takeaway?: string;
}
```

### `difficulty` — Clip 难度标签

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

### `flipodPracticeState` — 练习 Tab 的持久化状态

```typescript
interface PracticeState {
  lastGeneratedAt: number;               // timestamp，最近一次批量生成的时间
  lastVocabCountAtGeneration: number;    // 上次生成时的生词本规模（用于计算 delta）
  pendingPractices: Practice[];          // 待练习队列（最多 MAX_PENDING = 6 条）
  completedPractices: PracticeSnapshot[];// 已完成记录（最多 20 条，超出淘汰最旧）
  generationVersion: number;             // 生成策略版本号（用于未来升级策略时迁移）
}

interface Practice {
  id: string;                // e.g. "lp-1713456789-0-benchmark-recession-inflation"
  title: string;
  tag: string;               // "Business" / "Psychology" / ...（展示名）
  topicKey: string;          // "business" / "psychology" / ...（内部 key）
  cefr: "A2" | "B1" | "B2" | "C1" | "C2";
  target_words: string[];    // 3 个（受 CEFR 适配表决定，A2=2 / B2=4 / C1+=5）
  text: string;              // 完整英文
  lines: Array<{
    en: string;
    zh: string;
    target_words: string[];  // 本句内的目标词（用于高亮）
    start: number;           // 模型预估时间戳（秒）
    end: number;
  }>;
  vocabulary: Array<{
    word: string;
    definition_zh: string;
    cefr: string;
  }>;
  gist: {
    question: string;
    options: Array<{ text: string; correct: boolean }>;
    explanation_zh: string;
  };
  generatedAt: number;
  _persisted?: boolean;      // 运行时标记，避免重复归档
}

interface PracticeSnapshot {
  id: string;
  title: string;
  tag: string;
  cefr: string;
  target_words: string[];
  completedAt: number;
  difficultyRating?: "easy" | "right" | "hard";
}
```

### localStorage Keys

```javascript
// 现有（不动）
flipodLevel          // 离散 CEFR 等级（冷启动自评）
flipodVocab          // 生词本：[{ word, cefr, definition_zh, tag, timestamp }]
flipodInterests      // 兴趣 tag 数组：["business", "psychology", ...]
flipodSpeed          // 纯听 Tab 播放速度
flipodMode           // 当前 Tab："listen" | "practice"

// 新增 / 更新
flipodUserCEFR       // 持续校准的 CEFR 连续值（如 "B1.3"）
flipodClipBehavior   // 当前 clip 的听中行为缓冲区
flipodListenLog      // 已听完的 clip 日志（flush from clipBehavior）
flipodPracticeState  // 练习 Tab 的完整状态（见上文 PracticeState 接口）

// 已废弃（v2 遗留，v3 不再使用）
// flipodTeachingLog       → 已删除（Feed 教学不再存在）
// flipodKnownWords        → 已删除（算法选词不再使用）
// flipodPracticeLog       → 合并进 flipodPracticeState.completedPractices
```

### Schema 设计原则

**Pipeline 预计算 `difficulty`，其他全部运行时生成**：v2 在 pipeline 里预生成了 Gist 题、词汇池、练习题等大量教学内容。v3 简化为只在 pipeline 里预计算 `difficulty`（用于 Feed 排序），其他所有内容（训练短文、主旨题、目标词）都在练习 Tab 运行时生成。理由：(1) Feed 教学已经不做，预生成字段没有消费端；(2) 训练内容必须基于用户当下的生词本 + 兴趣 + CEFR 动态生成，预生成本身做不到。

**不污染 ClipData**：练习 Tab 生成的内容存在 `flipodPracticeState` 里，不写回 `data.json` 或 ClipData。两边生命周期完全解耦。

---

## 十、版权策略

| 环节 | 策略 | 风险 |
|---|---|---|
| 纯听 Tab · Feed 播放 | 原播客音频流 + 来源归属 + 完整节目外链 | 合理使用 |
| 纯听 Tab · 点词查翻译 | 仅展示单词 + 中文释义，不复制连续原文 | 无 |
| 练习 Tab · 生成短文 | 全部 AI 生成，不引用任何 clip 原文 | 无 |
| 练习 Tab · TTS 音频 | 全部 TTS 合成，非原音频 | 无 |
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

## 十二、练习面板状态机

状态通过 `ListeningPracticeController.state` 驱动，overlay 根元素同步 `data-state` 属性供 CSS 钩子：

```
init    → 还未加载具体 practice（不显示面板）
pass1   → 全中文字幕
pass2   → 全英文字幕
pass3   → 渐隐字幕
pass4   → 无字幕纯听
review  → 回看 + 检测 + 难度反馈
(关闭)  → 面板淡出，controller 状态清零
```

状态转移：

```javascript
const transitions = {
  init:   { loaded: 'pass1' },
  pass1:  { next: 'pass2' },
  pass2:  { next: 'pass3' },
  pass3:  { next: 'pass4' },
  pass4:  { next: 'review' },
  review: { exit: null }
};
```

### 不支持的状态转移（设计决策）

| 不支持 | 设计意图 |
|---|---|
| `skip`（跳过某遍） | 四遍是完整序列，跳过会破坏脚手架递减 |
| `restart`（重来这篇） | 想再练就回列表开新的一篇；避免用户反复刷同一篇产生虚假正确率 |
| `pause → resume`（中途保存进度） | 练习设计为一次性完成，时长只有 3–5 分钟；保存中间态增加复杂度收益小 |

### 关闭练习面板的行为

- 从 `pass1/2/3/4` 关闭 → 丢弃本次进度，practice 仍留在 `pendingPractices`，下次打开从 pass1 重新开始
- 从 `review` 关闭 → 触发 `finish`，practice 从 `pendingPractices` 移到 `completedPractices`

### 练习 Controller 公开 API

```javascript
ListeningPracticeController.open(forceUnlock?)   // 打开练习 Tab 中心页；forceUnlock 用于 debug 预览解锁前界面
ListeningPracticeController.close()              // 关闭面板并清理 TTS
ListeningPracticeController.startPractice(id)    // 从中心页进入某个 practice 的 pass1
ListeningPracticeController.transition(event)    // 状态转移（内部使用）
```

---

## 十三、侧边菜单

v3 侧边菜单只承载"非主线"功能。听力练习已升为一级 Tab（第七章），从侧边菜单移除。

用户点击左上角 ☰ 展开侧边菜单（300px 宽度，从左侧滑入，右侧 Feed 暗化）。

菜单内容：

- 用户区（头像 + CEFR 等级 + 兴趣标签 + 统计）
- 分割线
- 菜单列表：📚 我的收藏、📝 生词本、⚙️ 设置
- 底部无 toggle（v2 的"学习模式 toggle"已随学习 Tab 下线一起移除）

ESC / 点背景关闭菜单。

---

## 十四、竞品对比

| 维度 | DuoRadio | YouTube 听力频道 | Flipod |
|---|---|---|---|
| 音频来源 | AI TTS 角色扮演 | 教师自录/新闻 | 发现层真实播客 + 训练层 AI 生成 |
| 音频真实度 | TTS 模拟 | 教师自录 | 发现层真人自然语流 / 训练层 TTS 高质 |
| 训练方式 | 选择题 | 无（视频观看） | 四遍渐进脱手（全中 → 全英 → 渐隐 → 盲听） |
| 内容个性化 | 全员同一路径 | 无个性化 | AI 基于生词本 + 兴趣 + CEFR 生成专属短文 |
| 用户路径 | 线性课程 | 无结构 | 漏斗——真实播客发现 → AI 生成个性化训练 |

---

## 十五、优先级

### P0（V1 必须交付，承载漏斗主线）

1. **两 Tab 结构 + 默认纯听**——`#mode-tab-bar` 重命名"学习"为"练习"，默认激活 `data-mode="listen"`，mode 状态持久化到 localStorage
2. **纯听 Tab 漏斗职责**——保留行为采集（点词 / 收藏 / 回拉）、点词翻译 toast、autoplay；删除所有 Phase 1-4 内嵌教学相关 UI 和代码路径
3. **练习 Tab 三态入口**——未解锁（生词本 < 5）/ 生成中 / 已就绪三态 UI；解锁阈值与文案见第七章
4. **AI 短文生成 Pipeline**——综合评分（生词本 60%×新鲜度 + 兴趣 30% + 水平差 10%，第七章 §选词评分）→ Prompt 模板 → LLM 调用 → 校验 → 入 `pendingPractices`
5. **四遍渐进脱手训练**——Pass 1 全中 + 全字幕 + 0.85x、Pass 2 全英 + 全字幕 + 0.94x、Pass 3 渐隐挖空 + 1.00x、Pass 4 盲听 + Review，状态机见 `listening-practice.js`
6. **CEFR 适配规则真正落地**——第八章适配表 4 行规则在 `listening-practice.js` 里写成 `clampLevel`、`speakText rate`、`buildCaptionHtml en-fade density`、Pass 4 replay 次数限制四处真实生效，而不是只写在 PRD 里
7. **CEFR-J overrides**——`cefr_overrides.json` 收 50-100 个高频 function/discourse 词（whenever、whatever、somewhere、nevertheless、furthermore、although...），覆盖 CEFR-J 误判；`podcast_agent.py` 和 `listening-practice.js` 查询时 overrides 优先于 CEFR-J；旧 clip 跑 `tools/retag_cefr_all_clips.py` 重打标
8. **TTS 音频层**——`/api/tts` 端点 + `text-hash` 文件缓存（`output/tts_cache/`）；行级播放 `audio.duration / plannedTotal` 线性映射高亮
9. **数据持久化**——`flipodPracticeState` 结构（pendingPractices / completedPractices / lastGeneratedAt / lastVocabCountAtGeneration / generationVersion）；`flipodInterests` 单独存
10. **AI 内容标识 + 版权归属**——练习 Tab 短文头部"AI 生成"小标签；CEFR-J/EVP/iTunes 归属在第十章对应位置展示

### P1（快速跟进）

1. **CEFR 适配表全字段写出**——P0 已落地核心三档，P1 把 A2/C1 边缘行为（A1 fallback、C2 不再降速等）补全
2. **Cambridge EVP 评估或迁移**——并行 spike：抓取 EVP A1-C2 8000 词作 ground truth 对照 CEFR-J 误差率；若 > 15% 启动迁移，输出脚本 `tools/migrate_cefr_to_evp.py`
3. **三信号 CEFR 校准**——融合 Pass 4 review 正确率 + 难度反馈 + 点词率，动态调整用户 `cefrLevel`，写入 `flipodUserProfile`
4. **供给与调度精调**——`MAX_PENDING=6` 触发上限 / 完成 `REFRESH_DELTA=3` 个补 `BATCH_SIZE=2` 个的链路在弱网/失败场景下的退避策略
5. **Pass 4 Review 题型扩充**——除当前听写式回填外，加听句配对、Gist 单选两种题型；按 `practiceLevel` 选择
6. **interest tag bonus 校准**——P0 用 +100 兜底，P1 根据 7 日点词命中率重新加权
7. **TTS 失败降级**——网络失败时显示离线"不可用"卡 + 等待重试；不要静默卡死
8. **冷启动定级流程**——4 段定级片 + 兴趣多选 → 写 `cefrLevel` 和 `flipodInterests`

### P2（设计预留）

1. **间隔复习**——已完成 Practice 的目标词在 7/30 天后回插 Review 题
2. **Pass 3 渐隐策略多模态**——除按密度遮词，再加按词性遮、按 CEFR 等级遮两种 mode，让用户选
3. **Practice 多人共享**——把生成的优质 practice 匿名化后跨用户复用，减少 LLM 调用成本
4. **设备听力数据上报**——耳机断连 / 切后台时正确暂停训练 + 恢复进度
5. **Practice 难度精修**——支持用户在 Pass 4 后给出"再来一次更难/更简单"，下次生成自动调档

---

## 十六、不做的事

- **不再做 Feed 内嵌教学（Phase 1-4）**——v3 把教学完全转移到练习 Tab，纯听 Tab 回归"沉浸发现"，不再在 clip 间隙塞 Gist 题/词卡/配对/反馈，已有的 `teaching` 字段、`flipodTeachingLog` localStorage 全部废弃
- **不做基于真实播客原文的训练**——版权风险 + AI 生成已能更精准对齐用户生词本，没必要冒险
- **不做语音录制/评分/跟读**——Flipod 是听力垂类，不开口语的口
- **不做考试模拟（雅思/托福/CET 题型）**——Flipod 不做应试，做长期听力肌肉
- **不在产品里暴露有限内容量**——纯听 Feed 不显示"第 n/22"；练习 Tab `pendingPractices` 给数字但不暴露"上限 6"或"已生成 X 个"
- **不做语法专项讲解**——所有教学锚定在"听懂这段"
- **不做原始播客音频下载/切片用于训练**——版权红线
- **不做 connected speech 专项训练**——TTS 目前做不到自然连读，留待技术成熟
- **不做训练中的 streak/打卡 gamification**——避免把"听"异化成"打卡"，让用户因为兴趣而非积分回来
- **不做练习 Tab 跳过/快进**——Pass 1-3 不能跳过（破坏渐进脱手的设计本意），只能整段退出

---

## 十七、埋点

v3 埋点按漏斗分两层：**纯听层**记录用户在发现层的内容偏好与生词来源，**练习层**记录训练完成度和难度匹配。教学层（Phase 1-4）事件全部删除。

### 纯听 Tab

| 事件名 | 触发 | 属性 |
|---|---|---|
| `tab.switch` | 用户切换 Tab | `from, to, mid_practice?(bool)` |
| `clip.viewed` | Feed 卡片进入视口且 play() 成功 | `clip_id, cefr, source_podcast, autoplay?` |
| `clip.word_tapped` | 听中点词 | `word, cefr, clip_id, timestamp` |
| `clip.word_saved` | 听中收藏词 | `word, cefr, clip_id` |
| `clip.replay` | 回拉重听 | `from, to, clip_id` |
| `clip.saved` | 收藏整段 clip | `clip_id` |
| `clip.skipped` | 快速划走（< 5s 停留） | `clip_id, dwell_ms` |
| `clip.priming_seen` | 有 priming 字段的卡片滑入视口 | `clip_id, word_count` |
| `clip.priming_skipped` | 1 秒延迟窗口内划走 | `clip_id, dwell_ms` |

### 练习 Tab（漏斗第二段）

| 事件名 | 触发 | 属性 |
|---|---|---|
| `practice.unlock_seen` | 未解锁态曝光 | `vocab_count, threshold=5` |
| `practice.generating_seen` | 生成中态曝光 | `is_first_time?(bool)` |
| `practice.list_seen` | 已就绪态曝光 | `pending_count, completed_count` |
| `practice.batch_generated` | 后台批次生成结束 | `count, reason(unlock/refresh), duration_ms, llm_tokens?` |
| `practice.session_started` | 用户点击某个 practice | `practice_id, target_words[], practice_level` |
| `practice.pass_completed` | Pass 1-4 某遍结束 | `practice_id, pass(1/2/3/4), duration_ms, replay_count` |
| `practice.review_submitted` | Review 层答题提交 | `practice_id, correct, total, per_word[{word, correct}]` |
| `practice.difficulty_rated` | 用户反馈难度 | `practice_id, value: easy/right/hard` |
| `practice.session_exited` | 非正常退出（中途关闭） | `practice_id, last_pass, reason(tab_switch/close/back)` |
| `practice.generation_failed` | 生成失败 | `reason(llm/network/validation), retry_count` |

### 用户画像校准

| 事件名 | 触发 | 属性 |
|---|---|---|
| `profile.cefr_updated` | 水平估值变化 | `from, to, signal(pass_review/difficulty/word_tap_rate)` |
| `profile.interest_added` | 兴趣 tag 增加 | `tag, from(ob/settings)` |
| `profile.vocab_milestone` | 生词本达阈值（5/20/50） | `count, milestone` |

---

## 附录 A：参考文献

- Vandegrift, L. (2003). Orchestrating strategy use: Toward a model of the skilled second language listener. *Language Learning*, 53(3).
- Vandegrift, L. & Tafaghodtari, M. (2010). Teaching L2 learners how to listen does make a difference. *Language Learning*, 60(2).
- Gianfranco Conti (2025). Shadowing for Fluency, Prosody, and Listening Comprehension. *The Language Gym*.
- Gianfranco Conti (2025). Teaching Listening Strategies – When It Actually Works. *The Language Gym*.
- Duolingo Blog (2025). DuoRadio is Duolingo's New Tool for Practicing Listening Skills.
- Duolingo Blog (2025). Using generative AI to scale DuoRadio 10x faster.
- Nature (2025). The impact of AI-driven speech recognition on EFL listening comprehension.
- ScienceDirect (2024). Enhancing language proficiency through mobile extensive listening and podcasting.
- ScienceDirect (2024). Optimising listening skills: effectiveness of a blended model with a top-down approach through cognitive load theory.
