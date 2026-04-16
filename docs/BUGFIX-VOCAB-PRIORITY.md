# Bugfix: Phase 2 选词必须按用户行为优先级

> 把这个文件整份给 Claude Code。改动涉及 `teaching-module-v3.js` 的 `selectVocabWords()` 方法，以及 `index.html` 里传数据给 TeachingController 的部分。

---

## 问题

Phase 2 选词当前只按 CEFR 等级排序从 clip 的 words 里选 3 个。**完全忽略了用户在听的过程中收藏的词和点击查看翻译的词。** 这些词才是用户最需要学的。

---

## 规则（来自 TEACHING-RULES-v3.md）

选词最多 3 个，按以下优先级填充：

```
优先级 1：用户收藏词（flipodVocab）→ 如果这个 clip 里出现了用户生词本中的词，无条件选入
优先级 2：用户点击查看过翻译的词（tappedWordsThisSession）→ 过滤到用户等级 ±1 级
优先级 3：算法补齐 → 从 clip.words 中选 cefr = 用户等级+1 的词，排除 PN、null、A1、已知词
```

3 个名额先给优先级 1 填，有剩余给优先级 2 填，还有剩余才走优先级 3。

---

## 改动 1：index.html — 把点词记录传给 TeachingController

当前 `tappedWordsThisSession` 是 index.html 内部的局部变量（Set），TeachingController 访问不到。

在 `_startTeaching` 函数（约第 4672 行）创建 TeachingController 时，把点词记录传进去：

```javascript
// 找到 _startTeaching 函数，改 TeachingController 的创建
window._startTeaching = function(clipIndex) {
  // ... 现有的 panel 清理代码 ...

  // 新增：把当前 session 的点词记录传给 controller
  const tappedWords = window.tappedWordsThisSession
    ? new Set(window.tappedWordsThisSession)
    : new Set();

  const ctrl = new TeachingController(panel, clips[clipIndex], onFinish, tappedWords);
  // ... 后续代码不变 ...
};
```

同时，把 `tappedWordsThisSession` 暴露到 window 上，这样 TeachingController 能读到：

在 index.html 中定义 `tappedWordsThisSession` 的地方（约第 2967 行），加一行：
```javascript
const tappedWordsThisSession = new Set();
window.tappedWordsThisSession = tappedWordsThisSession; // 暴露给教学模块
```

---

## 改动 2：teaching-module-v3.js — constructor 接收 tappedWords

```javascript
constructor(panelEl, clipData, onFinish, tappedWords) {
  this.root = panelEl;
  this.clip = clipData;
  this.onFinish = onFinish;
  this.tappedWords = tappedWords || new Set(); // 用户本次听的时候点过的词
  // ... 其余不变 ...
}
```

---

## 改动 3：teaching-module-v3.js — 重写 selectVocabWords()

把当前的第 242-276 行整个替换为：

