# Claude Code Brief · Addendum · Round 1 QA 必修清单

> 2026-04-17 · Jamesvd · Round 1 全量 QA 跑完（报告见 `docs/qa/QA-report-v3-round-1.md`），总共 43 个问题。这份 brief 只列 **9 条打包前必须修的**——测试环境独有的 bug（7 条）写进 handoff backup 了不用管；pencil 视觉精修（14 条）这轮跳过。这 9 条修完直接打包推 GitHub（Direction A：独立仓 + feature-specs），AI 算法团队接手 RN 重写。

---

## 总览

| # | Bug ID | 优先级 | 涉及任务 | 一句话 |
|---|--------|-------|---------|--------|
| 1 | B36 / B11 | P0 | Task G | Priming 选词逻辑反了，选了最简单的 A2 词而不是最难的 |
| 2 | B41 | P0 | Task E | Pass 4 MCQ 没做必答门控，不选答案也能返回列表 |
| 3 | B16 | P1 | Task E | 练习 Tab 生成失败 / pending 状态没 UI，只有空白 |
| 4 | B17 | P1 | Task F | 生成的练习卡片没有 category tag（右上角空白） |
| 5 | B18 | P1 | Task E | 练习生成中无 skeleton，用户不知道在等什么 |
| 6 | B33 | P1 | Task G | Priming 词点击无反馈（不弹词典） |
| 7 | B37 | P1 | Task F | Pass 4 MCQ 选项数不固定（有时 2 个有时 3 个） |
| 8 | B38 | P1 | Task F | Review 页只显示 target words，遗漏短文里其他 ≥ 用户等级的生词 |
| 9 | B40 | P1 | Task F | MCQ 错选答案没有解释反馈 |

注：B37 和 B40 实际是同一个 prompt 层的问题，合并处理；B38 牵涉到 Task F 返回体结构——这三个 bug 的 prompt 侧修改详见 `CC-BRIEF-TaskF-prompt-amendments.md`，这里只管前端消费逻辑。

---

## Bug 1 · B36 / B11 · Priming 选词逻辑反了

### 现象

打开纯听 Tab 任意卡片（mock B1 用户 + 兴趣 business/psychology/science），priming 区显示的三个词是：

```
scroll | elusive | federal
```

`elusive` 是 B2，`federal` 是 B1，这两个正确。但 `scroll` 是 A2——远低于用户等级，根本不是"高难词预先暴露"而是"用户早就会的词"。B1 卡片（如《美联储加息》）里明明有 `monetary`/`resilience`/`yield`/`hike` 等 B2+ 词没被选中。

### 根因

`generate_priming` 的过滤逻辑应该是**选出 clip 里 CEFR 最高的 2-3 个词**，现在看起来是**选出 CEFR 最低的几个**——排序方向反了，或者阈值判断用了 `<=` 应该是 `>=`。

### 修复

定位 `generate_priming`（应该在 `podcast_agent.py` 或 `tools/generate_priming.py` 里；也可能在 `server/dev_server.js` 的 `/data.json` 构造阶段）：

```python
# 当前（错误）——伪代码
candidates = [w for w in clip_words if cefr_rank(w.cefr) <= user_level_rank]
priming = sorted(candidates, key=lambda w: cefr_rank(w.cefr))[:3]

# 改为
user_rank = cefr_rank(user_level)  # B1 = 2
candidates = [w for w in clip_words
              if cefr_rank(w.cefr) >= user_rank + 1  # 至少比用户等级高一级
              and w.cefr not in ('A1', 'A2')]        # 硬排除 A1/A2
# 如果够不到 2 个，放宽到 user_rank（同级但稀有）但仍然排除 A1/A2
priming = sorted(candidates, key=lambda w: -cefr_rank(w.cefr))[:3]  # 从高到低
```

**CEFR rank 映射**：`A1=0, A2=1, B1=2, B2=3, C1=4, C2=5`

### 校验

Mock B1 用户打开《美联储加息与经济韧性》，priming 应该是 `monetary` / `resilience` / `hike` / `yield` 这类 B2 词，**不应该**出现 `scroll` / `couple` / `afternoon` / `add` 这种 A1-A2 词。

全量复跑：`python podcast_agent.py --regenerate-priming-only` 或等价命令，重写所有 clip 的 `priming` 字段到 `data.json`。

### 边界

- 如果某个 clip 里真的没有高于用户等级的词（很少见），priming 允许为空数组——前端已处理空数组（不显示 priming 区即可）
- 不要把 target_words 也加进 priming——这两个是不同的显示区域

