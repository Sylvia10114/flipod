# Podcast Clip Processor Agent 技术规格

**作者**：Sylvia
**日期**：2026-04-07
**执行者**：Claude Code
**目的**：定义一个自动化 agent，从关键词发现播客 → 抓取 → 转录 → 筛选片段 → 输出可直接灌入英语听力推荐流产品的片段包。全流程自动化。

---

## 1. Agent 概述

这个 agent 是英语听力推荐流产品的**内容供给管线**。完整覆盖从"找到播客"到"输出可用片段"的全流程：

1. **发现**：根据关键词/主题自动搜索并发现高质量英语播客
2. **抓取**：解析 RSS feed，下载音频
3. **处理**：转录、识别高质量片段、切割、翻译、打标签
4. **输出**：生成产品前端可直接使用的 data.json + mp3 文件

全自动运行，不需要人工审核环节。Agent 自己判断片段质量。

---

## 2. 输入 / 输出

### 输入

两种输入模式，任选其一或组合使用：

**模式 A：关键词发现（自动找播客）**
```
搜索关键词或主题描述，如 "science", "business storytelling", "psychology daily life"
```

**模式 B：直接指定 RSS URL（跳过发现步骤）**
```
一个或多个播客 RSS feed URL
```

可选参数：

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `keywords` | string[] | 与 feed_urls 二选一 | 搜索关键词，用于自动发现播客 |
| `feeds_per_keyword` | int | 5 | 每个关键词最多发现多少个播客 |
| `feed_urls` | string[] | 与 keywords 二选一 | 直接指定的 RSS feed URL 列表 |
| `episodes_per_feed` | int | 5 | 每个 feed 处理最近多少集 |
| `clips_per_episode` | int | 3 | 每集最多提取多少个片段 |
| `clip_duration_min` | int | 60 | 片段最短秒数 |
| `clip_duration_max` | int | 120 | 片段最长秒数 |
| `output_dir` | string | `./output` | 输出目录 |
| `tags` | string[] | 自动推断 | 可手动指定领域标签，不指定则由 LLM 自动推断 |

### 输出

```
output/
  data.json              ← 所有片段的元数据 + 字幕（含词级时间戳）
  clips/
    clip_001.mp3         ← 切割好的音频片段
    clip_002.mp3
    ...
  logs/
    processing_log.json  ← 处理日志（每集的处理结果、跳过原因等）
```

data.json 格式与产品前端一致（见 PRD v0.4 第 7.3 节）：

```json
{
  "clips": [
    {
      "id": 1,
      "title": "中文钩子标题",
      "tag": "Science",
      "audio": "clips/clip_001.mp3",
      "duration": 75.0,
      "source": {
        "podcast": "播客名称",
        "episode": "剧集标题",
        "episode_url": "原始链接",
        "timestamp_start": "00:12:30",
        "timestamp_end": "00:13:45"
      },
      "lines": [
        {
          "start": 0.0,
          "end": 3.2,
          "en": "English sentence.",
          "zh": "中文翻译。",
          "words": [
            { "word": "English", "start": 0.0, "end": 0.5 },
            { "word": "sentence.", "start": 0.5, "end": 1.0 }
          ]
        }
      ]
    }
  ]
}
```

---

## 3. 处理流程

Agent 按以下步骤顺序执行。每一步都应该有错误处理和日志记录。

### Step 0：播客发现（当输入为关键词时）

如果用户提供的是关键词而非 RSS URL，agent 先自动发现相关播客。

**搜索源**（按优先级）：

1. **iTunes Search API**（免费，无需 API key）
   - `https://itunes.apple.com/search?term={keyword}&media=podcast&limit=20`
   - 返回结果中包含 `feedUrl` 字段，即 RSS 地址
   - 覆盖面最广，Apple Podcasts 是全球最大的播客目录

2. **Podcast Index API**（免费，需注册 API key）
   - `https://api.podcastindex.org/api/1.0/search/byterm?q={keyword}`
   - 开源播客目录，覆盖面也很好
   - 作为 iTunes 的补充和备选

**筛选逻辑**：

搜索返回的播客不一定都适合我们的产品。Agent 需要过滤：
- 只保留英语播客（根据 `language` 字段或播客描述判断）
- 优先选择有较多评分/评论的播客（质量信号）
- 跳过纯音乐、纯新闻播报（太短或太机械）、儿童节目
- 跳过已停更超过 6 个月的播客

**输出**：一组 RSS feed URL，传入 Step 1。同时在 processing_log.json 中记录发现了哪些播客、保留了哪些、跳过了哪些及原因。

### Step 1：解析 RSS Feed

- 解析 RSS XML，提取最近 N 集的音频 URL、标题、描述、发布日期
- 只处理英语播客，跳过非英语内容
- 记录每集的元数据备用

**工具**：`feedparser`（Python）或类似 RSS 解析库

### Step 2：下载音频

