# Claude Code Brief · Task D + E · CEFR 适配表落地 + UI 漏斗重构

> 2026-04-17 · Jamesvd · 在 Task C 之后或并行（D 不依赖 C 的输出，但 E 不依赖 D）。建议拆两个 PR：`feat/cefr-adaptation-table-D` 和 `feat/funnel-ui-E`。

---

## 任务 D：CEFR 适配表代码落地

### 背景

PRD 第八章定义了"CEFR 适配规则"4 行表，v2 时这只是个文档表，运行时没有真正生效。v3 要让它在 `listening-practice.js` 里 4 个具体位置真实改变行为。

### 适配表（PRD 第八章原文）

| 用户 CEFR | TTS rate | Pass 4 review 题数 | Pass 3 渐隐密度 | Pass 4 replay 次数 |
|---|---|---|---|---|
| A2 | 0.85 | 2 | 每 5 个非目标词遮 1 个 | 允许 2 次 |
| B1 | 0.94 | 3 | 每 3 个非目标词遮 1 个 | 允许 1 次 |
| B2 | 1.00 | 4 | 每 2 个非目标词遮 1 个 | 不允许 |
| C1+ | 1.05 | 5 | 每 2 个遮 1 个 + 相邻词 | 不允许 |

A1 走 A2 这一行（fallback）。C2 走 C1+ 这一行。

### 落地 4 个点

**1. `clampLevel(userLevel) → adaptationRow`**

在 `listening-practice.js` 顶部加常量 + helper：

```js
const CEFR_ADAPTATION = {
  A2: { rate: 0.85, reviewCount: 2, fadeDensity: 5, maxReplay: 2 },
  B1: { rate: 0.94, reviewCount: 3, fadeDensity: 3, maxReplay: 1 },
  B2: { rate: 1.00, reviewCount: 4, fadeDensity: 2, maxReplay: 0 },
  C1: { rate: 1.05, reviewCount: 5, fadeDensity: 2, maxReplay: 0, fadeAdjacent: true },
};

function clampLevel(level) {
  if (!level) return CEFR_ADAPTATION.B1;  // 默认 B1
  const lv = String(level).toUpperCase();
  if (lv === 'A1' || lv === 'A2') return CEFR_ADAPTATION.A2;
  if (lv === 'B1') return CEFR_ADAPTATION.B1;
  if (lv === 'B2') return CEFR_ADAPTATION.B2;
  return CEFR_ADAPTATION.C1;  // C1, C2, anything else
}
```

**2. `speakText` 注入 rate**

现在 `speakText` 调 `/api/tts`，加 query param `?rate=<X>`：

```js
const userAdapt = clampLevel(getUserCefrLevel());
const url = `/api/tts?text=${encodeURIComponent(text)}&rate=${userAdapt.rate}`;
```

**注意**：服务端 TTS 要支持 `rate` param（如果用 OpenAI TTS 模型 `tts-1` / `tts-1-hd` 不直接支持 speed，可以前端用 `audio.playbackRate = userAdapt.rate` 实现，更省事，也保留服务端缓存）。**优先选 `audio.playbackRate` 方案**，避免改服务端缓存键导致旧缓存失效。

```js
// 在 _renderPass 创建 <audio> 之后
audio.playbackRate = userAdapt.rate;
audio.preservesPitch = true;  // Safari/Chrome 都支持
```

**3. `buildCaptionHtml` 在 Pass 3 应用 fadeDensity**

定位现有 Pass 3 渐隐渲染逻辑（应该在 `_renderPass` 或一个 `buildCaptionHtml(words, mode='fade-en')` 里），加密度参数：

```js
function buildFadeEnHtml(words, targetWordSet, density, fadeAdjacent=false) {
  // density = 5 → 每 5 个非目标词遮 1 个
  // fadeAdjacent = true → 被遮的词同时遮其前后词
  let nonTargetCount = 0;
  const fadeIndexes = new Set();
  words.forEach((w, i) => {
    if (targetWordSet.has(w.text.toLowerCase())) return;
    nonTargetCount++;
    if (nonTargetCount % density === 0) {
      fadeIndexes.add(i);
      if (fadeAdjacent) {
        if (i > 0) fadeIndexes.add(i - 1);
        if (i < words.length - 1) fadeIndexes.add(i + 1);
      }
    }
  });
  return words.map((w, i) =>
    fadeIndexes.has(i)
      ? `<span class="word-fade">${w.text}</span>`
      : `<span class="word">${w.text}</span>`
  ).join(' ');
}
```