---

## Bug 2 · B41 · Pass 4 MCQ 没做必答门控

### 现象

Pass 4 结束看到 MCQ 题 + "返回列表" 按钮。不选任何选项、直接点"返回列表"能走通——这违反 PRD 第七章"Pass 4 必须答题才能标记为完成"的设计。

### 根因

`listening-practice.js` 里 Pass 4 的"返回列表"按钮没检查 `mcqAnswered` 状态，也没把"答题完成"作为完成条件之一。

### 修复

定位 Pass 4 渲染代码（`_renderPass(4, ...)` 或 `renderReview`），给"返回列表"按钮加状态判断：

```js
// 渲染时
const backBtn = document.querySelector('.p4-back-btn');
backBtn.disabled = !state.currentPractice.mcqAnswered;
backBtn.title = state.currentPractice.mcqAnswered
  ? ''
  : '请先选择一个答案';

// MCQ onclick 里答对或答错都算"已答"
function onMcqAnswer(practice, selectedIdx) {
  practice.mcqAnswered = true;
  practice.mcqSelectedIdx = selectedIdx;
  practice.mcqCorrect = (selectedIdx === practice.correctIdx);
  // 展示反馈 UI（B40 的修复会在这里加解释文本）
  savePracticeState();
  renderReview(practice);  // 重渲染，让返回按钮解锁
}
```

**UI 上**：未答时按钮灰掉，hover 提示"请先选择一个答案"；答完变为亮色可点。不要用 `alert`——体验差。

### 校验

- 进入 Pass 4 不选答案点"返回列表"→ 按钮灰色，点不动 ✓
- 选任一答案 → 按钮立即变亮，可返回 ✓
- 返回后 practice 卡片状态应该标记为"已完成"（对勾标记或移到"已完成"分组）

### 边界

- 不要强制答对才能返回——答错也算完成（学习过程允许犯错）
- 如果 MCQ 本身没渲染出来（B37 未修前），暂时降级为"Pass 4 播放完即可返回"；等 B37 修完再完整启用必答门控

---

## Bug 3 · B16 · 练习 Tab pending/failed 状态无 UI

### 现象

练习 Tab 在"生成中"或"生成失败"时，列表区域一片空白，用户不知道系统在干什么。目前只有 `ready` 状态有 UI。

### 根因

`renderPracticeTab`（或类似名字）直接 `state.pendingPractices.map(renderCard)`——如果 pendingPractices 是空（因为还在生成）或者 generateBatch 抛错，就什么都不渲染。

### 修复

引入显式状态机，4 个状态各自有对应 UI：

```js
// listening-practice.js
const PRACTICE_VIEW_STATE = {
  LOCKED: 'locked',        // 生词本 < 5
  GENERATING: 'generating', // 正在调 /api/practice/generate
  FAILED: 'failed',         // 最近一次生成失败
  READY: 'ready',           // 有 pending 练习
};

function getPracticeViewState(vocab, state) {
  if (vocab.length < 5) return PRACTICE_VIEW_STATE.LOCKED;
  if (state.generating) return PRACTICE_VIEW_STATE.GENERATING;
  if (state.lastGenerationError && state.pendingPractices.length === 0) {
    return PRACTICE_VIEW_STATE.FAILED;
  }
  return PRACTICE_VIEW_STATE.READY;
}

function renderPracticeTab() {
  const vocab = getVocab();
  const state = getPracticeState();
  const view = getPracticeViewState(vocab, state);
  switch (view) {
    case PRACTICE_VIEW_STATE.LOCKED:
      return renderLockedHint(vocab.length);  // "再收藏 N 个词解锁练习"
    case PRACTICE_VIEW_STATE.GENERATING:
      return renderGeneratingSkeleton();      // B18 的 skeleton
    case PRACTICE_VIEW_STATE.FAILED:
      return renderGenerationFailed(state.lastGenerationError);
    case PRACTICE_VIEW_STATE.READY:
      return renderPracticeList(state.pendingPractices);
  }
}
```

**状态写入**（在 `refreshGeneration` / `fetchGeneratedPractice` 里）：

