# Claude Code Brief · Task G · 纯听 Tab 卡片 Priming（方案 3 · 延迟 autoplay）

> 2026-04-17 · Jamesvd · v3 新增能力。为了让纯听 Tab 对 A2/B1 的用户"真能听懂"，在 feed 卡片上离线预生成高难度词 + 中译作为 priming，autoplay 延迟 1 秒给用户一个视觉预激活窗口。**完全离线预处理，不依赖音频下载，合规安全。**

---

## 背景

**为什么做这个 feature**：

predictive processing 的研究表明，听力理解本质是"用耳朵听到的东西去匹配脑子里已经建立的预期"——预期准，理解好。对于 A2/B1 用户，clip 里如果有 2-3 个 B2/C1 级的生词，没有 priming 他们就会在那几个词上卡住，整段听力就报废。priming 不是给所有人"多 3 秒信息"，是让**低水平用户的预测机器能在听之前先 load 好关键词**。

**为什么是方案 3（卡片视觉 + 延迟 autoplay）而不是 pre-roll**：

- pre-roll 破坏 feed 流的无摩擦惯性（TikTok 护城河），所有用户付 3 秒成本
- 方案 3 把 priming 寄生在"卡片滑入视口 → 用户决定看不看 → autoplay"这个本来就存在的微决策窗口里。0.8-1.2 秒延迟短到不让"流"断掉，但够眼睛扫完 2-3 个词
- 不想看的用户继续滑走，零成本；想看的用户在决策窗口里顺便吸收

**关键合规前提**：
- 我们不下载音频（仍然只是 URL 跳转播放）
- priming 的输入是 **Whisper 已经转录出来的 transcript**（这个 v2 pipeline 就已经在做了）
- 也就是说 priming 完全只用我们自己产出的文字，不涉及新的版权动作

---

## 交付物

1. **`podcast_agent.py` 新增 pipeline 步骤**：`generate_priming(clip)` 在 transcript 落地后运行，挑词 + 补中译，写进 `clip.priming` 字段
2. **`tools/backfill_priming.py`**（新建）：给历史所有 clip 补 priming 字段；跑一次即可
3. **前端卡片渲染**：`index.html` 的 clip card 模板新增 `priming-zone` UI 块
4. **前端 autoplay 时序改造**：IntersectionObserver 里 autoplay 延迟 1 秒启动
5. **埋点**：`clip.priming_seen` / `clip.priming_skipped`
6. **测试**：跑 20 条现有 clip，肉眼抽 5 条验证 priming 词确实是该 clip 里的高难度实义词 + 中译准确

---

## 数据结构

```json
// data.json 里每个 clip 新增字段
{
  "id": "clip_012",
  "title": "...",
  "audio_url": "...",
  "transcript": { ... },
  "priming": {
    "words": [
      { "word": "compounding", "zh": "复利的/累积的", "cefr": "C1" },
      { "word": "delinquent", "zh": "逾期的/失职的", "cefr": "C1" },
      { "word": "chipping", "zh": "一点点削减", "cefr": "B2" }
    ],
    "version": "v1.0",
    "generatedAt": 1745851200000
  }
}
```

---

## 选词算法（`generate_priming` 的核心逻辑）

```python
# podcast_agent.py 新增
from cefr_lookup import get_cefr  # Task C 产出

PRIMING_MAX_WORDS = 3
PRIMING_MIN_WORDS = 2
PRIMING_ALLOWED_POS = {'NOUN', 'VERB', 'ADJ', 'ADV'}  # 只要实义词
PRIMING_EXCLUDE_LEVELS = {'A1', 'A2', 'B1'}  # 太简单不是 priming 目标

def generate_priming(clip):
    words = clip['transcript']['words']  # Whisper word-level 输出

    # 1. 词级聚合（同词不同形态合并：running/runs/ran → run 以 lemma 为准）
    lemma_map = {}
    for w in words:
        lemma = lemmatize(w['text'].lower().strip('.,!?";:'))
        if not lemma or lemma in STOPWORDS: continue
        pos = get_pos(w['text'])
        if pos not in PRIMING_ALLOWED_POS: continue
        cefr = get_cefr(lemma)
        if not cefr or cefr in PRIMING_EXCLUDE_LEVELS: continue
        if lemma not in lemma_map:
            lemma_map[lemma] = { 'word': lemma, 'cefr': cefr, 'first_idx': w.get('idx', 0) }

    # 2. 按 CEFR 档位降序排（C2 > C1 > B2），同级按在 clip 里出现顺序
    cefr_order = ['C2', 'C1', 'B2']
    sorted_words = sorted(
        lemma_map.values(),
        key=lambda w: (cefr_order.index(w['cefr']) if w['cefr'] in cefr_order else 99, w['first_idx'])
    )

    # 3. 取前 2-3 个
    picked = sorted_words[:PRIMING_MAX_WORDS]
    if len(picked) < PRIMING_MIN_WORDS:
        return None  # clip 里没有 B2+ 实义词，不生成 priming（很少见但可能）

    # 4. 批量补中译（复用 podcast_agent 已有的 translate_words 逻辑 + curl subprocess）
    translations = translate_words_via_curl([w['word'] for w in picked])
    for w, zh in zip(picked, translations):
        w['zh'] = zh

    return {
        'words': picked,
        'version': 'v1.0',
        'generatedAt': now_ms(),
    }
```

