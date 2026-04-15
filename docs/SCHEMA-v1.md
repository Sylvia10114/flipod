# Flipod Clip Schema v1

**状态**：v1 草案
**Owner**：PM（Jamesvd）+ Cowork
**后续**：研发如有新字段需求,提到 PM,评估后增补(不影响 v1 锁定)
**依赖文档**：
- `docs/DIVISION-OF-WORK.md` —— 分工协议
- `docs/ops/INTAKE-STANDARDS.md` —— 入库判断标准(一级 QA 定义依据)
- `docs/ops/TIER-DEFINITIONS.md` —— 6 个 topic(原 tier)定义

---

## 0. 关键决定(2026-04-15)

1. **tier → topic 合并**：生产侧分类和前端兴趣标签统一为 `topic`，6 值。
2. **QA 单层**：进 data.json / manifest 的 clip 默认通过一级 QA，不保留 `human_verdict` 字段(人审 reject 直接不入库)。
3. **保留 `agent_verdict` + `agent_dimensions`**：审计 trail + 为 INTAKE-STANDARDS §8 阶段 2 切换提供一致率算料。
4. **版权姿态**：clip 卡片必须带「听完整集 →」导流按钮(放 `episode_url`)。

---

## 1. Topic 值和中文显示名

6 个 topic 值稳定不动。生产 prompt(`scripts/prompts/loader.py`) 和 filter(`scripts/agent/filter.py`) 按这 6 个差异化处理。前端 ob 页面展示中文名。

| topic 值      | 前端中文名   | 生产侧特殊处理                                        |
| ------------ | ------- | ---------------------------------------------- |
| `Business`   | 商业 / 创业 | Duration 45-120s                               |
| `Tech`       | 科技 / AI | Duration 60-120s;主持人闲聊过滤                       |
| `Science`    | 科学 / 自然 | Duration 45-120s;防广告转场结尾                       |
| `Psychology` | 心理 / 行为 | Duration 60-120s                               |
| `Culture`    | 文化 / 社会 | Duration 60-120s;集体现象,个体生物学归 Science           |
| `Story`      | 故事 / 叙事 | Duration **60-150s**;eval 加 `narrative_arc` 维度 |

---

## 2. Clip 输出字段(data.json / manifest)

```jsonc
{
  "clip_id": "clip_038",                     // 自增,三位编号兼容旧格式
  "audio_url": "clips/clip_038.mp3",         // 相对路径

  // ── 来源 ──────────────────────────────
  "source": {
    "source_id": "hidden_brain_npr",          // 稳定 feed 级别 id(由 feed URL hash 或手工映射)
    "podcast_name": "Hidden Brain",
    "episode_title": "Why We Choose Struggle",
    "episode_url": "https://...",              // 原播客页 URL,「听完整集 →」按钮跳这里
    "episode_published_at": "2026-04-10T00:00:00Z"
  },

  // ── 分类 ──────────────────────────────
  "topic": "Psychology",                      // 枚举见 §1
  "topic_display_zh": "心理 / 行为",          // 冗余存储,前端无需查表

  // ── 时间 ──────────────────────────────
  "start_time": 123.4,                        // 在原 episode 内的起点秒
  "end_time": 189.1,
  "duration_sec": 65.7,

  // ── 内容 ──────────────────────────────
  "text": "完整英文原文...",

  "lines": [                                  // 句子级,前端字幕按这个渲染
    {
      "text_en": "It happens all the time.",
      "text_zh": "这种情况经常发生。",
      "start": 123.4,
      "end": 125.8
    }
  ],

  "words": [                                  // 词级,用于高光+点词查义
    {
      "word": "happens",
      "start": 123.9,
      "end": 124.3,
      "cefr_level": "A2"                       // A1-C2;"unknown" 表示词表未命中且 LLM 也无法判定
    }
  ],

  "comprehension_questions": [                // 3 题 MCQ
    {
      "question_en": "What does the speaker mean by...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct_idx": 1,
      "explanation_zh": "正确答案的中文解释"
    }
  ],

  // ── QA(审计 trail) ─────────────────────
  "hook_strength": "high",                    // 来自 segmentation agent(high/medium/low)
  "hook_score": 0.85,                         // 由 hook_strength 映射 0-1;high=0.85, medium=0.55, low=0.25
  "completeness": "high",                     // 来自 segmentation agent(v2.2 Patch D 重点)

  "agent_verdict": "pass",                    // eval agent 输出(pass/gray/reject)
  "agent_dimensions": {                       // 5+1 维度(Story 才有 narrative_arc)
    "opening":    {"score": 4, "note": "..."},
    "ending":     {"score": 5, "note": "..."},
    "info":       {"score": 4, "note": "..."},
    "standalone": {"score": 4, "note": "..."},
    "tier_fit":   {"score": 5, "note": "..."},
    "narrative_arc": {"score": 4, "note": "..."}   // 仅 Story topic
  },

  "qa_score": 0.85,                           // 综合分数(公式待定,见 §4)

  // ── 难度 ──────────────────────────────
  "difficulty_band": "medium",                // easy / medium / hard(从 difficulty_score 分桶)
  "difficulty_score": null,                   // 5 信号加权模型产出(0-1);v1 先留 null,等模型落地

  // ── 元数据 ─────────────────────────────
  "ingested_at": "2026-04-15T15:30:00Z"       // clip 入库时间,用于排序和 freshness 派生
}
```

