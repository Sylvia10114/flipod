# Handoff · Flipod v3 Split Entry Demo · 2026-04-27

> 这是 `2026-04-26_split-entry-handoff.md` 的延续 + 后续多轮 UI 迭代的总结。当前 demo 已可用（feed → 拆开听 → 6-stage → 词汇消费 → 生词本），整体在 main 分支。

---

## 一、当前形态（What's Built）

### 1.1 主入口：`flipod_v3_split_entry.html`

刷流 feed，单句大字幕 + 词级 CEFR 高难词高光。视觉与字幕渲染照搬 `jp_test/mobile/src/components/WordLine.tsx` + `FeedScreen.tsx` + `PlayerControls.tsx` 的 darkColors token 与 `restorePunctuation` / `spokenWordStyle` 规则。

**布局**（自上而下）：

- 左上 ☰ hamburger（菜单入口，从左侧滑出）
- 顶部居中 source kicker + clip title（轻量上下结构）
- 中部 WordLine 单句字幕（fade in/out 句切换 + 词级 spoken / active 状态）
- 字幕下方 translation bar（zh 折叠时占位 pill；展开时显示中文）
- 拇指热区一行 transport：左 cluster 空 / 中 [↶][▶][↷] / 右侧 L 镜像组（[♡] [🔖] 竖排在上、[文A] [1x] 横排在下）
- progress bar + 0:00 / 1:25 时间
- utility row 右下角 [⊙ 拆开听] pill（深练入口，target 同心圆图标）

**交互**：

- 自动播放第一句（验收 §10.1）
- 上下滑切 clip / 滚轮调试切 clip
- 双击 transport 跳上一句 / 下一句
- zh-toggle 切换中文翻译显示
- speed 循环 0.75x / 1x / 1.25x / 1.5x / 2x
- 心 / 收藏：UI-only state（未做后端持久）
- 拆开听 → 跳 `practice-v2-demo.html?clip=clipNN.mp3` 单条模式

### 1.2 菜单抽屉

从左侧滑入（与 hamburger 同侧，符合右手模式拇指动线）。

- Header: `Hi, Learner` + 「已收 N · 已掌握 X · 待复习 Y」
- 6 项：**生词本**（带 badge）/ 喜欢的 / 收藏 / 看看有什么 / 学习兴趣 / 设置
- **生词本**点入 → 二级面板（带返回按钮）：每条记录显示 `word + CEFR + 状态徽章 + 中英例句`
- 其他 5 项：toast 提示「demo 暂未实现」

### 1.3 深练页改造：`practice-v2-demo.html`

仍是 6 stage（预听 / Gist / Decode / 渐隐 / 检验+归因 / 词汇）。改动集中在两类：

**A. 单条模式（split-entry）**：

- `?clip=clipNN.mp3` 解析 → CLIPS / KEYWORDS_PER_CLIP / CLIP_TYPES / QUESTIONS_PER_CLIP 全部裁到该 clip
- 顶部右上 × 关闭按钮（`history.back()` 回 feed）
- chain bar 显示 1 步
- 单条结束 →「完成 · 返回」按钮（`pushCompleted()` + `history.back()`，不进 global-end）
- skip 按钮在 single-clip 模式下隐藏

**B. 教学阶段题目独立第二屏**：

- Stage 0：信息卡（标题/来源/链接/关键词/提示）+「开始预测 →」按钮 → 第二屏只有 kicker + 提示 + 题目
- Stage 1-3：音频 onEnded → `showQuestionsAsScreen()` 清屏后渲染题目（kicker + hint）
- 新增 helper `showQuestionsAsScreen(container, qs, onAllDone, {kicker, hint})` 在 line ~1413

**C. Stage 4 step 2 全词可选**：

- 移除 B2+ 过滤；句中所有词都能点选（A1/A2 不带 CEFR 标，B1+ 带）
- 副标题改成「点句子展开 → 任何词都能选，B1+ 词带难度标 · 可以多选」

**D. Stage 5 词汇消费 → 生词本**：

- 标题改为「阶段 5 · 词汇消费 → 生词本」
- 每词两个动作：**✓ 记住了** / **↻ 再练一遍**
- 全部消费后写入 `localStorage["flipodVocabBook"]` → 跳 Stage 6
- 入库结构：`{word, cefr, sentence_en, sentence_zh, clip_audio, status, committed_at}`，同词覆盖（保留最新 status）

---

## 二、关键文件

