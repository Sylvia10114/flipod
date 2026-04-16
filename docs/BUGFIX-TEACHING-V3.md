# Teaching v3 Bugfix — 5 个 bug 一次修完

> 把这个文件整份给 Claude Code。改的文件只有两个：`teaching-module-v3.js` 和 `styles/teaching-v3.css`。

---

## Bug 1：词卡中文翻译是整句翻译，不是词义

**现象**：Phase 2 词卡里 "particular" 的中文显示为 "当天那些书是怎么摆到那儿的。"（整行 `lines[].zh`），应该显示 "特定的；特别的"。

**根因**：`teaching-module-v3.js` 第 279-284 行的 `extractDef()` fallback 直接返回了 `line.zh`（整句翻译），不是词义。

**修复**：

1. 扩充 `WORD_DEFS` 字典，把 demo 用到的 3 个 clip 里所有 B1+ 词都加进去。至少包含：`particular`（特定的；特别的）、`literally`（字面上地；确实）、`found`（创立；建立）、`assortment`（各类；混合）、`managed`（设法做到）、`shelf`（书架）、`slim`（微薄的）、`margin`（利润率）、`anticipate`（预期）、`optimistic`（乐观的）、`resilient`（有韧性的）、`congressional`（国会的）、`medal`（奖章）、`veteran`（退伍军人）、`honor`（荣誉）。

2. 改 `extractDef()` fallback：如果 `WORD_DEFS` 查不到，**不要**返回 `line.zh`，改为返回 `"查看释义"` 占位文本。永远不要用整句翻译冒充词义。

```javascript
// 第 279-284 行，改为：
extractDef(word, lineIndex) {
  // NEVER use line.zh as word definition — it's a full sentence translation
  return '查看释义';
}
```

---

## Bug 2：连线配对右列中文竖排显示 + 左右不对称

**现象**：Phase 3 的右列中文释义每个字符竖着排列，英文和中文没有左右对称分布。

**根因**：`.match-board` 的 `grid-template-columns: 1fr 32px 1fr` 没有生效，可能是 `.match-col--zh` 的宽度被挤压。`.match-item` 的中文文本在极窄的容器里逐字换行。

**修复**：在 `styles/teaching-v3.css` 中，确保以下样式正确：

```css
/* 强制 match-board 为 grid 且给足宽度 */
.match-board {
  display: grid;
  grid-template-columns: 1fr 32px 1fr;
  gap: 12px;
  align-items: start;       /* 改 stretch 为 start，避免拉伸 */
  position: relative;
  padding: 4px 0;
  width: 100%;              /* 确保占满父容器 */
}

/* 两列都必须有最小宽度 */
.match-col {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;             /* 允许 grid 正常收缩 */
}

/* 确保文字横排（排除 writing-mode 干扰） */
.match-item {
  writing-mode: horizontal-tb;   /* 强制横排 */
  text-align: center;
  word-break: keep-all;          /* 中文不逐字换行 */
  white-space: normal;
  min-height: 48px;              /* 保证最小点击区域 */
  display: flex;
  align-items: center;
  justify-content: center;
}
```

同时检查 `.teaching-panel` 或 `.tp-phase` 是否有 `overflow: hidden` 或固定宽度限制导致 grid 被压缩。如果有，去掉。

---

## Bug 3：Phase 1 答错后出现多个反馈条（3 个不同 clip 的解释同时显示）

**现象**：在 clip "美联储加息" 上选错答案后，底部同时出现 3 个反馈框，分别是 Fisher/书店、Tuskegee Airmen、美联储 的 `explanation_zh`。应该只显示当前题目的 1 条解释。

**根因**：多个 TeachingController 实例同时活跃，或者 DOM 中有多个 `.teaching-panel` 同时可见，导致多个 panel 的 gist 选项都接收了点击事件。

**修复**：

1. 在 `handleGistAnswer()` 开头加防重入检查：
```javascript
handleGistAnswer(el) {
  // 防止重复触发
  if (this.state.gistCorrect !== null) return;
  // ... 原有逻辑
}
```