调用时：

```js
const userAdapt = clampLevel(getUserCefrLevel());
const html = buildFadeEnHtml(words, targetWordSet, userAdapt.fadeDensity, userAdapt.fadeAdjacent);
```

**4. Pass 4 replay 次数限制**

定位 Pass 4 / Blind Pass 的 replay 按钮逻辑：

```js
// _renderBlindPass 内
const userAdapt = clampLevel(getUserCefrLevel());
let replayCount = 0;
const replayBtn = document.getElementById('blind-replay-btn');

function updateReplayBtn() {
  const remaining = userAdapt.maxReplay - replayCount;
  if (userAdapt.maxReplay === 0) {
    replayBtn.style.display = 'none';
    return;
  }
  if (remaining <= 0) {
    replayBtn.disabled = true;
    replayBtn.textContent = '已用完';
  } else {
    replayBtn.disabled = false;
    replayBtn.textContent = `重听（剩余 ${remaining} 次）`;
  }
}

replayBtn.onclick = () => {
  if (replayCount >= userAdapt.maxReplay) return;
  replayCount++;
  audio.currentTime = 0;
  audio.play();
  updateReplayBtn();
};
```

**Review 题数**：`buildReviewQuestions(targetWords, count)` 现在按 `userAdapt.reviewCount` 来选题数；如果目标词不够，按 `min(targetWords.length, reviewCount)`。

### D 任务校验

- [ ] A2 用户进 Pass 1，audio 播放速度肉眼明显比 B2 用户慢
- [ ] B1 用户进 Pass 3，渐隐密度比 B2 用户低
- [ ] B2 用户进 Pass 4，看不到 replay 按钮
- [ ] C1 用户进 Pass 3，被遮词的相邻词也遮
- [ ] localStorage 改 `flipodUserProfile.cefrLevel`，刷新页面，所有 4 个点行为同步变化

---

## 任务 E：UI 漏斗重构

### 背景

`index.html` 当前已有两 Tab 框架（line ~2420）：

```html
<div class="mode-tab-bar" id="mode-tab-bar">
  <button class="mode-tab" data-mode="listen" id="tab-listen">纯听</button>
  <button class="mode-tab is-active" data-mode="learn" id="tab-learn">学习</button>
</div>
```

但默认激活"学习"，且学习 Tab 走 v2 的 Phase 1-4 教学路径。E 任务把它彻底重构成 v3 漏斗。

### 改动清单

**E.1 Tab 重命名 + 默认切换**

```html
<div class="mode-tab-bar" id="mode-tab-bar">
  <button class="mode-tab is-active" data-mode="listen" id="tab-listen">纯听</button>
  <button class="mode-tab" data-mode="practice" id="tab-practice">练习</button>
</div>
```

- `data-mode="learn"` → `data-mode="practice"`
- id `tab-learn` → `tab-practice`
- 文案 "学习" → "练习"
- `is-active` 从 `tab-practice` 移到 `tab-listen`

JS 层（grep `mode-tab` 或 `data-mode`）：所有 `'learn'` 字符串替换成 `'practice'`，`localStorage.flipodMode` 默认值改 `'listen'`。

**E.2 删除所有 Phase 1-4 内嵌教学代码**

grep 关键词清单（出现的全部清理）：

```
Phase 1 / Phase 2 / Phase 3 / Phase 4
TeachingPlugin
teaching.gist
teaching.vocab
teaching.match
flipodTeachingLog
flipodKnownWords
flipodPracticeLog (注意：合并进 flipodPracticeState.completedPractices)
教学降级 / teachingDowngrade
gistQuestion / wordCard / matchPair
```

**预期会牵涉**：
- `index.html` 的 `<div class="teaching-panel">`、`<div class="phase-1">` ... 这类容器整段删
- 关联 CSS 类 `.teaching-*`、`.phase-*` 删
- JS 里 `renderPhase1` / `renderPhase2` ... 函数整段删
- `data.json` clip 的 `teaching` 字段不动（pipeline 不再产出，但旧字段留着不读就行）

**保留**：`clip.word_tapped`、`clip.word_saved`、`clip.replay` 等纯听 Feed 行为采集逻辑——这些 v3 仍在。

**E.3 练习 Tab 三态入口**

新建 `<div id="practice-tab-content">` 容器，内有三个互斥子视图：