```js
async function refreshGeneration() {
  const state = getPracticeState();
  state.generating = true;
  state.lastGenerationError = null;
  savePracticeState();
  renderPracticeTab();  // 立即显示 skeleton
  try {
    const batch = await generateBatch(...);
    state.pendingPractices.push(...batch);
    state.generating = false;
    savePracticeState();
  } catch (e) {
    state.generating = false;
    state.lastGenerationError = { msg: e.message, ts: Date.now() };
    savePracticeState();
  }
  renderPracticeTab();
}
```

**Failed 状态 UI**：展示"AI 生成失败了，[重试] 或稍后再试"——点重试 → 再调 `refreshGeneration`。

### 校验

- 新用户刚收藏第 5 个词切练习 Tab → 立即看到 skeleton ✓
- 断网情况下重试 → 看到"生成失败"+ 重试按钮 ✓
- 重试后网络恢复 → skeleton → 正常列表 ✓
- 已有 2 个 pending 的情况下后台补给生成失败 → 列表仍显示现有 2 个，但可加小 toast 提示"补给失败"（不影响主体验）

---

## Bug 4 · B17 · 练习卡片缺 category tag

### 现象

练习 Tab 里每张卡片右上角按设计应该有一个 category tag（business / psychology / science / tech 等）用于视觉区分，现在这个位置空白。

### 根因

前端 `renderPracticeCard` 里有 `<span class="cat-tag">${practice.category}</span>` 但 `practice.category` 是 `undefined`——Task F 的 LLM 响应里目前没有 `category` 字段。

### 修复

**这是 Task F prompt 要改 + 前端读字段两步**：

**前端侧**（本 brief 处理）：

```js
// renderPracticeCard
const category = practice.category || inferCategoryFromWords(practice.target_words);

function inferCategoryFromWords(words) {
  // 兜底：如果 F 的 prompt 没改完，从词的 tag 里推断
  const tagCounts = {};
  words.forEach(w => {
    if (w.tag) tagCounts[w.tag] = (tagCounts[w.tag] || 0) + 1;
  });
  const top = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'general';
}
```

**后端 prompt 侧**：详见 `CC-BRIEF-TaskF-prompt-amendments.md`——让 LLM 返回 `category` 字段。

### 校验

- 前端渲染健壮性：即便 Task F 那边还没改完，`inferCategoryFromWords` 兜底能让标签显示出来，不留空白
- Task F 改完后，`practice.category` 直接可用，标签颜色按 category 映射

### 边界

- category 值必须在预定义集合内（`['business', 'psychology', 'science', 'tech', 'culture', 'general']`）——不在集合内的退回 `general`
- 别写死颜色——用 CSS class `.cat-tag-business` / `.cat-tag-psychology` 等，让视觉层自由换色

---

## Bug 5 · B18 · 练习生成中无 skeleton

### 现象

切到练习 Tab、正好在生成中，用户只看到空白。没有 loading 动画，没有文案，什么都没有。

### 根因

同 B16——GENERATING 状态没 UI。这条是 B16 的 UI 具体实现。

### 修复

`renderGeneratingSkeleton`：

```js
function renderGeneratingSkeleton() {
  return `
    <div class="practice-skeleton">
      <div class="sk-card">
        <div class="sk-line sk-title"></div>
        <div class="sk-line sk-meta"></div>
        <div class="sk-line sk-body"></div>
        <div class="sk-line sk-body"></div>
      </div>
      <div class="sk-card">
        <div class="sk-line sk-title"></div>
        <div class="sk-line sk-meta"></div>
        <div class="sk-line sk-body"></div>
        <div class="sk-line sk-body"></div>
      </div>
      <div class="sk-hint">
        <span class="sk-spinner"></span>
        AI 正在为你生成练习...
      </div>
    </div>
  `;
}
```

**CSS**：

```css
.sk-line {
  background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%);
  background-size: 200% 100%;
  animation: sk-pulse 1.4s infinite;
  border-radius: 6px;
  height: 14px;
  margin: 8px 0;
}
.sk-title { width: 60%; height: 20px; }
.sk-meta  { width: 40%; height: 12px; }
.sk-body  { width: 95%; }
.sk-spinner {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid #ccc; border-top-color: #1a1a1a;
  border-radius: 50%; animation: sk-spin 0.8s linear infinite;
  margin-right: 8px; vertical-align: middle;
}
@keyframes sk-pulse { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
@keyframes sk-spin  { to { transform: rotate(360deg) } }
```

### 校验

- 切练习 Tab 在生成中 → 立刻看到 2 张骨架卡 + "AI 正在为你生成练习..." ✓
- 生成完成 → 骨架自动替换为真实卡片（renderPracticeTab 重渲染） ✓
- 在生成中期间切走 Tab 再切回来 → 仍然是骨架（状态持久） ✓