- 下载每集的完整音频文件（通常是 mp3）
- 如果文件过大（>100MB），跳过并记录原因
- 存储到临时目录

**注意**：播客音频通常托管在公开 CDN 上，RSS 中的 `<enclosure>` 标签直接提供下载 URL，不涉及版权绕过。播客 RSS 本身就是公开分发渠道。

### Step 3：语音转录（ASR）

- 使用 Whisper（推荐 `whisper-large-v3` 或 `faster-whisper`）转录完整音频
- 输出**词级时间戳**（Whisper 支持 `word_timestamps=True`）
- 输出格式：每个词的 text、start、end

**关键要求**：
- 必须是词级时间戳，不是句级。产品需要逐词高亮
- 如果 Whisper 词级时间戳不稳定，可以用句级时间戳 + 按词数均匀切分作为降级方案

### Step 4：片段识别（核心 LLM 步骤）

这是整个 agent 最关键的一步。将完整转录文本发给 LLM，让它识别其中适合作为独立片段的段落。

**发给 LLM 的 prompt 应该包含以下要求**：

（1）**完整叙述**：每个片段必须是一个自成一体的故事、观点、论述或信息块。有明确的开头和结尾，不能是半截话。

（2）**时长控制**：每个片段对应的音频时长应在 60-120 秒之间。LLM 需要根据转录文本估算时长（参考词数，英语平均语速约 150 词/分钟）。

（3）**开头要有钩子**：片段的第一句话要能引起好奇心或制造信息缺口。如果一个有趣的段落开头很平淡，LLM 可以建议从稍后的位置开始切入。

（4）**信息密度**：优先选择信息密度高的段落。纯寒暄、重复性内容、广告段落应跳过。

（5）**情绪多样性**：如果一集中有多个候选片段，尽量选择情绪/类型不同的（一个有趣的、一个有信息量的、一个有故事性的）。

（6）**排除内容**：跳过广告、赞助商口播、节目开头/结尾套话、纯技术术语堆砌、涉及敏感话题的段落。

（7）**故事类内容的特殊要求**：对于 The Moth、StoryCorps、Radiolab、This American Life 等故事型播客，片段必须包含至少一个叙事转折点（情绪变化、意外事件、认知反转）。不能只有铺垫没有落点。如果一个好的故事开头在 60s 内没有出现转折，应延长切片到 90-120s 以覆盖完整叙事弧线。宁可超出时长上限 10-15s，也不要把故事截断在高潮前。

**LLM 输出格式**：

```json
{
  "segments": [
    {
      "start_word_index": 450,
      "end_word_index": 620,
      "start_time": 180.5,
      "end_time": 248.2,
      "reason": "完整的关于睡眠科学的反直觉论述，开头就抛出了一个违反常识的结论",
      "suggested_title": "你以为早睡早起更健康？",
      "suggested_tag": "Science",
      "hook_strength": "high",
      "completeness": "high"
    }
  ]
}
```

### Step 5：音频切割

- 根据 Step 4 识别的时间戳，从完整音频中切割出片段
- 切割时在首尾各加 0.3 秒的淡入淡出，避免突然开始/结束的听感
- 输出为 mp3，比特率 128kbps（平衡体积和音质）

**工具**：`pydub` 或 `ffmpeg`（如果环境中可用）

### Step 6：生成词级时间戳 + CEFR 标注

- 从 Step 3 的 Whisper 输出中，根据切割后的片段时间范围，提取对应的词级时间戳
- 时间戳归零（片段内的第一个词 start = 0.0）
- 按标点符号将词合并为句，生成句级的 `lines` 数组，每个 line 内包含 `words` 数组
- **对每个词查询 CEFR 等级并标注**

**CEFR 标注方案**：

数据源（按优先级）：
1. **English Vocabulary Profile (EVP)**：剑桥大学维护的 CEFR 词汇分级数据库，最权威。有 API 可查询（需注册）。
2. **COCA 词频表 + CEFR 映射**：COCA 前 500 词 ≈ A1，500-1500 ≈ A2，1500-3000 ≈ B1，3000-5000 ≈ B2，5000-10000 ≈ C1，10000+ ≈ C2。这是近似映射，但实用性高且免费。
3. **LLM 兜底**：对于查不到的词（专有名词、新词等），用 LLM 估算 CEFR 等级。

实现建议：本地维护一个 CEFR 词表文件（CSV 或 JSON），启动时加载到内存。逐词查表，查不到的走 LLM 兜底。不需要实时调 API。

**输出格式**：每个 word 对象增加 `cefr` 字段：

```json
{ "word": "ubiquitous", "start": 5.2, "end": 5.8, "cefr": "C1" }
```

CEFR 等级取值：`A1`, `A2`, `B1`, `B2`, `C1`, `C2`

### Step 7：中文翻译

- 将每个片段的英文逐句发给 LLM 翻译
- 翻译要求：口语化、简洁、不要翻译腔
- 每个 line 生成对应的 `zh` 字段