```html
<div id="practice-tab-content" hidden>
  <!-- 未解锁 -->
  <div id="practice-locked" class="practice-state" hidden>
    <div class="practice-icon">🎧</div>
    <h2>解锁个性化训练</h2>
    <p>收藏 <strong id="practice-vocab-needed">5</strong> 个词，AI 会根据你的兴趣 + 生词本生成专属听力训练。</p>
    <div class="practice-progress">
      <div class="practice-progress-bar" id="practice-progress-bar"></div>
      <div class="practice-progress-text">
        <span id="practice-vocab-current">0</span> / 5
      </div>
    </div>
    <button class="practice-cta" onclick="switchTab('listen')">回到纯听找词</button>
  </div>

  <!-- 生成中 -->
  <div id="practice-generating" class="practice-state" hidden>
    <div class="practice-spinner"></div>
    <h2>正在为你生成…</h2>
    <p>AI 正在结合你的生词本、兴趣 tag 和当前水平，生成 2 段专属训练。预计 20 秒。</p>
  </div>

  <!-- 已就绪 -->
  <div id="practice-ready" class="practice-state" hidden>
    <h2>专属训练</h2>
    <div id="practice-pending-list" class="practice-list"></div>
    <h3 id="practice-completed-header" hidden>已完成</h3>
    <div id="practice-completed-list" class="practice-list"></div>
  </div>
</div>
```

状态切换逻辑（在 `switchTab('practice')` 时跑一次）：

```js
function refreshPracticeView() {
  const state = JSON.parse(localStorage.getItem('flipodPracticeState') || '{}');
  const vocab = JSON.parse(localStorage.getItem('flipodVocabBook') || '[]');
  const pending = state.pendingPractices || [];
  const completed = state.completedPractices || [];

  hideAllPracticeStates();
  if (vocab.length < 5 && pending.length === 0 && completed.length === 0) {
    document.getElementById('practice-vocab-current').textContent = vocab.length;
    document.getElementById('practice-progress-bar').style.width = `${Math.min(100, vocab.length * 20)}%`;
    show('practice-locked');
    track('practice.unlock_seen', { vocab_count: vocab.length, threshold: 5 });
  } else if (pending.length === 0 && completed.length === 0) {
    show('practice-generating');
    track('practice.generating_seen', { is_first_time: true });
    triggerInitialGeneration();  // 见 E.4
  } else {
    renderPracticeList(pending, completed);
    show('practice-ready');
    track('practice.list_seen', { pending_count: pending.length, completed_count: completed.length });
  }
}
```

**E.4 解锁触发 + 后台批生成**

监听生词本变化（在 `clip.word_saved` handler 里加）：

```js
function onVocabChanged() {
  const vocab = JSON.parse(localStorage.getItem('flipodVocabBook') || '[]');
  const state = JSON.parse(localStorage.getItem('flipodPracticeState') || '{}');
  const completed = (state.completedPractices || []).length;
  const pending = (state.pendingPractices || []).length;

  // 首次解锁
  if (vocab.length === 5 && pending === 0 && completed === 0) {
    showToast('🎉 解锁个性化训练！切到「练习」Tab 看看');
    track('profile.vocab_milestone', { count: 5, milestone: 'unlock' });
    triggerInitialGeneration();  // 后台生成 2 段，不阻塞 UI
  }
  // 后续补给
  else if (state.lastVocabCountAtGeneration && vocab.length - state.lastVocabCountAtGeneration >= 3) {
    if (pending < 6) triggerBatchGeneration();
  }
}
```

`triggerInitialGeneration` / `triggerBatchGeneration` 调 `listening-practice.js` 的 `generateBatch(2)` 现有 API（v3 重构后已存在）。

**E.5 Tab 切换中途行为**

```js
function switchTab(targetMode) {
  const currentMode = localStorage.getItem('flipodMode') || 'listen';
  if (currentMode === targetMode) return;

  // 中途练习保护
  if (currentMode === 'practice' && isPracticeInSession()) {
    if (!confirm('当前训练未完成，切换会中断。是否继续？')) return;
    pausePracticeSession();
  }

  // 纯听暂停（不自动恢复，让用户回来手动 play）
  if (currentMode === 'listen') {
    pauseAllClipAudio();
  }

  localStorage.setItem('flipodMode', targetMode);
  document.getElementById('tab-listen').classList.toggle('is-active', targetMode === 'listen');
  document.getElementById('tab-practice').classList.toggle('is-active', targetMode === 'practice');
  document.getElementById('feed').hidden = (targetMode !== 'listen');
  document.getElementById('practice-tab-content').hidden = (targetMode !== 'practice');

  if (targetMode === 'practice') refreshPracticeView();
  track('tab.switch', { from: currentMode, to: targetMode, mid_practice: currentMode === 'practice' && isPracticeInSession() });
}
```