---

## 3. Segmentation Agent 输入(LLM 选段时)

Step 5 段选 agent 的输入:

```jsonc
{
  "transcript": {
    "segments": [...],    // Whisper segment 级(有标点)
    "words": [...]        // Whisper word 级(有时间戳)
  },
  "topic": "Psychology",  // 6 值,决定用哪套 tier-specific prompt
  "podcast_name": "Hidden Brain",
  "episode_title": "Why We Choose Struggle",
  "episode_duration_minutes": 32.5
}
```

输出:5-6 个候选片段(含 start_word_index / end_word_index / start_time / end_time / duration_sec / reason / info_takeaway / suggested_title / hook_type / hook_strength / completeness / risk_flags / tier / prompt_version / text)。这是**流水线内部中间态**,不进 data.json。

---

## 4. qa_score 公式(TBD)

v1 **先不实现**,保留字段占位(默认为 `agent_dimensions` 五维度平均,Story 六维度)。

等冷库补到 60-70 条,再观察:
- agent_score vs 人审通过率的相关性
- 哪个维度最能预测人审 reject

再定加权公式。

---

## 5. difficulty_score(5 信号模型,TBD)

v1 **先留 null**,`difficulty_band` 字段必填但现阶段用**当前 CEFR 词占比单信号**先近似:
- B2+C1+C2 词 < 15% → `easy`
- 15-30% → `medium`
- > 30% → `hard`

5 信号模型(B2+/C1+ 词占比 / WPM / 句长 / 专名密度 / 主题抽象度)作为独立 backlog 推进,产出后刷全量。

---

## 6. 旧 data.json → v1 的迁移

当前 37 条 clip 用的字段跟 v1 的差异:

| 差异 | 处理 |
|---|---|
| 无 `source_id` | 用 `podcast_name` 哈希生成 |
| 无 `topic`(只有 `tier`) | 按 topic = tier 映射(值完全一致) |
| 无 `topic_display_zh` | 按 §1 表查 |
| 无 `episode_published_at` | 从 RSS 缓存回补 |
| 无 `hook_score` | 按 `hook_strength` 映射(high=0.85, medium=0.55, low=0.25) |
| 无 `qa_score` | 用 agent_dimensions 平均计算 |
| 无 `difficulty_band` | 按 §5 单信号近似规则计算 |
| `cefr_tags` 格式 | 从当前假 CEFR 迁移到新 EVP/CEFR-J 词表(见另一文档) |
| 有 `human_verdict` | 丢弃(进库即通过) |

迁移脚本由 Cowork 写(`tools/migrate_datajson_to_schema_v1.py`),执行由 Claude Code 本地跑,执行前走 PM 审阅。

---

## 7. 变更日志

| 日期 | 版本 | 改动 | Owner |
|---|---|---|---|
| 2026-04-15 | v1.0 | PM 自定义初版,tier→topic 合并,去掉 human_verdict,保留 agent_verdict | Cowork |

**变更流程**:
1. PM 或研发提出修改 → Cowork 更新本文档
2. 影响流水线输出:同步改 `scripts/agent/output.py` + 迁移脚本刷全量
3. 影响前端:同步通知研发改 rank.js
