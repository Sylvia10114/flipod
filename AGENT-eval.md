# Clip Eval Agent 规格

**作者**：Sylvia + Claude
**日期**：2026-04-08
**前置文档**：AGENT-podcast-processor.md、PRD-content-personalization-v0.6.md
**状态**：待 Sylvia 审查

---

## 1. 定位

Eval agent 是 processor agent 和 data.json 之间的质量关卡。processor 产出 `new_clips.json` 后，eval agent 逐条检查，只有合格的 clip 才能进入 data.json。

运行模式分两个阶段：
- **阶段 1（半自动）**：输出 pass / review / reject 三种状态。pass 自动进入合并候选，reject 自动丢弃，review 需要 Sylvia 人工确认。通过人工校准来验证 eval 判断是否准确。
- **阶段 2（纯自动）**：eval 标准跑稳后，去掉 review 状态，只有 pass 和 reject，全自动写入 data.json。

切换条件：连续 3 批（约 15-20 个 clip）eval 的 review 判断与 Sylvia 人工判断一致率 >= 90%。

---

## 2. 输入 / 输出

### 输入

```
eval agent 读取：
  - new_clips.json（processor agent 的产出）
  - 对应的 mp3 音频文件
```

### 输出

```
output/eval_results.json
```

格式：

```json
{
  "eval_run_id": "2026-04-08_001",
  "total_clips": 5,
  "passed": 3,
  "review": 1,
  "rejected": 1,
  "results": [
    {
      "clip_id": 1,
      "verdict": "pass",
      "scores": {
        "narrative_completeness": {"score": 8, "reason": "完整的论述，有开头引入和结论收束"},
        "translation_accuracy": {"score": 9, "reason": "翻译准确，语气自然"},
        "audio_quality": {"score": 7, "reason": "音频清晰，首尾淡入淡出正常"}
      },
      "overall_score": 8.0,
      "flags": []
    },
    {
      "clip_id": 2,
      "verdict": "reject",
      "scores": {
        "narrative_completeness": {"score": 3, "reason": "故事在高潮前截断，没有落点"},
        "translation_accuracy": {"score": 7, "reason": "翻译基本准确"},
        "audio_quality": {"score": 6, "reason": "结尾有轻微截断感"}
      },
      "overall_score": 5.3,
      "flags": ["narrative_truncated"]
    }
  ]
}
```

---

## 3. 三个检查维度

### 3.1 叙事完整性（narrative_completeness）

检查 clip 是否有完整的语义结构，不是从话题中间截断的。

**LLM 检查 prompt 核心**：给 LLM clip 的全部英文句子，问：

1. 这段内容是否有明确的开头（引入话题/设定场景/抛出问题）？
2. 是否有明确的结尾（结论/转折/情绪收束/观点总结）？
3. 最后一句话是否像一个自然的停顿点，还是明显话说到一半？
4. 如果是故事类内容，是否包含至少一个叙事转折点？

**评分标准**：

| 分数 | 含义 |
|---|---|
| 8-10 | 完整的叙事弧线，有清晰的开头和结尾 |
| 6-7 | 基本完整，结尾略弱但不算截断 |
| 4-5 | 结尾模糊，听完会觉得"然后呢？" |
| 1-3 | 明显截断，话说到一半 |

**自动 reject 条件**：分数 <= 4

### 3.2 翻译准确性（translation_accuracy）

检查中文翻译是否与英文语义一致、是否自然。

**LLM 检查 prompt 核心**：给 LLM 每句英文和对应中文，问：

1. 语义是否一致？有无漏译、错译、多译？
2. 中文是否自然口语化？有无翻译腔？
3. 专有名词处理是否合理？

**评分标准**：

| 分数 | 含义 |
|---|---|
| 8-10 | 准确且自然，像人翻译的 |
| 6-7 | 基本准确，个别句子措辞不太自然 |
| 4-5 | 有 1-2 处明显错译或漏译 |
| 1-3 | 多处严重错误，影响理解 |

