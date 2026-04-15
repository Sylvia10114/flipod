# Flipod 入库判断标准（INTAKE STANDARDS）

> **作用**：判断一个 clip 能不能进入 Flipod `data.json` 冷库的 single source of truth
> **适用场景**：eval agent 评分、人审 verdict、filter 调优、prompt 迭代的对齐基准
> **Owner**：PM (Jamesvd) 定义并校准 / Cowork 负责维护本文档
> **首次落盘**：2026-04-14（抽取自 `scripts/eval_candidates.py` 第 9-23 行注释 + `docs/ops/AGENT-eval.md`）

---

## 0. 使用规则（长期协作机制）

**这是 PM 和 AI 之间的长期约定，不是一次性文档。**

- PM 对齐过的任何入库判断标准都应在此文档，**不应在对话、代码注释、散落文档里**
- 任何 todo / 代码 / 文档涉及"按标准审核"时，**直接引用本文档**（`docs/ops/INTAKE-STANDARDS.md`），不要复述
- PM 在对话中提到新标准时，Cowork 的第一反应是**搜索 `docs/` 看是否已有定义**，已有→引用；不同→更新本文档并回报
- 本文档任何修改必须记录在第 9 节变更日志

---

## 1. 判断原则

一个 clip 能进库，意味着**用户滑到它时获得完整可消费的体验**——不是"AI 觉得结构合格"，而是：
- 内容本身有信息或情绪的实质
- 独立可听，不依赖前后文
- 开头钩得住，结尾收得干净
- 匹配它所属的 tier 画像

---

## 2. 红线（任一触发 → 直接 reject）

**红线只有 2 条，任何 reject 决定必须落到其中至少一条。**

### 红线 A：信息密度 = 1
- 嘉宾介绍 / 主持人自我介绍
- 纯寒暄 / 纯感慨 / 纯抒情
- 广告口播 / 赞助商鸣谢
- 节目套话（"coming up after the break" / "sponsored by" / "stay tuned" / "subscribe"）
- 纯 meta 闲聊（主持人之间"yeah totally" 类互相 validate，没有实质内容）

### 红线 B：开头 = 1 或结尾 = 1（半截句类）
- 不含完整句末标点（`.` `!` `?` 或引号）
- 悬挂连词结尾（`and / but / or / to / of / in / on / which / that`）
- 句子中途被切断（末尾词明显不是自然落点）
- 开头就是半截语（"is when I realized..." "much smaller."）
- 逗号结尾（`…they` `…us`）

**重要例外——不算红线的情况：**
- 开头出现 antecedent_phrase（"you said" / "that's right" / "back to your point"）但**后续立即复述或补救前文内容** → opening 给 2-3 分，标 **gray** 让 PM 拍板，不算红线

---

## 3. 5 个核心维度评分（1-5）

每条 clip 都必须给这 5 个维度打分。

| 维度 | 5 分 | 4 分 | 3 分 | 2 分 | 1 分（红线） |
|---|---|---|---|---|---|
| **opening** 开头 | 直接问句 / 具体人物 / 反差数字 / 第一人称记忆 | 软标记 And/But/So 起头但 hook 真 | 套路开头但内容撑得住（"It's funny how" / "The thing about X is"） | antecedent 但有补救 / 弱钩子 | 半截句 |
| **ending** 结尾 | 自然落点 | 完整句但语义略散 | 完整句但收得仓促 | 完整句但悬挂感强 | 半截句 / 悬挂连词 / 广告转场 |
| **info** 信息密度 | 明确洞察 / 反直觉 / 完整故事 | 有信息但不够锐利 | 普通 | 信息稀薄 | 纯寒暄 / 嘉宾介绍 / 广告 |
| **standalone** 独立可消费 | 完全独立 | 需要少量背景但能猜 | 部分依赖前文 | 多处依赖 | 严重依赖前文 |
| **tier_fit** Tier 匹配 | 完美命中该 tier 的"好片段"画像 | 典型 | 沾边 | 偏移 | 串台 |

---

## 4. Story tier 的额外维度

Story tier 除以上 5 维，**加评第 6 维 narrative_arc**（1-5）：