---

## Bug 6 · B33 · Priming 词点击无反馈

### 现象

纯听 Tab 卡片上的 priming 三个词点上去毫无反应——既不弹词典也不播发音。

### 根因

`.priming-zone .pz-word` 元素没绑 click handler，或者 handler 里的逻辑是 placeholder。

### 修复

给 priming 词加轻量 tooltip，点击 → 弹一个卡片气泡显示词典内容：

```html
<span class="pz-word"
      data-word="elusive"
      data-zh="难捉摸"
      data-cefr="B2"
      data-ipa="/ɪˈluːsɪv/">elusive 难捉摸</span>
```

```js
document.addEventListener('click', (e) => {
  const el = e.target.closest('.pz-word');
  if (!el) return;
  e.stopPropagation();
  showPrimingTooltip(el);
});

function showPrimingTooltip(el) {
  closeAllTooltips();
  const rect = el.getBoundingClientRect();
  const tip = document.createElement('div');
  tip.className = 'pz-tooltip';
  tip.innerHTML = `
    <div class="tip-word">${el.dataset.word}
      <span class="tip-cefr">${el.dataset.cefr || ''}</span>
    </div>
    <div class="tip-ipa">${el.dataset.ipa || ''}</div>
    <div class="tip-zh">${el.dataset.zh}</div>
    <button class="tip-save" data-word="${el.dataset.word}">收藏</button>
  `;
  tip.style.top = `${rect.bottom + window.scrollY + 6}px`;
  tip.style.left = `${rect.left + window.scrollX}px`;
  document.body.appendChild(tip);

  tip.querySelector('.tip-save').onclick = () => {
    addWordToVocab({
      word: el.dataset.word,
      cefr: el.dataset.cefr,
      zh: el.dataset.zh,
      ipa: el.dataset.ipa,
      tag: getCurrentClipTag(),
      savedAt: Date.now(),
    });
    tip.querySelector('.tip-save').textContent = '已收藏';
    tip.querySelector('.tip-save').disabled = true;
  };

  setTimeout(() => {
    document.addEventListener('click', closeAllTooltips, { once: true });
  }, 0);
}

function closeAllTooltips() {
  document.querySelectorAll('.pz-tooltip').forEach(t => t.remove());
}
```

**CSS**：tooltip 绝对定位，白底阴影，max-width 240px，z-index 高于 clip 卡。

### 校验

- 点 priming 词 → 弹出气泡显示词 + 音标 + 中文 + 收藏按钮 ✓
- 点气泡外任意处 → 气泡关闭 ✓
- 点收藏 → 写 vocab + 按钮变"已收藏" ✓
- 点另一个 priming 词 → 旧气泡关闭，新气泡打开（closeAllTooltips 先跑） ✓
- 已在生词本里的词点开 → 按钮应显示"已收藏"（可选：检查 vocab 是否存在）

### 边界

- 不做语音（TTS 调用太重，priming 交互要轻）
- 不做详细释义（词典 API 不是 v3 目标），只展示 data-* attrs 里已有的字段

---

## Bug 7 · B37 · Pass 4 MCQ 选项数不固定

### 现象

Pass 4 的 MCQ 有时候显示 2 个选项有时候 3 个，规格说应该是**4 选 1**，不稳定。

### 根因

Task F 的 LLM 响应里 `mcq.options` 数组长度不稳定——有时 LLM 只返回 2 个干扰项，有时 3 个。prompt 没硬约束选项数。

### 修复

**Prompt 侧**（详见 `CC-BRIEF-TaskF-prompt-amendments.md`）：硬约束 `options` 必须 4 个，并把现在的 `gist_options_zh`（3 个）重构为 `mcq.options`（4 个）。

**前端侧**（本 brief 处理）：加容错，LLM 给多了或少了都能工作：

```js
function normalizeMcq(practice) {
  if (!practice.mcq || !Array.isArray(practice.mcq.options)) {
    // 彻底缺失的情况——从旧字段迁移
    if (Array.isArray(practice.gist_options_zh) && practice.gist_options_zh.length >= 3) {
      practice.mcq = {
        q: 'What is the main point of this passage?',
        options: practice.gist_options_zh.slice(0, 4),
        correct: 0,
        explanation: '',
      };
    } else {
      practice.mcq = null;  // Pass 4 就不出 MCQ，只播完即可
      return;
    }
  }
  // 选项多了截到 4，少了补占位（LLM 偶发返回 3 个）
  if (practice.mcq.options.length > 4) {
    practice.mcq.options = practice.mcq.options.slice(0, 4);
  }
  while (practice.mcq.options.length < 4) {
    practice.mcq.options.push('— 无此选项 —');  // 不可选占位
  }
}
```