**E.6 侧边菜单清理**

去掉以下三项（PRD 第十三章已写）：
- 🎧 听力练习 入口（line ~2314）
- 学习模式 toggle（菜单底部）
- `sp-practice-count` badge（已移到 Tab 上不需要）

保留：📚 我的收藏、📝 生词本、⚙️ 设置。

**E.7 Toast 引导（可选，做了更好）**

PRD 第六章提到的"funnel toast 触发"——在纯听 Tab 里特定时机弹 toast：
- 生词本到 5：见上 E.4
- 生词本到 20：`'练习 Tab 已经积累了 4 段训练，要不要看看？'`
- 生词本到 50：`'你已经收了 50 个词，AI 给你专门做了 6 段训练'`

均触发 `profile.vocab_milestone` 埋点。

### E 任务校验

- [ ] 全新用户首次打开，默认在纯听 Tab，能正常上下滑 clip
- [ ] 切到练习 Tab，看到"解锁个性化训练"未解锁页，进度条 0/5
- [ ] 收藏第 5 个词，看到 toast，切回练习 Tab，看到"生成中"
- [ ] 等 ~20s（mock 或真 LLM 都行），刷新练习 Tab，看到 2 段 pending
- [ ] 点击一段，进入四遍训练，Pass 1 正常播放
- [ ] Pass 进行到一半，切回纯听 Tab，弹 confirm；选"否"留在练习；选"是"切出去
- [ ] grep `'learn'`、`Phase 1`、`teaching` 在 `index.html` 主代码路径里返回 0
- [ ] 旧用户的 `flipodTeachingLog` localStorage 不会让页面崩（兼容性：读到老字段直接忽略）

### CLAUDE.md 必守约束

- 音频懒加载：练习 Tab 的 audio 元素只在 `_renderPass` 时创建，不预加载
- play() 失败必须 catch 并回退 `isPlaying` 状态
- 菜单关闭逻辑保留对 `.menu-panel` 和 `.menu-btn` 的排除
- 速度持久化：D 任务的 `audio.playbackRate` 不要写 `flipodSpeed`（那是纯听用的），用 `flipodPracticeRate` 或直接从 CEFR 表算

---

## 两个任务的依赖关系

- D 不依赖 C（D 用现有 CEFR-J，overrides 来了自动生效，无需改 D）
- E 不依赖 D（E 是 UI 框架，D 是行为参数）
- E 不依赖 C
- 三个 PR 可以并行 review，建议合并顺序：C → D → E（让 retag 后的 difficulty 在 E 上线前先到位）

---

## 问题升级

- 删 Phase 1-4 时发现某段代码被纯听 Feed 也用 → 停下，跟 Jamesvd 确认是否真的要删
- 适配表 4 行规则在某些 edge case 下导致 UX 反常（比如 A2 用户 0.85x 听不清因为 TTS 引擎问题）→ 先记录数据，PR 评论里讨论是否要二次 tuning
- E 完成后整体跑通验收：Jamesvd 桌面 Cowork Claude 会做视觉 QA（截图 + check 每个状态的 UI 是否符合 PRD 第七章 mock）

---

## 2026-04-17 Correction (B28 · rate 注入)

本 brief 第 50-64 行示例里给的 `audio.playbackRate` 路径**在 v3 代码里早已用的是 `/api/tts` + `new Audio()` 方案（已正确注入），但 `CEFR_ADAPTATION.rate` 作为单数字 per-level 字段无法按 Pass 递增**（B1 Pass 1 应 0.85x，实际一直是 0.94x）。修正见 `CC-BRIEF-TaskD-rate-injection-correction.md`：把 `CEFR_ADAPTATION.rate` 移除，改用 `CEFR_PASS_RATE` 矩阵 + `getPassRate(passNum)` 在 `_playCurrentPass` 里注入。其他 3 个字段（`reviewCount` / `fadeDensity` / `maxReplay` / `fadeAdjacent`）保留。
