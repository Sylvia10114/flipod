# Cowork 新窗口上下文移交 · 2026-04-14

## 复制下面这段作为新 Cowork 窗口的开场 prompt

---

我是 Flipod 项目的 AI PM（Jamesvd），工作方式：Vibe Coding + 多 Agent 协作，AI 尽可能多介入，我只做关键决策。

## 项目背景

Flipod 是英语听力播客 App，用户 CEFR B1-B2，在手机上刷短音频片段学英语。内容由两级 agent 生产：

- `scripts/podcast_agent.py` — 从 RSS 自动发现 → 下载 → Whisper 转录 → LLM 选片段 → ffmpeg 切音频 → 翻译 → CEFR 标注
- `scripts/eval_agent.py` — 对 processor 产出做质检，输出 pass / review / reject

目前冷库 37 个 clip，目标补齐到 150+。

## 最近进展

上一个 Cowork 窗口和 Claude Code 完成了大规模 agent 重构：

### Claude Code 完成的 8 个任务

1. podcast_agent.py 拆成 12 个模块，主文件 < 200 行
2. 6 个 tier prompt + episode 分类 + Mixed 跳过路径集成
3. 候选过滤 6 条规则实现（开头检查三档：硬拒绝 / 软标记 / 硬通过），46 个单元测试
4. 切片边界 snap 到 Whisper segment gap 中点（2s 窗口）
5. `--dry-run` 模式输出 `dry_run_candidates.json`
6. API keys 全部 env，`.env.example` 更新
7. 46/46 单元测试通过
8. `merge_clips.py` 支持 `--dry-run` + 自动备份 + 回滚

注意：CC 的重构前/后 data.json diff 验证没做（需要真 API 调用）。新 agent 文件为 `podcast_agent_v4.py`，老文件 `podcast_agent.py` 保留。

### ⚠️ CC 做完之后我发现的问题

**CC 跑的是旧版本规则**——在 CC 工作过程中，我和上一个 Cowork 基于 37 个 clip 的回溯打标，把规则从 v1 升级到 v2。CC 可能只 pick up 了部分 v2 变化。

**v2 关键变化**（CC 需要复核的）：

1. **开头规则**从"首词黑名单"改为三档（硬拒绝/软标记/硬通过）——CC 的 Task 3 checkbox 提到了三档，但具体正则需要对 
   - 硬拒绝：纯附和响应（`Exactly.` / `Yeah.` 单独成句）+ 前 15 词内的指代短语（`you just said` / `that's right` / `to your point` 等）+ 纯填充词开头（`You know,` / `I mean,`）
   - 软标记（不淘汰）：And/But/So/Well/Actually 起头 + 后接实质内容，加 `soft_open_connective` flag
   - 硬通过：问句 / 具体人物 / 场景设定起头

2. **时长限制按 tier 分化**（CC 可能没做）：
   - Science/Business：45-120s
   - Tech/Culture/Psychology：60-120s  
   - Story：60-150s（可能还要放到 55s 配合 StoryCorps）

3. **Storytelling tier 改名**为 `Story`（CC 在 @PM review 里标了需要统一）

## 关键文档位置

项目根目录：`/Users/.../listen demo/`

- `prompts/PROMPTS-segment-selection.md` — 6 个 tier 的 segment 选择 prompt（v2 已更新 SHARED_PREAMBLE 和 Tech tier 警示）
- `prompts/CLAUDE-CODE-HANDOFF.md` — 8 个工程任务的规格（Task 3 过滤规则 v2 已更新）
- `docs/ops/OPS-cold-store-backfill.md` — 冷库分批补齐 SOP（3 批 × 每批审核 → 合并）
- `output/retrospective_labels.md` — 现有 37 clip 用 v2 规则打标的分析（pass 25 / gray 3 / reject 9）
- `output/retrospective_labels_v2.json` — 上面分析的结构化数据
- `tools/dry_run_review.html` — Desktop 优化的 review 工具，键盘快捷键 1/2/3 标 好/灰/差，支持导出 annotations JSON

## 下一步（我要和你商量的）

按原计划补齐冷库的路线：

```
Claude Code 交付 ✅ (但需复核 v2 rules)
   ↓
Dry-run 校准（6 feed × 2 episode × 6 候选 ≈ 72 个）
   ↓ 用 tools/dry_run_review.html 审核
第一批 Business + Tech 补齐
   ↓
第二批 Science + Psychology
   ↓
第三批 Culture + Story
   ↓
冷库 150+ 后再评估要不要开定时任务
```

定时任务 `flipod-podcast-weekly` 已创建但**已 disabled**，等冷库补齐后再启用。

## 我的工作偏好

- 反馈必须有实质意义，不做虚荣指标
- 尊重产品心智（无限流里不要暴露"内容有限"）
- 先做 demo 再交接（AI 做出可运行的原型再给研发）
- 不要默认把事甩给研发，先尝试 AI 自主实现
- 不要用"客观最优解"覆盖我的审美判断——比如我上次就说过"开头是 But so 未必是问题，可能是 hook"

## 现在我想讨论的

CC 刚交付完，我们要决定下一步怎么走。主要几个方向：

1. 先让 CC 复核 v2 rules 的完整应用，还是直接进 dry-run？
2. Dry-run 的 6 个代表性 feed 怎么选？之前上一个 Cowork 建议的是：Planet Money、Hard Fork、Short Wave、Hidden Brain、Throughline、The Moth
3. Dry-run 之前要不要先解决 CC 的"重构前/后 diff 未验证"这个潜在风险？

请你帮我一起判断，不要都甩我做决策，但关键选择让我拍板。

---

## 复制上面那段即可，下面是我（上一个 Cowork）给你留的备注

### CC 工作质量评估

- CC 的执行力很强，8 个任务全部自行推进，46 个单元测试说明工程严谨
- 可能的问题点：
  - `podcast_agent_v4.py` 而不是原地覆盖——意味着可能有两套代码并存
  - v2 规则 pick up 可能不完整（CC 多轮工作中，文档是边做边更新的）
  - 重构前后 diff 验证跳过——没法保证纯重构无回归

### 需要重点确认的技术细节

1. `agent/filter.py` 里的 duration_check 是否按 tier 分化
2. `agent/segmentation.py` 的 Step 4 prompt 调用是否用了 tier-specific 分派
3. `prompts/loader.py` 是怎么从 markdown 解析 tier prompt 的——如果是简单的 split by H2，v2 的内容更新 CC 得重新加载
4. `agent/audio_cut.py` 的 snap 逻辑：2s 窗口够不够？对于说话密集的播客（Hard Fork），gap 可能都 < 1s

### 推荐的下一步

我的判断：**先花 30 分钟让 CC 做三件事**，再进 dry-run：

1. 让 CC 把 v2 的完整 opener rules 和 duration limits 比对一遍代码，confirm 都应用了
2. 让 CC 补一个"结构测试"——跑一次 `--dry-run` 在 mock 数据上，验证输出 schema 符合规格（不用真调 API）
3. 让 CC 把 `podcast_agent.py` 和 `podcast_agent_v4.py` 的关系说清楚——要么收敛成一个，要么文档说明各自的用途

做完这三件事再进 dry-run，质量更有保障。