**关键细节**：
- **必须在 CEFR overrides 之后跑**（Task C 的 `cefr_overrides.json` 生效之后），否则会把 `whenever`、`nevertheless` 这种功能词选成 priming 词，完全没意义
- **只取实义词**（NOUN/VERB/ADJ/ADV）——POS tagging 可以用 spaCy 或 NLTK，podcast_agent.py 如果已经有 POS 工具就复用
- **lemmatize 归并**：同词不同形态（running/runs/ran）算一个；lemma 作为 key
- **CLAUDE.md 约束**：`translate_words_via_curl` 必须用 curl subprocess 调 Azure GPT（不是 urllib），`max_completion_tokens` 不是 `max_tokens`
- **失败兜底**：选词失败（< 2 个候选）直接不写 priming 字段，前端渲染时判空跳过，不渲染 priming-zone

---

## Pipeline 集成

`podcast_agent.py` 的现有步骤（大概）：

```
抓 URL → Whisper 转录 → 翻译 → CEFR 标注 → validate → 写 data.json
```

priming 插在 CEFR 标注之后、validate 之前：

```
抓 URL → Whisper 转录 → 翻译 → CEFR 标注 → generate_priming → validate → 写 data.json
```

validate 里加一行：`assert clip.get('priming') is None or len(clip['priming']['words']) >= 2`

---

## `tools/backfill_priming.py`

```
入参: data.json (默认 ./data.json)
行为:
  1. 遍历所有 clip
  2. 对已有 priming 字段的 clip 跳过（除非 --force）
  3. 对没有的调 generate_priming 补上
  4. 翻译 batch 调 LLM（每 20 个词合并一次，减少 API 调用）
  5. 写回 data.json（先 backup 到 output/backups/）
```

单独脚本因为 priming 会独立于 pipeline 迭代（Prompt 调整、CEFR overrides 更新后都可能要重跑）。

---

## 前端渲染

### 卡片 UI

`index.html` 里 clip card 模板新增 priming-zone。视觉层级**必须克制**——不要抢 clip 标题和封面的主位。建议放在卡片底部或右上角小条。

```html
<!-- clip card template -->
<div class="clip-card">
  <!-- 封面 / 标题 / 时长 / 波形等现有元素 -->

  <div class="priming-zone" hidden>
    <div class="priming-label">🎯 3 个关键词</div>
    <div class="priming-words">
      <!-- 动态注入 -->
      <!-- <span class="priming-word">
             <span class="priming-word-en">compounding</span>
             <span class="priming-word-zh">复利的</span>
           </span> -->
    </div>
  </div>
</div>
```

```css
.priming-zone {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);  /* iOS 暗色风格里的微浮起 */
  border-radius: 8px;
  margin-top: 8px;
}
.priming-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 4px;
}
.priming-word {
  display: inline-block;
  margin-right: 12px;
  font-size: 13px;
}
.priming-word-en {
  color: #fff;
  font-weight: 500;
}
.priming-word-zh {
  color: rgba(255, 255, 255, 0.6);
  margin-left: 4px;
}
```

**视觉基线**：不能让卡片整体看起来变重。设计师/Jamesvd 视觉 QA 过一眼再定终稿。

### autoplay 延迟时序

现在的 IntersectionObserver 回调（大概长这样）：

```js
if (entry.isIntersecting && entry.intersectionRatio > 0.8) {
  audio.play().catch(handlePlayError);
}
```

改为：

