# Flipod 端到端链路研发交接文档

**日期**：2026-04-15
**作者**：PM（Jamesvd）
**收件人**：研发
**目的**：把"用户信息抓取 → 内容推送"整条链路上所有 agent、代码、提示词整理成一份交接文档，用于后续性能、稳定性、成本和效果优化。所有路径都是仓库相对路径（根目录：`listen demo/`）。

---

## 0. 链路总览

```
  ┌───────────────────────────────────────────────────────────────────┐
  │                         前端（index.html）                         │
  │                                                                   │
  │  Onboarding: CEFR level + Interests  ──► localStorage             │
  │  行为埋点: listened / skipped / vocab_clicked / session_duration  │
  │                 │                                                  │
  │                 ▼                                                  │
  │  callRankApi()  ──►  POST /api/rank                               │
  └─────────────────┬─────────────────────────────────────────────────┘
                    │
                    ▼
  ┌─────────────────────────────────────────────────┐
  │   Cloudflare Pages Function: functions/api/rank.js │
  │   (Azure GPT-5.4, CLIP_META 硬编码)                 │
  │   输出: [{id, reason}] 排序后的 feed                 │
  └─────────────────────────────────────────────────┘

  ──────────────────── 离线 / 定时 ───────────────────────

  ┌─────────────────────────────────────────────────────────────────┐
  │                      内容供给管线（scripts/agent/）                │
  │                                                                 │
  │  Step 0 discovery.py    (iTunes Search)                         │
  │   ↓                                                             │
  │  Step 1 rss.py          (RSS 解析 + 时间窗过滤)                  │
  │   ↓                                                             │
  │  Step 2 download.py     (ffmpeg + curl fallback, 前 5 分钟)      │
  │   ↓                                                             │
  │  Step 3 transcribe.py   (Azure Whisper, word+segment 双时间戳)   │
  │   ↓                                                             │
  │  Step 4 segmentation.py (GPT tier 分类 + tier-specific prompt)   │
  │   ↓                                                             │
  │  ┌── filter.py           (规则 + ffmpeg silencedetect)         │
  │  │   6 道检查: duration / start / end / ad / silence / repetition │
  │  ↓                                                             │
  │  Step 5 audio_cut.py    (ffmpeg 切片 + fade + snap to pause)    │
  │   ↓                                                             │
  │  Step 6 cefr.py         (CEFR-J + C1/C2 词表 + LLM fallback)    │
  │   ↓                                                             │
  │  Step 7 translate.py    (GPT 批量 JSON 翻译, 10句/批)            │
  │   ↓                                                             │
  │  Step 8 output.py       (句子切分 + collocations + 理解题 + 校验) │
  │   ↓                                                             │
  │  new_clips.json  ──► 手动合入 data.json                          │
  └─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
  ┌─────────────────────────────────────────────────┐
  │      独立 QA Agent: scripts/eval_agent.py         │
  │   规则分 + 可选 LLM 分 + Whisper 回转录校对        │
  │   输出: pass / review / reject                   │
  └─────────────────────────────────────────────────┘
```

---

## 1. 用户信息抓取链路

### 1.1 前端采集（单文件：`index.html`）

所有数据都写进 `localStorage`，没有账号体系。

| Key | 内容 | 写入点（大致行号） |
|---|---|---|
| `onboardingDone` | 首次 onboarding 完成标记 | 2311 |
| `flipodLevel` | CEFR 自评等级（A2–C1） | 2309 |
| `flipodInterests` | 兴趣标签数组 | 2310 |
| `flipodListenedClips` | 已听 clip id | 2776 |
| `flipodBookmarks` | 收藏 | 2417 |
| `flipodVocab` | 查过的生词 | 2418 |
| `flipodLikes` | 点赞 | 2932 |
| `flipodReview` | 复习队列 | 2943 |
| `flipodTheme` / `flipodLeftHand` / `flipodSpeed` | UI 偏好 | 2334/2529/2569 |

**Onboarding overlay**：`<div id="onboarding-overlay">`（第 1985 行起），只问两题：level + interests。

### 1.2 排序 API 调用

