# Filter + Prompt 流水线修复交付

**日期**：2026-04-14
**作者**：Cowork (AI) + Jamesvd
**状态**：已实测交付（v2.2 prompt 未实测，见下文）
**相关分支**：无（未 commit，所有改动在工作区，研发可自行 diff 整合）

---

## TL;DR

Dry-run 流水线之前每 123 候选只通过 1 个（0.8%），诊断后发现是 **LLM / filter / pipeline text 拼接三方对齐问题**，不是内容质量差。四个 patch 修完后：

| 指标 | v2.0 | v2.1 实测 |
|---|---:|---:|
| Filter 通过率 | 0.8%（1/123） | **42%（33/79）** |
| LLM + Filter + Agent 三者共识 pass | 1 | **33** |
| "Filter 能过但 Agent 不认同"误放行 | N/A | **0** |
| 冷库预估产出（当前 37 基础上） | +0 | **+33**（目标 150，还差 80） |

核心逻辑：**filter 和 agent 现在高度吻合**（filter_pass ⊆ agent_pass），说明规则层自洽。剩余瓶颈从"流水线 bug"转移到"LLM 选段时对时长约束的妥协"，这是 prompt 调优问题，可后续迭代。

---

## 一、改动清单

### 代码改动（4 个文件）

| # | 文件 | 改动 | 性质 |
|---|---|---|---|
| 1 | `scripts/agent/pipeline.py` | 候选 `text` 字段改用 Whisper segment 级拼接（带标点），word 级作 fallback | Bug 修复 |
| 2 | `scripts/agent/filter.py::_check_end_completeness` | 末尾标点检测从"仅看最后 1 字符"改成"扫末尾 8 字符" | Bug 修复（防御性） |
| 3 | `scripts/agent/transcribe.py` | 增加 transcript 落盘缓存（`<mp3>.transcript.json`），自动命中 | 基础设施 |
| 4 | `scripts/prompts/loader.py` + `prompts/PROMPTS-segment-selection.md` | v2.0 → v2.2：duration 和结尾完整性都升为**硬约束** | Prompt 迭代 |

### 新增工具（2 个文件）

| # | 文件 | 用途 |
|---|---|---|
| 5 | `tools/analyze_filter_rejections.py` | 诊断脚本，读 `dry_run_candidates.json` 输出 `filter_diagnostics.md`（duration 直方图 / tier 拆分 / 末尾 dump / 通过率） |
| 6 | `tools/refilter_candidates.py` | 零成本复跑工具，读 transcript 缓存 + 老候选，原地套新 filter 看对比。以后改 filter / 改规则不用再烧 Whisper 钱 |

### Prompt 版本

- `PROMPT_VERSION`：`v2.0` → **`v2.2`**
  - v2.1 (2026-04-14)：duration 升为硬约束（SHARED_PREAMBLE 第 1 条）
  - v2.2 (2026-04-14)：结尾完整性升为硬约束（SHARED_PREAMBLE 第 3 条）

---

## 二、根因和修复对应

### Bug 1：pipeline 用 word-level 拼 text，丢了标点

- **现象**：filter `_check_end_completeness` 看最后 1 字符判句末，word-level 输出没标点，大量完整句被误判为半截。
- **数据**：v2.0 dry-run 25 个 `end_no_punctuation` 拒绝里，目测约 17 个是完整句被误杀。
- **根因**：Whisper word 级输出**没有**标点，segment 级输出**有**标点（见 `.claude/CLAUDE.md` 第 37 行踩坑记录）。
- **修复**：Patch 1 按候选的 `start_time/end_time` 找 overlap 的 segments，取 segment 的 `text` 字段拼接；如果本集 transcript 无 segments（老缓存），回退到 word 级。

### Bug 2：filter 句末检测太严

- **现象**：即使用 segment 级 text，Whisper 的 segment 边界和候选时间窗不精确对齐，末尾词偶尔落在句号之后。
- **修复**：Patch 2 扫末尾 8 字符，任一位置出现 `.!?'"` 即通过。

### Prompt 漂移：duration 和结尾下限被 LLM 当作"软建议"

