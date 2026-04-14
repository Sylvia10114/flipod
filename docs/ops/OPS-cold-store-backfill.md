# Cold Store 冷库补齐 SOP

**日期**：2026-04-14
**目标**：把 Flipod 冷库从 37 clip 扩到 150+ clip，每个 tier 至少 20 clip
**前提**：Claude Code 已完成 `prompts/CLAUDE-CODE-HANDOFF.md` 的 7 个任务

---

## 阶段划分

```
[阶段 0] Claude Code 代码改造           → 1-2 天
[阶段 1] Dry-run 校准 prompt            → 半天
[阶段 2] 分批补齐（3 批）               → 1-2 周
[阶段 3] 补齐完成，评估是否开定时        → 1 天
```

---

## 阶段 0：代码改造验收

**不属于本 SOP，但进入阶段 1 的前提。Claude Code 交付后检查：**

- [ ] `podcast_agent.py` 主文件 < 200 行，逻辑拆分到 `agent/` 子模块
- [ ] 重构前后同配置跑出的 data.json 完全一致（纯结构重构无逻辑变化）
- [ ] `--dry-run` flag 可用，输出 `output/dry_run_candidates.json`
- [ ] 6 个 tier 的 prompt 都能按路径分派到
- [ ] 候选过滤层 6 条规则跑得动（单元测试绿）
- [ ] API keys 从 env 读，`.env.example` 提供
- [ ] 单元测试通过率 100%

**任一不满足 → 打回 Claude Code，不进入阶段 1。**

---

## 阶段 1：Dry-run 校准

### 目标

在不花音频切片/翻译/CEFR 成本的前提下，验证每个 tier 的 prompt 选候选质量。

### 选测试 feed

从 17 个 Tier 1 feed 里选 6 个最有代表性的（每 tier 一个）：

| Tier | 代表 Feed | 原因 |
|------|----------|------|
| Business | Planet Money | 叙事+商业双重特点，最考验 prompt |
| Tech | Hard Fork | 主持人闲聊污染的典型源 |
| Science | Short Wave (NPR) | 单集主题清晰，好校准 |
| Psychology | Hidden Brain | 已有样本的参照物 |
| Culture | Throughline | 历史叙事 + 文化分析混合 |
| Story | The Moth | 纯叙事类的基准 |

### 执行命令

```bash
cd "/sessions/eager-loving-keller/mnt/listen demo"
python3 scripts/podcast_agent.py \
  --mode curated \
  --feeds "<上表 6 个 feed URL，逗号分隔>" \
  --episodes-per-feed 2 \
  --candidates-per-episode 6 \
  --dry-run \
  --output-dir output/dry_run_$(date +%Y%m%d) \
  2>&1 | tee output/logs/dryrun_$(date +%Y%m%d).log
```

预计产出：6 feed × 2 episode × 6 候选 = 约 72 个候选区间。

### PM 审核

**我和 PM 一起过这 72 个候选**，每个候选判断：

- **好**：符合 tier 预期，开头有钩子，内容完整
- **差**：具体说明差在哪（开头软 / 结尾截 / 信息密度低 / 内容无聊 / ...）

**目标通过率：≥ 60%**。低于 60% 说明当前 tier prompt 跑偏了，回去改 prompt 再 dry-run。

### 退出条件

- 所有 6 个 tier 的通过率都 ≥ 60%
- 没有系统性问题（比如某个 tier 全军覆没）
- PM 签字确认 prompt 进入补齐阶段

---

## 阶段 2：分批补齐

### 为什么分批

一次性跑满规模的风险：

1. 如果 prompt 后期发现问题，一整批都是低质量产出，浪费审核时间
2. 不同 tier 的问题暴露时间不同，分批能让我们在第一批后调整
3. PM 审核有精力上限，一次审 150 个 clip 质量会下滑

每批之间留 1-2 天审核 + 调整窗口。

### 批次安排

#### 第一批：Business + Tech

**选这两个 tier 先跑的原因：**
- 更新最频繁（weekly 级），长期都是内容主力
- 主持人闲聊污染最严重，风险最高，早暴露早修
- PM 对这两个领域的判断最准

**执行参数：**
```bash
python3 scripts/podcast_agent.py \
  --mode curated \
  --tiers "Business,Tech" \
  --episodes-per-feed 5 \
  --clips-per-episode 3 \
  --incremental \
  --output-dir output/batch1 \
  2>&1 | tee output/logs/batch1_$(date +%Y%m%d).log

python3 scripts/eval_agent.py \
  --input output/batch1/new_clips.json \
  --audio-dir output/batch1/clips \
  --use-llm
```

预计产出：9 个 feed（5 Business + 4 Tech）× 5 episode × 3 clip ≈ 100-130 候选，eval 后约 50-80 pass。

