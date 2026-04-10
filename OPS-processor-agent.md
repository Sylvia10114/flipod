# Processor Agent 操作手册

**作者**：Sylvia + Claude
**日期**：2026-04-08
**前置文档**：AGENT-podcast-processor.md（技术规格）、PRD-content-personalization-v0.6.md（需求）
**状态**：待 Sylvia 审查

---

## 1. 当前状态

Agent 脚本：`podcast_agent.py`
最近一次成功运行：2026-04-08，5/5 clip 全部通过校验，耗时 9 分 34 秒。
现有冷库：15 个 clip（分布不均，详见 PRD v0.6 第 2.3 节）。

已知瓶颈：
- 翻译是最慢步骤，20+ 句批量翻译的行数对齐率约 40%，频繁触发逐句 fallback
- iTunes 搜索存在重复 feed，导致同集重复处理
- 无错误日志持久化（full_run.log 是文本日志，缺乏结构化失败分析）

---

## 2. 过渡期任务清单（本周完成）

目标：把冷库从 15 个 clip 扩充到 40 个（8 兴趣 × 5 clip），同时修复已知问题。

### 2.1 任务优先级

| 序号 | 任务 | 优先级 | 说明 |
|---|---|---|---|
| 1 | 加 feed URL 去重 | P0 | 搜索结果按 `feedUrl` 去重，避免同集重复处理 |
| 2 | 翻译改 JSON 格式 + 分批 | P0 | 输出改为 `[{"idx":0,"zh":"..."}]`，每 10 句一批 |
| 3 | 补 culture 冷库（5 clip） | P0 | 搜 "culture" 相关词，按 iTunes 评分/评论数取 top 播客 |
| 4 | 补 society 冷库（5 clip） | P0 | 搜 "society" 相关词，按 iTunes 评分/评论数取 top 播客 |
| 5 | 补 history 冷库（4 clip） | P0 | 同上策略 |
| 6 | 补 science 冷库（3 clip） | P1 | 同上策略 |
| 7 | 补 psychology 冷库（3 clip） | P1 | 同上策略 |
| 8 | 补 tech 冷库（3 clip） | P1 | 同上策略 |
| 9 | 补 story 冷库（2-4 clip） | P1 | 同上策略 |
| 10 | 加结构化错误日志 | P2 | 每次 API 调用记录 status/error/耗时 |

### 2.2 批量运行命令参考

每个兴趣分开跑，避免单次任务过大：

```bash
# 所有兴趣方向统一策略：按 iTunes 热度搜索，agent 自动取评分/评论数最高的播客

# culture（从零开始，需要 5 个 clip）
python podcast_agent.py \
  --keywords "culture" \
  --clips-per-episode 3 \
  --output-dir ./output/coldstore_culture \
  --tags culture

# society（从零开始，需要 5 个 clip）
python podcast_agent.py \
  --keywords "society" \
  --clips-per-episode 3 \
  --output-dir ./output/coldstore_society \
  --tags society

# history、science、psychology、tech、story 同理，keyword 就用标签名本身
```

关键词策略：不需要人为拟定具体关键词。直接用兴趣标签名搜 iTunes，按评分/评论数排序取 top 结果。热门播客自然覆盖该领域最受欢迎的子话题，不需要预判。

### 2.3 产出合并流程

每批跑完后，手动合并到主数据：

1. 检查 `output/coldstore_xxx/new_clips.json` 的校验结果
2. 人工浏览抽查 1-2 个 clip 的翻译质量
3. 复制音频文件到项目根目录，重命名为 `clip{N}.mp3`（N 从 16 开始递增）
4. 将 clip 数据合并到 `data.json`，tag 值使用标准化小写
5. **不要直接让 agent 写 data.json**（见踩坑记录）

### 2.4 tag 统一映射

合并时如遇到非标准 tag，按以下映射转换：

| agent 输出 | 标准 tag |
|---|---|
| Business | business |
| Science | science |
| Storytelling | story |
| Tech / Technology | tech |
| Psychology | psychology |
| History | history |
| Culture / Pop Culture | culture |
| Society / Social | society |

---

## 3. 持续运转机制（冷库建好后）

### 3.1 定时生产

建议节奏：每天跑一次，每次生产 15-20 个新 clip（覆盖 3-4 个兴趣方向）。

调度方式选一：
- **简单版**：macOS 的 `cron` 或 `launchd` 定时任务
- **手动版**：每天上班前手动触发一次（过渡期推荐）
- **Claude Code 定时任务**：如果后续集成到 Claude 工作流中

每次运行的关键词轮转策略：
```
周一：science + psychology
周二：business + tech
周三：story + history
周四：culture + society
周五：根据库存最少的 2 个兴趣补充
```

### 3.2 用户兴趣触发生产（未来）

PRD v0.6 提到的"识别用户兴趣后 processor 开始处理"，实现分两阶段：

**阶段 1（短期，用冷库兜底）**：
- 冷库每个兴趣 5 个 clip，用户选什么都有内容
- 后台定时生产持续补充，不与用户行为联动

**阶段 2（中期，兴趣驱动生产）**：
- 记录用户兴趣选择的分布（哪些兴趣被选得多）
- 生产侧根据分布调整权重：被选多的兴趣多生产
- 触发时机：用户完成 onboarding → 写入一条生产请求 → agent 下次运行时优先处理