```js
const PRIMING_DELAY_MS = 1000;
const clipEntryTimers = new WeakMap();

observer.observe(card);

function onIntersect(entry) {
  const audio = entry.target.querySelector('audio');
  if (entry.isIntersecting && entry.intersectionRatio > 0.8) {
    // 渲染 priming（如果 clip 有 priming 字段）
    renderPrimingIfPresent(entry.target, clip);

    // 埋点：priming_seen
    const seenAt = Date.now();
    track('clip.priming_seen', {
      clip_id: clip.id,
      word_count: clip.priming ? clip.priming.words.length : 0,
    });

    // 延迟 1s 启动 autoplay
    const timer = setTimeout(() => {
      if (isStillVisible(entry.target)) {
        audio.play().catch(handlePlayError);
      }
    }, PRIMING_DELAY_MS);
    clipEntryTimers.set(entry.target, { timer, seenAt });
  } else {
    // 离开视口：取消延迟启动，埋点是否在 1s 内划走
    const t = clipEntryTimers.get(entry.target);
    if (t) {
      clearTimeout(t.timer);
      const dwell = Date.now() - t.seenAt;
      if (dwell < PRIMING_DELAY_MS) {
        track('clip.priming_skipped', { clip_id: clip.id, dwell_ms: dwell });
      }
      clipEntryTimers.delete(entry.target);
    }
    audio.pause();
  }
}
```

**关键点**：
- 如果 clip 没有 `priming` 字段，priming-zone 不渲染，但 autoplay 延迟仍然存在——**保持时序一致性**，避免"有 priming 的 clip 慢、没有的 clip 快"造成 UX 抖动
- 用户在 1 秒内划走 → setTimeout 被清掉，audio 不会"滑过去之后还在后面响"
- 旧的 `clip.viewed` 埋点继续在 audio.play() 成功之后触发，不要和 priming_seen 混

---

## 和其他任务的关系

- **G 不依赖 F**（F 是练习 Tab 生成，G 是纯听 Tab 卡片）
- **G 部分依赖 C**（CEFR overrides 生效之后 priming 选词才准；但 C 没做完也能跑，只是选词偏差）。**建议 C 先合并再跑 G 的 backfill_priming.py**
- **G 不依赖 D/E**（D 是练习 Tab 行为、E 是 UI 漏斗主结构——都不碰纯听卡片内部）
- **合并顺序建议**：E → F → C → G → D（G 和 D 可以并行）

---

## MVP 边界（不要顺手做）

- **不做 adaptive 显隐**（按用户水平决定显不显示 priming）——P1 做，需要用户 CEFR 档位 + 交互信号才够精度
- **不做点词交互**——priming 词本身可点查翻译？P1 做
- **不做跨 clip 去重**（避免连续 5 条 clip 里都出现同一个 priming 词）——P2
- **不做 priming 词加入生词本**——用户想收藏该词走现有"听中点词"路径
- **不改 autoplay 延迟时长**为可配置——就写死 1000ms，上线后看数据再调

---

## 校验清单

- [ ] 跑 `backfill_priming.py` 后，`data.json` 里所有 clip 有 `priming` 字段或 null
- [ ] 抽 5 条 clip 人工 check：priming 词确实是该 clip transcript 里出现过的高难度实义词，中译准确
- [ ] 功能词（whenever、nevertheless 等）不会被选进 priming（说明 Task C overrides 在 pipeline 侧生效了）
- [ ] 前端卡片渲染，priming-zone 在有 priming 字段的 clip 上显示，没字段的隐藏
- [ ] 卡片滑入视口，phrase 立刻可见；1 秒后 audio 开始
- [ ] 用户在 0.5s 内滑走，audio 不会在后台启动（用 `setTimeout` 的计时 log 验证）
- [ ] 埋点 `clip.priming_seen` / `clip.priming_skipped` 有数据
- [ ] 视觉 QA：Jamesvd 看一眼卡片密度是否超标

---

## 问题升级

- POS tagger 在 podcast_agent.py 现有依赖里找不到 → 用 spaCy 小模型 `en_core_web_sm`，`pip install --break-system-packages`（CLAUDE.md 约束）
- 翻译的中译在某些词上有歧义（如 `bank` 可以是银行也可以是河岸）→ 让 Prompt 加 context，传入 clip 的一句话上下文让 LLM 基于语境翻译
- priming 词选出来 80% 是 C2 → 算法改 sort 时加"频率惩罚"，偏 B2+C1（更实用的区间）
- 1 秒延迟在真机测试上感觉"卡"→ 降到 800ms 或 700ms，PR 备注说明调整理由
- 历史 clip 跑 backfill 时 API 费用超标 → batch 翻译调到每次 50 词，再加客户端节流

---

## 埋点补充（对齐 PRD 第十七章）

| 事件名 | 触发 | 属性 |
|---|---|---|
| `clip.priming_seen` | 卡片滑入视口且有 priming 字段 | `clip_id, word_count` |
| `clip.priming_skipped` | 1 秒内划走 | `clip_id, dwell_ms` |
| `clip.priming_word_tapped` | （P1 功能，占位不实现）| `word, cefr, clip_id` |

PR 里在 PRD 第十七章对应表加这两行。
