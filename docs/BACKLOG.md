# Backlog（待决策 / 待实现）

记录已发现但暂不处理的产品/工程问题，避免遗忘。

---

## 1. 候选池浪费（Candidate Pool）

**发现日期**：2026-04-14

**问题**：每集 LLM 选 6 个候选，filter 通过后按 `hook_strength` 排序取 `--clips-per-episode` 个（默认 3），剩下 2-5 个候选**全部丢弃**——只在日志里有，没存任何文件。

**潜在浪费**：Whisper 转录是最贵的一步（~$0.30/集），跑完只产出 3 个 clip，剩下的好候选下次想用还得重转录。

**影响范围**：

- 冷库补齐效率
- 长尾内容池建设（用户口味学习需要候选池）
- 无法事后回看"为什么 prompt 改了之后某个候选不再被选"

**可能的方案**：

- A. 把所有候选（含 filter 拒绝的、排在 N+1 之后的）落到 `output/candidate_pool.json`
- B. 候选池支持去重（同 episode 多次跑只保留最新）
- C. 后续 batch 补齐先从 pool 里捞已转录的、未切的候选，覆盖到再去转新 episode
- D. 长期：基于上线后留存数据，回头从 pool 挑当时 hook_strength 不高但实际表现好的类型

**优先级**：等冷库 150+ 之后再处理。dry-run 阶段不阻塞。

**工程代价**：5-10 行写入逻辑 + 一个 `select_from_pool.py` 工具（约 100 行）。

---

## 2. Audio cut snap 的进阶版（P3 跟进）

**发现日期**：2026-04-14

**当前状态**：已修——`pipeline.py` 调 `cut_audio` 时不传 `segments`，snap 失效，回到老版"句子边界=音频边界"的行为。

**遗留**：`audio_cut.py::snap_boundary` 的代码还在，只是没人调用。

**进阶方案（如果要做）**：snap 之后重新调用 `extract_clip_words` 重新对齐 lines 时间戳，让字幕和音频两端都对齐到 segment gap 中点。这样能利用 snap 带来的"自然停顿"边界，又不破坏字幕同步。

**优先级**：第一批冷库补齐后视情况评估。dry-run 阶段不阻塞。

---

## 3. soft_flag 的实际应用

**发现日期**：2026-04-14

**当前状态**：filter 检测到 `And/But/So/Yeah/Well` 等 connective 起头会加 `soft_flags=["soft_open_connective"]`，但目前**没有任何后续逻辑使用这个 flag**——除了 dry_run_review.html 显示出来。

**待决定**：积累足够多的"软标记 + 人工审核 verdict"对照数据后（dry-run 后能拿到一批），决定 soft_flag 是要：

- A. 影响排序（同 hook_strength 的候选里软标记的排后面）
- B. 真值率高 → 提升为硬通过（从规则里删掉这条软标记）
- C. 真值率低 → 升级为硬拒绝
- D. 留作 LLM 自我校准用，不在 filter 层动

**触发条件**：第一轮 dry-run 审完后回看。

---

## 4. PM 待决字段（合并到 data.json 之前）

**发现日期**：2026-04-14

- ✅ `difficulty` — 已实现：`infer_difficulty()` 从 CEFR 词分布反推（B 方案）
- ✅ `info_takeaway` — 已修：v2 prompt 加回该字段（回方案）
- ✅ `tag` — 决定保留 `tier`（per-episode 而非 per-segment）

阈值待校准：`infer_difficulty` 的百分比阈值（目前 C1>=8% / B2>=30% / B2>=20% 等）是首版经验值，第一批补齐后回看分布再调。