- **入口**：`callRankApi()`（`index.html` 第 2631 行）
- **请求体**：
  ```json
  { "level": "B1", "interests": [...], "listened": [...], "skipped": [...],
    "vocab_clicked": [...], "session_duration": 128 }
  ```
- **3 秒超时**；失败走本地兴趣过滤兜底（第 2707 行起）
- **重排触发**：`maybeRerank()`（第 2681 行），每 `RERANK_AFTER_CLIPS` 条触发

### 1.3 服务端：`functions/api/rank.js`

Cloudflare Pages Function，**独立跑在 Azure GPT-5.4 上**（和内容管线的 GPT 部署不同）。

| 事项 | 值 |
|---|---|
| 部署 | `gpt-5.4-global-01` @ us-east-02 |
| 环境变量 | `AZURE_API_KEY` |
| CLIP_META | **硬编码在 rank.js 第 17–40 行**（22 条），每次新 clip 入库都要改这里 |
| Prompt | `buildPrompt()` 第 42 行，英文，6 条排序规则 |
| 返回 | `{ id, reason }` 数组 |

> ⚠️ **最明显的债**：CLIP_META 硬编码。每次 data.json 更新都要手动同步这个数组，否则新 clip 进不了 AI 排序。建议改成部署时从 data.json 自动生成 meta，或者让 rank.js 接受 meta 数组作为请求参数。

---

## 2. 内容供给管线（scripts/agent/）

管线是模块化的 v2 版本。旧版单文件 `scripts/podcast_agent.py`（1714 行）仍保留，但**新功能都走模块化目录**。入口：`scripts/agent/pipeline.py::process_episode()`。

### Step 0 — Discovery（`scripts/agent/discovery.py`）

- **职责**：用 iTunes Search API 按关键词找播客 feed
- **输入**：`CURATED_FEEDS`（Tier 1，17 个精选源）+ `TIER2_KEYWORDS`（动态关键词）
- **过滤**：`languageCodesISO2A` 限英语；跳过 "kids/children/music only"
- **Tier 配置**：`scripts/agent/config.py::CONTENT_TIERS`，6 个 tier 各有独立刷新频率和时效窗口
- **痛点**：iTunes 搜索结果质量参差，Tier 2 发现基本没在用；节目黑名单只有 3 个关键词

### Step 1 — RSS 解析（`scripts/agent/rss.py`）

- **职责**：解析 feed XML，返回最近 N 集元信息
- **时间窗**：按 tier 配置过滤（Business/Tech 7 天，Science/Psychology/Culture 30 天，Story evergreen 365 天）
- **每 feed 默认 3 集**

### Step 2 — 下载（`scripts/agent/download.py`）

- **工具**：ffmpeg（主）+ curl range + ffmpeg 裁切（fallback）
- **策略**：只下前 `max_seconds=300`（5 分钟），避免整集（30–60 min）下载和转录成本
- **痛点**：只取前 5 分钟，Story 类节目经常前 5 分钟全是 intro/广告，导致 Step 4 找不到候选
- **Whisper 25MB 上限**在 `transcribe.py` 里也会再次检查

### Step 3 — 转录（`scripts/agent/transcribe.py`）

- **API**：Azure OpenAI Whisper (`whisper0614`)
- **关键**：**必须同时传 `timestamp_granularities[]=word` 和 `timestamp_granularities[]=segment`**（CLAUDE.md 明确记录过这个坑）
- **传输**：走 `curl` subprocess，**不能用 urllib**（macOS Python 3.9 SSL 超时问题）
- **语言过滤**：`data.language` 必须是 `english`/`en`
- **缓存**：结果落盘到 `<audio>.transcript.json`，避免重烧 Whisper（~$0.30/集）
- **3 次重试 + 3s backoff**

### Step 4 — 片段识别（`scripts/agent/segmentation.py` + `scripts/prompts/loader.py`）

这是**最复杂也最常调的一步**。