### Step 8：生成钩子标题和标签

- LLM 为每个片段生成中文钩子标题（简短、有悬念感、让人想点进去听）
- LLM 为每个片段打英文领域标签（从预定义列表中选择，或自动生成）

预定义标签参考：`Science`, `Culture`, `Business`, `Tech`, `Psychology`, `History`, `Health`, `Society`, `Storytelling`, `Language`

### Step 9：组装输出

- 将所有片段组装成 data.json
- 校验：每个片段都有完整的 lines、words（含 cefr 字段）、zh、title、tag、source
- 校验：音频文件存在且可播放
- 输出 processing_log.json 记录处理结果

---

## 4. 技术栈建议

| 组件 | 推荐方案 | 备选 |
|---|---|---|
| 播客发现 | iTunes Search API（免费） | Podcast Index API（需 key） |
| RSS 解析 | `feedparser` (Python) | 手动解析 XML |
| 音频下载 | `requests` + 流式下载 | `wget` |
| 语音转录 | `faster-whisper`（本地）或 Whisper API | `whisper.cpp` |
| LLM（片段识别/翻译/标题） | Claude API（Sonnet） | OpenAI GPT-4o |
| 音频切割 | `pydub` | `ffmpeg` CLI |
| 音频格式处理 | `pydub` | `soundfile` |
| CEFR 词汇标注 | COCA 词频表 + CEFR 映射（本地 CSV） | English Vocabulary Profile API / LLM 兜底 |

Python 3.10+ 单脚本即可，不需要复杂框架。

---

## 5. 错误处理和边界情况

| 场景 | 处理方式 |
|---|---|
| iTunes API 搜索无结果 | 尝试 Podcast Index API，仍无则返回空并记录 |
| 搜索返回非英语播客 | 根据 language 字段过滤，跳过 |
| RSS 解析失败 | 记录错误，跳过该 feed |
| 音频下载超时或失败 | 重试 2 次，仍失败则跳过 |
| 音频文件>100MB | 跳过，记录 |
| Whisper 转录质量差（大量 [inaudible]） | 跳过该集 |
| LLM 没有识别出合格片段 | 记录"该集无合格片段"，跳过 |
| 切割后音频时长<60s 或>120s | 丢弃该片段 |
| 翻译质量无法自动判断 | 先不做质量校验，后续可加 LLM 自评环节 |
| 非英语内容混入 | Whisper 可检测语言，非英语段落跳过 |
| CEFR 词表查不到某个词 | 用 LLM 估算 CEFR 等级，标注 `cefr_source: "estimated"` |
| 专有名词（人名、地名等） | 不标注 CEFR，`cefr` 字段设为 `null` |

---

## 6. 性能预估

处理一集 30 分钟的播客，大致耗时：

| 步骤 | 预估耗时 |
|---|---|
| 下载 | 10-30s |
| Whisper 转录（本地 GPU） | 2-5 min |
| Whisper 转录（API） | 30-60s |
| LLM 片段识别 | 10-20s |
| 音频切割 | 5-10s |
| LLM 翻译 + 标题 | 20-40s |
| 总计（本地 Whisper） | 约 5-8 min/集 |
| 总计（Whisper API） | 约 2-3 min/集 |

处理 5 个 feed × 5 集 = 25 集 → 约 1-3 小时，输出约 75 个片段。

---

## 7. 未来扩展（当前不做）

- **质量评分**：用 LLM 对输出片段做二次评分，0-10 分，只保留 7 分以上的
- **去重**：同一个播客不同集可能讲类似内容，需要语义去重
- **用户反馈闭环**：根据产品端的点赞/收藏数据，反向调整片段筛选策略
- **智能播客推荐**：基于已产出高质量片段的播客特征，自动推荐相似播客
- **多语言支持**：处理中英混合播客，只提取英语段落
- **片段整体难度分级**：基于已有的词级 CEFR 标注，计算片段整体难度（如 B2+ 词汇占比、语速、句子平均长度），用于推荐算法按用户 CEFR 水平筛选内容

---

## 8. 运行方式

```bash
# 模式 A：用关键词自动发现播客
python podcast_agent.py --keywords "science,psychology,business storytelling"

# 模式 B：直接指定 RSS feed
python podcast_agent.py --feeds "https://feed1.xml,https://feed2.xml"

# 混合使用
python podcast_agent.py \
  --keywords "science" \
  --feeds "https://my-favorite-podcast.xml" \
  --feeds-per-keyword 5 \
  --episodes-per-feed 5 \
  --clips-per-episode 3 \
  --clip-duration-min 60 \
  --clip-duration-max 120 \
  --output-dir ./output \
  --whisper-model large-v3 \
  --llm-provider claude
```

输出完成后，将 `output/data.json` 和 `output/clips/` 复制到产品前端目录即可使用。