| 文件 | 性质 | 核心改动 |
|---|---|---|
| `flipod_v3_split_entry.html` | 新增 | 整张 feed + 菜单 + 生词本面板 |
| `practice-v2-demo.html` | 改 | +220 行：query 解析、close 按钮、Stage 0 拆 2 屏、Stage 1-3 题目独立成屏、Stage 4 全词可选、Stage 5 消费入库 |
| `practice-v2-demo-data.json` | 沿用 | 3 clip，未改 schema |
| `practice-v2-demo-questions-v2.json` | 沿用 | GPT 生成的 21 题 |
| `flipod_v2_demo.html` | 未动 | 保留作为对照 |

---

## 三、数据 / Storage 约定

- `localStorage["flipodVocabBook"]` — 生词本入库，结构见 §1.3-D
- `localStorage["flipodV2DemoSession"]` / `flipodV2DemoCompleted` / `flipodV2DemoLastRun` — 沿用原 schema
- `sessionStorage["flipodV3FeedIdx"]` — feed 当前 clip index，深练页 `history.back()` 后用于恢复位置
- 数据源全部走 `practice-v2-demo-data.json`，**没有引入新 schema 字段**

---

## 四、设计原则（来自 2026-04-27 市场调研 §10）

UI 在多轮迭代中向以下原则收敛，**未来改动应继续遵守**：

1. **第一屏 3 秒内有声音** — autoplay，无 OB / tooltip / 智能体气泡
2. **进度条上方 = 拇指热区** — 心/收藏/字幕/倍速 全部聚拢成 L 镜像，不分散在屏幕四角
3. **不暴露内容池上限** — 删掉「1/3」计数器；最后一条用「歇会儿，明天再来听新的」而非「已经是最后一条」
4. **教学阶段题目独立成屏** — 信息和题目不混在同一屏，给字幕和题目各自的呼吸空间
5. **拆开听入口要可见但不抢戏** — target 同心圆图标 + 文字标，避免 search/help 语义
6. **菜单从 hamburger 同侧滑入** — 右手模式下 ☰ 在左 → drawer 从左

---

## 五、已知限制 / 没做的（明确出 scope）

- **mask 模式 / subtitle size 切换**：jp_test FeedScreen 有，本 demo 没做，PlayerControls 已照搬其他四件套
- **三态 CEFR 置信度视觉**（high/medium/low）：调研 §10.6 的处方，需要 confidence 数据才能落地
- **长按词 → 词典抽屉**：调研 §10.3 layer 2，需要词典内容，做 stub 反而稀释概念
- **clip 结束后 chip 反馈**（再来一个 / 类似话题 / 更简单些）：调研 §10.5，是 feed 流的扩展，本次没做
- **大封面图视觉主体**（调研 §10.2）：数据没有 podcast cover URL
- **菜单 5 项功能**（喜欢的 / 收藏 / 看看有什么 / 学习兴趣 / 设置）：均为 toast 占位
- **心 / 收藏的持久化**：当前是 per-card UI state，刷新即丢；菜单里的「喜欢的 / 收藏」对应入口也未实现

---

## 六、运行与验证

```bash
# 启动 dev server（含 Range request 支持，音频 seek 必需）
node scripts/dev_server.js

# 访问
http://localhost:8080/flipod_v3_split_entry.html
```

完整闭环验收：

1. 进入 feed → 看到字幕单句滚动 + 词级 CEFR 高光
2. 点拆开听 → 进入 practice 页，单条 chain，6 stage 跑通
3. Stage 0 → 第一屏只有信息，点「开始预测 →」进入第二屏题目
4. Stage 4 step 2 → 任意词都能选
5. Stage 5 → 每词「✓ 记住了 / ↻ 再练一遍」消费完毕
6. × 关闭返回 feed → 卡片位置恢复
7. 点 ☰ 菜单 → 抽屉从左侧滑入 → 点「生词本」→ 看到刚才消费的词 + 状态

---

## 七、给下一棒的建议

- **Nate（RN 重构方向）**：feed 视觉已经按 jp_test FeedScreen 来对齐，可以直接把 v3 的拇指 L 镜像 + 单侧菜单 + 拆开听 入口往 mobile/src/screens/FeedScreen.tsx 上挪。Stage 0 拆 2 屏的模式也建议 RN 版本采纳。
- **下一个 Claude session**：如果接上做"心/收藏持久化 + 菜单二级面板填实"，可以参考生词本面板的 push view 模式（`vocab-panel` slide-in，带返回按钮）。
- **L 镜像位置不要动**：用户在 demo 这一轮反复迭代了 3 次才定下位置（右下、拇指热区、心收藏在字幕倍速上方）。改动这一带需要先和 Sylvia 确认。

---