1. **Episode 分类**（`classify_episode()`）：如果 feed 没标 tier，用 LLM 分类；置信度 < 0.6 返回 `Mixed` 跳过
2. **Tier-specific prompt**：6 个 tier 各有独立 prompt body
3. **Prompt 装配**（`build_segment_prompt()` at loader.py:364）：
   - `SHARED_PREAMBLE`：时长硬约束 + 三档开头检查（硬拒绝 / 软标记 / 硬通过）+ 结尾建议 + 广告黑名单
   - `TIER_PROMPTS[tier]`：tier 特定"好片段"定义 + 拒绝规则 + 开头钩子优先级
   - `SHARED_OUTPUT_FORMAT`：严格 JSON schema
4. **当前版本**：`PROMPT_VERSION = "v2.1.1"`（2026-04-15 回滚了 v2.2 的 Patch D）
5. **文件**：
   - Prompt 源：`prompts/PROMPTS-segment-selection.md`
   - Python 加载器：`scripts/prompts/loader.py`（字符串硬编码，**不是**从 md 实时解析；md 只是 PM 编辑用，改了之后需要同步到 loader.py）

> ⚠️ **最大的 prompt 债**：md 文件和 loader.py 不是单源。目前要 PM 改 loader.py 里的 Python 字符串才能生效。

### Step 4.5 — Filter（`scripts/agent/filter.py`）

LLM 输出完会过一道**规则过滤**。6 道检查：

| 检查 | 规则 | 典型拒绝码 |
|---|---|---|
| `_check_duration` | 按 tier 区间：Science/Business 45–120s，Tech/Psy/Cul 60–120s，Story 60–150s | `duration_out_of_range_…` |
| `_check_start` | 硬拒：`Exactly./Right.` 起 / `you said` 类指代 / 纯填充；软标记：and/but/so 等 | `hard_reject_echo_response` 等 |
| `_check_end_completeness` | 末尾 8 字符内要有句末标点；末词不能是悬挂连词 | `end_no_punctuation`, `end_dangling_and` |
| `_check_ad_pattern` | 正则命中 `sponsored by/coming up after the break/…` | `ad_detected_…` |
| `_check_internal_silence` | ffmpeg `silencedetect=-35dB:d=3`，内部静音 > 3s 拒绝 | `internal_silence_…` |
| `_check_repetition` | 前 10%/后 10% 词集交叠 > 50% 拒绝（避免循环段）| `repetition_overlap_…` |

**Text 来源**：在 `pipeline.py:80-94` 里拼装。**优先用 segment 级 text（有标点）**，没有 segments 的历史缓存才回退 word 级拼接——这是为了 end completeness 检查能正确识别句号。

### Step 5 — 切片（`scripts/agent/audio_cut.py`）

- **核心**：`cut_audio()` 用 ffmpeg 按 `-ss`/`-t` 切，加 0.3s fade in/out
- **snap**：`snap_boundary()` 找 Whisper segment 间的 gap，把切点吸到最近的自然停顿（窗口 2s）
- **注意**：`pipeline.py:138-143` 明确**不**让 `cut_audio` 做二次 snap，因为 `extract_clip_words` 已经把 start/end 调到了句子边界；再 snap 会导致音频和字幕错位
- **尾部静音检测**：`_detect_tail_silence()`，尾段 > 8s 静音或占比 > 35% 直接丢弃输出

### Step 6 — CEFR 标注（`scripts/agent/cefr.py` + `cefr_wordlist.json`）

- **词表来源**：CEFR-J + Octanove C1/C2（**2026-04-15 从假 COCA-CEFR 迁过来的**，CC BY-SA 4.0，前端侧面板已加归属行）
- **查表**：`get_cefr()` 小写 strip 标点后查 map
- **LLM fallback**：`batch_cefr_annotation()` 一次最多 200 词，专有名词返回 null
- **难度推断**：`infer_difficulty()` 按词分布推 B1/B1+/B2/B2+/C1，**主信号是高难度词占比**而不是平均
- **迁移脚本**：`tools/migrate_cefr_to_cefrj.py`；全库重标：`tools/retag_cefr_all_clips.py`

### Step 7 — 翻译（`scripts/agent/translate.py`）

