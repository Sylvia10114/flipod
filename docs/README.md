# Flipod

AI 驱动的英语听力推荐流产品。用户像刷短视频一样往下滑，每条内容是一个 60-120 秒的播客切片，带实时字幕、CEFR 词汇高亮、点词释义和中文翻译。系统在后台根据用户画像和行为数据动态排列内容顺序。

**不是**课程产品、播客播放器或词汇工具箱。是一个 AI-native 的听力 companion。

## 项目结构

```
flipod/
├── index.html            # 前端主文件（全部 UI + 逻辑，单文件）
├── data.json             # clip 元数据 + 字幕 + 词级时间戳
├── cefr_wordlist.json    # CEFR 词表缓存
│
├── clips/                # 音频切片 (clip1-23.mp3)
├── functions/api/        # Cloudflare Pages Functions
│   └── rank.js           # AI 排序 API
├── output/coldstore_*/   # 内容冷库（按 topic 分类）
│
├── docs/
│   ├── prd/              # 产品需求文档
│   ├── brief/            # 简报、架构、竞品调研
│   ├── ops/              # Agent 规格、执行指令
│   └── handoff/          # 研发交接文档
│
├── design/               # UI 设计稿 + Pencil 指令
│   └── exports/          # 设计稿导出图
│
└── scripts/              # 生产管线 & 工具脚本
    ├── podcast_agent.py  # 内容生产主管线
    ├── eval_agent.py     # 质量评估
    ├── test_rank_api.py  # AI 排序 API 测试
    └── ...
```

## 文档索引

| 文档 | 位置 | 内容 |
|------|------|------|
| 产品愿景 | docs/prd/ai-native-listening-feed-v0.1.md | AI Native 听力推荐流的完整定义 |
| 前端实现规格 | docs/prd/demo-to-product-v2.md | 所有 UI 交互细节 + 铁律清单 |
| CEO 方案 | docs/brief/ceo-productization-v1.md | CEO 视角的产品化路线 |
| 多 Agent 架构 | docs/brief/agent-architecture.md | Supervisor + Subagent 方案 |
| 内容管线规格 | docs/ops/agent-podcast-processor.md | podcast_agent.py 的技术规格 |
| AI 排序 API | docs/ops/task-ai-feed-ranking.md | /api/rank 的实现指令 |
| 研发交接 | docs/handoff/研发交接文档.docx | 完整功能清单 + 技术架构 |

## 技术栈

- 前端：Vanilla JS 单文件 HTML
- 部署：Cloudflare Pages
- API：Cloudflare Pages Functions + Azure OpenAI (GPT-5.4)
- 内容生产：Python + Whisper + GPT（本地运行）
- 用户状态：localStorage（所有 key 以 flipod 为前缀）