在 `renderReview` 或 Pass 4 渲染入口调 `normalizeMcq(practice)`。

**渲染**：选项渲染时，文本是 `— 无此选项 —` 的 disabled。

### 校验

- 正常 4 选项 → 正常渲染 ✓
- LLM 返回 3 选项 → 渲染 3 个真实 + 1 个 disabled 占位 ✓
- LLM 完全缺 mcq → Pass 4 不显示 MCQ，播完直接允许返回（回落到旧行为） ✓

---

## Bug 8 · B38 · Review 页只显示 target words

### 现象

Pass 4 Review 页的"生词回顾"只列出原本的 3 个 target words，没列出短文里其他同样 ≥ 用户等级的生词。用户在短文里新学到的词就这么丢了。

### 根因

Task F 响应里只有 `target_word_contexts`，没有全文的生词扫描结果。前端也只读 `target_word_contexts`。

### 修复

**Prompt 侧**（详见 `CC-BRIEF-TaskF-prompt-amendments.md`）：增加 `vocab_in_text` 字段，让 LLM 额外返回短文里所有 CEFR ≥ 用户等级的词（去重，不含 target words 本身）。

**前端侧**（本 brief 处理）：

```js
function renderReviewVocab(practice) {
  const target = practice.target_word_contexts || [];
  const extra  = practice.vocab_in_text || [];  // 新字段
  const all = [...target.map(t => ({ ...t, isTarget: true })),
               ...extra.map(e => ({ ...e, isTarget: false }))];
  // 去重（保留 target 版本优先，它有更详细的 definition）
  const seen = new Set();
  const deduped = all.filter(w => {
    const k = w.word.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.map(w => `
    <div class="rv-word ${w.isTarget ? 'is-target' : ''}">
      <span class="rv-w">${w.word}</span>
      ${w.isTarget ? '<span class="rv-badge">目标词</span>' : ''}
      <span class="rv-cefr">${w.cefr || ''}</span>
      <span class="rv-zh">${w.definition_zh || w.zh || ''}</span>
      <button class="rv-save" data-word="${w.word}">收藏</button>
    </div>
  `).join('');
}
```

**兜底**：如果 `vocab_in_text` 不存在（Task F 还没改完），就退回只显示 target words——不要崩。

### 校验

- B1 用户的 practice，Review 页应看到 3 个 target + 2-6 个 extra（≥B1 其他词）
- 重复词不重复显示
- 收藏按钮对 target 和 extra 同效
- Task F 没改完时，前端应只显示 target words，无 JS 错误

### 边界

- 不要把用户已收藏的词再显示为"待收藏"——可选进一步优化（查 vocab 标红"已收藏"），P2 再做
- 不做频度/难度排序——按原文出现顺序即可

---

## Bug 9 · B40 · MCQ 错选无解释反馈

### 现象

Pass 4 MCQ 选错了没有反馈——既不提示错，也没说正确答案是什么，更没解释为什么。

### 根因

`mcq.explanation` 字段 LLM 没返回，前端也没 UI 位展示。

### 修复

**Prompt 侧**（详见 `CC-BRIEF-TaskF-prompt-amendments.md`）：加 `mcq.explanation` 字段，15-40 字中文，说明正确答案为什么对。

**前端侧**（本 brief 处理）：

