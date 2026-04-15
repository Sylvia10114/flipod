# Claude Code Handoff — Podcast Agent 改造任务

**日期**：2026-04-14
**目标仓库**：`/Users/.../listen demo/`（当前 Flipod 项目根目录）
**交付方**：Cowork (Sylvia 的 AI PM)
**接收方**：Claude Code（本地终端）

---

## 背景

Flipod 的内容生产 pipeline `scripts/podcast_agent.py` 和 `scripts/eval_agent.py` 目前能跑通，但有以下工程问题需要改造。**本次改造不涉及业务逻辑变更**（业务规则 / prompt 由 PM 侧维护），只做结构性重构和能力补全。

产品侧的 prompt 改动在另一个文档 `prompts/PROMPTS-segment-selection.md`，你不需要改 prompt 内容，只需要把新的 prompt 框架集成到代码里，按 tier 分派调用。

---

## 任务清单（按优先级）

### 任务 1：模块化拆分 podcast_agent.py

**现状**：1714 行单文件。所有逻辑（RSS 解析、音频下载、Whisper 调用、LLM 调用、切片、翻译、CEFR、输出）塞在一起。

**目标结构**：

```
scripts/
  podcast_agent.py          # 入口（CLI argparse + 主流程编排，< 200 行）
  agent/
    __init__.py
    config.py               # API keys、endpoints、CONTENT_TIERS、CURATED_FEEDS
    discovery.py            # Step 0: iTunes 搜索 + Tier 2 发现
    rss.py                  # Step 1: feed 解析
    download.py             # Step 2: 音频下载
    transcribe.py           # Step 3: Whisper 调用（双传 timestamp_granularities）
    segmentation.py         # Step 4: 片段识别（加载 tier-specific prompt）
    audio_cut.py            # Step 5: ffmpeg 切片 + fade
    cefr.py                 # Step 6: CEFR 词表 + 标注
    translate.py            # Step 7: 批量 JSON 翻译
    output.py               # Step 9: 组装 data.json
    utils.py                # log / step_timer / curl subprocess helper
  prompts/
    loader.py               # 加载 PROMPTS-segment-selection.md 里的 prompt 片段
```

**要求**：
- 重构前跑一次现有 agent 生成一批基线输出，作为回归测试基准
- 重构后再跑一次相同配置，对比两次输出的 data.json 应该**完全一致**（因为是纯重构，不改逻辑）
- 每个模块加 docstring，说明输入输出
- 敏感值（API keys）全部从 `os.environ` 读，不再有 fallback 硬编码
- 提供 `.env.example` 模板列出所有需要的环境变量

---

### 任务 2：实现 Tier-Specific Prompt 分派

**规格文档**：`prompts/PROMPTS-segment-selection.md`（必读，全部内容都在里面）

**实现要点**：

1. 新建 `prompts/segment_selection.py`（或 `.json`），把 MD 里的 6 个 tier prompt + shared preamble + output format 解析出来作为 Python 字符串常量

2. `segmentation.py` 的 `select_segments()` 函数签名改为：
   ```python
   def select_segments(
       transcript_words: list[dict],  # Whisper 词级输出
       podcast_name: str,
       tier: str,  # 'Business'|'Tech'|'Science'|'Story'|'Psychology'|'Culture'
       duration_minutes: float,
       candidates_per_episode: int = 6,  # 默认选 6 个候选（原来是 3）
   ) -> list[dict]:
   ```

3. Tier 来源优先级：
   - 优先从 `CURATED_FEEDS` 条目里的 `tier` 字段取
   - 如果 feed 没有明确 tier（Tier 2 发现的源），调用第八节的 episode 分类 prompt 先定 tier
   - 分类置信度 < 0.6 返回 "Mixed"，主流程直接 skip 这一集

4. 输出 `segments` 数组（5-6 个候选），交给任务 3 的过滤环节

---

### 任务 3：候选过滤层（新增步骤，在 Step 4 和 Step 5 之间）

**目的**：LLM 选出的候选段落用规则和 ffmpeg 过滤一道，淘汰明显垃圾后再进入切片。

**新建** `agent/filter.py`，实现 `filter_candidates(candidates, full_audio_path) -> list[dict]`：

对每个候选做以下检查，任一失败就淘汰：

1. **时长检查**：
   - Story tier：60 ≤ duration ≤ 150
   - 其他 tier：60 ≤ duration ≤ 120

