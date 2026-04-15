# Flipod 分工与握手协议

**日期**：2026-04-14
**参与方**：PM（Jamesvd）+ Cowork（AI 流水线）× 研发
**背景**：研发接手用户侧（登录 / 信息搜集 / 推荐），但"flipod 进阶"文档里大量涉及内容供给侧的数据契约，为避免重复造轮子或空白地带，先明确边界和接口。

---

## 一、三块地盘

| 区域 | 谁负责 | 输出物 |
|---|---|---|
| **内容供给**（发现 → 转录 → 选片段 → QA → 加工 → 入库） | PM + Cowork | `data.json` / clip manifest、mp3 clips、`source_catalog.json` |
| **中间数据层**（schema / topic 体系 / 难度模型 / qa_score 定义） | **双方握手协议**（见第三节） | 协议文档 |
| **推荐与用户侧**（登录 / onboarding / rank / 用户画像 / 服务规则） | 研发 | 前端 UI、排序逻辑、后端 API（如需） |

---

## 二、详细职责

### 内容供给（PM + Cowork 主）

- Feed 发现与 curated list 维护（Tier A/B 分层）
- 音频下载、Whisper 转录（已落盘缓存）
- LLM 选候选（`scripts/agent/segmentation.py` + tier prompts）
- Filter 规则层（duration / 开头 / 末尾 / 广告 / 静音）
- Eval agent 打分（5+1 维度）
- 人审 verdict（`tools/dry_run_review.html`）
- mp3 切片、词级字幕、翻译、CEFR 标注、comprehension questions
- 合并进 data.json / manifest
- Prompt 版本迭代（当前 v2.2）

### 推荐与用户侧（研发主）

- 用户登录流程
- Onboarding：level 选择 + 3 interests + starter set 生成
- `rank.js` 替换为读 manifest（而非手写 CLIP_META）
- 首屏策略（70% 兴趣 topic / 20% 相邻 topic / 10% 高 hook 通用）
- 用户行为 → 画像调整（连续跳过换 topic，点词多降难度，完播高且少点词升难度）
- CEFR 服务规则（A1-A2 只吃 easy / B1 easy+medium / B2 medium / C1-C2 medium+hard）
- 前端 UI 改造、后端 API（如需持久化用户画像）

---

## 三、握手协议（明天要对齐的核心）

### 3.1 clip manifest schema

**性质**：生产侧写、推荐侧读的数据契约。不对齐，两边一定对不上。

| 事项                          | 谁做             | 交付物                            |
| --------------------------- | -------------- | ------------------------------ |
| 列字段（名称 / 含义 / 值域 / 必填 / 来源） | **研发先出 v1 提案** | `docs/SCHEMA-clip-manifest.md` |
| 评审"每个字段能否从流水线稳定产出"          | PM + Cowork    | 回标注 ✅/❌/需改造                    |
| 定稿锁定                        | 双方             | 同一份 schema 进 git               |
| 改流水线输出匹配 schema             | PM + Cowork    | `scripts/agent/output.py` 升级   |
| 前端 `rank.js` 改读 manifest    | 研发             | 无                              |

**PM 侧当前缺的字段**（相对研发文档）：`source_id` / `topic` / `difficulty_score`（数值）/ `qa_score` / `freshness` / `hook_score`。

### 3.2 topic 分类体系

**性质**：推荐用 topic，生产用 tier，两者共存但需要映射。

| 事项 | 谁做 |
|---|---|
| 列 8 个 topic 名称、含义、对应前端兴趣标签 | **研发** |
| 定"相邻 topic 矩阵"（starter set 20% 要用） | **研发** |
| 每个 clip 同时打 tier（生产用）和 topic（推荐用） | PM + Cowork |
| tier → topic 映射表（或 LLM 自动标） | PM + Cowork |

**约束**：topic 定了尽量稳定，增删会让全部 clip 需要重新打标。

**生产和消费分开的意义：**

**1. 它们服务的决策不一样。**

Tier 是给**流水线 LLM 和 filter 看的生产指令**。同一段音频是不是能切出好 clip,取决于 tier:Story 要求 60-150s(叙事需要空间),Science 45-120s(解释可以短);Story 的 eval 多一个 `narrative_arc` 维度,别的 tier 没有;INTAKE-STANDARDS §6 里 Culture 的边界写的是"**集体**人类社会现象,个体生物学不算" — 这是 segmentation prompt 里要告诉 LLM 的事,不是要告诉用户的事。tier 决定**怎么生产**。

Topic 是给**用户和推荐算法看的消费标签**。用户 onboarding 选 3 个兴趣、首屏 70/20/10 里的"相邻 topic"、连续跳过换 topic,这些都是用户心智维度。用户不会说"我想听 Story tier",他会说"我想听故事 / 心理 / 商业"。topic 决定**给谁看**。

**2. 它们的变化频率不一样。**

tier 改一次,全部 segmentation prompt + filter 参数 + eval agent 维度都要重写,已入库的 clip 也要全部重评。所以 tier 必须稳定,现在 6 个不动。

topic 可能随前端兴趣模块演化(今天 8 个,明天研发加了"环保"或"艺术",后天改为 10 个)。如果 tier 和 topic 绑死,每次前端调标签生产侧全得重来。分开之后,topic 改只需要重打标(`clip.topic` 字段重赋值),不动 prompts。DIVISION-OF-WORK §6 写"topic 不要频繁增删"但**留了增删的口子**,就是为了承认它会变。

