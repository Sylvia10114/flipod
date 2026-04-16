# Flipod 数据流全景 + Claude Code 实施提示词

> 把教学系统集成到现有产品的完整路线图。每个任务附 Claude Code 可直接使用的 prompt。

---

## 一、全局数据流图

```
┌──────────────────────────────────────────────────────────────────┐
│  PIPELINE（离线，运行一次 per episode）                            │
│                                                                  │
│  podcast_agent.py                                                │
│  ┌──────────┐    ┌──────────┐    ┌────────────┐   ┌──────────┐  │
│  │ Whisper  │───▶│ 分句+对齐 │───▶│ CEFR 标注  │──▶│ 选段+裁切 │  │
│  │ 转录     │    │ word ts  │    │ cefrj词表  │   │ filter   │  │
│  └──────────┘    └──────────┘    └────────────┘   └────┬─────┘  │
│                                                        │        │
│                    ┌───────────────────────────────────┐│        │
│                    │ GPT 生成教学内容（NEW）            ││        │
│                    │ • difficulty 计算                  ││        │
│                    │ • gist 题 + 变体                   ││        │
│                    │ • word_pool（按 CEFR 分层）        ││        │
│                    │ • exercises（多套 fill_blank）      ││        │
│                    │ • dictation 模板                   ││        │
│                    │ • reflection 选项                  ││        │
│                    └────────────────┬──────────────────┘│        │
│                                     │                   │        │
│                                     ▼                   ▼        │
│                              ┌──────────────┐   ┌───────────┐   │
│                              │ teaching.json│   │ data.json │   │
│                              │ （或内联）    │   │ (现有)    │   │
│                              └──────┬───────┘   └─────┬─────┘   │
│                                     │ merge           │         │
│                                     ▼                 │         │
│                              ┌──────────────┐         │         │
│                              │ data.json    │◀────────┘         │
│                              │ (final)      │                   │
│                              └──────┬───────┘                   │
└─────────────────────────────────────┼───────────────────────────┘
                                      │ deploy
                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│  CLIENT（浏览器，实时）                                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    index.html                            │    │
│  │                                                          │    │
│  │  ┌─────────┐   ┌───────────┐   ┌────────────────────┐   │    │
│  │  │ Startup │──▶│ Feed 渲染 │──▶│ 播放 + 字幕同步     │   │    │
│  │  │ (data   │   │ scroll-   │   │ audio timeupdate   │   │    │
│  │  │  fetch) │   │ snap cards│   │ word highlight     │   │    │
│  │  └────┬────┘   └───────────┘   └─────────┬──────────┘   │    │
│  │       │                                   │              │    │
│  │       │  localStorage                     │ 听中行为     │    │
│  │       │  ┌──────────────┐                 ▼              │    │
│  │       │  │flipodLevel   │        ┌─────────────────┐    │    │
│  │       │  │flipodVocab   │◀──────▶│ Word Popup      │    │    │
│  │       │  │flipodKnown   │        │ (点词/收藏/认识) │    │    │
│  │       │  │flipodBookmark│        └────────┬────────┘    │    │
│  │       │  │flipodSpeed   │                 │             │    │
│  │       │  │flipodTheme   │                 │ hook        │    │
│  │       │  │--------------│                 ▼             │    │
│  │       │  │flipodTeaching│        ┌─────────────────┐    │    │
│  │       │  │  Log (NEW)   │◀──────▶│ TeachingModule  │    │    │
│  │       │  │flipodUserCEFR│        │ .onWordTap()    │    │    │
│  │       │  │  (NEW)       │        │ .onWordSave()   │    │    │
│  │       │  │flipodClip    │        │ .onReplay()     │    │    │
│  │       │  │  Behavior    │        │ .onClipEnd()    │    │    │
│  │       │  │  (NEW)       │        │ .finishTeaching()│   │    │
│  │       │  └──────────────┘        └────────┬────────┘    │    │
│  │       │                                   │             │    │
│  │       │                                   │ 教学 UI      │    │
│  │       │                                   ▼             │    │
│  │       │                          ┌─────────────────┐    │    │
│  │       │                          │ Teaching Card   │    │    │
│  │       │                          │ Phase 1: Gist   │    │    │
│  │       │                          │ Phase 2: Vocab  │    │    │
│  │       │                          │ Phase 3: Exercise│   │    │
│  │       │                          │ Phase 4: Summary│    │    │
│  │       │                          └────────┬────────┘    │    │
│  │       │                                   │             │    │
│  │       │                                   │ callback    │    │
│  │       │                                   ▼             │    │
│  │       │                          ┌─────────────────┐    │    │
│  │       │                          │ 恢复 auto-      │    │    │
│  │       │                          │ advance 到下一   │    │    │
│  │       │                          │ clip            │    │    │
│  │       │                          └─────────────────┘    │    │
│  │       │                                                 │    │
│  └───────┴─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、模块接口清单

### 2.1 Pipeline 侧

| 模块 | 输入 | 输出 | 位置 |
|---|---|---|---|
| `podcast_agent.py` (现有) | RSS → Whisper → GPT | `output/new_clips.json` + `output/clips/*.mp3` | `scripts/podcast_agent.py` |
| `generate_teaching.py` (**新建**) | `data.json` (现有 clips) | 每个 clip 的 `difficulty` + `teaching` 对象 | `scripts/generate_teaching.py` |
| `merge_teaching.py` (**新建**) | `data.json` + teaching 输出 | 合并后的 `data.json` | `scripts/merge_teaching.py` |
| `retag_cefr_all_clips.py` (现有) | `data.json` + `cefr_wordlist.json` | 更新 words[].cefr | `tools/retag_cefr_all_clips.py` |

### 2.2 Client 侧

| 模块 | 消费的数据 | 产出的数据 | 接口 |
|---|---|---|---|
| Feed 渲染 | `clips[]` (title, source, tag, audio, lines) | DOM screens | `buildCards()` |
| 播放引擎 | `clips[].lines[].words[]` (start, end) | 当前播放时间、字幕高亮 | `timeupdate` → `updateSubtitle()` |
| Word Popup | 点击的 `.w` span → Google Translate API | 翻译/音标/释义 + flipodVocab/flipodKnown | `showWordPopup()` / `hideWordPopup()` |
| **TeachingModule** (新) | `clips[].teaching`, `clips[].difficulty`, flipodLevel, 听中行为 | 教学 DOM、flipodTeachingLog、flipodUserCEFR | 3 hooks + 公开 API |
| IntersectionObserver | DOM screens | `playClip()` / `stopAll()` | threshold 0.5 |
| 进度卡 | sessionClipsPlayed, tappedWordsThisSession | 进度 HTML | `buildProgressCardHTML()` |

### 2.3 关键数据流（分步）

```
用户点击一个词
  ↓
1. showWordPopup(span) → fetchTranslation(word) → 显示弹窗
2. 同时调用 TeachingModule.onWordTap(word, cefr, lineIndex, audio.currentTime)
3. 如果用户点"收藏" → saveVocab() + TeachingModule.onWordSave(word, cefr, lineIndex)
4. 如果用户点"认识" → saveKnownWords() （不调教学模块）
  ↓
clip 播完 (audio 'ended' event)
  ↓
5. 调用 TeachingModule.onClipEnd(currentIdx)
6. 如果返回 true → 拦截 auto-advance，教学卡片滚入视野
7. 如果返回 false → 原逻辑，scrollIntoView 下一个 clip
  ↓
教学流内部（Phase 1→2→3→4）
  ↓
8. Phase 2 selectTeachingWords() 读取 clipBehavior.saved_words/clicked_words
9. Phase 3 matchExerciseSet() 根据选中的词匹配预生成练习
10. Phase 4 logTeachingResult() → flipodTeachingLog
11. updateCEFREstimate() → flipodUserCEFR
  ↓
用户点"下一个 clip →"
  ↓
12. finishTeaching(clipIndex) → 移除教学卡片 → onTeachingDismiss 回调
13. 主流程恢复 → scrollIntoView(nextClip) + playClip(nextIdx)
```

---

## 三、需要修改的现有代码（精确定位）

### 修改点 A：`ended` 事件处理器

**文件**: `index.html`（.cf-pages-dist/index.html）
**行号**: ~3081-3086
**现有逻辑**:
```javascript
audio.addEventListener('ended', () => {
  if (currentIdx !== idx) return;
  if (idx + 1 < total) {
    screens[idx + 1].scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => playClip(idx + 1), 400);
  }
```
**改为**: 在 auto-advance 之前调用 `TeachingModule.onClipEnd(idx)`，如果返回 `true` 则不 advance。

### 修改点 B：Word Popup 点词事件

**文件**: `index.html`
**行号**: ~3372 (`showWordPopup` 函数内)
**改为**: 在显示弹窗的同时调用 `TeachingModule.onWordTap()`。需要从 span 的 `data-cefr` 属性和当前行索引提取参数。

### 修改点 C：收藏按钮

**文件**: `index.html`
**行号**: ~3506-3527 (`wpStar` click handler)
**改为**: 在 `vocab.push(...)` 之后追加 `TeachingModule.onWordSave()`。

### 修改点 D：回放检测

**文件**: `index.html`
**行号**: `seeked` 事件（现有可能没有监听）
**改为**: 添加 `audio.addEventListener('seeked', ...)` 调用 `TeachingModule.onReplay()`。

### 修改点 E：教学完成回调

**新增**: 全局函数 `onTeachingDismiss(clipIndex)`，在教学卡片关闭后恢复 auto-advance 到下一个 clip。

### 修改点 F：`<script>` 引入

**文件**: `index.html`
**行号**: `</body>` 之前
**改为**: 添加 `<script src="teaching-module.js"></script>`（在主脚本之前或用 defer）。

### 修改点 G：CSS 新增

**新增**: teaching 相关样式（卡片、选项、反馈、词卡、填空、总结），需要与现有的 `.content-screen` scroll-snap 系统兼容。Teaching card 不应参与 snap scrolling（它是一个临时插入的全屏卡片，用 `scroll-snap-align: none` 或从 snap container 外渲染）。

---

## 四、Claude Code 提示词

> 以下提示词按执行顺序排列。每个提示词都是独立的，可以单独交给 Claude Code。

---

### Prompt 1: Pipeline — 生成教学内容脚本

```
你是 Flipod 项目的后端开发。任务：创建 `scripts/generate_teaching.py`，为 data.json 中的每个 clip 生成教学内容。

**输入**: `data.json`（路径通过命令行参数传入）
**输出**: 在每个 clip 对象上新增 `difficulty` 和 `teaching` 两个字段，写入 `output/teaching_output.json`

请严格阅读以下 schema 规范：
- 读取 `SCHEMA-EXTENSION.md` 了解完整字段定义
- 读取 `TEACHING-SYSTEM-SPEC-v2.md` 的 Phase 1-4 了解教学设计意图
- 读取 `TEACHING-EXAMPLE-B1.md` 了解一个完整的示例

**difficulty 字段**由代码直接计算（不需要 LLM）：
- `wpm` = 总词数 / (最后 word.end - 第一个 word.start) × 60
- `avg_sentence_length` = 总词数 / lines 数量
- `cefr_distribution` = 各等级词数 / 总词数（排除 proper_nouns）
- `proper_nouns` = 检测大写开头且不在 cefr_wordlist.json 中的词
- `level` = 加权公式映射到五档（A2/B1/B1+/B2/B2+）

**teaching 字段**需要调用 Azure GPT API 生成（参考 `scripts/podcast_agent.py` 中的 curl 调用方式）：
- **所有 HTTP 请求必须用 curl subprocess**（项目 CLAUDE.md 约束，macOS Python 3.9 SSL 问题）
- **用 `max_completion_tokens` 不是 `max_tokens`**（GPT-5.4 要求）
- API key 从环境变量 `AZURE_OPENAI_KEY` 读取，endpoint 从 `AZURE_OPENAI_ENDPOINT` 读取

GPT 生成的内容包括：
1. `gist` — 主 Gist 题（英文，B1 难度）+ `difficulty_variants` 里的 A2（中文题）和 B2+（推断题）变体。每题 3 个选项（1 对 2 错），带 `focus_hint`（答错后的引导）和 `correct_insight`（答对后的解析）
2. `word_pool` — 按 B1/B2/C1 三个 CEFR 层级各选 2-4 个教学词。每个词需要 line_index、context_en、context_zh、definition_zh、why_selected。**从 clip 的 lines[].words[] 中筛选**，不要凭空编造
3. `exercises.fill_blank.sets[]` — 至少 2 套，每套对应一个可能的 target_words 组合（参考 schema 里的示例）。每套有 word_bank（目标词 + 2 个干扰词）和 4 道填空题
4. `exercises.dictation.sets[]` — 至少 2 套，每套含 2-3 个听写句子，句子使用原 clip 的语言风格但不直接复制原文
5. `reflection.options` — 3 个反思选项，每个对应 clip 中一段难听懂的区间（label + time_range）

**处理逻辑**：
- 遍历 data.json 中的 clips[]
- 对每个 clip：先计算 difficulty（纯代码），再调 GPT 生成 teaching（一次 API call，JSON 输出）
- GPT prompt 中带入 clip 的完整 lines（en+zh+words），让 GPT 看得到原文
- GPT 输出用 JSON mode（response_format: {"type": "json_object"}）
- 校验 GPT 输出的 line_index 是否在有效范围内
- 校验 word_pool 中的 word 是否真实存在于 clip 的 words[] 中

**错误处理**：
- API 失败重试 3 次，间隔 5 秒
- 校验失败的 clip 跳过，输出日志
- 最终输出一个汇总：成功 N 个，失败 M 个，跳过 K 个

项目约束请阅读 `.claude/CLAUDE.md`。
```

---

### Prompt 2: Pipeline — 合并教学数据

```
创建 `scripts/merge_teaching.py`，将 generate_teaching.py 的输出合并到 data.json。

**输入**：
- `data.json`（现有 clip 数据）
- `output/teaching_output.json`（generate_teaching.py 的输出）

**逻辑**：
- 按 clip 索引或 clip.id 匹配
- 将 `difficulty` 和 `teaching` 字段写入对应 clip
- 不修改现有字段（title, source, tag, audio, lines 等）
- 如果 clip 已有 teaching 字段，用新的覆盖
- 输出到 `data.json`（原地更新）并备份原文件到 `data.json.bak`

**校验**：
- 合并后每个有 teaching 的 clip，检查 gist.options 有且仅有 1 个 correct
- 检查 word_pool 每层至少有 1 个词
- 检查 exercises.fill_blank.sets 至少有 1 套
- 输出校验报告
```

---

### Prompt 3: 前端 — 集成教学模块到 index.html

```
你是 Flipod 项目的前端开发。任务：将 teaching-module.js 集成到 index.html。

**关键文件**：
- `index.html`（约 3594 行，vanilla JS 单文件应用）
- `teaching-module.js`（独立 IIFE 模块，暴露 TeachingModule 全局对象）
- `SCHEMA-EXTENSION.md`（data.json 新字段说明）

**需要做的修改**（请先完整阅读 index.html 理解现有架构）：

### A. 引入 teaching-module.js
在 `</body>` 之前、主 `<script>` 标签之前加入：
`<script src="teaching-module.js"></script>`

### B. 修改 `ended` 事件处理器（~第 3081 行）
现有代码：
```javascript
audio.addEventListener('ended', () => {
  if (currentIdx !== idx) return;
  if (idx + 1 < total) {
    screens[idx + 1].scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => playClip(idx + 1), 400);
  }
```
改为：
```javascript
audio.addEventListener('ended', () => {
  if (currentIdx !== idx) return;
  // 教学模块拦截
  if (typeof TeachingModule !== 'undefined' && TeachingModule.onClipEnd(idx)) {
    // 教学流已启动，不 auto-advance
    isPlaying = false;
    updatePlayPauseIcons();
    return;
  }
  if (idx + 1 < total) {
    screens[idx + 1].scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => playClip(idx + 1), 400);
  }
```

### C. 在 showWordPopup() 里加入行为采集（~第 3372 行）
在 `showWordPopup` 函数内，获取到 word 和 cefr 之后，加入：
```javascript
// 教学行为采集
if (typeof TeachingModule !== 'undefined') {
  const lineIdx = getCurrentLineIndex(idx); // 需要实现：返回当前正在显示的 line 索引
  TeachingModule.onWordTap(word, cefr, lineIdx, audios[idx]?.currentTime || 0);
}
```
**注意**：需要有一个方法获取当前行索引。现有代码中 `lastRenderedLine[idx]` 跟踪了当前显示的行，可以直接用它。

### D. 在收藏按钮 handler 里加入行为采集（~第 3506 行）
在 `wpStar` 的 click handler 中，`vocab.push(...)` 之后加入：
```javascript
if (typeof TeachingModule !== 'undefined') {
  TeachingModule.onWordSave(popupCurrentWord, popupCurrentCefr, lastRenderedLine[currentIdx] || 0);
}
```

### E. 添加 seeked 事件监听（回放检测）
在音频事件监听区域（~第 3060-3080 行），加入：
```javascript
audio.addEventListener('seeked', () => {
  if (currentIdx === idx && typeof TeachingModule !== 'undefined') {
    TeachingModule.onReplay(audio.currentTime);
  }
});
```

### F. 添加全局回调函数 onTeachingDismiss
```javascript
// 教学完成回调——恢复 feed 流 auto-advance
window.onTeachingDismiss = function(clipIndex) {
  const nextIdx = clipIndex + 1;
  if (nextIdx < total) {
    screens[nextIdx].scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => playClip(nextIdx), 400);
  }
};
```

### G. 注意事项
- **不要改动现有功能的行为**。所有教学调用都用 `typeof TeachingModule !== 'undefined'` 做 guard，确保不引入 teaching-module.js 时一切照旧
- **scroll-snap 兼容**：TeachingModule 在 clip screen 后面插入 `.teaching-card`。需要确保这个 DOM 节点不干扰现有的 scroll-snap。最安全的方式是给 `.teaching-card` 设 `scroll-snap-align: start`（参与 snap）或用 `position: fixed` overlay。请根据现有 CSS 判断最佳方案
- **音频状态**：教学流期间用户不应该被自动推进到下一个 clip。`ended` handler 的拦截已确保这一点
- 测试 data.json 是否有 teaching 字段决定教学是否生效——对没有 teaching 字段的 clip，`onClipEnd` 返回 `false`，一切照旧
```

---

### Prompt 4: 前端 — 教学 UI 样式

```
为 Flipod 的教学模块编写 CSS 样式，内联到 index.html 的 `<style>` 标签中。

**现有设计语言**（从 index.html 提取）：
- 深色主题：背景 #111, 文字 #eee, 强调色 #0af
- 字体：system-ui
- 卡片圆角：12px
- 间距系统：8px 基础倍数
- 已有 `.content-screen` 使用 scroll-snap-align: start, 全屏高度 100dvh

**需要覆盖的 class**（TeachingModule 生成的 DOM 结构）：

1. `.teaching-card` — 教学卡片容器，插入在 clip screen 之后
   - 全屏高度，scroll-snap-align: start（或 none，取决于集成方案）
   - 深色背景，垂直居中内容
   - 进入动画：从底部滑入（opacity 0→1, translateY 20→0）
   - `.teaching-exit` 退出动画

2. `.teaching-phase` — 每个阶段的内容块
3. `.teaching-header` — 标题行（阶段标签 + 跳过按钮）
4. `.teaching-phase-label` — 阶段标签（"理解检测""本段词汇"等）
5. `.teaching-skip` — 跳过按钮（低调，不抢视线）

6. `.teaching-gist` — Gist 题
   - `.teaching-question` — 题目文本
   - `.teaching-options` — 选项列表
   - `.teaching-option` — 单个选项按钮（大面积可点击区域，圆角）
   - `.teaching-option.correct` — 正确选项（绿色边框/背景）
   - `.teaching-option.wrong` — 错误选项（红色边框 + 抖动动画）
   - `.teaching-feedback` — 反馈区
   - `.feedback-correct` / `.feedback-wrong` — 正确/错误反馈样式
   - `.teaching-relisten` — 重听按钮

7. `.teaching-vocab` — 词汇卡片
   - `.teaching-word-card` — 单个词卡（间距、分隔线）
   - `.word-header` — 词头（词 + CEFR badge + 行为标签）
   - `.word-text` — 词本体（加粗，稍大字号）
   - `.word-cefr` — CEFR 等级标签（小圆角 pill）
   - `.cefr-a1` 到 `.cefr-c2` — 各等级颜色
   - `.word-behavior-tag` — "你查过这个词" 标签
   - `.word-context` — 英文上下文（斜体，引号）
   - `.word-context-zh` — 中文释义
   - `.word-definition` — 释义
   - `.word-save-btn` — 加入生词本按钮
   - `.word-saved` — 已收藏状态
   - `.teaching-cta` — "练习这些词汇 →" 按钮（主色按钮）

8. `.teaching-exercise` — 练习
   - `.word-bank` — 词库区（横向排列的词按钮）
   - `.bank-word` — 单个词按钮
   - `.bank-word.used` — 已使用（灰化）
   - `.bank-word.wrong-shake` — 选错抖动
   - `.exercise-sentence` — 题干句子
   - `.exercise-progress` — 进度指示（1/4）
   - `.exercise-feedback .correct` / `.wrong` — 正确/错误

9. `.teaching-summary` — 总结
   - `.summary-stats` — 统计信息
   - `.summary-words` — 词汇列表
   - `.summary-word` — 单个词 pill
   - `.save-all-btn` — 全部收藏按钮
   - `.teaching-reflection` — 反思区
   - `.reflection-prompt` — 提示文案
   - `.reflection-option` — 反思选项
   - `.reflection-option.selected` — 已选中
   - `.teaching-next` — 下一个 clip 按钮

10. `.teaching-mini` — 折叠态
    - `.mini-entry-btn` — "学一下？" 按钮（小巧，低调）

**设计原则**：
- 教学卡片的视觉层次应低于 clip 内容本身——用户首先是来听播客的
- 过渡要平滑，避免突兀的弹窗感
- 移动端优先（max-width 按 375px 设计，宽屏居中 max-width 500px）
- 参考现有 index.html 中 `.word-popup`、`.feed-card-screen`、`.progress-card` 的样式风格
```

---

### Prompt 5: Pipeline — CEFR 标注修复

```
修复 data.json 中的 CEFR 标注问题。

**问题描述**：
现有 CEFR 标注使用 CEFR-J + Octanove 词表（`cefr_wordlist.json`），但不在词表中的词会被 LLM fallback 标注，导致常见词被错误标成高级。

已发现的 bug 示例：
- Brad, Florida, Reese's, Hershey → C2（应为专有名词，不标等级或标最低）
- house → C2（应为 A1）
- spending → C2（应为 B1）
- everything → C1（应为 A1）
- until → C1（应为 A1）

**修复方案**：

1. **专有名词检测**：如果一个词在原文中大写开头（首词除外）且不在 cefr_wordlist.json 中，标记为 `"cefr": "PN"`（proper noun）而非回退到 LLM

2. **常见词兜底**：建一个 ~200 词的 hardcoded 补丁表，覆盖高频基础词：
   - 所有代词 (I, you, he, she, it, we, they, me, my...) → A1
   - 常见连词 (and, but, or, because, until, while, although...) → A1-A2
   - 高频名词 (house, school, money, time, people, family...) → A1
   - 高频动词 (go, come, make, take, get, give, know...) → A1
   - 高频形容词 (good, bad, big, small, new, old, young...) → A1
   这些词无论 LLM 怎么标，都强制覆盖

3. **应用顺序**：cefr_wordlist.json 查表 → hardcoded 补丁表 → 专有名词检测 → LLM fallback

修改现有的 `tools/retag_cefr_all_clips.py` 实现以上逻辑。同时更新 data.json 中所有 clip 的 words[].cefr。

项目约束请阅读 `.claude/CLAUDE.md`，特别注意 CEFR 词表相关的说明。
```

---

### Prompt 6: 端到端测试

```
为 Flipod 教学系统编写测试。

**测试 1：Pipeline 输出校验**（Python）
创建 `scripts/tests/test_teaching_output.py`：
- 加载带 teaching 字段的 data.json
- 对每个 clip 校验：
  - difficulty.wpm 在 80-220 之间（合理语速范围）
  - difficulty.level 是五档之一
  - difficulty.cefr_distribution 各值之和 ≈ 1.0（±0.05）
  - gist.options 恰好 1 个 correct
  - 每个 difficulty_variant 的 options 也恰好 1 个 correct
  - word_pool 每层的 word 都能在 clip.lines[].words[] 中找到
  - word_pool 每层的 line_index 在 lines[] 范围内
  - exercises.fill_blank.sets[].items[].answer 在对应 word_bank 中
  - exercises.fill_blank.sets[].items[].answer_index 指向 word_bank 中正确位置

**测试 2：前端集成冒烟测试**（手动测试清单）
生成一个 `TESTING-CHECKLIST.md` 文件，包含：
- [ ] 加载页面，确认没有 JS 错误
- [ ] 播放一个有 teaching 字段的 clip，确认 ended 后出现 Gist 题
- [ ] 播放一个没有 teaching 字段的 clip，确认 ended 后正常 auto-advance
- [ ] 听中点一个词，确认词弹窗正常 + 教学模块记录了行为
- [ ] 收藏一个词，确认 flipodVocab 更新 + 教学模块记录了收藏
- [ ] Gist 题答对 → 反馈 → 自动进入词汇卡
- [ ] Gist 题答错 → 提示 + 重听按钮 → 重新作答
- [ ] 词汇卡显示至少 1 个带"你查过这个词"标签的词
- [ ] 点"练习这些词汇" → 填空题出现
- [ ] 填空全部答对 → 进入总结
- [ ] 总结页有正确的统计信息
- [ ] 反思选项可点击
- [ ] 点"下一个 clip →" → 教学卡消失 → 正常 auto-advance
- [ ] 连续跳过 3 个 clip 的教学 → 第 4 个只显示"学一下？"mini 入口
- [ ] 点 mini 入口 → 展开完整教学流
```

---

## 五、执行顺序建议

```
Phase A：Pipeline（可独立进行）
  1. Prompt 5 — 修复 CEFR 标注    ← 先做，因为教学内容依赖正确的 CEFR
  2. Prompt 1 — 生成教学内容
  3. Prompt 2 — 合并到 data.json

Phase B：前端（依赖 Phase A 的输出，但可先用 mock 数据）
  4. Prompt 4 — CSS 样式          ← 可与 Prompt 3 并行
  5. Prompt 3 — 集成教学模块
  6. Prompt 6 — 测试

并行策略：
  - Phase A 的 1+2+3 串行
  - Phase B 的 4 可以和 Phase A 并行（不依赖数据）
  - Phase B 的 5 需要 teaching-module.js 就绪（已完成）
  - 如果不想等 Phase A，可以手动给 1 个 clip 写 teaching 字段作为 mock 数据，先推进前端
```

---

## 六、Mock 数据快速启动

如果想先跑前端不等 pipeline，在 data.json 的第 4 个 clip（Hidden Brain, 被债务淹没的体面人生）上手动加入 teaching 字段。完整示例见 `SCHEMA-EXTENSION.md` 底部和 `TEACHING-EXAMPLE-B1.md`。

只需给 1 个 clip 加 teaching 即可跑通前端全流程——其他 clip 没有 teaching 字段时 `onClipEnd` 返回 `false`，走原逻辑。
