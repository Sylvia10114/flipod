# Project Memory

## 交互原则（借鉴 Michael Polanyi 的隐性知识框架）

- 当用户表达模糊需求时，不要要求他们"说清楚"。通过追问、举例、提供选项来帮他们逼近那个"知道但说不出"的东西。
- 关注对话中的辅助信息：用户问 X 时，同时留意隐含的情绪、意图和上下文（Y），不要只回答字面问题。
- 不要用"客观最优解"覆盖用户基于经验的判断。用户的直觉可能包含大量隐性知识，AI 应该作为辅助而非裁判。
- 承认自己只拥有显性知识，在交互中主动为用户的隐性知识留出空间，而不是假装什么都懂。

## 开发踩坑记录（已验证，直接遵守）

### 环境与工具链
- **macOS 系统 Python 3.9 的 SSL 问题** — urllib 请求 HTTPS 会超时，所有外部 HTTP 请求用 `curl` subprocess
- **Claude Preview 沙盒不兼容系统 Python** — launch.json 无法启动 Python http.server（PermissionError），只能用 Bash 手动启动
- **cloudflared 路径** — 在 `/opt/homebrew/bin/cloudflared`，不在 PATH 里；QUIC 协议可能被防火墙挡，必须加 `--protocol http2`
- **ffmpeg 路径** — `/opt/homebrew/bin/ffmpeg`

### Whisper API
- **词级时间戳必须双传** — 同时传 `timestamp_granularities[]=word` 和 `timestamp_granularities[]=segment`，否则只有 segment 文字没有词级时间戳
- **Transcript-first 流程** — 不要先盲切音频再转录（静音/音乐区会让 Whisper 返回垃圾），正确做法：先全文 Whisper → 从词级时间戳选最佳区间 → 按词边界裁切

### Azure GPT API
- **GPT-5.4 用 `max_completion_tokens`** — 不是 `max_tokens`，否则 400 报错

### 前端 index.html
- **data.json 是核心数据** — agent 脚本输出不要直接写 data.json，写到 `new_clips.json` 再手动合并
- **音频懒加载** — 只预加载前 2 个 clip，其余在 playClip 时设 `preload='auto'` 并预加载下一个
- **进度条 duration** — 优先用 `audio.duration`，fallback 到最后一行的 `end` 时间
- **菜单关闭逻辑** — document click listener 要排除 `.menu-panel` 和 `.menu-btn` 内部的点击
- **autoplay catch** — play() 失败时必须回退 isPlaying 状态并更新图标，不能静默吞错误
- **播放速度** — 持久化到 localStorage (`flipodSpeed`)，页面加载时恢复

### podcast_agent.py
- **所有 API 调用必须用 curl subprocess** — Whisper 和 GPT 的 HTTP 请求都不能用 urllib（Python 3.9 SSL 问题），必须走 curl
- **Step 0 语言过滤** — iTunes 搜索结果用 `languageCodesISO2A` 字段过滤非英语播客；Whisper 转录后再用 `language` 字段二次验证
- **输出路径格式** — 音频输出到 `output/clips/clip_001.mp3`（三位编号），日志到 `output/logs/`，data 到 `output/new_clips.json`
- **句子分割** — Whisper word 级输出**没有标点**，segment 级输出**有标点**。正确做法：用 segment 文本按标点分句，再把 word 时间戳按顺序映射到每个句子。不要在 word 上找标点（找不到）
- **翻译行数必须校验** — 用 JSON 格式（`[{"idx":0,"zh":"..."}]`）而非纯文本按行对齐，每 10 句一批，失败退回逐句翻译
- **CEFR 词表用 CEFR-J + Octanove C1/C2**（2026-04-15 从假 COCA-CEFR 迁移）— 源：`openlanguageprofiles/olp-en-cefrj`（A1-B2 主表 `cefrj-vocabulary-profile-1.5.csv` + C1-C2 扩展 `octanove-vocabulary-profile-c1c2-1.0.csv`），共 ~8650 词。**许可证 CC BY-SA 4.0**，前端必须在侧面板底部显示归属行（已在 `index.html` `.sp-attribution` 里）。迁移脚本 `tools/migrate_cefr_to_cefrj.py`，未命中词走 LLM fallback。**旧的 LLM 生成 COCA-CEFR 已弃用**——频率 ≠ 难度，会把 `add`/`agree`/`afternoon` 这种 A1 词标成 B2，严重高估难度
- **Prompt 末尾完整性约束不能靠 LLM 自查**（Patch D 失败教训，2026-04-15）— v2.2 让 LLM 在 prompt 层硬约束末尾不能是逗号/连词/悬挂短语并自评 `completeness`，实测 9 条 `end_no_punct` 零改善且 LLM 全部自评 `completeness=high`（实际 8/9 真半截）。**LLM 按内容语义选段，对 word-level 边界盲视**。正确做法：在 `filter.py` 加 code-level 末尾 snap（往前回扫 Whisper segment 级标点位置，调整 end_word_index 到最近句号/问号/感叹号/引号）
- **词提取边界** — 收紧到 ±0.05s，避免超出片段边界的词混入
- **Whisper 语言检测** — 转录后检查 `language` 字段，非英语直接跳过
- **输出必须经过 validate_all_clips()** — 校验时间戳连续性、翻译完整性、CEFR 覆盖率、音频文件存在性
- **clips_per_episode 默认 3**（Spec 要求），不是 2
- **故事类内容切片必须有完整叙事弧线** — The Moth、StoryCorps、Radiolab 等故事型播客，切片必须包含至少一个叙事转折点（不能只有铺垫没有落点）。如果一个好的故事开头在 60s 内没有转折，宁可延长到 120s 也不要截断在半截

## 用户工作偏好（Jamesvd 的协作风格）

### 角色定位
- 用户是 AI 产品经理，工作方式是 Vibe Coding（AI 辅助全流程开发）
- 理想模式是**自闭环**：用户 + AI agents 完成尽可能多的事，只把"产品外"的工程任务交给真人研发
- AI 的角色不只是执行者，要主动探索用户能力和 AI 能力的边界

### 工作方式
- **多 Agent 协作**：需要时主动组建 agent team 并行推进（产品 agent、研发 agent、设计 agent 等），不要串行等待
- **先做 demo 再交接**：任何功能先用 AI 做出可运行的 demo/原型，而非直接写 PRD 交给研发。研发接手的应该是"已验证的方案"而非"纸上计划"
- **不要默认甩给研发**：除非涉及基础设施、部署、安全等产品外工程，否则先尝试 AI 自主实现
- **反馈必须有实质意义**：不做虚荣指标（"听了30分钟"），反馈系统要提供具体的、可行动的信息
- **尊重产品心智**：不要引入破坏产品核心体验的元素（比如在无限流中暴露"内容有限"的事实，或者用"第n/22"暗示有限列表）
