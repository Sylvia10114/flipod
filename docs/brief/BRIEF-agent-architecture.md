# Agent 架构讨论总结

## 背景
当前 podcast_agent.py 是单进程串行流水线（搜索→下载→转录→切片→翻译→CEFR→输出），手动触发，无质检，无自动发布。

## 多 Agent 架构方案

```
Supervisor Agent（调度员，用 Opus）
  │
  ├── Discovery Agent（找内容，用 Haiku）
  │     iTunes/Podcast Index 搜索，语言过滤，feed 去重
  │     输出：候选 episode 列表
  │
  ├── Processing Agent（处理内容，用 Sonnet）× 可并行多个
  │     下载音频 → Whisper 转录 → 切片 → 翻译 → CEFR
  │     输出：完整 clip 数据包
  │
  ├── QA Agent（质检，用 Sonnet）
  │     检查：时间戳连续性、翻译完整性、叙事弧线、音频可播放
  │     不合格 → 打回 Processing Agent
  │     输出：通过/不通过 + 原因
  │
  └── Publishing Agent（发布，用 Haiku）
        合并 data.json，上传 COS，更新 CDN
```

## 关键好处
- Discovery 和 Processing 并行——找下一批同时处理当前批
- 失败隔离——翻译挂了不影响转录，单步重跑
- 不同 agent 用不同模型——Opus 做规划、Sonnet 做核心处理、Haiku 做简单任务，成本降 90%
- 用户行为触发——收藏播客 → Supervisor 自动派 Discovery Agent 找更多

## 实现技术：Claude Agent SDK
- Anthropic 官方 SDK，Claude Code 背后的引擎
- 核心循环：收集上下文 → 决定行动 → 执行 → 观察 → 再决定
- 支持 Subagent：spawn 子 agent，独立上下文，只传结论
- Python 和 TypeScript 两个包
- 文档：https://platform.claude.com/docs/en/agent-sdk/overview

## 四种主流 Agent 模式
1. **Supervisor**：主管拆任务，分派专家 agent（我们的方案）
2. **Handoff（接力）**：A 做完交给 B，线性流水线（当前 podcast_agent 的模式）
3. **角色协作**：多 agent 扮演不同角色协作（适合内容审核）
4. **群聊**：agent 互相辩论达成共识（成本最高，需要 human-in-the-loop 时用）

## 下一步
- 产品层面：定义每个 agent 的职责边界和输入输出
- 技术层面：用 Claude Agent SDK 把 podcast_agent.py 重构为 Supervisor + Subagent 架构
- 运营层面：接入定时调度（cron），实现无人值守内容供给