- **批大小**：10 句/批
- **格式**：JSON `[{idx, zh}]`——**不用纯文本按行对齐**（会错位）
- **降级**：JSON 解析失败 → 单句翻译兜底
- **2 次重试**；最终还是失败就 `zh=""`，由 output.validate_clip 标警告

### Step 8 — 输出装配（`scripts/agent/output.py`）

1. **`extract_clip_words()`**（58-199 行）— 把 clip 时间窗里的 word 映射到 segment text；遇到 > 25 词无标点的段落调 `llm_add_punctuation()` 补标点；再按 greedy 对齐拆成字幕行
2. **`extract_collocations()`** — 抓 2/3-gram，给后续"收藏词组"用
3. **`generate_comprehension_questions()`** — GPT 生成 2 题（gist + attitude），每题 4 选 1
4. **`validate_questions()`** — 第二次 GPT 调用校验每题能否仅从文本答出；禁止考 specific detail
5. **`validate_clip()` / `validate_all_clips()`** — 时间戳连续性 / 字幕完整性 / CEFR 覆盖率 / 音频文件存在性

### 最终输出结构（每个 clip）

```
id, title, tag, audio, duration, difficulty, info_takeaway,
source { podcast, episode, episode_url, timestamp_start, timestamp_end, pub_date, tier },
lines [ { start, end, en, zh, words [ {word, start, end, cefr} ] } ],
collocations [ ... ], questions [ ... ], prompt_version
```

---

## 3. QA / 评估 Agent（`scripts/eval_agent.py`）

**独立离线脚本**，不在 pipeline.py 里自动跑。给运营复核用。

| 维度 | 权重 | 打分函数 |
|---|---|---|
| narrative_completeness | 0.4 | `score_narrative_rule_based` |
| translation_accuracy | 0.3 | `score_translation_rule_based` |
| audio_quality | 0.3 | `score_audio_rule_based` + `score_audio_text_sync` |

- **关键动作**：`score_audio_text_sync()` 把 clip mp3 回传给 Whisper 再转录一遍，和字幕比对 token 相似度（`text_similarity`）—— 防止字幕和音频错位
- **verdict**：`verdict_for()` 输出 `pass/review/reject`，有 critical issue（音频缺失、0 时长行、尾部静音等）直接 reject
- **`--use-llm`**：可选 LLM 复评，narrative + translation 两项取平均
- **输入**：`new_clips.json`
- **输出**：`eval_results.json` + `approved_clips.json`

## 4. 周边工具（tools/）

- `analyze_filter_rejections.py` — 拉 dry-run 的 filter_result 统计分布
- `compare_dry_runs.py` / `diff_old_vs_new.py` — prompt/filter 版本对比
- `cut_from_candidates.py` — 从已有 transcript + 候选直接切片（跳过 Step 0–3）
- `refilter_candidates.py` — 只重跑 Step 4.5 filter，不重烧 LLM
- `retag_cefr_all_clips.py` / `migrate_cefr_to_cefrj.py` — CEFR 词表迁移和批量重标
- `flag_clips_for_review.py` — 把 eval review/reject 标记刷到 data.json
- `test_eval_on_retro.py` — 历史 clip 上跑回归测试
- `dry_run_review.html` — 静态页，人工复核 dry-run 输出

## 5. 相关脚本入口

| 用途 | 命令 |
|---|---|
| 正式跑管线 | `python scripts/podcast_agent_v4.py`（173 行，只是调用 `agent.pipeline`） |
| 单元测试 | `pytest scripts/tests/`（test_cefr / test_filter / test_translate / test_segment_snap） |
| 本地前端 | `scripts/serve.sh` → `scripts/range_http_server.py`（支持 Range 请求，音频播放必须） |
| 部署 COS | `scripts/deploy_cos.sh` |

## 6. 依赖与环境

环境变量（`.env.example`）：

```
AZURE_WHISPER_OPENAI_ENDPOINT
AZURE_WHISPER_OPENAI_API_KEY
AZURE_WHISPER_OPENAI_DEPLOYMENT   (默认 whisper0614)
AZURE_WHISPER_OPENAI_API_VERSION  (默认 2024-06-01)
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT           (默认 gpt-5-chat-global-01)
AZURE_OPENAI_API_VERSION          (默认 2025-01-01-preview)
```