- 5 分：完整铺垫 → 冲突 → 落点弧线
- 3 分：有铺垫无落点（或反之）
- 1 分：纯感慨没有故事本体

---

## 5. 综合判断规则

| Verdict | 条件 |
|---|---|
| **reject** | 触发任一红线 |
| **pass** | 5 维度平均 **≥ 3.5** **且无任何维度 ≤ 2** |
| **gray** | 其他所有情况（含 antecedent_with_recovery / 软套路开头 / tier 模糊 / 平均 3.0-3.5 / 单项 = 2 但平均不低） |

**gray = 需要 PM 人工拍板**，不自动入库也不自动 reject。

---

## 6. Tier 边界澄清

以下是 PM 反复校准过的边界，eval agent 和人审都必须遵守：

- **Science**：自然科学（物理 / 化学 / 生物）+ 人体 + 行为科学 + 神经科学 + 动物
- **Culture**：**集体**人类社会现象（历史 / 习俗 / 文化对比 / 社会现象）。**个体生物学不算 Culture**
- **Psychology**：心理学 / 行为科学 / 个体认知模式
- **Business**：商业 / 金融 / 创业 / 公司战略
- **Tech**：技术 / AI / 互联网产品 / 科技公司
- **Story**：第一人称叙事；额外评 `narrative_arc` 维度

> 完整 tier 定义（定位 / 三类好片段 / 边界 / duration / 特有维度 / 典型来源播客）见 `docs/ops/TIER-DEFINITIONS.md`。

---

## 7. Anchor 案例（校准基准）

**权威来源**：`scripts/eval_candidates.py::ANCHORS`（9 个案例：4 pass / 1 gray / 4 reject）

维护规则：修改 anchor = PM 更新校准版本，必须同时更新本文档版本号。

案例速查（细节见代码）：

| # | Tier | Verdict | 关键判断 |
|---:|---|---|---|
| 1 | Business | pass | 直接问句 + 反直觉洞察 + 完整收束 |
| 2 | Tech | pass | And 软标记但 hook 真，脱离上下文成立 |
| 3 | Story | pass | 第一人称记忆 + 完整铺垫-反转-落点 |
| 4 | Psychology | pass | 软套路开头但内容稳 |
| 5 | Tech | **gray** | antecedent 有补救；可听但不锐利，PM 拍板 |
| 6 | Business | reject | 信息密度=1（纯嘉宾介绍） |
| 7 | Story | reject | 开头和结尾都是半截句 |
| 8 | Science | reject | 结尾=1（广告转场） |
| 9 | Tech | reject | 信息密度=1（纯 meta 闲聊）+ antecedent 没补救 |

---

## 8. 两阶段审核机制

**阶段 1（当前）**：半自动
- eval agent 输出 pass / gray / reject 三档
- pass → 自动进入合并候选
- reject → 自动丢弃
- gray → PM 人工复核

**阶段 2（未来）**：纯自动
- 去掉 gray，只有 pass / reject
- 全自动写入 data.json

**切换条件**：连续 3 批（约 15-20 个 clip）eval 的 gray 判断与 PM 人工判断**一致率 ≥ 90%**。

详细规格见 `docs/ops/AGENT-eval.md`。

---

## 9. 变更日志

| 日期 | 版本 | 改动 | Owner |
|---|---|---|---|
| 2026-04-14 | v1.0 | 首次落盘，从 eval_candidates.py 注释 + AGENT-eval.md 提取 | Cowork |

**变更流程**：
1. PM 在对话里提出修改
2. Cowork 更新本文档对应章节 + 追加一行变更日志
3. 若影响 eval_candidates.py 的 prompt 或 anchor，同步更新代码
4. 向 PM 报告："标准已更新到 INTAKE-STANDARDS.md 第 X 节"

---

## 10. 引用入口（给后续 todo / 文档写作用）

需要"按标准审核"时这么写：

> 按 `docs/ops/INTAKE-STANDARDS.md` 判断 verdict，gray 条目交 PM 人审。

**不要**这么写：

> ❌ 按红线 A/B 和 5 维度评分，平均 ≥3.5 且无维度 ≤2 为 pass... （复述标准）