阶段 2 需要一个简单的请求队列（可以是一个 JSON 文件），不需要复杂的消息队列。

### 3.3 Eval Agent（内容质量关卡）

在 processor agent 和 data.json 之间加一个 eval agent，负责质量审核。

Eval agent 检查项：

| 检查维度 | 具体规则 | 不通过的处理 |
|---|---|---|
| 语义完整性 | clip 是否有完整的开头和结尾，不是话说到一半截断 | 标记 reject，记录原因 |
| 翻译准确性 | 中文翻译是否与英文语义一致，有无明显错译 | 标记 review，人工抽查 |
| CEFR 合理性 | 标注的 CEFR 等级是否与词汇实际难度匹配 | 重新标注 |
| 音频质量 | 音频是否有噪音、截断、静音段 | 标记 reject |
| tag 匹配 | clip 内容是否真的属于标注的兴趣分类 | 修正 tag |
| 钩子标题质量 | 中文标题是否有吸引力、是否与内容匹配 | 重新生成 |

Eval agent 输出三种状态：
- `pass`：直接进入合并候选
- `review`：需要人工确认（翻译存疑等）
- `reject`：丢弃，记录原因

实现建议：eval agent 就是一个 Python 脚本，读取 `new_clips.json`，逐条跑 LLM 评估，输出 `eval_results.json`。每个 clip 的评估成本约 1 次 GPT 调用。

### 3.4 日志与可观测性

每次 agent 运行后应能回答以下问题：

1. 跑了多久？成功了几个 clip？失败了几个？
2. 失败的原因是什么？卡在哪一步？
3. 哪些 feed 经常出问题？
4. 翻译的批量成功率是多少？
5. 当前各兴趣的库存量？

建议的日志结构（`processing_log.json`）：

```json
{
  "run_id": "2026-04-08_001",
  "start_time": "2026-04-08T09:00:00",
  "end_time": "2026-04-08T09:10:00",
  "duration_seconds": 600,
  "target_interest": "culture",
  "keywords": ["pop culture podcast", "culture commentary"],
  "feeds_discovered": 6,
  "feeds_processed": 3,
  "episodes_processed": 5,
  "clips_produced": 5,
  "clips_passed_eval": 4,
  "clips_rejected": 1,
  "errors": [
    {
      "step": "step7_translation",
      "clip_id": "clip_003",
      "error_type": "line_count_mismatch",
      "detail": "Expected 22 lines, got 20. Fell back to per-sentence.",
      "resolved": true
    }
  ],
  "feed_health": {
    "https://feed1.xml": {"status": "ok", "clips_produced": 3},
    "https://feed2.xml": {"status": "ok", "clips_produced": 2},
    "https://feed3.xml": {"status": "failed", "reason": "audio_download_timeout"}
  },
  "inventory_after": {
    "science": 5, "business": 5, "psychology": 5, "story": 5,
    "history": 5, "culture": 4, "tech": 5, "society": 5
  }
}
```

### 3.5 库存监控

维护一个简单的库存文件 `inventory.json`：

```json
{
  "last_updated": "2026-04-08",
  "total_clips": 40,
  "by_interest": {
    "science": {"count": 5, "status": "ok"},
    "business": {"count": 5, "status": "ok"},
    "psychology": {"count": 5, "status": "ok"},
    "story": {"count": 5, "status": "ok"},
    "history": {"count": 5, "status": "ok"},
    "culture": {"count": 5, "status": "ok"},
    "tech": {"count": 5, "status": "ok"},
    "society": {"count": 5, "status": "ok"}
  },
  "low_stock_threshold": 3,
  "alerts": []
}
```

每次 agent 运行后更新。如果某个兴趣的库存低于阈值，自动加入下次运行的优先队列。

---

## 4. 风险与注意事项

| 风险 | 影响 | 缓解方案 |
|---|---|---|
| 某些兴趣方向播客资源少 | culture/society 可能难以找到足够高质量英语播客 | 放宽搜索关键词范围，允许 partial_success |
| 翻译质量不稳定 | 40% 批量成功率意味着大量 fallback | 优先实施 JSON 格式 + 分批翻译优化 |
| agent 运行中断 | 已产出的 clip 不丢失，但浪费时间 | 加断点续传：记录已处理的 episode，重跑时跳过 |
| macOS Python 3.9 SSL | 已知问题，所有 HTTP 必须走 curl | 已在 CLAUDE.md 中记录，不要忘记 |
| 播客内容版权 | RSS 公开分发，但裁切后再分发存在灰色地带 | Demo 阶段可接受，正式产品需要法务确认 |

---

## 5. 操作 checklist（每次运行）

运行前：
- [ ] 确认目标兴趣和关键词
- [ ] 确认 output 目录不与已有数据冲突
- [ ] 确认 API key 可用（Whisper、GPT）

运行后：
- [ ] 检查 `full_run.log` 有无异常
- [ ] 检查 `new_clips.json` 的 clip 数量和校验结果
- [ ] 抽查 1-2 个 clip 的翻译质量
- [ ] 合并到 data.json（tag 标准化）
- [ ] 更新 inventory.json
- [ ] 如果有 eval agent：运行 eval，只合并 pass 的 clip