外部二进制：

```
/opt/homebrew/bin/ffmpeg           # 必需
/opt/homebrew/bin/cloudflared      # 远程预览（需加 --protocol http2）
```

---

## 7. 已知踩坑（已验证，研发改动前务必读）

以下均来自 `CLAUDE.md`，研发接手时容易踩。**不要回改这些**：

1. **Python 3.9 SSL 坏** — 所有 HTTP 必须走 `curl` subprocess，不能用 urllib
2. **Whisper 词级时间戳**必须双传 `word + segment`，否则只有 segment 文字
3. **GPT 5.4 用 `max_completion_tokens`**，不是 `max_tokens`
4. **word 级输出没有标点，segment 级有标点** — 句末检查和分句必须用 segment，不要在 word 上找标点
5. **翻译用 JSON 格式**，不要按行对齐，失败退回单句
6. **CEFR 词表源**：CEFR-J + Octanove，不是 COCA 频率（频率 ≠ 难度，会把 add/agree 标成 B2）
7. **Prompt 末尾完整性约束不能靠 LLM 自查**（v2.2 Patch D 翻车过）— 必须在 filter 层做 code-level snap 到 Whisper segment 标点
8. **词提取边界收紧到 ±0.05s**，避免超出片段边界的词混入
9. **cut_audio 不要传 segments 做二次 snap** —— extract_clip_words 已经 snap 过了
10. **Story 类内容切片必须有完整叙事弧线** — 60s 内没转折宁可延长到 120s
11. **data.json 是核心** — agent 输出到 `new_clips.json`，不要直接写 data.json

---

## 8. 研发优化建议（按优先级）

### P0（阻塞迭代）

1. **CLIP_META 单源化**
   - 现状：`functions/api/rank.js` 的 CLIP_META 和 `data.json` 脱钩，每次 data 更新要手改
   - 建议：部署时由 CI 从 `data.json` 生成 meta；或 rank.js 改成接受 clip ids 由前端传 meta

2. **Prompt 单源化**
   - 现状：`prompts/PROMPTS-segment-selection.md`（PM 编辑）和 `scripts/prompts/loader.py`（运行时）不同步
   - 建议：loader.py 改成从 md 解析结构化 section，md 做唯一来源（或反过来 loader.py 为源，md 自动导出）

3. **下载只取前 5 分钟导致 Story/长节目失效**
   - Story 类前 5 分钟大概率是 intro，Step 4 空返回
   - 建议：按 tier 差异化 `max_seconds`，或改成基于文件大小的采样（分布式抽样）

### P1（影响规模化）

4. **管线无持久化任务队列**
   - `process_episode` 是同步串行，一集处理到一半挂了就全部重来（Whisper 有缓存但切片/翻译没）
   - 建议：把 Step 2–8 每一步产物写本地（transcribe 已做）；加 `resume` 参数

5. **无多 episode 并发**
   - 当前 for-loop 单线程，5 分钟音频 + 3 clips × 翻译 + CEFR + 2 题生成 ≈ 单集 2-3 分钟
   - 建议：episode 级 ThreadPoolExecutor（参考 `podcast_agent.py` v1 已有雏形）；API 调用已 rate-limited，注意退避

6. **eval_agent 没集成到主链**
   - 现状：手动跑；失败的 clip 人工删
   - 建议：pipeline.py 最后自动调 eval_agent，`reject` 的 clip 不入 `new_clips.json`；`review` 的打标签进待审队列

7. **多 Agent 架构落地**
   - `docs/brief/BRIEF-agent-architecture.md` 已讨论过：Supervisor + Discovery + Processing × N + QA + Publishing
   - 建议：用 Claude Agent SDK 重构，Supervisor 用 Opus，Processing 用 Sonnet，Discovery/Publishing 用 Haiku。成本预计降 60–80%

### P2（优化效果）

8. **Filter 6 道检查是串行命中首条即返回**
   - 不利于调试（拿不到全部失败原因）和 LLM 反馈
   - 建议：收集所有失败 reason，供 dry-run 复盘；同时把 reason 反馈给 segmentation prompt 做 few-shot