2. 在 index.html 的集成代码中，确保同一时间只有**一个** TeachingController 实例活跃。创建新的 controller 前，先销毁旧的：
```javascript
// 在 index.html 的集成逻辑里
if (window._activeTeachingCtrl) {
  window._activeTeachingCtrl.destroy();  // 需要在 TeachingController 中加 destroy 方法
}
window._activeTeachingCtrl = new TeachingController(panelEl, clipData, onFinish);
```

3. 给 TeachingController 加 `destroy()` 方法，移除事件监听 + 清空 DOM：
```javascript
destroy() {
  this.root.innerHTML = '';
  this.root.classList.remove('is-visible');
  // 用 AbortController 或 clone+replace 方式移除 click listener
}
```

4. 确保 `.teaching-panel.is-visible` 在同一时间只有一个元素拥有这个类。在 `enter()` 方法开头加：
```javascript
document.querySelectorAll('.teaching-panel.is-visible').forEach(p => {
  if (p !== this.root) p.classList.remove('is-visible');
});
```

---

## Bug 4：Phase 3 连线配对文字颜色不可见

**现象**：连线配对界面里英文和中文文字都很难看到，几乎与背景融为一体。

**根因**：`.match-item` 的 `color: rgba(255,255,255,.87)` 是暗色主题文字色，但截图显示当前页面背景是浅色的（index.html 的 `.teaching-panel` 背景用了 `var(--bg-primary)` 可能是浅色）。深色文字 on 深色背景 = 看不见。

**修复**：

方案 A（推荐）：让教学面板强制用暗色主题。在 `.teaching-panel` 上设置自己的 CSS 变量覆盖：

```css
.teaching-panel {
  --bg-primary: #0C0C0E;
  --text-1: rgba(255,255,255,.87);
  --text-2: rgba(255,255,255,.55);
  --text-3: rgba(255,255,255,.30);
  --accent: #8B9CF7;
  background: var(--bg-primary);
  color: var(--text-1);
}
```

方案 B：如果现有 index.html 是浅色主题，把 `.match-item` 的颜色改为适配浅色背景：
```css
.match-item {
  color: #1a1a1a;
  background: rgba(0,0,0,.05);
  border-color: rgba(0,0,0,.12);
}
```

**选方案 A**。教学面板应该始终暗色，跟 Pencil 设计稿保持一致。确保 `.teaching-panel` 内所有组件的颜色都从这些 CSS 变量继承。

---

## Bug 5：Phase 4 总结卡缺少边框 + 元素未对齐

**现象**：统计数字（3 / ✓ / 0/3）、词汇 pill、难度选择之间没有视觉分组，看起来松散无结构。

**修复**：在 `styles/teaching-v3.css` 中加强 Phase 4 的样式：

```css
/* 统计格子加明确边框 */
.tp-stat {
  border: 1px solid rgba(255,255,255,.08);
}

/* 难度反馈区域加边框和 padding */
.tp-difficulty {
  padding: 16px;
  border-radius: 12px;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.08);
  margin-bottom: 20px;
}

/* 确保所有 Phase 4 子元素之间有一致的间距 */
.tp-phase > *:not(:last-child) {
  margin-bottom: 16px;
}

/* 统计数字文本对齐 */
.tp-stat {
  text-align: center;
}
.tp-stat .n {
  display: block;
  text-align: center;
}
.tp-stat .lab {
  display: block;
  text-align: center;
}
```

---

## 修复顺序

1. 先修 Bug 4（颜色不可见）— 这样后续改动都能看到效果
2. 再修 Bug 2（连线布局竖排）
3. 再修 Bug 1（词卡翻译）
4. 再修 Bug 3（多个反馈条）
5. 最后修 Bug 5（总结卡样式）

每修完一个，刷新浏览器确认效果再改下一个。

---

## 验收

- [ ] Phase 2 词卡："particular" 显示为 "特定的；特别的"，不是整句中文
- [ ] Phase 3 连线：左列英文 / 右列中文 水平横排，左右对称，文字清晰可见
- [ ] Phase 3 连线：点击英文词高亮 + TTS，配对正确变绿，配对错误 shake
- [ ] Phase 1 答错：只出现 1 个反馈条（当前题目的解释），不是 3 个
- [ ] Phase 4 总结：统计格有边框，元素垂直对齐，视觉分组清晰
- [ ] 无 console error