2. **开头检查（三档规则，见 prompts/PROMPTS-segment-selection.md SHARED_PREAMBLE 第 2 条）**：

   硬淘汰条件（任一命中即淘汰）：
   ```python
   # 纯附和响应单独成句（前 3 词匹配）
   HARD_REJECT_RESPONSES = re.compile(
       r"^(exactly|right|totally|i agree|absolutely|correct|yeah[,.]|yes[,.]|no[,.])\s*[.!?]",
       re.IGNORECASE,
   )
   
   # 前 15 词内明确指代前文
   ANTECEDENT_PHRASES = re.compile(
       r"\b(you (just )?said|what you (just )?mentioned|that'?s (right|exactly|what i meant)|"
       r"as i was saying|back to your point|to your point|that'?s a (great|good) (example|point)|"
       r"following up on what)\b",
       re.IGNORECASE,
   )
   # 只检查片段前 15 个词的范围内
   
   # 纯填充词开头且前 10 词无实质内容
   EMPTY_FILLER_OPEN = re.compile(
       r"^(you know|i mean|like|um|uh)[, ]+.{0,50}[.!?]$",  # 短小且首句只有填充
       re.IGNORECASE,
   )
   ```

   软标记（不自动淘汰，但 flag 上报给 LLM 做二次判断）：
   - 首词属于 {and, but, so, because, then, well, actually, or, yeah, yes, no}
   - 首句以这些词起手**且**不在硬淘汰规则里
   - 加 flag `soft_open_connective`，但不在过滤层淘汰——交给 Step 4 的 LLM prompt 判断
   
   注：不要简单按"首词黑名单"淘汰。"Yeah. So Vortec watch company is like Vortex and Tik Tok..." 是好 hook，"But here's the thing..." 也是好 hook，不应该被过滤层掐掉。