9. **CEFR LLM fallback 一次 200 词，无缓存命中率统计**
   - 建议：跑 10 集后统计 fallback 率，命中率低于 90% 说明词表缺太多，考虑再扩表

10. **rank.js prompt 和 meta 硬编码在同一文件**
    - 建议：prompt 抽到 `functions/api/_prompts/rank.txt`，meta 独立 json，便于 AB 测试

11. **前端兴趣标签和后端 tier 命名对不上**
    - `tag` 在 data.json 里是小写（`science/business/story/…`），CURATED_FEEDS tier 是 TitleCase（`Science/Business/Story/…`），rank.js 里又是小写
    - 建议：出一份枚举单源（`docs/SCHEMA-v1.md` 可扩展），前后端 import

12. **历史 clip 重排成本**
    - `retag_cefr_all_clips.py` 已能批量重标，但翻译没重跑能力；prompt 升级后老 clip 无法享受新标签
    - 建议：每个 clip 存 `prompt_version` 和 `cefr_source_version`（已存 prompt_version），提供批量升级脚本

---

## 9. 代码文件清单（给研发索引用）

```
listen demo/
├── index.html                       前端单文件（~3000 行）
├── data.json                        全量 clip 数据（生产源）
├── cefr_wordlist.json               CEFR-J + Octanove 词表
├── functions/api/rank.js            Cloudflare Pages AI 排序 API
├── scripts/
│   ├── podcast_agent_v4.py          新入口（调用 agent 包）
│   ├── podcast_agent.py             旧单文件版本（保留参考，新功能勿动）
│   ├── eval_agent.py                QA agent（独立离线）
│   ├── eval_candidates.py           候选评分（离线）
│   ├── fix_clips.py / fix_sentences.py   一次性修复脚本
│   ├── merge_clips.py               new_clips.json 合并 data.json
│   ├── range_http_server.py         本地音频服务（支持 Range）
│   ├── agent/
│   │   ├── pipeline.py              Step 2–9 编排
│   │   ├── config.py                Tier 定义 + 精选 feed
│   │   ├── discovery.py             Step 0
│   │   ├── rss.py                   Step 1
│   │   ├── download.py              Step 2
│   │   ├── transcribe.py            Step 3
│   │   ├── segmentation.py          Step 4
│   │   ├── filter.py                Step 4.5
│   │   ├── audio_cut.py             Step 5
│   │   ├── cefr.py                  Step 6
│   │   ├── translate.py             Step 7
│   │   ├── output.py                Step 8–9
│   │   └── utils.py                 log/ curl/ call_gpt
│   ├── prompts/
│   │   └── loader.py                Prompt 装配 + 版本号（唯一运行时来源）
│   └── tests/
│       ├── test_cefr.py
│       ├── test_filter.py
│       ├── test_segment_snap.py
│       └── test_translate.py
├── prompts/
│   └── PROMPTS-segment-selection.md 分 tier prompt 原文档（PM 编辑）
├── tools/                           辅助脚本（见第 4 节）
└── docs/
    ├── ops/                         运营规格（AGENT-podcast-processor.md 等）
    ├── prd/                         PRD
    ├── brief/                       架构 brief（含多 agent 方案）
    └── handoff/                     本文件 + 历史交接
```

---

## 10. 快速验收清单（研发接手后跑一遍）

1. `.env` 配好，跑 `pytest scripts/tests/` 全绿
2. 挑一集 Science 类 episode，跑 `python scripts/podcast_agent_v4.py`，确认 dry-run 产出 5–6 候选、filter 通过 3 个
3. 对比 `data.json` 里现有 clip 的 `prompt_version`，确认和 `loader.py::PROMPT_VERSION` 一致
4. 前端 `scripts/serve.sh` 启本地，onboarding → 听 5 个 clip → 看 `/api/rank` 是否被调用、feed 是否重排
5. 跑 `python scripts/eval_agent.py --input output/new_clips.json --audio-dir output/clips`，确认每个 clip 都有 verdict

有任何一步跑不通先来找 PM 同步，不要回改 CLAUDE.md 里已经踩过的坑。
