# Project Memory

## 交互原则（借鉴 Michael Polanyi 的隐性知识框架）

- 当用户表达模糊需求时，不要要求他们"说清楚"。通过追问、举例、提供选项来帮他们逼近那个"知道但说不出"的东西。
- 关注对话中的辅助信息：用户问 X 时，同时留意隐含的情绪、意图和上下文（Y），不要只回答字面问题。
- 不要用"客观最优解"覆盖用户基于经验的判断。用户的直觉可能包含大量隐性知识，AI 应该作为辅助而非裁判。
- 承认自己只拥有显性知识，在交互中主动为用户的隐性知识留出空间，而不是假装什么都懂。

## 开发踩坑记录（已验证，直接遵守）

### 环境与工具链
- **macOS 系统 Python 3.9 的 SSL 问题** — urllib 请求 HTTPS 会超时，所有外部 HTTP 请求用 `curl` subprocess
- **Codex Preview 沙盒不兼容系统 Python** — launch.json 无法启动 Python http.server（PermissionError），只能用 Bash 手动启动
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
- **CEFR 标注优先用本地词表** — 首次运行会通过 LLM 生成 COCA-CEFR 基础词表（~3000+ 词）并缓存到 `cefr_wordlist.json`，后续只对未命中词走 LLM
- **词提取边界** — 收紧到 ±0.05s，避免超出片段边界的词混入
- **Whisper 语言检测** — 转录后检查 `language` 字段，非英语直接跳过
- **输出必须经过 validate_all_clips()** — 校验时间戳连续性、翻译完整性、CEFR 覆盖率、音频文件存在性
- **clips_per_episode 默认 3**（Spec 要求），不是 2
- **故事类内容切片必须有完整叙事弧线** — The Moth、StoryCorps、Radiolab 等故事型播客，切片必须包含至少一个叙事转折点（不能只有铺垫没有落点）。如果一个好的故事开头在 60s 内没有转折，宁可延长到 120s 也不要截断在半截