3. **结尾完整性**：
   - 最后一个词结尾必须是 [.!?"'] 之一 → 不满足淘汰
   - 最后一个词 lowercase 属于 {and, but, or, because, which, that, to, of, in, on} → 淘汰

4. **广告/套话检测**（regex）：
   ```
   r"sponsored by|brought to you by|this episode is supported|coming up after the break|
     subscribe to our|rate us on|follow us on|stay tuned|we'll be right back|
     for a limited time"
   ```
   片段文本命中任一 → 淘汰

5. **内部静音检测**（ffmpeg）：
   - 对候选区间用 `ffmpeg -af silencedetect=noise=-35dB:d=3` 扫
   - 如果内部（非首尾）出现任何 >3s 的静默块 → 淘汰
   - 这个是 PM 明确要求的标准（"完整 + 内部没有过长转场/静音"）

6. **重复率检测**：
   - 候选文本做词级 token 化，如果前 10% 和后 10% 的词集合重复度 > 50% → 淘汰（循环/重复内容）

**输出**：通过过滤的候选列表，按 LLM 给的 hook_strength 排序后取 top 3（或 `clips_per_episode` 配置值）。

---

### 任务 4：切片边界 Snap 到自然停顿

**现状**：`audio_cut.py` 直接按 LLM 给的 start_time/end_time 切，加 0.3s fade。

**改造**：

1. 在 Whisper 转录结果里，除了 word-level，还保留 segment-level 数据（Whisper API 原生返回）
2. 计算 segment 之间的 gap（前一个 segment 的 end 到下一个 segment 的 start）
3. 切片时：
   - 对 start_time：向前找最近的 gap（≤ 2s 窗口内），把 start snap 到 gap 中点
   - 对 end_time：向后找最近的 gap（≤ 2s 窗口内），把 end snap 到 gap 中点
4. 如果找不到 gap（紧密说话），保持原时间戳不动
5. fade in/out 保留 0.3s（在 snap 后的边界上）

**验证**：随机抽 5 个切片人耳听，对比 snap 前后的开头/结尾听感。

---

### 任务 5：`--dry-run` 模式

**目的**：PM 调试 prompt 时不需要等完整的切片+翻译+CEFR 流程，只要看 LLM 选出的候选区间。

**实现**：
```bash
python podcast_agent.py --feeds ... --dry-run
```

`--dry-run` 时只执行 Step 0-4（发现、下载、转录、候选选择），输出到 `output/dry_run_candidates.json`：

```json
{
  "run_id": "2026-04-14_1430",
  "config": {...},
  "prompt_version": "v2.0",
  "episodes": [
    {
      "podcast": "Planet Money",
      "episode": "...",
      "tier": "Business",
      "candidates": [
        {
          "start_time": 180.5, "end_time": 248.2, "duration": 67.7,
          "text": "开头 200 字...\n\n...结尾 100 字",
          "reason": "...",
          "hook_type": "...", "hook_strength": "high",
          "filter_result": "passed" | "rejected_reason_X"
        }
      ]
    }
  ]
}
```

不切音频、不做翻译、不做 CEFR。跑完就退出。

---

### 任务 6：环境变量 + .env 支持

**现状**：Azure API keys 硬编码在 podcast_agent.py 源码里（安全隐患）。

**改造**：
1. 所有 keys 从 `os.environ` 读，无 fallback
2. 用 `python-dotenv` 在启动时加载 `.env`
3. 提供 `.env.example` 模板：
   ```
   AZURE_WHISPER_OPENAI_ENDPOINT=
   AZURE_WHISPER_OPENAI_API_KEY=
   AZURE_WHISPER_OPENAI_DEPLOYMENT=whisper0614
   AZURE_WHISPER_OPENAI_API_VERSION=2024-06-01
   AZURE_OPENAI_ENDPOINT=
   AZURE_OPENAI_API_KEY=
   AZURE_OPENAI_DEPLOYMENT=gpt-5-chat-global-01
   AZURE_OPENAI_API_VERSION=2025-01-01-preview
   ```
4. `.env` 加入 `.gitignore`（检查一下现有 .gitignore）
5. 启动时如果必要环境变量缺失，报错退出，不静默用默认值

---

### 任务 7：单元测试（关键路径）

在 `scripts/tests/` 下加 pytest 测试：

1. `test_filter.py` — 候选过滤逻辑的每条规则各写 2 个 case（通过 / 不通过）
2. `test_segment_snap.py` — 切片边界 snap 逻辑（mock Whisper 数据）
3. `test_cefr.py` — CEFR 词表查询和 LLM 兜底路径
4. `test_translate.py` — JSON 批量翻译的行数校验和 fallback

**不需要**集成测试（那个要真 API 调用），只做单元级。

---

### 任务 8：merge_clips.py 合并工具

**目的**：把每批 `output/batchN/approved_clips.json` 合入主 `data.json`，支撑冷库分批补齐流程（见 `docs/ops/OPS-cold-store-backfill.md`）。

**新建** `scripts/merge_clips.py`：

```bash
python3 scripts/merge_clips.py \
  --source output/batchN/approved_clips.json \
  --target data.json \
  --audio-src output/batchN/clips \
  --audio-dst clips \
  [--dry-run]
```

**行为**：

1. 读 source 的 approved_clips，读 target 的 data.json
2. target 现有 clip 的最大 id + 1 作为新 clip 的起始 id
3. source 里每个 clip：
   - 重新分配 id（递增）
   - 原始音频从 `{audio-src}/clip_XXX.mp3` 复制到 `{audio-dst}/clip{新id}.mp3`（注意：旧命名 `clip_001.mp3`，主库命名 `clip1.mp3`，无下划线无前导零）
   - clip 的 `audio` 字段更新为新路径 `clips/clip{新id}.mp3`
4. 追加到 target 的 `clips` 数组末尾
5. **自动备份**：合并前 `cp data.json data.json.backup_{timestamp}`
6. `--dry-run` 模式：只报告将会发生什么（新增 N 个 clip，新 id 范围，音频复制清单），不实际改文件

**校验**：
- 合并前检查 source 里所有 clip 的 audio 文件存在
- 合并后检查 target 的 clips 数组长度 = 原长度 + 新增数量
- 合并后检查所有新增 clip 的 audio 字段指向的文件已复制到位
- 任一校验失败：回滚（恢复备份），报错退出

**输出**：
```
Merged N clips (ids X-Y) from output/batchN/approved_clips.json into data.json
Audio files: output/batchN/clips/*.mp3 -> clips/*.mp3 (N files copied)
Backup: data.json.backup_20260414_1430
```

**不做**：不去重（假设上游 eval 已处理），不改 clip 内容（原样合并），不触发前端重新部署（部署由 git push 触发现有 CI）。

---

## 交付检查清单

完成后请回复以下清单的每一条：

- [ ] podcast_agent.py 拆成模块，主文件 < 200 行
- [ ] 重构前/后用同一配置跑出的 data.json 完全一致（diff 为空）
- [ ] Tier prompt 按规格集成，6 个 tier + Mixed 分类路径都能跑通
- [ ] 候选过滤 6 条规则全部实现，单元测试覆盖
- [ ] 切片边界 snap 实现，人耳听过样本
- [ ] --dry-run 模式可用，输出格式符合规格
- [ ] 所有 API keys 从 env 读，.env.example 提供
- [ ] 单元测试通过率 100%
- [ ] merge_clips.py 工具实现，--dry-run 可用
- [ ] 所有改动提交到 git，commit message 按现有项目惯例

---

## 不属于本次任务范围（不要做）

- 修改任何 prompt 的文字内容（只做集成）
- 修改 eval_agent.py（下一轮再动）
- 修改前端 index.html
- 修改 data.json 的 schema（保持向后兼容）
- 改变 data.json 里现有 clip 的内容

---

## 有疑问时

- Prompt 内容疑问 → 查 `prompts/PROMPTS-segment-selection.md`
- 业务逻辑疑问 → 在 commit message 或 PR 里标注 "@PM review"，不要自己拍板改
- 环境问题（SSL、ffmpeg 路径等）→ 查 `.claude/CLAUDE.md` 里的"开发踩坑记录"，已经列了现有坑