#### 第二批：Science + Psychology

**在第一批审核后 1-2 天启动。**

```bash
python3 scripts/podcast_agent.py \
  --mode curated \
  --tiers "Science,Psychology" \
  --episodes-per-feed 5 \
  --clips-per-episode 3 \
  --incremental \
  --output-dir output/batch2
```

预计产出：4 个 feed × 5 episode × 3 clip ≈ 40-60 候选，eval 后约 20-35 pass。

#### 第三批：Culture + Story

```bash
python3 scripts/podcast_agent.py \
  --mode curated \
  --tiers "Culture,Storytelling" \
  --episodes-per-feed 5 \
  --clips-per-episode 3 \
  --incremental \
  --output-dir output/batch3
```

Storytelling 是 evergreen，如果 episode 少可以放宽到 10 集/feed。

---

## 每批审核 SOP

### 1. eval 结果分析

读 `output/batchN/eval_results.json`，检查：

- **pass 率**：目标 50-70%
  - 低于 40% → processor 或 prompt 有系统性问题，暂停合入 data.json，先排查
  - 高于 80% → eval 标准可能太松，抽查 review/reject 看看

- **reject 原因分布**：是否有集中出现的新模式
  - 新模式 → 可能是 prompt 某个场景没覆盖，加规则
  - 已知模式 → 是否在过滤层能补一条规则拦截

### 2. Review 状态 clip 人工过

每个 review 状态的 clip：
- 听 mp3（mp3 路径在 eval_results.json 的 `audio_path` 字段）
- 看 flags，决定转 pass 或 reject
- 转 pass 的批量添加到 approved_clips.json

### 3. 合并到 data.json

**不直接覆盖 data.json，走合并流程：**

```bash
# 把批次产出的 approved_clips.json 合入主 data.json
python3 scripts/merge_clips.py \
  --source output/batchN/approved_clips.json \
  --target data.json \
  --audio-src output/batchN/clips \
  --audio-dst clips
```

合并时：
- clip id 重新编号（接续 data.json 最大 id + 1）
- mp3 从 `output/batchN/clips/clip_XXX.mp3` 复制到 `clips/clipN.mp3`（命名方式与现有保持一致）
- 更新 data.json 的 `clips` 数组
- **备份旧 data.json**：`cp data.json data.json.backup_$(date +%Y%m%d)`

（⚠️ `merge_clips.py` 目前不存在，需要 Claude Code 在阶段 0 的任务清单里补上——我会让 Sylvia 追加到 handoff 文档。）

### 4. 前端验证

```bash
cd "/sessions/eager-loving-keller/mnt/listen demo"
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080，抽查 3-5 个新 clip 能正常播放、字幕同步、CEFR 着色正确
```

### 5. Git 提交

```bash
git add data.json clips/
git commit -m "content: batch N backfill - $NEW_CLIP_COUNT new clips (Business/Tech)"
```

---

## 停止/调整条件

任何一条触发都应该暂停下一批，先排查：

- 某批 pass 率 < 40%
- Eval 出现集中新型 reject 原因（单类占比 > 30%）
- PM 人工抽查发现 eval 误判（reject 里有明显好 clip、pass 里有明显差 clip）
- 前端验证时发现技术问题（时间戳不同步、CEFR 异常等）
- Azure API 成本异常（超出预算 2x）

---

## 完成标准

冷库补齐"完成"的定义：

- [ ] 总 clip 数 ≥ 150
- [ ] 每个 tier 至少 20 clip
- [ ] 最近一批的 pass 率稳定在 50-70%
- [ ] 前端抽查无技术问题
- [ ] PM 对各 tier 内容质量整体满意

满足全部条件，进入阶段 3。

---

## 阶段 3：完成后的决策

冷库补齐完成后，PM 决策：

1. **要不要重启定时任务？**
   - 启用：`flipod-podcast-weekly`（当前已停用）
   - 当前的定时 prompt 已经写好，直接 enable 就能跑

2. **要不要改为按 tier 分日运行？**
   - 当前是周一一次性跑全部 tier
   - 可改为 Business/Tech 周一、Science 周三、Culture 周五——分散 Azure API 成本峰值

3. **要不要加用户反馈闭环？**
   - 前端有 "喜欢"/"收藏" 数据
   - 可把高赞 clip 的特征反哺 prompt，做自适应

这些决策都放到补齐完成后讨论，现在不预设。

---

## 文档引用

- Tier Prompt：`prompts/PROMPTS-segment-selection.md`
- Claude Code 交接：`prompts/CLAUDE-CODE-HANDOFF.md`
- Processor 原规格：`docs/ops/AGENT-podcast-processor.md`
- Eval 原规格：`docs/ops/AGENT-eval.md`