- **现象**：v2.0 prompt 说"短而锐利的 hook 也算合格"被 LLM 误读为可以无视 45s 下限，123 候选里 93 个 `<45s` 被 filter 砍。
- **修复**：Patch 3（v2.1）duration 硬约束 + Patch 4（v2.2）结尾完整性硬约束，prompt 明确告诉 LLM "违反直接丢弃该候选，不要返回"。
- **实测效果（v2.1）**：短候选占比 67% → 28%，end_no_punctuation 25 → 9。
- **v2.2 预期**：剩下的 9 个 `end_no_punctuation`（7-8 个是真半截）应该被 LLM 自己压掉。

### 基础设施：transcript 未落盘

- **现象**：v2.0 dry-run 跑完 mp3 在 `tmp/` 但 transcript 丢了，要复跑 filter 必须重新 Whisper（$10+/次、10 分钟+）。
- **修复**：transcribe.py 每次成功后自动写 `<mp3 basename>.transcript.json` 到 mp3 隔壁。v2.1 跑完已有 45 份缓存，以后所有 filter / prompt 调优零成本。

---

## 三、实测结果（v2.1，真实 dry-run + eval）

### Filter × Agent 交叉矩阵（79 候选）

| | agent pass | agent gray | agent reject | 合计 |
|---|---:|---:|---:|---:|
| filter pass | **33** | 0 | 0 | 33 |
| filter reject | 29 | 2 | 15 | 46 |
| 合计 | 62 | 2 | 15 | 79 |

**关键信号**：
- **B 档（filter pass + agent 不认同）= 0**：filter 没有任何误放行，规则层和内容判断层吻合。
- **A 档（filter + agent 都 pass）= 33**：直接可进人审。
- **C 档（filter reject + agent pass）= 29**：LLM 把好内容切太短或切太长，filter 砍掉。agent 只看 text 质量说 pass，不看时长。**是下一阶段主要瓶颈**（见下文 Backlog 1）。

### Tier 分布（A 档 33 条）

| Tier | 数量 | 备注 |
|---|---:|---|
| Business | 9 | |
| Science | 9 | Short Wave 5/5 通过 |
| Tech | 7 | Vergecast 3/3 通过 |
| Culture | 3 | |
| Story | 3 | |
| Psychology | 2 | Hidden Brain 切段偏短，多个落在 C 档 |

### 每集产出（46 集）

- 零产出：19 集（41%）
- 1 个：21 集（46%）
- 2 个：6 集（13%）
- A 档均 0.72 clip/集

---

## 四、未实测项（需下一轮 dry-run 验证）

**v2.2 Patch D（结尾完整性硬约束）**刚改完 prompt，没重跑 dry-run。

**验证成本**：~$11 + 30 分钟（可复用 45 份 transcript 缓存，实际只要再跑 LLM 选候选 + 新增集的 Whisper）。

**预期**：
- `end_no_punctuation` 从 9 → 2-3
- Story/Psych tier 通过率上升（它们现在 30-45s 段最多）
- A 档候选数 33 → 40+

建议研发接手后**第一件事跑这轮验证**，用同样的 `--dry-run` 命令，复用 `output/dry_run_2026_04_14/` 目录（mp3 + transcript 都在，成本低）。

---

## 五、交给研发的 action items

排序按优先级：

1. **跑 v2.2 验证**（~30 分钟 + ~$11）
   ```bash
   mv output/dry_run_2026_04_14/dry_run_candidates.json \
      output/dry_run_2026_04_14/dry_run_candidates.v21.json
   python scripts/podcast_agent_v4.py --dry-run \
     --output-dir output/dry_run_2026_04_14
   python scripts/eval_candidates.py \
     output/dry_run_2026_04_14/dry_run_candidates.json
   python tools/analyze_filter_rejections.py
   ```
   产出 `filter_diagnostics.md` 对照本文第三节指标看是否达标。

2. **A 档 33 条走完整流水线**（切 mp3 + 翻译 + CEFR + 生成 questions）
   - 当前 dry-run 模式走到 filter 就停了，没切音频
   - 需要一个"non-dry-run"跑法，以 `dry_run_candidates.json` 为输入，跳过 Whisper 和 LLM 选段（都已缓存），直接从第 100 行开始（`for seg in filtered:`）往下跑
   - 产出 `output/new_clips.json`，人 review 后合并到 `data.json`