**3. 它们的定义权在不同人手里。**

tier 归 PM + Cowork(生产方定义生产指令),topic 归研发(消费方定义用户看到的标签)。这是 DIVISION-OF-WORK §6 红线第 5、6 条的内在逻辑 — **谁是消费方谁定义**,否则会出现"研发改前端兴趣标签 → PM 被迫改 prompts"的连锁反应,两边互相牵制,迭代速度崩塌。

---

**合并的代价(反面论证,你可以自己判断值不值得分开):**

- 每个 clip 要打双标,多一步(tier→topic 映射表 or LLM 自动标)
- 双标可能不一致(Story tier 的一个 clip 打到"心理"topic 还是"故事"topic?)— 需要映射规则或人审
- 文档和代码里两套术语,初期团队容易混

如果你的 gut 是"这层抽象过度了",也是合理质疑。特别是**如果 tier 和 topic 几乎一一对应**(6 个 tier ↔ 8 个 topic 里面只差 2 个),分两层的收益就很小,不如合并成一套。

**下午会议上可以顺手问研发一句**:你们给的 8 个 topic,能不能基本对应到 6 个 tier(哪怕是 N:1)?如果映射表 80% 以上是 1:1,那分两层的工程代价就不太值;如果研发的 8 个 topic 跟 tier 结构完全正交(比如 topic 按"情绪/信息/叙事"分,完全是另一个维度),那分两层就是必须的。


### 3.3 source catalog

**性质**：流水线 by-product，研发可能用于推荐侧的"来源多样性规则"。

| 事项                                                                                                        | 谁做                     |
| --------------------------------------------------------------------------------------------------------- | ---------------------- |
| 字段定义（feed_id / primary_topics / tier / qa_pass_rate / clip_yield / median_difficulty / last_processed_at） | PM + Cowork（向研发征询是否够用） |
| 自动维护（每轮 dry-run 后更新）                                                                                      | PM + Cowork            |
| 输出路径：`output/source_catalog.json`                                                                         | PM + Cowork            |
| 按需读取                                                                                                      | 研发                     |
|                                                                                                           |                        |

### 3.4 difficulty 模型

**性质**：从"CEFR 词分布单信号"升级到"5 信号加权"，按研发文档要求。

| 事项 | 谁做 |
|---|---|
| 5 个信号实现（B2+/C1+ 词占比 / WPM / 句长 / 专名密度 / 主题抽象度） | PM + Cowork |
| 加权公式 + band 阈值（落到 easy/medium/hard） | PM + Cowork（研发可提改进） |
| 产出 `difficulty_score`（0-1 连续）+ `difficulty_band`（三档） | PM + Cowork |
| 读 band（或 score 做自定义规则） | 研发 |

**约束**：band 命名用 easy/medium/hard 和研发文档一致，**不再保留 B1/B2/C1**（除非研发需要 CEFR 原值）。

### 3.5 QA 和 qa_score

**性质**：最容易出双跑的地方——研发可能想在推荐侧加二次评估。

| 事项 | 谁做 |
|---|---|
| 一级 QA（filter + eval agent + 人审） | PM + Cowork |
| 写入 manifest 的 clip = 都通过了一级 QA | PM + Cowork |
| `qa_score` 字段定义（取值和含义） | 双方协议 |
| 二级 QA（基于用户行为动态降权）← 如果要做 | 研发 |

**关键问题（要当面问研发）**：**manifest 里的 clip，你默认它们都通过 QA 了吗？还是你也要根据用户行为重新算 qa_score？**

- 如果前者：一级 QA 出的就是最终 `qa_score`，研发只读
- 如果后者：需要定义"基础 qa_score"和"动态 qa_score"的关系，研发走反馈回路调整

---

## 四、明天 30 分钟对齐会议的议程

1. **schema v1**（10 分钟）——研发带 v1 字段清单，PM 评审可产出性，现场锁定
2. **8 个 topic**（10 分钟）——研发给定义，PM 确认能打标
3. **QA 归属**（5 分钟）——问 3.5 节的关键问题，达成单层或双层 QA 决定
4. **排期**（5 分钟）——schema 锁定后，PM 多久能改完流水线输出、研发多久能改完 rank.js

其余事项（source catalog / 库存矩阵 / difficulty 公式）PM + Cowork 内部推进，不占会议时间。

---

## 五、上线前节奏建议

- **本周**：对齐会 + PM 继续补冷库（当前 37，目标 150）
- **下周**：schema 锁定 → PM 改流水线输出 + 补完冷库 → 研发改 rank.js
- **再下周**：推荐改造上线（首屏 starter set + 用户画像反馈）

---

## 六、红线（避免双跑和空白）

- ❌ 前端**不要**绕过 manifest 直接读 data.json
- ❌ schema 锁定前，**不要**双方各起一套
- ❌ topic 体系**不要**频繁增删（增量可以，结构变动要公告）
- ❌ 一级 QA 的判权**不要**分化（manifest 里的 clip 默认已通过）
- ❌ PM 侧**不要**自己定义 topic（研发是消费方，定义权归他）
- ❌ 研发侧**不要**自己动手算 difficulty（PM 侧五信号已在排期）