**自动 reject 条件**：分数 <= 4
**自动 review 条件**：分数 5-6（翻译存疑，人工看一眼）

### 3.3 听感体验（audio_quality）

检查音频本身的可用性。

**规则检查（不需要 LLM）**：

| 检查项 | 方法 | 不通过条件 |
|---|---|---|
| 时长 | 读取音频 duration | < 45s 或 > 135s |
| 开头静音 | 检测前 1s 的音量 | 超过 0.5s 的静音 |
| 结尾截断 | 检测最后 0.5s 的波形 | 音量突然归零（非淡出） |
| 整体音量 | 计算平均 RMS | 过低（听不清）或过高（爆音） |

**LLM 辅助检查**（基于转录文本）：

| 检查项 | 方法 |
|---|---|
| 开头自然度 | 第一句话是否像从中间开始（如 "...and then he said"） |
| 广告/套话 | 是否包含 "sponsored by"、"brought to you by"、"subscribe" 等 |

**评分标准**：

| 分数 | 含义 |
|---|---|
| 8-10 | 音频清晰，首尾自然，时长合适 |
| 6-7 | 基本可用，有轻微问题但不影响体验 |
| 4-5 | 有明显问题（太短、有截断感、包含广告片段） |
| 1-3 | 不可用（噪音严重、听不清、严重截断） |

**自动 reject 条件**：分数 <= 4 或时长不达标

---

## 4. 综合判定逻辑

```
overall_score = (narrative × 0.4) + (translation × 0.3) + (audio × 0.3)

如果任一维度触发自动 reject → verdict = "reject"
否则如果任一维度触发自动 review → verdict = "review"
否则如果 overall_score >= 6.5 → verdict = "pass"
否则 verdict = "review"
```

权重说明：叙事完整性权重最高（0.4），因为这是 clip 3 那种问题的根源——内容截断是最影响体验的。

---

## 5. 结构性校验（前置检查，不需要 LLM）

在跑 LLM 评估之前，先做结构完整性检查：

| 检查项 | 条件 | 不通过处理 |
|---|---|---|
| lines 数组非空 | len(lines) >= 3 | 直接 reject |
| 每个 line 有 en 和 zh | 所有 line 都有非空的 en 和 zh | 直接 reject |
| words 时间戳连续 | 每个 word 的 start >= 前一个 word 的 start | 直接 reject |
| 音频文件存在 | mp3 文件在指定路径 | 直接 reject |
| tag 在标准列表内 | tag ∈ {science, business, psychology, story, history, culture, tech, society} | 修正或 reject |
| CEFR 覆盖率 | >= 80% 的 words 有 cefr 标注 | review |

---

## 6. 运行方式

```bash
# 评估 processor agent 的最新产出
python eval_agent.py --input output/new_clips.json --audio-dir output/clips/

# 输出
# → output/eval_results.json（评估结果）
# → output/approved_clips.json（只含 pass 的 clip，可直接合并到 data.json）
```

---

## 7. 成本估算

每个 clip 的 eval 成本：
- 结构校验：0（纯规则）
- 叙事完整性 LLM 调用：1 次
- 翻译准确性 LLM 调用：1 次（所有句对打包一次发）
- 音频质量规则检查：0
- 音频质量 LLM 辅助：可以和叙事检查合并为 1 次调用

所以每个 clip 约 2 次 GPT 调用。5 个 clip 约 10 次调用，成本忽略不计。

---

## 8. 阶段 2 切换条件

连续 3 批 eval 运行（每批 5+ 个 clip），满足以下条件时可切到纯自动：

- review 判断与 Sylvia 人工判断的一致率 >= 90%
- 无漏检（Sylvia 认为应该 reject 但 eval 给了 pass 的情况为 0）
- reject 率稳定在 10-25% 之间（太低说明标准太松，太高说明 processor 有问题）

切换后 review 状态取消，所有 clip 只有 pass 和 reject。