```javascript
selectVocabWords() {
  const userLevel = localStorage.getItem('flipodLevel') || 'B1';
  const userNum = CEFR_NUM[userLevel] || 3;
  const MAX_WORDS = 3;

  // 已知词集合（不选这些）
  const knownWords = new Set();
  try {
    const kw = JSON.parse(localStorage.getItem('flipodKnownWords') || '[]');
    kw.forEach(w => knownWords.add(w.toLowerCase()));
  } catch {}

  // 建一个 clip 内所有可选词的索引（word → {word, cefr, cefrNum, lineIndex, def}）
  const clipWordMap = new Map();
  for (let li = 0; li < this.clip.lines.length; li++) {
    const line = this.clip.lines[li];
    for (const w of (line.words || [])) {
      const cefr = w.cefr;
      if (!cefr || cefr === 'PN' || cefr === 'A1') continue;
      const num = CEFR_NUM[cefr];
      if (!num) continue;
      const lower = w.word.toLowerCase();
      if (knownWords.has(lower)) continue;
      if (clipWordMap.has(lower)) continue;
      const def = WORD_DEFS[lower] || '查看释义';
      clipWordMap.set(lower, { word: w.word, cefr, cefrNum: num, lineIndex: li, def });
    }
  }

  const selected = [];
  const usedWords = new Set();

  // ── 优先级 1：用户生词本中的词，如果在这个 clip 里出现了 ──
  try {
    const savedVocab = JSON.parse(localStorage.getItem('flipodVocab') || '[]');
    for (const v of savedVocab) {
      if (selected.length >= MAX_WORDS) break;
      const lower = v.word?.toLowerCase();
      if (!lower || usedWords.has(lower)) continue;
      const clipWord = clipWordMap.get(lower);
      if (clipWord) {
        clipWord.behaviorTag = '你收藏了这个词';
        selected.push(clipWord);
        usedWords.add(lower);
      }
    }
  } catch {}

  // ── 优先级 2：用户听的时候点击查看过翻译的词 ──
  for (const tapped of this.tappedWords) {
    if (selected.length >= MAX_WORDS) break;
    const lower = tapped.toLowerCase();
    if (usedWords.has(lower)) continue;
    const clipWord = clipWordMap.get(lower);
    if (!clipWord) continue;
    // 过滤到用户等级 ±1
    if (Math.abs(clipWord.cefrNum - userNum) <= 1) {
      clipWord.behaviorTag = '你查过这个词';
      selected.push(clipWord);
      usedWords.add(lower);
    }
  }

  // ── 优先级 3：算法补齐（目标 = 用户等级 +1） ──
  const targetNum = userNum + 1;
  const remaining = [...clipWordMap.values()]
    .filter(w => !usedWords.has(w.word.toLowerCase()))
    .sort((a, b) => {
      const da = Math.abs(a.cefrNum - targetNum);
      const db = Math.abs(b.cefrNum - targetNum);
      if (da !== db) return da - db;
      return b.cefrNum - a.cefrNum;
    });

  for (const w of remaining) {
    if (selected.length >= MAX_WORDS) break;
    selected.push(w);
    usedWords.add(w.word.toLowerCase());
  }

  this.state.vocabWords = selected;
}
```

---

## 改动 4：teaching-module-v3.js — renderPhase2() 显示行为标签

在词卡渲染里，如果 `w.behaviorTag` 存在，显示一个小标签。找到 `renderPhase2()` 里生成词卡 HTML 的部分（约第 290-311 行），在 `vocab-card__top` 下面加：

```javascript
const behaviorHTML = w.behaviorTag
  ? `<span class="vocab-behavior-tag">${this.esc(w.behaviorTag)}</span>`
  : '';

// 插入到 vocab-card__top 和 vocab-zh 之间
return `
  <div class="vocab-card" data-index="${i}">
    <div class="vocab-card__top">
      <span class="vocab-word">${this.esc(w.word)}</span>
      <span class="cefr-pill ${cefrClass}">${w.cefr}</span>
    </div>
    ${behaviorHTML}
    <p class="vocab-zh">${this.esc(w.def)}</p>
    ... 后面不变 ...
  </div>`;
```

CSS 里 `.vocab-behavior-tag` 样式已经在 teaching-v3.css 里了（第 206-211 行），不需要额外加。

---

## 验收

- [ ] 在 clip 播放过程中点击一个词查看翻译 → 播完后 Phase 2 词卡里出现这个词，标签显示「你查过这个词」
- [ ] 如果 flipodVocab 里有词恰好在当前 clip 中出现 → Phase 2 优先显示，标签「你收藏了这个词」
- [ ] 行为词不足 3 个时，算法自动补齐到 3 个（无标签）
- [ ] 行为词超过 3 个时，只取前 3 个（收藏优先于点击）
- [ ] 没有任何行为词时，退回到纯算法选词（现有逻辑，不变）