3. **C 档救助脚本**（backlog 1，预计 1-2 小时）
   - 见下

4. **Commit 本次改动**
   - 所有改动未 commit，请研发做一次 review 后合并
   - 建议分两个 commit：`fix: pipeline text + filter punctuation` 和 `prompt: v2.2 hard constraints`

---

## 六、Backlog（未在本次解决）

### 1. C 档 29 条"时长不达标但内容好"的救助

LLM 把好内容切短了（多数 30-55s），filter 按 duration 硬约束砍。但 agent 说这些内容是 pass 的。直接扔掉浪费。

**方案**：写 `tools/rescue_short_candidates.py`，读 transcript 缓存里的 segments，对每个 C 档候选在 `[start-30s, end+30s]` 范围内找最近的完整句边界，向前/向后扩展到 ≥ tier 下限。扩展后重跑 filter，过得了就进新候选池。

**预计产出**：20 个 C 档被救活，冷库可到 70 左右。

### 2. Throughline 1 个候选 internal_silence_3.7s 误伤

`_check_internal_silence` 阈值 3 秒过严，叙事型节目（Throughline 做戏剧化演绎）的刻意停顿会被当噪声拒。考虑：
- 阈值放到 5 秒，或
- Story/Culture tier 禁用此检测。

### 3. TED Radio Hour / Snap Judgment tier 0% 通过率

TED 演讲结构完整、Snap 跨段叙事，天然不适合短切片。考虑从 curated feeds 里降权或移除。

### 4. 候选池浪费（旧 backlog.md 第 1 条，仍未做）

目前 filter 拒绝的候选只在日志里，没落到 `candidate_pool.json`。后续 prompt/filter 改动时，无法回溯"哪些以前被拒的现在能过"。v2.2 之后可以考虑。

---

## 七、文件地图（研发接手时的快速索引）

```
listen demo/
├── scripts/
│   ├── agent/
│   │   ├── pipeline.py          ← Patch A（第 62、75-92 行）
│   │   ├── filter.py            ← Patch B（第 139-165 行）
│   │   └── transcribe.py        ← 缓存（第 17、34-48、86-93 行）
│   ├── prompts/
│   │   └── loader.py            ← v2.2 SHARED_PREAMBLE（第 17、22-75 行）
│   ├── eval_candidates.py       ← 已有工具，无改动
│   └── podcast_agent_v4.py      ← 已有主入口，无改动
├── prompts/
│   └── PROMPTS-segment-selection.md  ← v2.2 同步（第 37-56 行）
├── tools/
│   ├── analyze_filter_rejections.py  ← 本次新增
│   ├── refilter_candidates.py        ← 本次新增
│   └── dry_run_review.html           ← 已有 UI，无改动
├── output/dry_run_2026_04_14/
│   ├── dry_run_candidates.json       ← v2.1 最新结果（含 eval）
│   ├── dry_run_candidates.v20.json   ← v2.0 备份
│   ├── dry_run_candidates.backup.json← eval 前备份
│   ├── filter_diagnostics.md         ← v2.1 分析
│   └── tmp/*.transcript.json         ← 45 份 Whisper 缓存
└── docs/
    ├── BACKLOG.md
    └── 2026-04-14-filter-prompt-handoff.md  ← 本文
```

---

## 八、给研发的几个关键踩坑提示

（其他踩坑见 `.claude/CLAUDE.md`）

1. **Whisper word 级没标点、segment 级有标点**——本次 Bug 1 的根因。拼 text 永远用 segment 级。
2. **Azure GPT-5.4 用 `max_completion_tokens`**，不是 `max_tokens`。
3. **macOS 系统 Python 3.9 的 SSL 问题**——所有 HTTP 请求必须走 `curl subprocess`，不要用 urllib。
4. **transcript 缓存路径**是 `<mp3>.transcript.json`（mp3 隔壁，不在单独目录）。误删 mp3 会带走缓存。
5. **prompt 版本号**用 `PROMPT_VERSION` 常量跟踪，落到每个 clip 的 `prompt_version` 字段，用于后续内容质量归因分析。