```js
function onMcqAnswer(practice, selectedIdx) {
  practice.mcqAnswered = true;
  practice.mcqSelectedIdx = selectedIdx;
  practice.mcqCorrect = (selectedIdx === practice.mcq.correct);
  savePracticeState();
  renderMcqFeedback(practice);
}

function renderMcqFeedback(practice) {
  const container = document.querySelector('.mcq-feedback');
  const correctIdx = practice.mcq.correct;
  const selected = practice.mcqSelectedIdx;
  const isCorrect = practice.mcqCorrect;

  // 选项高亮：选错的红，正确的绿
  document.querySelectorAll('.mcq-option').forEach((el, i) => {
    el.classList.remove('opt-correct', 'opt-wrong', 'opt-user');
    if (i === correctIdx) el.classList.add('opt-correct');
    if (i === selected && !isCorrect) el.classList.add('opt-wrong');
    if (i === selected) el.classList.add('opt-user');
    el.style.pointerEvents = 'none';  // 锁定不能再改
  });

  container.innerHTML = `
    <div class="fb-header ${isCorrect ? 'fb-ok' : 'fb-ng'}">
      ${isCorrect ? '答对了' : '答错了'}
    </div>
    <div class="fb-answer">
      正确答案：<strong>${String.fromCharCode(65 + correctIdx)}. ${practice.mcq.options[correctIdx]}</strong>
    </div>
    ${practice.mcq.explanation ? `<div class="fb-exp">${practice.mcq.explanation}</div>` : ''}
  `;

  // 解锁"返回列表"按钮（B41）
  document.querySelector('.p4-back-btn').disabled = false;
}
```

**CSS**：`.opt-correct { border-left: 3px solid #10b981; background: #ecfdf5 }` / `.opt-wrong { border-left: 3px solid #ef4444; background: #fef2f2 }` 等。

### 校验

- 答对 → 绿色横条"答对了" + 正确答案高亮绿 + explanation ✓
- 答错 → 红色横条"答错了" + 错选红色 + 正确答案绿色 + explanation ✓
- 任一答题后选项不可再改 ✓
- 返回按钮解锁 ✓
- Task F 没返回 explanation 时 → 不显示 .fb-exp 区，整体 UI 不崩 ✓

---

## 合并顺序建议

按依赖关系：

1. **先 Task F prompt 改**（另一个 brief，`CC-BRIEF-TaskF-prompt-amendments.md`）——让新字段进响应
2. 然后合并本 brief 的 9 条 Code 侧修复
3. B28 的 rate 注入（第三个 brief，`CC-BRIEF-TaskD-rate-injection-correction.md`）单独 PR，和本 brief 无依赖

建议拆 2 个 PR：
- `fix/round-1-product-bugs`（本 brief 的 9 条）
- `fix/round-1-taskf-prompt`（Task F prompt 的改动，让本 brief 能用到新字段）

---

## 非目标

- **不做 pencil 视觉精修**——14 条 Design bugs 这轮跳过（TestFlight RN 重写时设计侧重新校准）
- **不修测试环境独有 bug**——B1/B2/B3/B4/B9/B28/B29 这 7 条写进 handoff backup，等 TestFlight 跑到再看
- **不动 Task C/D/E/G 的已合并主干**——本 brief 是 round-1 round 的 follow-up fixes，不重构
- **不改 data.json schema**——priming 重生成不改字段只改值

---

## 校验清单（合 PR 前）

- [ ] B36 / B11：B1 mock 用户打开《美联储加息》看到 priming 是 B2 级的词不是 A2
- [ ] B41：Pass 4 不选答案返回按钮灰
- [ ] B16：切练习 Tab 在生成中立即看到 skeleton
- [ ] B17：练习卡片右上角有 category tag
- [ ] B18：skeleton 有动画有文案
- [ ] B33：priming 词点击弹 tooltip
- [ ] B37：MCQ 稳定 4 选项（或缺失兜底）
- [ ] B38：Review 页看到 target + extra 两组词
- [ ] B40：答错有红色反馈 + 正确答案 + 解释
- [ ] 跑一次完整四关 + Review，截图附 PR，对比 `docs/qa/QA-report-v3-round-1.md` 里的 baseline 截图组

---

## 问题升级

- 如果 B36 改了之后某些 clip 的 priming 还是空（没有高于用户等级的词）→ 决定是放宽到同级稀有词还是允许空 → 问 Jamesvd
- 如果 B16 的状态机引入破坏了已有 render 的节流/防抖 → 保留旧的 render 主函数作为 READY 分支的实现，其他状态新增
- Task F 的 prompt 改后 LLM 偶发不返回 `vocab_in_text` → 前端必须健壮兜底到只显示 target words，不能崩
- 任意一条修复引入 regression（QA Green List 14 项之一失效）→ 回滚该条，单独拉 issue

---

## 交付

- 1-2 个 PR
- PR 描述贴每条 bug 的 before/after 截图（或至少 after 截图）
- 合并后 tag `v3-round-1-fixed`，Jamesvd 跑 Round 2 QA

跑完 Round 2 没有 regression 即打包推 GitHub（Direction A：独立仓 + feature-specs），AI 算法团队接手 RN 重写 → TestFlight。
